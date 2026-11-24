import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Category } from '../types.js';
import { DEFAULT_PRICING_POLICY, pricingForItem } from '../api/_lib/pricing.js';
import { stripeOrderParameters } from '../api/_lib/checkout-order.js';
import type { Order, ReserveOrderInput } from '../api/_lib/orders.js';
import { normalizeSettings } from '../api/_lib/db.js';

let db: PGlite;
const keyA = '00000000-0000-4000-8000-000000000001';
const keyB = '00000000-0000-4000-8000-000000000002';
const origin = 'https://mvw.example';
const settings = () => ({ marginPercent: { WATCH: 20, HANDBAG: 20, JEWELLERY: 20 }, pricingPolicy: { ...DEFAULT_PRICING_POLICY } });
const source = (id = 'watch-a') => ({ priceGbp: id === 'watch-a' ? 2500 : 3500, shippingGbp: id === 'watch-a' ? 10 : 0, category: Category.WATCH });
const quote = (id = 'watch-a') => {
  const pricing = pricingForItem(source(id), settings());
  return { itemId: id, amountPence: pricing.retailPricePence, pricing };
};
async function initialize(pricing = true) {
  const connection = new PGlite();
  await connection.exec('create role anon; create role authenticated; create role service_role;');
  await connection.exec((await readFile('db/schema.sql', 'utf8')).replace(/create extension if not exists pgcrypto;/i, ''));
  await connection.exec(await readFile('db/migrations/20261122_orders.sql', 'utf8'));
  if (pricing) await connection.exec(await readFile('db/migrations/20261122_retail_pricing.sql', 'utf8'));
  return connection;
}
async function seed(connection: PGlite) {
  await connection.exec('reset role; truncate public.stripe_events,public.inventory_reservations,public.order_lines,public.orders,public.items,public.settings cascade;');
  await connection.query("insert into public.settings(id,data) values('default',$1::jsonb)", [JSON.stringify(settings())]);
  await connection.exec(`insert into public.items(id,ebay_item_id,url,title_raw,title_boutique,price_gbp,shipping_gbp,
    seller_name,seller_feedback_percent,seller_feedback_score,category,location_country,image_urls,status,
    last_seen_at,first_seen_at,publish_state,score)
    values ('watch-a','v1|100|0','https://www.ebay.co.uk/itm/100','Source A','Reviewed A',2500,10,
      'seller',100,500,'WATCH','GB','[]','ACTIVE',now(),now(),'PUBLISHED',90),
    ('watch-b','v1|200|0','https://www.ebay.co.uk/itm/200','Source B',null,3500,0,
      'seller',100,500,'WATCH','GB','[]','ACTIVE',now(),now(),'PUBLISHED',90);`);
}
async function sqlQuote(price: number, shipping: number, policy = settings()) {
  return (await db.query<{ quote: unknown }>('select public.mvw_pricing_quote($1::numeric,$2::numeric,$3,$4::jsonb) as quote', [price, shipping, 'WATCH', JSON.stringify(policy)])).rows[0].quote;
}
async function reserve(lines: ReserveOrderInput['lines'] | any[] = [quote()], key = keyA, connection = db): Promise<Order> {
  return (await connection.query<{ order: Order }>('select public.mvw_reserve_order($1::uuid,$2,$3::jsonb) as "order"', [key, origin, JSON.stringify(lines)])).rows[0].order;
}
async function assertNoReservation() {
  assert.equal((await db.query('select * from public.orders')).rows.length, 0);
  assert.equal((await db.query('select * from public.inventory_reservations')).rows.length, 0);
  assert.equal((await db.query<{ status: string }>("select status from public.items where id='watch-a'")).rows[0].status, 'ACTIVE');
}

before(async () => { db = await initialize(); });
beforeEach(async () => { await seed(db); });
after(async () => { await db.close(); });

