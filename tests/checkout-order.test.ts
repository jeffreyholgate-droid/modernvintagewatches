import test from 'node:test';
import assert from 'node:assert/strict';
import type { Order } from '../api/_lib/orders.js';
import { CheckoutError, CHECKOUT_MARKER } from '../api/_lib/checkout.js';
import { linkedPaymentStatus, startOrderCheckout, stripeOrderParameters, type CheckoutOrderDependencies } from '../api/_lib/checkout-order.js';

const now = Date.parse('2026-11-22T12:00:00Z');
const orderFixture = (): Order => ({
  id: '629654b2-5e6a-4c5d-bbf6-e9da3f1e2307',
  checkoutKey: 'b329421e-868e-436c-9682-ea68fc086d97',
  checkoutOrigin: 'https://original.example',
  status: 'pending_payment', totalPence: 250025, currency: 'gbp', stripeSessionId: null,
  createdAt: new Date(now).toISOString(),
  lines: [{ itemId: 'watch-1', title: 'Persisted title', amountPence: 250025, sourceUrl: 'https://www.ebay.co.uk/itm/123', ebayItemId: 'v1|123|0' }],
});
const input = () => ({ checkoutKey: orderFixture().checkoutKey, origin: 'https://original.example', lines: [{ id: 'watch-1', qty: 1 as const }] });
const sessionFixture = (order = orderFixture()) => ({
  id: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
  status: 'open' as const, payment_status: 'unpaid' as const, mode: 'payment' as const, livemode: false,
  amount_total: order.totalPence, currency: 'gbp',
  metadata: { checkout_origin: CHECKOUT_MARKER, order_id: order.id },
});

function harness(initialOrder: Order | null = null) {
  let stored = initialOrder;
  const calls = { quote: 0, reserve: 0, create: 0, retrieve: 0, attach: 0, keys: [] as string[], params: [] as unknown[] };
  const deps: CheckoutOrderDependencies = {
    now: () => now,
    getOrderByCheckoutKey: async () => stored,
    quote: async () => { calls.quote++; return [{ itemId: 'watch-1', amountPence: 250025 }]; },
    reserveOrder: async (args) => {
      calls.reserve++;
      stored ??= { ...orderFixture(), checkoutKey: args.checkoutKey, checkoutOrigin: args.checkoutOrigin };
      return stored;
    },
    createSession: async (params, key) => {
      calls.create++; calls.keys.push(key); calls.params.push(params);
      return sessionFixture(stored!);
    },
    retrieveSession: async () => { calls.retrieve++; return sessionFixture(stored!); },
    attachCheckoutSession: async (_id, sessionId) => {
      calls.attach++; stored = { ...stored!, stripeSessionId: sessionId }; return stored;
    },
  };
  return { deps, calls, current: () => stored };
}

test('new checkout quotes then reserves durable snapshots before creating and attaching Stripe session', async () => {
  const h = harness();
  const result = await startOrderCheckout(input(), h.deps);
  assert.equal(result.id, 'cs_test_fixture');
  assert.equal(h.current()?.stripeSessionId, result.id);
  assert.equal(h.calls.quote, 1); assert.equal(h.calls.reserve, 1); assert.equal(h.calls.create, 1); assert.equal(h.calls.attach, 1);
  assert.equal(h.calls.keys[0], `mvw-order:${orderFixture().id}`);
  assert.deepEqual(h.calls.params[0], stripeOrderParameters(orderFixture()));
});

test('repeated checkout reuses attached Stripe session without checking its own reserved inventory as ACTIVE', async () => {
  const h = harness({ ...orderFixture(), stripeSessionId: 'cs_test_fixture' });
  const result = await startOrderCheckout(input(), h.deps);
  assert.equal(result.id, 'cs_test_fixture');
  assert.equal(h.calls.quote, 0); assert.equal(h.calls.reserve, 0); assert.equal(h.calls.create, 0); assert.equal(h.calls.retrieve, 1);
});

