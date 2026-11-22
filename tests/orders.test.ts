import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStripeEvent, attachCheckoutSession, getOrderByCheckoutKey, getOrderById,
  listRecentOrders, reserveOrder, type Order,
} from '../api/_lib/orders.js';
import { Category } from '../types.js';
import { pricingForItem } from '../api/_lib/pricing.js';

const pricing = pricingForItem({ priceGbp: 2500, shippingGbp: 10, category: Category.WATCH }, { marginPercent: { WATCH: 20, HANDBAG: 20, JEWELLERY: 20 } });
const quotedLine = { itemId: 'watch-a', amountPence: pricing.retailPricePence, pricing };

const orderId = '00000000-0000-4000-8000-000000000001';
const checkoutKey = '00000000-0000-4000-8000-000000000002';
const order = (): Order => ({
  id: orderId, checkoutKey, checkoutOrigin: 'https://mvw.example', status: 'pending_payment',
  totalPence: 250000, currency: 'gbp', stripeSessionId: null, createdAt: '2026-11-22T10:00:00Z',
  lines: [{ itemId: 'watch-a', title: 'Reviewed watch', amountPence: 250000, sourceUrl: 'https://www.ebay.co.uk/itm/100', ebayItemId: 'v1|100|0' }],
});
const pricedOrder = (): Order => ({ ...order(), totalPence: pricing.retailPricePence, lines: [{ ...order().lines[0], ...quotedLine }] });
async function withDatabase(response: (url: URL, payload: any) => Response, run: () => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mvw-test.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://mvw-test.supabase.invalid');
    assert.equal(init?.method, 'POST');
    return response(url, JSON.parse(String(init?.body)));
  };
  try { await run(); } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
}

test('order wrapper calls atomic reservation RPC with only expected fields', async () => {
  await withDatabase((url, payload) => {
    assert.equal(url.pathname, '/rest/v1/rpc/mvw_reserve_order');
    assert.deepEqual(payload, { p_checkout_key: checkoutKey, p_checkout_origin: 'https://mvw.example', p_lines: [quotedLine] });
    return Response.json({ ...pricedOrder(), private_detail: 'not returned' });
  }, async () => {
    const saved = await reserveOrder({ checkoutKey, checkoutOrigin: 'https://mvw.example', lines: [{ ...quotedLine, clientTitle: 'ignored' } as any] });
    assert.deepEqual(saved, pricedOrder());
  });
});

test('order wrapper validates input and blocks live sessions/events before network access', async () => {
  await withDatabase(() => { throw new Error('must not request provider'); }, async () => {
    await assert.rejects(reserveOrder({ checkoutKey, checkoutOrigin: 'https://mvw.example', lines: [{ ...quotedLine, amountPence: 0 }] }), /INVALID_ORDER/);
    await assert.rejects(reserveOrder({ checkoutKey, checkoutOrigin: 'https://user:password@mvw.example', lines: [quotedLine] }), /INVALID_ORDER/);
    await assert.rejects(reserveOrder({ checkoutKey, checkoutOrigin: 'https://mvw.example', lines: [{ itemId: 'watch-a', amountPence: 320000 } as any] }), /INVALID_ORDER/);
    await assert.rejects(getOrderById('not-a-uuid'), /INVALID_ORDER/);
    await assert.rejects(attachCheckoutSession(orderId, 'cs_live_real'), /INVALID_ORDER/);
    await assert.rejects(applyStripeEvent({ eventId: 'evt_live', type: 'checkout.session.completed', orderId,
      sessionId: 'cs_test_sessionA', amountTotal: 250000, currency: 'gbp', paymentStatus: 'paid', livemode: true }), /INVALID_EVENT/);
  });
});

test('order wrapper propagates safe conflict/race codes but sanitizes provider details', async () => {
  for (const message of ['CHECKOUT_KEY_REUSED', 'ITEM_UNAVAILABLE', 'ORDER_SESSION_PENDING', 'PRICE_CHANGED', 'secret provider connection detail']) {
    await withDatabase(() => Response.json({ message, code: 'P0001' }, { status: 400 }), async () => {
      await assert.rejects(getOrderById(orderId), { message: message.startsWith('secret') ? 'ORDER_STORAGE_UNAVAILABLE' : message });
    });
  }
});

test('order wrapper accepts missing order and strips checkout key from admin summaries', async () => {
  await withDatabase(url => url.pathname.endsWith('mvw_list_recent_orders') ? Response.json([order()]) : Response.json(null), async () => {
    assert.equal(await getOrderByCheckoutKey(checkoutKey), null);
    const recent = await listRecentOrders(50);
    assert.equal(recent[0].id, orderId);
    assert.equal(Object.hasOwn(recent[0], 'checkoutKey'), false);
  });
});

test('order wrapper rejects invalid stored totals rather than expose corrupt order data', async () => {
  await withDatabase(() => Response.json({ ...order(), totalPence: 1 }), async () => {
    await assert.rejects(getOrderById(orderId), /ORDER_STORAGE_UNAVAILABLE/);
  });
});

test('order wrapper validates complete immutable pricing snapshots but reads legacy null snapshots', async () => {
  for (const changed of [{ sourceShippingPence: -1 }, { retailPricePence: 50 }, { estimatedFeePence: 0 }, { vatMode: 'MARGIN_SCHEME' }]) {
    await withDatabase(() => Response.json({ ...pricedOrder(), lines: [{ ...pricedOrder().lines[0], pricing: { ...pricing, ...changed } }] }), async () => {
      await assert.rejects(getOrderById(orderId), /ORDER_STORAGE_UNAVAILABLE/);
    });
  }
  await withDatabase(() => Response.json(order()), async () => {
    const legacy = await getOrderById(orderId);
    assert.equal(legacy?.totalPence, 250000);
    assert.equal(legacy?.lines[0].pricing, null);
  });
});

test('order persistence never falls back to local memory', async () => {
  const old = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, memory: process.env.ALLOW_IN_MEMORY_DB };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ALLOW_IN_MEMORY_DB = 'true';
  try { await assert.rejects(getOrderById(orderId), /ORDER_STORAGE_UNAVAILABLE/); }
  finally {
    if (old.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old.url;
    if (old.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = old.key;
    if (old.memory === undefined) delete process.env.ALLOW_IN_MEMORY_DB; else process.env.ALLOW_IN_MEMORY_DB = old.memory;
  }
});
