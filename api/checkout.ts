import { json, methodNotAllowed, readJson } from './_lib/respond.js';
import { getItemById, getSettings } from './_lib/db.js';
import { EbayClient } from '../server/ebay.js';
import { attachCheckoutSession, getOrderByCheckoutKey, getOrderById, reserveOrder } from './_lib/orders.js';
import { getOperations } from './_lib/order-operations.js';
import { linkedPaymentStatus, startOrderCheckout } from './_lib/checkout-order.js';
import {
  authoritativeLines, CHECKOUT_MARKER, checkoutConfiguration,
  CheckoutError, parseCheckoutKey, parseCheckoutLines,
} from './_lib/checkout.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res, ['POST', 'GET']);

  try {
    // Existing payments remain verifiable even while new checkout is disabled.
    if (req.method === 'GET') {
      const sessionId = new URL(req.url || '/', 'https://local.invalid').searchParams.get('session_id');
      if (!sessionId || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(sessionId) || sessionId.length > 256) {
        return json(res, 400, { error: 'INVALID_SESSION' });
      }
      if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: 'CHECKOUT_UNAVAILABLE' });
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.checkout_origin !== CHECKOUT_MARKER || !session.metadata?.order_id) {
        return json(res, 404, { error: 'SESSION_NOT_FOUND' });
      }
      const order = await getOrderById(session.metadata.order_id);
      if (!order) return json(res, 404, { error: 'SESSION_NOT_FOUND' });
      const payment = linkedPaymentStatus(session, order);
      const operation = payment.paid && order.status === 'paid_awaiting_source'
        ? (await getOperations([order.id])).get(order.id) : null;
      return json(res, 200, { ...payment, orderProgress: operation?.state ?? null });
    }

    const { stripeKey, origin } = checkoutConfiguration(process.env);
    let body: unknown;
    try { body = await readJson(req); }
    catch { return json(res, 400, { error: 'INVALID_JSON' }); }
    const lines = parseCheckoutLines(body);
    const checkoutKey = parseCheckoutKey(body);
    const ebay = new EbayClient();
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);
    const checkout = await startOrderCheckout({ checkoutKey, origin, lines }, {
      getOrderByCheckoutKey,
      reserveOrder,
      attachCheckoutSession,
      quote: async (requested) => {
        const quoted = await authoritativeLines(requested, {
          getItem: getItemById,
          getSourceOffer: (id) => ebay.getPurchasableItem(id),
          getSettings,
        });
        return quoted.map((line) => ({
          itemId: line.price_data.product_data.metadata.item_id,
          amountPence: line.price_data.unit_amount,
          pricing: line.pricing,
        }));
      },
      createSession: (params, idempotencyKey) => stripe.checkout.sessions.create(params, { idempotencyKey }),
      retrieveSession: (id) => stripe.checkout.sessions.retrieve(id),
    });
    return json(res, 200, checkout);
  } catch (error: any) {
    if (error instanceof CheckoutError) return json(res, error.status, { error: error.code });
    if (req.method === 'GET' && error?.code === 'resource_missing') {
      return json(res, 404, { error: 'SESSION_NOT_FOUND' });
    }
    if (['ITEM_UNAVAILABLE', 'ITEM_CHANGED', 'PRICE_CHANGED', 'CHECKOUT_KEY_REUSED'].includes(error?.code)) {
      return json(res, 409, { error: error.code });
    }
    if (['SESSION_CONFLICT', 'ORDER_UNAVAILABLE'].includes(error?.code)) {
      return json(res, 409, { error: 'CHECKOUT_REVIEW_REQUIRED' });
    }
    // Provider errors may contain credentials or customer details. Never return them.
    return json(res, 503, { error: 'CHECKOUT_UNAVAILABLE' });
  }
}
