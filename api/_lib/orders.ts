import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Category } from '../../types.js';
import { pricingForItem, type PricingQuote } from './pricing.js';

export type OrderStatus = 'pending_payment' | 'paid_awaiting_source' | 'expired' | 'payment_review';
export type OrderLine = {
  itemId: string;
  title: string;
  amountPence: number;
  sourceUrl: string;
  ebayItemId: string;
  /** Missing on historical orders. Never infer historical source costs. */
  pricing?: PricingQuote | null;
};
export type Order = {
  id: string;
  checkoutKey: string;
  checkoutOrigin: string;
  status: OrderStatus;
  totalPence: number;
  currency: 'gbp';
  stripeSessionId: string | null;
  createdAt: string;
  lines: OrderLine[];
};
export type AdminOrder = Omit<Order, 'checkoutKey'>;
export type ReserveOrderInput = {
  checkoutKey: string;
  checkoutOrigin: string;
  lines: Array<{ itemId: string; amountPence: number; pricing: PricingQuote }>;
};
export type StripeEventInput = {
  eventId: string;
  type: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded' |
    'checkout.session.expired' | 'checkout.session.async_payment_failed';
  orderId: string;
  sessionId: string;
  amountTotal: number | null;
  currency: string | null;
  paymentStatus: string | null;
  livemode: boolean;
};

const knownErrors = new Set([
  'INVALID_ORDER', 'INVALID_EVENT', 'ITEM_UNAVAILABLE', 'ITEM_CHANGED', 'CHECKOUT_KEY_REUSED',
  'ORDER_NOT_FOUND', 'SESSION_CONFLICT', 'ORDER_UNAVAILABLE', 'ORDER_SESSION_PENDING',
  'PRICE_CHANGED', 'INVALID_PRICING_SETTINGS',
]);
export class OrderError extends Error {
  constructor(public code: string) { super(code); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const session = /^cs_test_[A-Za-z0-9]+$/;
const eventTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.expired', 'checkout.session.async_payment_failed']);

function requireUuid(value: string, code = 'INVALID_ORDER') {
  if (typeof value !== 'string' || !uuid.test(value)) throw new OrderError(code);
}

function parsePricing(value: any, amountPence: number, code = 'ORDER_STORAGE_UNAVAILABLE'): PricingQuote | null {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value !== 'object' || Array.isArray(value) || value.policyVersion !== 'mvw-pricing-v1') throw new Error();
    const margin = value.marginBps / 100;
    const canonical = pricingForItem({
      priceGbp: value.sourceItemPence / 100, shippingGbp: value.sourceShippingPence / 100, category: Category.WATCH,
    }, {
      marginPercent: { WATCH: margin, HANDBAG: margin, JEWELLERY: margin },
      pricingPolicy: {
        version: value.policyVersion, deliveryAllowancePence: value.deliveryAllowancePence,
        feeAllowanceBps: value.feeAllowanceBps, feeFixedPence: value.feeFixedPence,
        roundingPence: value.roundingPence, vatMode: value.vatMode,
      },
    });
    if (canonical.retailPricePence !== amountPence ||
        Object.entries(canonical).some(([key, expected]) => value[key] !== expected)) throw new Error();
    return canonical;
  } catch { throw new OrderError(code); }
}

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // Orders must never use a browser key or an ephemeral memory fallback.
  if (!url || !key) throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  try { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
  catch { throw new OrderError('ORDER_STORAGE_UNAVAILABLE'); }
}

async function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  try {
    const { data, error } = await client().rpc(name, args);
    if (error) throw new OrderError(knownErrors.has(error.message) ? error.message : 'ORDER_STORAGE_UNAVAILABLE');
    return data;
  } catch (error) {
    if (error instanceof OrderError) throw error;
    throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  }
}

function parseOrder(value: any, admin = false): Order | AdminOrder {
  if (!value || !uuid.test(value.id || '') || (!admin && !uuid.test(value.checkoutKey || '')) ||
    typeof value.checkoutOrigin !== 'string' ||
    !['pending_payment', 'paid_awaiting_source', 'expired', 'payment_review'].includes(value.status) ||
    !Number.isSafeInteger(value.totalPence) || value.totalPence < 50 || value.totalPence > 99999999 ||
    value.currency !== 'gbp' || (value.stripeSessionId !== null &&
      (typeof value.stripeSessionId !== 'string' || !session.test(value.stripeSessionId))) ||
    typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 20 ||
    value.lines.some((line: any) => !line || typeof line.itemId !== 'string' || !line.itemId ||
      typeof line.title !== 'string' || !Number.isSafeInteger(line.amountPence) || line.amountPence < 50 ||
      typeof line.sourceUrl !== 'string' || typeof line.ebayItemId !== 'string') ||
    new Set(value.lines.map((line: any) => line.itemId)).size !== value.lines.length ||
    value.lines.reduce((total: number, line: any) => total + line.amountPence, 0) !== value.totalPence) {
    throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  }
  // Construct a deliberate DTO: unexpected provider columns never reach callers.
  const order: AdminOrder = {
    id: value.id, checkoutOrigin: value.checkoutOrigin, status: value.status,
    totalPence: value.totalPence, currency: 'gbp', stripeSessionId: value.stripeSessionId,
    createdAt: value.createdAt,
    lines: value.lines.map((line: any) => ({
      itemId: line.itemId, title: line.title, amountPence: line.amountPence,
      sourceUrl: line.sourceUrl, ebayItemId: line.ebayItemId,
      pricing: parsePricing(line.pricing, line.amountPence),
    })),
  };
  return admin ? order : { ...order, checkoutKey: value.checkoutKey };
}