test('ambiguous Stripe create retries use identical key and persisted parameters even if site config changes', async () => {
  const h = harness(orderFixture());
  const originalCreate = h.deps.createSession;
  let first = true;
  h.deps.createSession = async (params, key) => {
    const session = await originalCreate(params, key);
    if (first) { first = false; throw new Error('response lost after create'); }
    return session;
  };
  await assert.rejects(startOrderCheckout(input(), h.deps));
  assert.equal(h.current()?.stripeSessionId, null);
  await startOrderCheckout({ ...input(), origin: 'https://changed.example' }, h.deps);
  assert.deepEqual(h.calls.keys, [`mvw-order:${orderFixture().id}`, `mvw-order:${orderFixture().id}`]);
  assert.deepEqual(h.calls.params[0], h.calls.params[1]);
  assert.equal(h.calls.quote, 0);
});

test('failed attachment keeps the durable reservation and retries the same session creation key', async () => {
  const h = harness(orderFixture());
  const attach = h.deps.attachCheckoutSession;
  let first = true;
  h.deps.attachCheckoutSession = async (id, sessionId) => {
    if (first) { first = false; throw new Error('database unavailable'); }
    return attach(id, sessionId);
  };
  await assert.rejects(startOrderCheckout(input(), h.deps));
  assert.equal(h.current()?.status, 'pending_payment');
  await startOrderCheckout(input(), h.deps);
  assert.equal(h.calls.keys[0], h.calls.keys[1]);
});

test('same key with a different basket is refused before Stripe access', async () => {
  const h = harness(orderFixture());
  await assert.rejects(startOrderCheckout({ ...input(), lines: [{ id: 'different', qty: 1 }] }, h.deps),
    (err) => err instanceof CheckoutError && err.code === 'CHECKOUT_KEY_REUSED');
  assert.equal(h.calls.create + h.calls.retrieve + h.calls.quote, 0);
});

test('unresolved sessions older than 23h cannot be recreated after Stripe idempotency may expire', async () => {
  const h = harness({ ...orderFixture(), createdAt: new Date(now - 23 * 60 * 60 * 1000).toISOString() });
  await assert.rejects(startOrderCheckout(input(), h.deps), (err) => err instanceof CheckoutError && err.code === 'CHECKOUT_REVIEW_REQUIRED');
  assert.equal(h.calls.create, 0);
});

test('expired and review orders cannot start another payment', async () => {
  for (const status of ['expired', 'payment_review'] as const) {
    const h = harness({ ...orderFixture(), status });
    await assert.rejects(startOrderCheckout(input(), h.deps), CheckoutError);
    assert.equal(h.calls.create + h.calls.retrieve, 0);
  }
});

test('completed sessions return verification destination, never another payment URL', async () => {
  const h = harness({ ...orderFixture(), stripeSessionId: 'cs_test_fixture', status: 'paid_awaiting_source' });
  h.deps.retrieveSession = async () => ({ ...sessionFixture(), status: 'complete', payment_status: 'paid', url: null });
  assert.deepEqual(await startOrderCheckout(input(), h.deps), { id: 'cs_test_fixture', status: 'complete' });
  assert.equal(h.calls.create, 0);
});

test('public payment status requires database linkage, marker, test mode, amount and currency agreement', () => {
  const order = { ...orderFixture(), stripeSessionId: 'cs_test_fixture' };
  const paid = { ...sessionFixture(), status: 'complete' as const, payment_status: 'paid' as const };
  assert.deepEqual(linkedPaymentStatus(paid, order), { paid: true, status: 'complete', orderStatus: 'pending_payment', testMode: true });
  for (const change of [{ id: 'cs_test_wrong' }, { amount_total: 1 }, { currency: 'usd' }, { livemode: true },
    { metadata: { checkout_origin: CHECKOUT_MARKER, order_id: 'wrong' } }]) {
    assert.throws(() => linkedPaymentStatus({ ...paid, ...change }, order), CheckoutError);
  }
});
