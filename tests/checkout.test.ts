import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoritativeLines, CHECKOUT_MARKER, checkoutConfiguration,
  CheckoutError, parseCheckoutKey, parseCheckoutLines, paymentStatus,
} from '../api/_lib/checkout.js';
import { requestCheckout, checkoutErrorMessage, checkoutAttemptKey, type CheckoutAttemptStorage } from '../lib/checkout.js';
import type { AppStateItem } from '../api/_lib/db.js';
import checkoutHandler from '../api/checkout.js';

const configured = {
  CHECKOUT_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-key',
  PUBLIC_SITE_URL: 'https://shop.example',
  NODE_ENV: 'production',
};
const item = {
  id: 'watch-1', ebayItemId: 'source-1', titleRaw: 'Original watch', titleBoutique: 'Curated watch',
  publishStatus: 'PUBLISHED', status: 'ACTIVE', priceGbp: 2500.25, shippingGbp: 10,
} as AppStateItem;
const deps = (overrides: Partial<AppStateItem> = {}) => ({
  getItem: async () => ({ ...item, ...overrides }),
  getSourceOffer: async () => ({ priceGbp: 2500.25, shippingGbp: 10 }),
});
function storage(): CheckoutAttemptStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

test('checkout is disabled by default and fails closed for every missing required setting', () => {
  for (const field of Object.keys(configured).filter((name) => name !== 'NODE_ENV')) {
    const env = { ...configured, [field]: '' };
    assert.throws(() => checkoutConfiguration(env), (err) => err instanceof CheckoutError && err.status === 503);
  }
  assert.equal(checkoutConfiguration(configured).origin, 'https://shop.example');
});

test('checkout redirects require configured HTTPS site origin, never request headers or an embedded URL', () => {
  for (const value of ['http://shop.example', 'https://user:pass@shop.example', 'https://shop.example/redirect',
    'https://shop.example?url=https://evil.example', 'https://shop.example/#/']) {
    assert.throws(() => checkoutConfiguration({ ...configured, PUBLIC_SITE_URL: value }));
  }
  assert.equal(checkoutConfiguration({ ...configured, NODE_ENV: 'development', PUBLIC_SITE_URL: 'http://localhost:3000' }).origin, 'http://localhost:3000');
  assert.throws(() => checkoutConfiguration({ ...configured, NODE_ENV: 'development', VERCEL: '1', PUBLIC_SITE_URL: 'http://localhost:3000' }));
});

test('enabling checkout cannot accept live payments, including mismatched sandbox sourcing', () => {
  for (const stripeKey of ['sk_live_fixture', 'rk_live_fixture', 'pk_test_fixture', 'unknown_key']) {
    for (const ebayEnv of ['production', 'sandbox']) {
      assert.throws(() => checkoutConfiguration({ ...configured, STRIPE_SECRET_KEY: stripeKey, EBAY_ENV: ebayEnv }));
    }
  }
  assert.doesNotThrow(() => checkoutConfiguration({ ...configured, STRIPE_SECRET_KEY: 'rk_test_fixture' }));
});

test('checkout endpoint returns an explicit unavailable error while disabled', async () => {
  const previous = process.env.CHECKOUT_ENABLED;
  delete process.env.CHECKOUT_ENABLED;
  const headers: Record<string, string> = {};
  let result: any;
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    end: (value: string) => { result = JSON.parse(value); },
  };
  try {
    await checkoutHandler({ method: 'POST', body: { lines: [{ id: 'x', qty: 1, priceGbp: 0.01 }] } }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(result, { error: 'CHECKOUT_UNAVAILABLE' });
    assert.equal(headers['Cache-Control'], 'no-store');
  } finally {
    if (previous === undefined) delete process.env.CHECKOUT_ENABLED;
    else process.env.CHECKOUT_ENABLED = previous;
  }
});

test('unique one-off stock rejects duplicate IDs, invalid quantities and malformed baskets', () => {
  const invalid = [null, {}, { lines: [] }, { lines: Array(21).fill({ id: 'x', qty: 1 }) },
    { lines: [{ id: 'x', qty: 1 }, { id: 'x', qty: 1 }] },
    ...[0, -1, 2, 1.5, '1', null, undefined, NaN, Infinity].map((qty) => ({ lines: [{ id: 'x', qty }] })),
    ...['', ' x', 'x ', 'x\n', 'x'.repeat(201)].map((id) => ({ lines: [{ id, qty: 1 }] }))];
  for (const body of invalid) assert.throws(() => parseCheckoutLines(body), CheckoutError);
});

test('checkout requests require a valid opaque UUID retry key', () => {
  const key = 'b329421e-868e-436c-9682-ea68fc086d97';
  assert.equal(parseCheckoutKey({ checkoutKey: key.toUpperCase() }), key);
  for (const value of [undefined, '', 2, 'watch-1', key + 'x']) {
    assert.throws(() => parseCheckoutKey({ checkoutKey: value }), CheckoutError);
  }
});

test('tampered browser price and title cannot control Stripe line items', async () => {
  const requested = parseCheckoutLines({ lines: [{ id: 'watch-1', qty: 1, priceGbp: 0.01, title: 'Forged' }] });
  const actual = await authoritativeLines(requested, deps());
  assert.equal(actual[0].price_data.unit_amount, 250025);
  assert.equal(actual[0].price_data.product_data.name, 'Curated watch');
  assert.equal(actual[0].quantity, 1);
});