test('SQL and TypeScript pricing agree on source shipping, true gross margin, rounding and fee estimates', async () => {
  for (const [priceGbp, shippingGbp] of [[2352.70, 0], [2709.70, 15.95], [2500.25, 10], [0.50, 0], [12345.67, 89.12]]) {
    for (const margin of [5, 20, 23.45, 60]) {
      for (const roundingPence of [100, 500, 1000]) {
        const policy = settings();
        policy.marginPercent.WATCH = margin;
        policy.pricingPolicy.roundingPence = roundingPence;
        assert.deepEqual(await sqlQuote(priceGbp, shippingGbp, policy), pricingForItem({ priceGbp, shippingGbp, category: Category.WATCH }, policy));
      }
    }
  }
  assert.equal((await sqlQuote(2352.70, 0) as any).retailPricePence, 300500);
  assert.equal((await sqlQuote(2709.70, 15.95) as any).retailPricePence, 347000);
});

test('SQL defaults only missing pricing policy and rejects invalid settings or fractional source pennies', async () => {
  const legacy = { marginPercent: settings().marginPercent };
  const actual = (await db.query<{ quote: unknown }>('select public.mvw_pricing_quote(2500,10,\'WATCH\',$1::jsonb) as quote', [JSON.stringify(legacy)])).rows[0].quote;
  assert.deepEqual(actual, pricingForItem(source(), legacy));
  for (const policy of [null, {}, { ...DEFAULT_PRICING_POLICY, vatMode: 'MARGIN_SCHEME' },
    { ...DEFAULT_PRICING_POLICY, deliveryAllowancePence: -1 }, { ...DEFAULT_PRICING_POLICY, feeAllowanceBps: 1001 },
    { ...DEFAULT_PRICING_POLICY, feeFixedPence: 1.5 }, { ...DEFAULT_PRICING_POLICY, roundingPence: 99 }]) {
    await assert.rejects(sqlQuote(2500, 10, { ...settings(), pricingPolicy: policy } as any), /INVALID_PRICING_SETTINGS/);
  }
  for (const margin of [0, 100, 20.001, '20', null]) {
    await assert.rejects(sqlQuote(2500, 10, { ...settings(), marginPercent: { ...settings().marginPercent, WATCH: margin } } as any), /INVALID_PRICING_SETTINGS/);
  }
  for (const [price, shipping] of [[0.49, 0], [2500.001, 10], [2500, -1], [2500, 10.001], [999999.99, 0]]) {
    await assert.rejects(sqlQuote(price, shipping), /ITEM_UNAVAILABLE/);
  }
});

test('SQL legacy margin normalization matches settings defaults while explicit malformed maps fail closed', async () => {
  for (const raw of [{}, { marginPercent: {} }, { marginPercent: { HANDBAG: 25 } }, { marginPercent: { WATCH: 23.45 } }]) {
    assert.deepEqual(await sqlQuote(2500, 10, raw as any), pricingForItem(source(), normalizeSettings(raw)));
  }
  for (const marginPercent of [null, [], '20', { UNKNOWN: 20 }, { WATCH: null }, { HANDBAG: 100 }]) {
    assert.throws(() => normalizeSettings({ marginPercent }));
    await assert.rejects(sqlQuote(2500, 10, { marginPercent } as any), /INVALID_PRICING_SETTINGS/);
  }
});

test('new reservation snapshots retail and source breakdown per watch including separate delivery allowances', async () => {
  const order = await reserve([quote('watch-b'), quote('watch-a')]);
  assert.equal(order.totalPence, 764000);
  assert.equal(order.lines.length, 2);
  assert.deepEqual(order.lines[0].pricing, quote().pricing);
  assert.equal(order.lines[0].amountPence, 320000);
  assert.equal(order.lines[1].amountPence, 444000);
  assert.equal(order.lines[0].pricing?.deliveryAllowancePence, 5000);
  assert.equal(order.lines[1].pricing?.deliveryAllowancePence, 5000);
  assert.equal((await db.query('select * from public.inventory_reservations')).rows.length, 2);
  const params = stripeOrderParameters(order);
  assert.equal(params.line_items?.[0].price_data?.unit_amount, 320000);
  assert.equal(params.line_items?.[0].price_data?.product_data?.description, 'UK delivery included');
  assert.equal(Object.hasOwn(params, 'shipping_options'), false);
});

test('price or shipping changes after the source quote abort the whole basket', async () => {
  for (const field of ['price_gbp', 'shipping_gbp']) {
    await seed(db);
    const quoted = [quote('watch-a'), quote('watch-b')];
    await db.exec(`update public.items set ${field}=${field}+0.01 where id='watch-b'`);
    await assert.rejects(reserve(quoted), /ITEM_CHANGED/);
    await assertNoReservation();
  }
});

