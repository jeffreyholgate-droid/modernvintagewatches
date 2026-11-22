import { json, methodNotAllowed } from './_lib/respond.js';
import { requireAdmin } from './_lib/auth.js';
import { listRecentOrders } from './_lib/orders.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!await requireAdmin(req, res)) return;
  try {
    const orders = await listRecentOrders(50);
    // Deliberately omit checkout retry keys, raw events and customer data.
    return json(res, 200, { orders: orders.map(order => ({
      id: order.id,
      status: order.status,
      totalPence: order.totalPence,
      currency: order.currency,
      createdAt: order.createdAt,
      stripeSessionId: order.stripeSessionId,
      lines: order.lines.map(line => ({
        itemId: line.itemId,
        title: line.title,
        amountPence: line.amountPence,
        sourceUrl: line.sourceUrl,
        ebayItemId: line.ebayItemId,
      })),
    })) });
  } catch {
    return json(res, 503, { error: 'ORDERS_UNAVAILABLE' });
  }
}
