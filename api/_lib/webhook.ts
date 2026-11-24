import Stripe from 'stripe';
import { CHECKOUT_MARKER } from './checkout.js';
import type { applyStripeEvent } from './orders.js';

export type StripeOrderEvent = Parameters<typeof applyStripeEvent>[0];
export type WebhookDependencies = {
  endpointSecret: string | undefined;
  applyEvent: (event: StripeOrderEvent) => Promise<unknown>;
};

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
]);

class WebhookError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

function response(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

/** Preserve the exact bytes Stripe signed; never parse or reserialize this body. */
async function readRawBody(request: Request): Promise<Buffer> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_WEBHOOK_BYTES) {
    throw new WebhookError('PAYLOAD_TOO_LARGE', 413);
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new WebhookError('PAYLOAD_TOO_LARGE', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

/** Return only the event fields the order transaction needs. Customer data is discarded. */
export function orderEventFromStripe(event: unknown): StripeOrderEvent | null {
  const value = record(event);
  if (!value || value.object !== 'event' || typeof value.type !== 'string' ||
      typeof value.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(value.id) || value.id.length > 256) {
    throw new WebhookError('INVALID_EVENT', 400);
  }
  // This recovery implementation must not process real payments, even with a valid signature.
  if (value.livemode !== false) throw new WebhookError('LIVE_EVENTS_DISABLED', 400);
  if (!SUPPORTED_EVENTS.has(value.type)) return null;
  const session = record(record(value.data)?.object);
  if (!session || session.object !== 'checkout.session') throw new WebhookError('INVALID_EVENT', 400);
  const metadata = record(session.metadata);
  // Ignore unrelated sessions and pre-order-tracking checkout sessions.
  if (metadata?.checkout_origin !== CHECKOUT_MARKER || metadata.order_id === undefined) return null;
  if (session.mode !== 'payment' ||
      session.livemode !== false || typeof session.id !== 'string' ||
      !/^cs_test_[A-Za-z0-9]+$/.test(session.id) || session.id.length > 256 ||
      typeof metadata.order_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metadata.order_id)) {
    throw new WebhookError('INVALID_EVENT', 400);
  }
  const expectedStatus = value.type === 'checkout.session.expired' ? 'expired' : 'complete';
  if (session.status !== expectedStatus) throw new WebhookError('INVALID_EVENT', 400);

  return {
    eventId: value.id,
    type: value.type as StripeOrderEvent['type'],
    orderId: metadata.order_id,
    sessionId: session.id,
    amountTotal: Number.isSafeInteger(session.amount_total) && session.amount_total >= 0 ? session.amount_total : null,
    currency: typeof session.currency === 'string' && /^[a-z]{3}$/.test(session.currency) ? session.currency : null,
    paymentStatus: ['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status) ? session.payment_status : null,
    livemode: false,
  };
}

export async function handleStripeWebhook(request: Request, dependencies: WebhookDependencies): Promise<Response> {
  if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
  const secret = dependencies.endpointSecret;
  if (!secret || !secret.startsWith('whsec_') || /\s/.test(secret)) {
    return response(503, { error: 'WEBHOOK_UNAVAILABLE' });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return response(400, { error: 'INVALID_SIGNATURE' });

  let rawBody: Buffer;
  try { rawBody = await readRawBody(request); }
  catch (error) {
    if (error instanceof WebhookError) return response(error.status, { error: error.code });
    return response(400, { error: 'INVALID_BODY' });
  }

  let verifiedEvent: Stripe.Event;
  try {
    // The SDK verifies both the HMAC and its default five-minute timestamp tolerance.
    verifiedEvent = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return response(400, { error: 'INVALID_SIGNATURE' });
  }

  let orderEvent: StripeOrderEvent | null;
  try { orderEvent = orderEventFromStripe(verifiedEvent); }
  catch (error) {
    if (error instanceof WebhookError) return response(error.status, { error: error.code });
    return response(400, { error: 'INVALID_EVENT' });
  }
  if (!orderEvent) return response(200, { received: true });

  try {
    // The DB transaction checks the assigned session/total and records event IDs atomically.
    // Acknowledge only after persistence succeeds, including duplicate/no-op events.
    await dependencies.applyEvent(orderEvent);
    return response(200, { received: true });
  } catch {
    // Includes an event arriving before checkout has attached its session to the order.
    // A non-2xx response lets Stripe retry; never return raw provider/DB messages or PII.
    return response(503, { error: 'WEBHOOK_RETRY' });
  }
}
