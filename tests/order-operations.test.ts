import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type Stripe from 'stripe';
import type { Order } from '../api/_lib/orders.js';
import { CHECKOUT_MARKER } from '../api/_lib/checkout.js';
import { checkSource, inspectSandboxRefund } from '../api/_lib/order-operations.js';

const order: Order = {
  id: '11111111-1111-4111-8111-111111111111', checkoutKey: '22222222-2222-4222-8222-222222222222',
  checkoutOrigin: 'https://mvw.example', status: 'paid_awaiting_source', totalPence: 300000, currency: 'gbp',
  stripeSessionId: 'cs_test_paid', createdAt: '2026-11-24T00:00:00Z', lines: [],
};
const unpaidId = '33333333-3333-4333-8333-333333333333';
const packingId = '44444444-4444-4444-8444-444444444444';
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec((await readFile('db/schema.sql', 'utf8')).replace(/create extension if not exists pgcrypto;/i, ''));
  for (const file of ['20261122_orders', '20261122_retail_pricing', '20261124_order_operations']) {
    await db.exec(await readFile(`db/migrations/${file}.sql`, 'utf8'));
  }
  for (const [id, status] of [[order.id, order.status], [unpaidId, 'pending_payment'], [packingId, order.status]]) {
    await db.query("insert into public.orders (id, checkout_key, checkout_origin, status, total_pence) values ($1, gen_random_uuid(), $2, $3, $4)",
      [id, order.checkoutOrigin, status, order.totalPence]);
  }
});
after(async () => { await db.close(); });

function record(id: string, revision: number, state: string, reason: string | null = null) {
  return db.query<{ value: { revision: number; state: string } }>(
    'select public.mvw_record_order_operation($1::uuid,$2,$3,$4) as value', [id, revision, state, reason]);
}

test('only privileged operations can advance a paid order, and stale revisions cannot overwrite a refund decision', async () => {
  await db.exec('set role anon;');
  await assert.rejects(record(order.id, 0, 'purchase_in_progress'), /permission denied/);
  await db.exec('reset role; set role service_role;');
  try {
    await assert.rejects(record(unpaidId, 0, 'purchase_in_progress'), /OPERATION_NOT_ALLOWED/);
    await assert.rejects(db.query('select * from public.order_operations'), /permission denied/);
    await assert.rejects(record(order.id, 0, 'dispatched'), /OPERATION_NOT_ALLOWED/);
    await record(order.id, 0, 'refund_requested', 'source_unavailable');
    await assert.rejects(record(order.id, 0, 'purchase_in_progress'), /OPERATION_CHANGED/);
    await assert.rejects(record(order.id, 1, 'purchase_in_progress'), /OPERATION_NOT_ALLOWED/);
    const done = await record(order.id, 1, 'refunded');
    assert.equal(done.rows[0].value.state, 'refunded');
    const latest = await db.query('select revision,state from public.mvw_order_operations($1::uuid[])', [[order.id]]);
    assert.deepEqual(latest.rows, [{ revision: 2, state: 'refunded' }]);
  } finally { await db.exec('reset role;'); }
});

test('a sourcing hold blocks refunds and dispatch requires purchase and inspection records', async () => {
  await record(packingId, 0, 'purchase_in_progress');
  await assert.rejects(record(packingId, 1, 'refund_requested', 'customer_cancelled'), /OPERATION_NOT_ALLOWED/);
  await record(packingId, 1, 'awaiting_source');
  await record(packingId, 2, 'purchase_in_progress');
  await record(packingId, 3, 'sourced');
  await assert.rejects(record(packingId, 4, 'dispatched'), /OPERATION_NOT_ALLOWED/);
  await record(packingId, 4, 'inspected');
  await record(packingId, 5, 'dispatched');
  const audit = await db.query<{ state: string }>('select state from public.order_operations where order_id = $1 order by revision', [packingId]);
  assert.deepEqual(audit.rows.map(row => row.state), ['purchase_in_progress', 'awaiting_source', 'purchase_in_progress', 'sourced', 'inspected', 'dispatched']);
});

test('eBay lookup separates uncertain provider evidence and unavailable stock, preserving missing legacy costs', async () => {
  const line = { itemId: 'watch-a', title: 'Order line', amountPence: 300000, sourceUrl: '', ebayItemId: 'v1|100|0' };
  const offered = await checkSource(line, async id => {
    assert.equal(id, line.ebayItemId);
    return { priceGbp: 1500.02, shippingGbp: 15.95 };
  });
  assert.equal(offered.status, 'available');
  if (offered.status !== 'available') throw new Error();
  assert.equal(offered.costPence, 151597);
  assert.equal(offered.savedCostPence, null);
  assert.equal((await checkSource(line, async () => null)).status, 'unavailable');
  assert.equal((await checkSource(line, async () => { throw new Error('provider timeout'); })).status, 'unknown');
});

const session = {
  id: 'cs_test_paid', livemode: false, mode: 'payment', status: 'complete',
  payment_status: 'paid', currency: 'gbp', amount_total: order.totalPence, payment_intent: 'pi_test',
  metadata: { order_id: order.id, checkout_origin: CHECKOUT_MARKER },
} satisfies Awaited<ReturnType<Parameters<typeof inspectSandboxRefund>[1]['retrieveSession']>>;
function refund(id: string, amount: number, status: string) {
  return { id, amount, status, currency: 'gbp', payment_intent: 'pi_test' } as Stripe.Refund;
}

test('refund reconciliation only marks a linked order fully refunded at the complete succeeded amount', async () => {
  const get = (data: Stripe.Refund[], has_more = false, payment: Awaited<ReturnType<Parameters<typeof inspectSandboxRefund>[1]['retrieveSession']>> = session) => inspectSandboxRefund(order, {
    retrieveSession: async () => payment,
    listRefunds: async id => {
      assert.equal(id, 'pi_test');
      return { data, has_more, object: 'list', url: '/v1/refunds' };
    },
  });
  assert.deepEqual(await get([refund('re_a', 100000, 'succeeded'), refund('re_b', 200000, 'pending')]),
    { succeededPence: 100000, pending: true, needsAttention: false, complete: false });
  assert.equal((await get([refund('re_a', 300000, 'failed')])).complete, false);
  assert.equal((await get([refund('re_a', 100000, 'succeeded'), refund('re_b', 200000, 'succeeded')])).complete, true);
  await assert.rejects(get([refund('re_a', 300000, 'succeeded')], true), /REFUND_EVIDENCE_INVALID/);
  await assert.rejects(get([], false, { ...session, livemode: true }), /REFUND_EVIDENCE_INVALID/);
  await assert.rejects(get([{ ...refund('re_a', 300000, 'succeeded'), payment_intent: 'pi_other' }]), /REFUND_EVIDENCE_INVALID/);
});
