import type Stripe from 'stripe';
import type { Order } from './orders.js';
import { CHECKOUT_MARKER, CheckoutError, paymentStatus, type CheckoutLine } from './checkout.js';

type StripeSession = Pick<Stripe.Checkout.Session,
  'id' | 'url' | 'status' | 'payment_status' | 'metadata' | 'mode' | 'amount_total' | 'currency' | 'livemode'>;

export type CheckoutOrderDependencies = {
  getOrderByCheckoutKey: (key: string) => Promise<Order | null>;
  quote: (lines: CheckoutLine[]) => Promise<Array<{ itemId: string; amountPence: number }>>;
  reserveOrder: (input: {
    checkoutKey: string; checkoutOrigin: string; lines: Array<{ itemId: string; amountPence: number }>;
  }) => Promise<Order>;
  attachCheckoutSession: (orderId: string, sessionId: string) => Promise<Order>;
  createSession: (params: Stripe.Checkout.SessionCreateParams, idempotencyKey: string) => Promise<StripeSession>;
  retrieveSession: (id: string) => Promise<StripeSession>;
  now?: () => number;
};

function sameBasket(order: Order, lines: CheckoutLine[]) {
  const original = order.lines.map((line) => line.itemId).sort();
  const requested = lines.map((line) => line.id).sort();
  if (original.length !== requested.length || original.some((id, i) => id !== requested[i])) {
    throw new CheckoutError('CHECKOUT_KEY_REUSED', 409);
  }
}

function validateSession(session: StripeSession, order: Order, requireLink: boolean) {
  if (session.livemode !== false || session.metadata?.checkout_origin !== CHECKOUT_MARKER ||
      session.metadata?.order_id !== order.id || session.mode !== 'payment' ||
      session.currency !== order.currency || session.amount_total !== order.totalPence ||
      (requireLink && order.stripeSessionId !== session.id)) {
    throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);
  }
}

export function linkedPaymentStatus(session: StripeSession, order: Order) {
  validateSession(session, order, true);
  return { ...paymentStatus(session), orderStatus: order.status, testMode: session.livemode === false };
}

export function stripeOrderParameters(order: Order): Stripe.Checkout.SessionCreateParams {
  const total = order.lines.reduce((sum, line) => sum + line.amountPence, 0);
  if (!order.lines.length || !Number.isSafeInteger(total) || total !== order.totalPence ||
      order.lines.some((line) => !Number.isSafeInteger(line.amountPence) || line.amountPence < 50)) {
    throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);
  }
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    shipping_address_collection: { allowed_countries: ['GB'] },
    success_url: `${order.checkoutOrigin}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${order.checkoutOrigin}/#/checkout/cancel`,
    line_items: [...order.lines].sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0).map((line) => ({
      quantity: 1,
      price_data: {
        currency: order.currency,
        unit_amount: line.amountPence,
        product_data: { name: line.title, metadata: { item_id: line.itemId } },
      },
    })),
    metadata: { checkout_origin: CHECKOUT_MARKER, order_id: order.id },
    payment_intent_data: { metadata: { checkout_origin: CHECKOUT_MARKER, order_id: order.id } },
    customer_creation: 'if_required',
  };
}

export async function startOrderCheckout(
  input: { checkoutKey: string; origin: string; lines: CheckoutLine[] },
  deps: CheckoutOrderDependencies,
): Promise<{ id: string; status: 'open' | 'complete'; url?: string }> {
  let order = await deps.getOrderByCheckoutKey(input.checkoutKey);
  if (!order) {
    const quoted = await deps.quote(input.lines);
    order = await deps.reserveOrder({ checkoutKey: input.checkoutKey, checkoutOrigin: input.origin, lines: quoted });
  }
  if (order.checkoutKey !== input.checkoutKey) throw new CheckoutError('CHECKOUT_KEY_REUSED', 409);
  sameBasket(order, input.lines);
  if (order.status === 'expired') throw new CheckoutError('CHECKOUT_EXPIRED', 409);
  if (order.status === 'payment_review') throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);

  let session: StripeSession;
  if (order.stripeSessionId) {
    // A retry owns this reservation already; do not re-check it as new ACTIVE stock.
    session = await deps.retrieveSession(order.stripeSessionId);
    validateSession(session, order, true);
  } else {
    if (order.status !== 'pending_payment') throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);
    const age = (deps.now?.() ?? Date.now()) - Date.parse(order.createdAt);
    // Stripe can discard idempotency keys after 24h. An unresolved old attempt needs review,
    // never a new session or released inventory that could permit a duplicate payment.
    if (!Number.isFinite(age) || age < -60_000 || age >= 23 * 60 * 60 * 1000) {
      throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);
    }
    session = await deps.createSession(stripeOrderParameters(order), `mvw-order:${order.id}`);
    validateSession(session, order, false);
    order = await deps.attachCheckoutSession(order.id, session.id);
    validateSession(session, order, true);
  }
  if (order.status === 'paid_awaiting_source' && session.status !== 'complete') {
    throw new CheckoutError('CHECKOUT_REVIEW_REQUIRED', 409);
  }
  if (session.status === 'expired') throw new CheckoutError('CHECKOUT_EXPIRED', 409);
  if (session.status === 'complete') return { id: session.id, status: 'complete' };
  if (session.status !== 'open' || !session.url) throw new CheckoutError('CHECKOUT_UNAVAILABLE', 503);
  return { id: session.id, status: 'open', url: session.url };
}
