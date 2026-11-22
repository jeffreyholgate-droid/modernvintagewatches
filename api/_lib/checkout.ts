import type { AppStateItem } from './db.js';

export const CHECKOUT_MARKER = 'mvw-checkout-v1';

export class CheckoutError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export type CheckoutLine = { id: string; qty: 1 };

export function parseCheckoutLines(body: unknown): CheckoutLine[] {
  const lines = (body as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 20) {
    throw new CheckoutError('INVALID_LINES', 400);
  }
  const ids = new Set<string>();
  return lines.map((line) => {
    if (!line || typeof line.id !== 'string' || !line.id.trim() ||
        line.id !== line.id.trim() || line.id.length > 200 ||
        /[\x00-\x1f\x7f]/.test(line.id) || line.qty !== 1 || ids.has(line.id)) {
      throw new CheckoutError('INVALID_LINES', 400);
    }
    ids.add(line.id);
    return { id: line.id, qty: 1 };
  });
}

export function checkoutConfiguration(env: Record<string, string | undefined>) {
  if (env.CHECKOUT_ENABLED !== 'true') throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
  }
  // Live payments stay blocked until orders, sourcing and fulfillment are implemented.
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
  }
  let site: URL;
  try { site = new URL(env.PUBLIC_SITE_URL || ''); }
  catch { throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503); }
  const local = env.NODE_ENV !== 'production' && env.VERCEL !== '1' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  if ((site.protocol !== 'https:' && !(site.protocol === 'http:' && local)) ||
      site.username || site.password || site.search || site.hash || site.pathname !== '/') {
    throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
  }
  return { origin: site.origin, stripeKey: env.STRIPE_SECRET_KEY };
}

export type SourceOffer = { priceGbp: number; shippingGbp: number };
export type CheckoutDependencies = {
  getItem: (id: string) => Promise<AppStateItem | null>;
  getSourceOffer: (ebayItemId: string) => Promise<SourceOffer | null>;
};

export async function authoritativeLines(lines: CheckoutLine[], deps: CheckoutDependencies) {
  return Promise.all(lines.map(async ({ id }) => {
    const item = await deps.getItem(id);
    if (!item || item.publishStatus !== 'PUBLISHED' || item.status !== 'ACTIVE') {
      throw new CheckoutError('ITEM_UNAVAILABLE', 409);
    }
    const amount = Math.round(item.priceGbp * 100);
    if (!Number.isFinite(item.priceGbp) || !Number.isSafeInteger(amount) || amount < 50 ||
        !Number.isFinite(item.shippingGbp) || item.shippingGbp < 0) {
      throw new CheckoutError('ITEM_UNAVAILABLE', 409);
    }
    const offer = await deps.getSourceOffer(item.ebayItemId);
    if (!offer) throw new CheckoutError('ITEM_UNAVAILABLE', 409);
    if (!Number.isFinite(offer.priceGbp) || !Number.isFinite(offer.shippingGbp) ||
        Math.round(offer.priceGbp * 100) !== amount ||
        Math.round(offer.shippingGbp * 100) !== Math.round(item.shippingGbp * 100)) {
      throw new CheckoutError('ITEM_CHANGED', 409);
    }
    return {
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: amount,
        product_data: {
          name: item.titleBoutique || item.titleRaw,
          metadata: { item_id: item.id },
        },
      },
    };
  }));
}

export function paymentStatus(session: {
  metadata?: Record<string, string> | null;
  status?: string | null;
  payment_status?: string;
  mode?: string;
}) {
  if (session.metadata?.checkout_origin !== CHECKOUT_MARKER || session.mode !== 'payment') {
    throw new CheckoutError('SESSION_NOT_FOUND', 404);
  }
  return {
    paid: session.status === 'complete' && session.payment_status === 'paid',
    status: session.status === 'complete' ? 'complete' : session.status === 'expired' ? 'expired' : 'open',
  };
}