test('retail tampering, missing quote and policy changes cannot reserve an incorrectly priced order', async () => {
  await assert.rejects(reserve([{ itemId: 'watch-a', amountPence: 250000 }]), /PRICE_CHANGED/);
  await assert.rejects(reserve([{ ...quote(), amountPence: quote().amountPence - 500 }]), /PRICE_CHANGED/);
  await assert.rejects(reserve([{ ...quote(), pricing: { ...quote().pricing, retailPricePence: 50 } }]), /PRICE_CHANGED/);
  const quoted = quote();
  // Fee estimates do not change retail, but the immutable policy snapshot must still agree.
  await db.exec("update public.settings set data=jsonb_set(data,'{pricingPolicy,feeAllowanceBps}','400') where id='default'");
  await assert.rejects(reserve([quoted]), /PRICE_CHANGED/);
  await assertNoReservation();
});

test('new pricing snapshots and Stripe parameters remain fixed after source or policy changes', async () => {
  const original = await reserve();
  const params = stripeOrderParameters(original);
  await db.exec("update public.items set price_gbp=5000,shipping_gbp=100 where id='watch-a'; update public.settings set data='null' where id='default';");
  const retry = await reserve([{ itemId: 'watch-a', amountPence: 50 }]);
  assert.deepEqual(retry, original);
  assert.deepEqual(stripeOrderParameters(retry), params);
  await assert.rejects(reserve([quote('watch-b')]), /CHECKOUT_KEY_REUSED/);
});

test('migration preserves historical source-price orders and exact Stripe retry parameters without inventing costs', async () => {
  const old = await initialize(false);
  try {
    await seed(old);
    const original = await reserve([{ itemId: 'watch-a', amountPence: 250000 }], keyA, old);
    await old.query('select public.mvw_attach_checkout_session($1::uuid,$2)', [original.id, 'cs_test_historical']);
    const params = stripeOrderParameters(original);
    await old.exec(await readFile('db/migrations/20261122_retail_pricing.sql', 'utf8'));
    await old.exec("update public.settings set data='null'; update public.items set price_gbp=9999,shipping_gbp=999;");
    const retried = await reserve([{ itemId: 'watch-a', amountPence: 50 }], keyA, old);
    assert.equal(retried.id, original.id);
    assert.equal(retried.totalPence, 250000);
    assert.equal(retried.stripeSessionId, 'cs_test_historical');
    assert.equal(retried.lines[0].pricing, null);
    assert.deepEqual(stripeOrderParameters(retried), params);
    assert.equal(Object.hasOwn(params.line_items![0].price_data!.product_data!, 'description'), false);
  } finally { await old.close(); }
});

test('signed payment accounting validates the retail total and stays idempotent with pricing snapshots', async () => {
  const order = await reserve();
  await db.query('select public.mvw_attach_checkout_session($1::uuid,$2)', [order.id, 'cs_test_retail']);
  const apply = async (eventId: string) => (await db.query<{ result: any }>(
    'select public.mvw_apply_stripe_event($1,$2,$3::uuid,$4,$5::bigint,$6,$7,false) as result',
    [eventId, 'checkout.session.completed', order.id, 'cs_test_retail', order.totalPence, 'gbp', 'paid'],
  )).rows[0].result;
  const first = await apply('evt_retail');
  assert.equal(first.order.status, 'paid_awaiting_source');
  assert.deepEqual(first.order.lines[0].pricing, order.lines[0].pricing);
  assert.equal((await apply('evt_retail')).duplicate, true);
  assert.equal((await db.query('select * from public.stripe_events')).rows.length, 1);
  assert.equal((await db.query('select * from public.inventory_reservations')).rows.length, 0);
});

test('new pricing RPCs preserve service-only order permissions and cannot bypass reservations', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(sqlQuote(2500, 10), /permission denied/);
      await assert.rejects(reserve(), /permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try {
    const order = await reserve();
    assert.equal(order.totalPence, 320000);
    await assert.rejects(db.exec("update public.order_lines set pricing_snapshot='{}'"), /permission denied/);
    await assert.rejects(reserve([quote()], keyB), /ITEM_UNAVAILABLE/);
  } finally { await db.exec('reset role'); }
});
