import { json, methodNotAllowed, readJson } from './_lib/respond.js';
import { getItemById } from './_lib/db.js';
import { EbayClient } from '../server/ebay.js';
import {
  authoritativeLines, CHECKOUT_MARKER, checkoutConfiguration,
  CheckoutError, parseCheckoutLines, paymentStatus,
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
      return json(res, 200, paymentStatus(session));
    }

    const { stripeKey, origin } = checkoutConfiguration(process.env);
    let body: unknown;
    try { body = await readJson(req); }
    catch { return json(res, 400, { error: 'INVALID_JSON' }); }
    const lines = parseCheckoutLines(body);
    const ebay = new EbayClient();
    const lineItems = await authoritativeLines(lines, {
      getItem: getItemById,
      getSourceOffer: (id) => ebay.getPurchasableItem(id),
    });
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${origin}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/checkout/cancel`,
      line_items: lineItems,
      metadata: { checkout_origin: CHECKOUT_MARKER },
      customer_creation: 'if_required',
    });
    if (!session.url) throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
    return json(res, 200, { url: session.url, id: session.id });
  } catch (error: any) {
    if (error instanceof CheckoutError) return json(res, error.status, { error: error.code });
    if (req.method === 'GET' && error?.code === 'resource_missing') {
      return json(res, 404, { error: 'SESSION_NOT_FOUND' });
    }
    // Provider errors may contain credentials or customer details. Never return them.
    return json(res, 503, { error: 'CHECKOUT_UNAVAILABLE' });
  }
}