test('checkout refuses unpublished, unavailable, missing or invalid-priced inventory', async () => {
  for (const override of [{ publishStatus: 'DRAFT' }, { publishStatus: 'UNPUBLISHED' },
    { status: 'SOLD' }, { status: 'ENDED' }, { priceGbp: 0 }, { priceGbp: NaN }, { priceGbp: Infinity }, { shippingGbp: -1 }]) {
    await assert.rejects(authoritativeLines([{ id: 'watch-1', qty: 1 }], deps(override as Partial<AppStateItem>)), CheckoutError);
  }
  await assert.rejects(authoritativeLines([{ id: 'missing', qty: 1 }], { ...deps(), getItem: async () => null }), CheckoutError);
});

test('checkout refuses disappeared sources, changed price/shipping, and provider failures', async () => {
  for (const offer of [null, { priceGbp: 2600, shippingGbp: 10 }, { priceGbp: 2500.25, shippingGbp: 20 }]) {
    await assert.rejects(authoritativeLines([{ id: 'watch-1', qty: 1 }], {
      ...deps(), getSourceOffer: async () => offer,
    }), CheckoutError);
  }
  await assert.rejects(authoritativeLines([{ id: 'watch-1', qty: 1 }], {
    ...deps(), getSourceOffer: async () => { throw new Error('source unavailable'); },
  }));
});

test('a success URL alone cannot confirm payment; only a paid complete MVW session can', () => {
  assert.throws(() => paymentStatus({ status: 'complete', payment_status: 'paid', mode: 'payment' }), CheckoutError);
  const metadata = { checkout_origin: CHECKOUT_MARKER };
  for (const state of [
    { status: 'complete', payment_status: 'unpaid' },
    { status: 'open', payment_status: 'paid' },
    { status: 'expired', payment_status: 'unpaid' },
    { status: 'complete', payment_status: 'no_payment_required' },
  ]) assert.equal(paymentStatus({ ...state, metadata, mode: 'payment' }).paid, false);
  assert.equal(paymentStatus({ metadata, mode: 'payment', status: 'complete', payment_status: 'paid' }).paid, true);
  assert.throws(() => paymentStatus({ metadata, mode: 'subscription', status: 'complete', payment_status: 'paid' }), CheckoutError);
});

test('frontend rejects failed responses, missing redirect URLs and unsafe redirects', async () => {
  const responses = [
    new Response(JSON.stringify({ id: 'cs_test_fixture', status: 'open', url: 'https://checkout.stripe.com/pay' }), { status: 500 }),
    new Response(JSON.stringify({ ok: true, configured: false })),
    new Response('not-json'),
    ...['javascript:alert(1)', 'https://checkout.stripe.com.evil.example/pay', 'https://evil.example/', 'http://checkout.stripe.com/pay'].map((url) => new Response(JSON.stringify({ id: 'cs_test_fixture', status: 'open', url }))),
  ];
  for (const response of responses) {
    await assert.rejects(requestCheckout([{ id: 'watch-1', qty: 1 }], async () => response, storage()));
  }
});

test('frontend sends only identifiers and quantity, accepts only a successful Stripe redirect', async () => {
  let payload: any;
  const result = await requestCheckout([{ id: 'watch-1', qty: 1, priceGbp: 0.01 } as any], async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: 'cs_test_fixture', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }));
  }, storage());
  assert.deepEqual(payload.lines, [{ id: 'watch-1', qty: 1 }]);
  assert.equal(parseCheckoutKey(payload), payload.checkoutKey);
  assert.equal(result, 'https://checkout.stripe.com/c/pay/cs_test_fixture');
  assert.match(checkoutErrorMessage(new Error('private provider detail')), /currently unavailable/);
});

test('browser retry key remains stable for the same basket regardless of display order', () => {
  const attempts = storage();
  const first = checkoutAttemptKey([{ id: 'watch-2', qty: 1 }, { id: 'watch-1', qty: 1 }], attempts);
  assert.equal(checkoutAttemptKey([{ id: 'watch-1', qty: 1 }, { id: 'watch-2', qty: 1 }], attempts), first);
  assert.notEqual(checkoutAttemptKey([{ id: 'watch-1', qty: 1 }], attempts), first);
});

test('ambiguous network or server failures preserve the browser retry key', async () => {
  const attempts = storage();
  const lines = [{ id: 'watch-1', qty: 1 }];
  const key = checkoutAttemptKey(lines, attempts);
  await assert.rejects(requestCheckout(lines, async () => { throw new Error('connection lost'); }, attempts));
  assert.equal(checkoutAttemptKey(lines, attempts), key);
  await assert.rejects(requestCheckout(lines, async () => new Response(JSON.stringify({ error: 'CHECKOUT_UNAVAILABLE' }), { status: 503 }), attempts));
  assert.equal(checkoutAttemptKey(lines, attempts), key);
});

test('only confirmed expiration retires a browser retry key for the next user action', async () => {
  const attempts = storage();
  const lines = [{ id: 'watch-1', qty: 1 }];
  const key = checkoutAttemptKey(lines, attempts);
  await assert.rejects(requestCheckout(lines, async () => new Response(JSON.stringify({ error: 'CHECKOUT_EXPIRED' }), { status: 409 }), attempts));
  assert.notEqual(checkoutAttemptKey(lines, attempts), key);
});

test('browser never starts checkout if it cannot persist the retry key', async () => {
  let requests = 0;
  const attempts = { ...storage(), setItem: () => { throw new Error('storage unavailable'); } };
  await assert.rejects(requestCheckout([{ id: 'watch-1', qty: 1 }], async () => {
    requests++;
    return new Response('{}');
  }, attempts));
  assert.equal(requests, 0);
});

test('retry of a completed session opens payment verification without starting another payment', async () => {
  const result = await requestCheckout([{ id: 'watch-1', qty: 1 }], async () =>
    new Response(JSON.stringify({ id: 'cs_test_fixture', status: 'complete' })), storage());
  assert.equal(result, '/#/checkout/success?session_id=cs_test_fixture');
});
