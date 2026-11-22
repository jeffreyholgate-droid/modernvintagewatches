import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Order, StripeEventInput } from '../api/_lib/orders.js';

let db: PGlite;
const keyA = '00000000-0000-4000-8000-000000000001';
const keyB = '00000000-0000-4000-8000-000000000002';
const origin = 'https://mvw.example';

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const schema = (await readFile('db/schema.sql', 'utf8')).replace(/create extension if not exists pgcrypto;/i, '');
  await db.exec(schema);
  await db.exec(await readFile('db/migrations/20261122_orders.sql', 'utf8'));
});
beforeEach(async () => {
  await db.exec('reset role; truncate public.stripe_events, public.inventory_reservations, public.order_lines, public.orders, public.items cascade;');
  await db.exec(`insert into public.items(id,ebay_item_id,url,title_raw,title_boutique,price_gbp,shipping_gbp,
    seller_name,seller_feedback_percent,seller_feedback_score,category,location_country,image_urls,status,
    last_seen_at,first_seen_at,publish_state,score)
    values ('watch-a','v1|100|0','https://www.ebay.co.uk/itm/100','Source A','Reviewed A',2500,10,
      'seller',100,500,'WATCH','GB','[]','ACTIVE',now(),now(),'PUBLISHED',90),
    ('watch-b','v1|200|0','https://www.ebay.co.uk/itm/200','Source B',null,3500,0,
      'seller',100,500,'WATCH','GB','[]','ACTIVE',now(),now(),'PUBLISHED',90);`);
});
after(async () => { await db.close(); });

async function reserve(checkoutKey = keyA, lines = [{ itemId: 'watch-a', amountPence: 250000 }], checkoutOrigin = origin): Promise<Order> {
  const result = await db.query<{ order: Order }>('select public.mvw_reserve_order($1::uuid,$2,$3::jsonb) as "order"', [checkoutKey, checkoutOrigin, JSON.stringify(lines)]);
  return result.rows[0].order;
}
async function attach(orderId: string, sessionId = 'cs_test_sessionA') {
  return (await db.query<{ order: Order }>('select public.mvw_attach_checkout_session($1::uuid,$2) as "order"', [orderId, sessionId])).rows[0].order;
}
async function event(order: Order, overrides: Partial<StripeEventInput> = {}) {
  const input: StripeEventInput = {
    eventId: 'evt_paidA', type: 'checkout.session.completed', orderId: order.id,
    sessionId: 'cs_test_sessionA', amountTotal: order.totalPence, currency: 'gbp', paymentStatus: 'paid', livemode: false,
    ...overrides,
  };
  const result = await db.query<{ result: { order: Order; duplicate: boolean } }>(
    'select public.mvw_apply_stripe_event($1,$2,$3::uuid,$4,$5::bigint,$6,$7,$8) as result',
    [input.eventId, input.type, input.orderId, input.sessionId, input.amountTotal, input.currency, input.paymentStatus, input.livemode],
  );
  return result.rows[0].result;
}
async function item(id = 'watch-a') {
  return (await db.query<{ status: string; publish_state: string }>('select status,publish_state from public.items where id=$1', [id])).rows[0];
}
async function orderCount() { return Number((await db.query<{ n: number }>('select count(*) as n from public.orders')).rows[0].n); }

test('SQL reserves authoritative snapshots and prevents a second checkout taking the same watch', async () => {
  const order = await reserve();
  assert.equal(order.status, 'pending_payment');
  assert.equal(order.totalPence, 250000);
  assert.equal(order.checkoutOrigin, origin);
  assert.deepEqual(order.lines, [{ itemId: 'watch-a', title: 'Reviewed A', amountPence: 250000,
    sourceUrl: 'https://www.ebay.co.uk/itm/100', ebayItemId: 'v1|100|0' }]);
  assert.equal((await item()).status, 'RESERVED');
  await assert.rejects(reserve(keyB), /ITEM_UNAVAILABLE/);
  assert.equal(await orderCount(), 1);
});

test('SQL basket reservation is all-or-none for changed prices, missing items and duplicate IDs', async () => {
  await assert.rejects(reserve(keyA, [{ itemId: 'watch-a', amountPence: 250000 }, { itemId: 'watch-b', amountPence: 1 }]), /INVALID_ORDER/);
  await assert.rejects(reserve(keyA, [{ itemId: 'watch-a', amountPence: 250000 }, { itemId: 'watch-b', amountPence: 350001 }]), /ITEM_CHANGED/);
  await assert.rejects(reserve(keyA, [{ itemId: 'watch-a', amountPence: 250000 }, { itemId: 'missing', amountPence: 50000 }]), /ITEM_UNAVAILABLE/);
  await assert.rejects(reserve(keyA, [{ itemId: 'watch-a', amountPence: 250000 }, { itemId: 'watch-a', amountPence: 250000 }]), /INVALID_ORDER/);
  assert.equal((await item()).status, 'ACTIVE');
  assert.equal((await item('watch-b')).status, 'ACTIVE');
  assert.equal(await orderCount(), 0);
  assert.equal((await db.query('select * from public.inventory_reservations')).rows.length, 0);
});

test('SQL retries preserve saved prices, title and origin; a changed basket cannot reuse its key', async () => {
  const first = await reserve(keyA, [{ itemId: 'watch-b', amountPence: 350000 }, { itemId: 'watch-a', amountPence: 250000 }]);
  await db.exec("update public.items set price_gbp=5000,title_boutique='Changed while reserved'");
  const retry = await reserve(keyA, [{ itemId: 'watch-a', amountPence: 500000 }, { itemId: 'watch-b', amountPence: 500000 }], 'https://changed.example');
  assert.deepEqual(retry, first);
  await assert.rejects(reserve(keyA, [{ itemId: 'watch-a', amountPence: 500000 }]), /CHECKOUT_KEY_REUSED/);
  assert.equal(await orderCount(), 1);
});

