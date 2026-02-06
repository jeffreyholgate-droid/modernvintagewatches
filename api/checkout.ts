import { json, methodNotAllowed, readJson } from './_lib/respond.js';

type Line = {
  id: string;
  title: string;
  priceGbp: number;
  qty: number;
};

function getOrigin(req: any): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const body = await readJson(req);
  const lines: Line[] = Array.isArray(body?.lines) ? body.lines : [];
  if (!lines.length) return json(res, 400, { error: 'NO_LINES' });

  // If Stripe isn't configured, return empty (caller will fall back to simulated checkout).
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json(res, 200, { ok: true, configured: false });

  // Dynamic import so the client build never bundles Stripe.
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' } as any);

  const origin = getOrigin(req);
  const successUrl = `${origin}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/#/checkout/cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lines.map((l) => ({
      quantity: Math.max(1, Math.floor(l.qty || 1)),
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(Number(l.priceGbp) * 100),
        product_data: {
          name: l.title,
          metadata: { item_id: l.id },
        },
      },
    })),
    allow_promotion_codes: true,
    customer_creation: 'if_required',
  });

  return json(res, 200, { ok: true, configured: true, url: session.url, id: session.id });
}

