type CheckoutRequestLine = { id: string; qty: number };
export type CheckoutAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function attemptStorageKey(lines: CheckoutRequestLine[]) {
  const basket = lines.map(({ id, qty }) => [id, qty] as const)
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return `mvw.checkout.v2:${JSON.stringify(basket)}`;
}

export function checkoutAttemptKey(lines: CheckoutRequestLine[], storage: CheckoutAttemptStorage): string {
  const storageKey = attemptStorageKey(lines);
  const existing = storage.getItem(storageKey);
  if (existing && UUID.test(existing)) return existing;
  const key = globalThis.crypto.randomUUID();
  storage.setItem(storageKey, key);
  return key;
}

const errors: Record<string, string> = {
  INVALID_LINES: 'Each watch is a unique item. Please choose one of each watch in your bag.',
  ITEM_UNAVAILABLE: 'A watch is no longer available. Please review your bag before trying again.',
  ITEM_CHANGED: 'A source listing has changed. Please contact us to confirm the current price and availability.',
  CHECKOUT_KEY_REUSED: 'This checkout no longer matches your bag. Please contact us before starting another payment.',
  CHECKOUT_REVIEW_REQUIRED: 'This checkout needs to be checked. Please contact us before starting another payment.',
  CHECKOUT_EXPIRED: 'This checkout has expired. Please try again to start a new checkout.',
  CHECKOUT_UNAVAILABLE: 'Checkout is currently unavailable. Your bag has been saved; please try again later.',
};

export async function requestCheckout(
  lines: CheckoutRequestLine[], request: typeof fetch = fetch, storage?: CheckoutAttemptStorage,
): Promise<string> {
  let attempts: CheckoutAttemptStorage;
  let checkoutKey: string;
  try {
    attempts = storage ?? globalThis.sessionStorage;
    checkoutKey = checkoutAttemptKey(lines, attempts);
  } catch {
    // Never send a new attempt if its retry key cannot be persisted first.
    throw new Error(errors.CHECKOUT_UNAVAILABLE);
  }
  const response = await request('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkoutKey, lines: lines.map(({ id, qty }) => ({ id, qty })) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && data?.error === 'CHECKOUT_EXPIRED') {
      // Only a server-confirmed expired session permits a fresh key on a later user action.
      attempts.removeItem(attemptStorageKey(lines));
    }
    throw new Error(errors[data?.error] || errors.CHECKOUT_UNAVAILABLE);
  }
  if (typeof data?.id !== 'string' || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(data.id) || data.id.length > 256) {
    throw new Error(errors.CHECKOUT_UNAVAILABLE);
  }
  if (data.status === 'complete') return `/#/checkout/success?session_id=${encodeURIComponent(data.id)}`;
  if (data.status !== 'open') throw new Error(errors.CHECKOUT_UNAVAILABLE);
  let url: URL;
  try { url = new URL(data?.url); }
  catch { throw new Error(errors.CHECKOUT_UNAVAILABLE); }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) {
    throw new Error(errors.CHECKOUT_UNAVAILABLE);
  }
  return url.href;
}

export function checkoutErrorMessage(error: unknown): string {
  return error instanceof Error && Object.values(errors).includes(error.message)
    ? error.message
    : errors.CHECKOUT_UNAVAILABLE;
}