test('SQL session attachment is idempotent and an early webhook retries without being consumed', async () => {
  const order = await reserve();
  await assert.rejects(event(order), /ORDER_SESSION_PENDING/);
  assert.equal((await db.query('select * from public.stripe_events')).rows.length, 0);
  const attached = await attach(order.id);
  assert.deepEqual(await attach(order.id), attached);
  await assert.rejects(attach(order.id, 'cs_test_other'), /SESSION_CONFLICT/);
  const paid = await event(order);
  assert.equal(paid.order.status, 'paid_awaiting_source');
});

test('SQL paid event is idempotent, sells only reserved stock and cannot be reversed by expiry', async () => {
  const order = await reserve();
  await attach(order.id);
  assert.equal((await event(order)).order.status, 'paid_awaiting_source');
  assert.deepEqual(await item(), { status: 'SOLD', publish_state: 'UNPUBLISHED' });
  assert.equal((await event(order)).duplicate, true);
  const expiry = await event(order, { eventId: 'evt_expiredA', type: 'checkout.session.expired', paymentStatus: 'unpaid' });
  assert.equal(expiry.order.status, 'paid_awaiting_source');
  assert.equal((await item()).status, 'SOLD');
  assert.equal((await db.query('select * from public.inventory_reservations')).rows.length, 0);
});

test('SQL unpaid and failed asynchronous events keep reservations; only matching expiry releases them', async () => {
  const order = await reserve();
  await attach(order.id);
  assert.equal((await event(order, { eventId: 'evt_unpaidA', paymentStatus: 'unpaid' })).order.status, 'pending_payment');
  assert.equal((await event(order, { eventId: 'evt_failedA', type: 'checkout.session.async_payment_failed', paymentStatus: 'unpaid' })).order.status, 'pending_payment');
  assert.equal((await item()).status, 'RESERVED');
  await db.exec("update public.items set publish_state='UNPUBLISHED' where id='watch-a'");
  const result = await event(order, { eventId: 'evt_expiredA', type: 'checkout.session.expired', paymentStatus: 'unpaid' });
  assert.equal(result.order.status, 'expired');
  assert.deepEqual(await item(), { status: 'ACTIVE', publish_state: 'UNPUBLISHED' });
});

test('SQL late payment after expiry enters review and cannot steal another order’s stock', async () => {
  const first = await reserve();
  await attach(first.id);
  await event(first, { eventId: 'evt_expiredA', type: 'checkout.session.expired', paymentStatus: 'unpaid' });
  const second = await reserve(keyB);
  await attach(second.id, 'cs_test_sessionB');
  const late = await event(first, { eventId: 'evt_lateA', type: 'checkout.session.async_payment_succeeded' });
  assert.equal(late.order.status, 'payment_review');
  const reservation = (await db.query<{ order_id: string }>('select order_id from public.inventory_reservations')).rows[0];
  assert.equal(reservation.order_id, second.id);
  assert.equal((await item()).status, 'RESERVED');
  await event(first, { eventId: 'evt_expiredAgain', type: 'checkout.session.expired', paymentStatus: 'unpaid' });
  assert.equal((await item()).status, 'RESERVED');
});

test('SQL amount/session/currency anomalies enter review without releasing or selling stock', async () => {
  const order = await reserve();
  await attach(order.id);
  const anomaly = await event(order, { amountTotal: 1 });
  assert.equal(anomaly.order.status, 'payment_review');
  await event(order, { eventId: 'evt_expiredA', type: 'checkout.session.expired', paymentStatus: 'unpaid' });
  assert.equal((await item()).status, 'RESERVED');
  await assert.rejects(event(order, { amountTotal: 2 }), /INVALID_EVENT/);
});

test('SQL rejects live events and unknown orders without recording them', async () => {
  const order = await reserve();
  await attach(order.id);
  await assert.rejects(event(order, { livemode: true }), /INVALID_EVENT/);
  await assert.rejects(event(order, { orderId: keyB }), /ORDER_NOT_FOUND/);
  assert.equal((await db.query('select * from public.stripe_events')).rows.length, 0);
});

test('SQL anon/authenticated cannot access orders or RPCs; service role cannot bypass transaction functions', async () => {
  const order = await reserve();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from public.orders'), /permission denied/);
      await assert.rejects(db.query("update public.items set price_gbp=1 where id='watch-a'"), /permission denied/);
      await assert.rejects(db.query('select * from public.settings'), /permission denied/);
      await assert.rejects(db.query('select public.mvw_get_order_by_id($1::uuid)', [order.id]), /permission denied/);
      await assert.rejects(db.query('select public.mvw_reserve_order($1::uuid,$2,$3::jsonb)', [keyB, origin, '[]']), /permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try {
    const read = (await db.query<{ order: Order }>('select public.mvw_get_order_by_id($1::uuid) as "order"', [order.id])).rows[0].order;
    assert.equal(read.id, order.id);
    await db.query("insert into public.logs(ts,level,message) values(now(),'INFO','service role log')");
    await db.query("update public.items set title_raw='Allowed server refresh' where id='watch-b'");
    await assert.rejects(db.query("update public.orders set status='expired'"), /permission denied/);
    await assert.rejects(db.query('delete from public.inventory_reservations'), /permission denied/);
    const recent = (await db.query<{ orders: any[] }>('select public.mvw_list_recent_orders(50) as orders')).rows[0].orders;
    assert.equal(recent.length, 1);
    assert.equal(Object.hasOwn(recent[0], 'checkoutKey'), false);
  } finally { await db.exec('reset role'); }
});