export async function getOrderByCheckoutKey(checkoutKey: string): Promise<Order | null> {
  requireUuid(checkoutKey);
  const data = await rpc('mvw_get_order_by_checkout_key', { p_checkout_key: checkoutKey });
  return data === null ? null : parseOrder(data) as Order;
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  requireUuid(orderId);
  const data = await rpc('mvw_get_order_by_id', { p_order_id: orderId });
  return data === null ? null : parseOrder(data) as Order;
}

export async function reserveOrder(input: ReserveOrderInput): Promise<Order> {
  requireUuid(input?.checkoutKey);
  let origin: URL;
  try { origin = new URL(input.checkoutOrigin); } catch { throw new OrderError('INVALID_ORDER'); }
  if (origin.origin !== input.checkoutOrigin || input.checkoutOrigin.length > 2048 ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new OrderError('INVALID_ORDER');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 20 ||
    input.lines.some(line => !line || typeof line.itemId !== 'string' || !line.itemId ||
      line.itemId !== line.itemId.trim() || line.itemId.length > 200 || /[\x00-\x1f\x7f]/.test(line.itemId) ||
      !Number.isSafeInteger(line.amountPence) || line.amountPence < 50 || line.amountPence > 99999999) ||
    new Set(input.lines.map(line => line.itemId)).size !== input.lines.length ||
    input.lines.reduce((total, line) => total + line.amountPence, 0) > 99999999) throw new OrderError('INVALID_ORDER');
  return parseOrder(await rpc('mvw_reserve_order', {
    p_checkout_key: input.checkoutKey, p_checkout_origin: input.checkoutOrigin,
    p_lines: input.lines.map(({ itemId, amountPence, pricing }) => {
      const canonical = parsePricing(pricing, amountPence, 'INVALID_ORDER');
      if (!canonical) throw new OrderError('INVALID_ORDER');
      return { itemId, amountPence, pricing: canonical };
    }),
  })) as Order;
}

export async function attachCheckoutSession(orderId: string, sessionId: string): Promise<Order> {
  requireUuid(orderId);
  if (typeof sessionId !== 'string' || sessionId.length > 256 || !session.test(sessionId)) throw new OrderError('INVALID_ORDER');
  return parseOrder(await rpc('mvw_attach_checkout_session', {
    p_order_id: orderId, p_session_id: sessionId,
  })) as Order;
}

export async function applyStripeEvent(input: StripeEventInput): Promise<{ order: Order; duplicate: boolean }> {
  requireUuid(input?.orderId, 'INVALID_EVENT');
  if (input.livemode !== false || typeof input.eventId !== 'string' || input.eventId.length > 256 ||
    !/^evt_[A-Za-z0-9]+$/.test(input.eventId) || typeof input.sessionId !== 'string' ||
    input.sessionId.length > 256 || !session.test(input.sessionId) || !eventTypes.has(input.type) ||
    (input.amountTotal !== null && (!Number.isSafeInteger(input.amountTotal) || input.amountTotal < 0)) ||
    (input.currency !== null && (typeof input.currency !== 'string' || input.currency.length > 20)) ||
    (input.paymentStatus !== null && (typeof input.paymentStatus !== 'string' || input.paymentStatus.length > 50))) {
    throw new OrderError('INVALID_EVENT');
  }
  const result = await rpc('mvw_apply_stripe_event', {
    p_event_id: input.eventId, p_type: input.type, p_order_id: input.orderId,
    p_session_id: input.sessionId, p_amount_total: input.amountTotal,
    p_currency: input.currency, p_payment_status: input.paymentStatus, p_livemode: false,
  });
  if (typeof result?.duplicate !== 'boolean') throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  return { order: parseOrder(result.order) as Order, duplicate: result.duplicate };
}

export async function listRecentOrders(limit = 50): Promise<AdminOrder[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OrderError('INVALID_ORDER');
  const data = await rpc('mvw_list_recent_orders', { p_limit: limit });
  if (!Array.isArray(data)) throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
  return data.map(value => parseOrder(value, true) as AdminOrder);
}

export async function checkOrdersDatabase(): Promise<void> {
  try {
    const db = client();
    const checks = await Promise.all([
      db.from('orders').select('id,checkout_key,checkout_origin,status,total_pence,currency,stripe_session_id,created_at').limit(1),
      db.from('order_lines').select('order_id,item_id,title,amount_pence,source_url,ebay_item_id,pricing_snapshot').limit(1),
      db.from('inventory_reservations').select('item_id,order_id,created_at').limit(1),
      db.from('stripe_events').select('event_id,event_type,order_id,session_id,amount_total,currency,payment_status,livemode').limit(1),
    ]);
    if (checks.some(check => check.error)) throw new OrderError('ORDER_STORAGE_UNAVAILABLE');
    // The migration is transactional; this also checks that its read RPC is installed.
    await listRecentOrders(1);
  } catch { throw new OrderError('ORDER_STORAGE_UNAVAILABLE'); }
}
