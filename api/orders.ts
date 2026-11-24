import { json, methodNotAllowed, readJson } from './_lib/respond.js';
import { requireAdmin } from './_lib/auth.js';
import { getOrderById, listRecentOrders, OrderError } from './_lib/orders.js';
import { checkSource, getOperations, inspectSandboxRefund, recordOperation, refundReasons } from './_lib/order-operations.js';
import { EbayClient } from '../server/ebay.js';

const operatorActions = ['purchase_in_progress', 'awaiting_source', 'sourced', 'inspected',
  'dispatched', 'refund_requested'] as const;

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
  if (!await requireAdmin(req, res)) return;
  try {
    if (req.method === 'POST') return await manageOrder(req, res);
    const orders = await listRecentOrders(50);
    const operations = await getOperations(orders.map(order => order.id));
    // Omit checkout retry keys, raw events and customer information.
    return json(res, 200, { orders: orders.map(order => ({
      id: order.id,
      status: order.status,
      totalPence: order.totalPence,
      currency: order.currency,
      createdAt: order.createdAt,
      stripeSessionId: order.stripeSessionId,
      operation: operations.get(order.id) ?? null,
      lines: order.lines,
    })) });
  } catch (error) {
    if (error instanceof OrderError) {
      if (['OPERATION_CHANGED', 'OPERATION_NOT_ALLOWED', 'REFUND_EVIDENCE_INVALID', 'PAYMENT_ALREADY_REFUNDING'].includes(error.code)) {
        return json(res, 409, { error: error.code });
      }
      if (error.code === 'INVALID_ORDER') return json(res, 400, { error: 'INVALID_ORDER' });
    }
    return json(res, 503, { error: 'ORDERS_UNAVAILABLE' });
  }
}

async function manageOrder(req: any, res: any) {
  let body: any;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: 'INVALID_JSON' }); }

  const { orderId, action, revision, itemId, reason } = body ?? {};
  if (typeof orderId !== 'string' ||
      (!operatorActions.includes(action) && action !== 'check_source' && action !== 'check_refund') ||
      (action !== 'check_source' && (!Number.isInteger(revision) || revision < 0 || revision >= 2147483647)) ||
      (action === 'refund_requested' && !refundReasons.includes(reason))) {
    return json(res, 400, { error: 'INVALID_OPERATION' });
  }
  const order = await getOrderById(orderId);
  if (!order) return json(res, 404, { error: 'ORDER_NOT_FOUND' });
  if (order.status !== 'paid_awaiting_source') throw new OrderError('OPERATION_NOT_ALLOWED');

  const current = (await getOperations([orderId])).get(orderId);
  if (action === 'check_source') {
    if (current && !['awaiting_source', 'purchase_in_progress'].includes(current.state)) {
      throw new OrderError('OPERATION_NOT_ALLOWED');
    }
    const line = order.lines.find(value => value.itemId === itemId);
    if (!line) return json(res, 404, { error: 'ORDER_LINE_NOT_FOUND' });
    const source = await checkSource(line, id => new EbayClient().getPurchasableItem(id));
    return json(res, 200, { source });
  }

  if (revision !== (current?.revision ?? 0)) throw new OrderError('OPERATION_CHANGED');
  if (action === 'check_refund' || action === 'purchase_in_progress') {
    const state = current?.state ?? 'awaiting_source';
    if (state !== 'awaiting_source' && !(action === 'check_refund' && state === 'refund_requested')) {
      throw new OrderError('OPERATION_NOT_ALLOWED');
    }
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key || !/^(?:sk|rk)_test_/.test(key)) return json(res, 503, { error: 'STRIPE_SANDBOX_UNAVAILABLE' });
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key, { timeout: 10000, maxNetworkRetries: 0 });
    const refund = await inspectSandboxRefund(order, {
      retrieveSession: id => stripe.checkout.sessions.retrieve(id),
      listRefunds: id => stripe.refunds.list({ payment_intent: id, limit: 100 }),
    });
    if (action === 'check_refund') {
      const operation = refund.complete && state === 'refund_requested'
        ? await recordOperation(orderId, revision, 'refunded', null) : current;
      return json(res, 200, { refund, operation });
    }
    if (refund.pending || refund.succeededPence > 0) throw new OrderError('PAYMENT_ALREADY_REFUNDING');
  }

  return json(res, 200, {
    operation: await recordOperation(orderId, revision, action, action === 'refund_requested' ? reason : null),
  });
}
