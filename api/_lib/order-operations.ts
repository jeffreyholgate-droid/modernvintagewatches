import { OrderError, rpc, type Order, type OrderLine } from './orders.js';
import { CHECKOUT_MARKER } from './checkout.js';
import type Stripe from 'stripe';

const states = ['awaiting_source', 'purchase_in_progress', 'sourced', 'inspected',
  'dispatched', 'refund_requested', 'refunded'] as const;
export const refundReasons = ['source_unavailable', 'cost_changed', 'customer_cancelled', 'other'] as const;
export type RefundReason = typeof refundReasons[number];
export type OperationState = typeof states[number];
export type Operation = {
  state: OperationState;
  revision: number;
  refundReason: RefundReason | null;
  updatedAt: string;
};
export type SourceCheck =
  | { status: 'unavailable' | 'unknown'; checkedAt: string }
  | { status: 'available'; checkedAt: string; costPence: number; savedCostPence: number | null };

function operation(row: any): Operation {
  if (!states.includes(row?.state) || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
      (row.state === 'refund_requested' ? !refundReasons.includes(row.refund_reason) : row.refund_reason !== null)) {
    throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  }
  return { state: row.state, revision: row.revision, refundReason: row.refund_reason, updatedAt: row.created_at };
}

export async function getOperations(ids: string[]): Promise<Map<string, Operation>> {
  if (!ids.length) return new Map();
  const rows = await rpc('mvw_order_operations', { p_order_ids: ids });
  if (!Array.isArray(rows)) throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  return new Map(rows.map(row => [row.order_id, operation(row)]));
}

export async function recordOperation(id: string, revision: number, state: OperationState, reason: RefundReason | null) {
  return operation(await rpc('mvw_record_order_operation', {
    p_order_id: id, p_revision: revision, p_state: state, p_refund_reason: reason,
  }));
}

export async function checkSource(line: OrderLine, getOffer: (id: string) =>
  Promise<{ priceGbp: number; shippingGbp: number } | null>): Promise<SourceCheck> {
  try {
    const offer = await getOffer(line.ebayItemId);
    const checkedAt = new Date().toISOString();
    if (!offer) return { status: 'unavailable', checkedAt };
    const costPence = Math.round(offer.priceGbp * 100) + Math.round(offer.shippingGbp * 100);
    if (!Number.isSafeInteger(costPence) || costPence <= 0) throw new Error();
    const savedCostPence = line.pricing ? line.pricing.sourceItemPence + line.pricing.sourceShippingPence : null;
    return { status: 'available', checkedAt, costPence, savedCostPence };
  } catch {
    return { status: 'unknown', checkedAt: new Date().toISOString() };
  }
}

export async function inspectSandboxRefund(order: Order, stripe: {
  retrieveSession: (id: string) => Promise<Pick<Stripe.Checkout.Session, 'id' | 'livemode' | 'mode' | 'status' |
    'payment_status' | 'currency' | 'amount_total' | 'payment_intent' | 'metadata'>>;
  listRefunds: (intentId: string) => Promise<Stripe.ApiList<Stripe.Refund>>;
}) {
  if (order.status !== 'paid_awaiting_source' || !order.stripeSessionId?.startsWith('cs_test_')) {
    throw new OrderError('OPERATION_NOT_ALLOWED');
  }
  const session = await stripe.retrieveSession(order.stripeSessionId);
  const intentId = session.payment_intent;
  if (session.id !== order.stripeSessionId || session.livemode !== false || session.mode !== 'payment' ||
      session.status !== 'complete' || session.payment_status !== 'paid' || session.currency !== 'gbp' ||
      session.amount_total !== order.totalPence || session.metadata?.order_id !== order.id ||
      session.metadata.checkout_origin !== CHECKOUT_MARKER ||
      typeof intentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(intentId)) {
    throw new OrderError('REFUND_EVIDENCE_INVALID');
  }
  const refunds = await stripe.listRefunds(intentId);
  // A truncated list cannot establish the full amount refunded.
  if (refunds.has_more) throw new OrderError('REFUND_EVIDENCE_INVALID');
  const seen = new Set<string>();
  let succeededPence = 0;
  let pending = false;
  let needsAttention = false;
  for (const refund of refunds.data) {
    if (refund.payment_intent !== intentId || refund.currency !== 'gbp' || !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
        seen.has(refund.id) || !Number.isSafeInteger(refund.amount) || refund.amount <= 0 ||
        refund.amount > order.totalPence) throw new OrderError('REFUND_EVIDENCE_INVALID');
    seen.add(refund.id);
    if (refund.status === 'succeeded') succeededPence += refund.amount;
    else if (refund.status === 'pending' || refund.status === 'requires_action') pending = true;
    else needsAttention = true;
  }
  if (succeededPence > order.totalPence) throw new OrderError('REFUND_EVIDENCE_INVALID');
  return { succeededPence, pending, needsAttention, complete: succeededPence === order.totalPence && !pending };
}
