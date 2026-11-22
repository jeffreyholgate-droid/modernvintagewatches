type CheckoutRequestLine = { id: string; qty: number };

const errors: Record<string, string> = {
  INVALID_LINES: 'Each watch is a unique item. Please choose one of each watch in your bag.',
  ITEM_UNAVAILABLE: 'A watch is no longer available. Please review your bag before trying again.',
  ITEM_CHANGED: 'A source listing has changed. Please contact us to confirm the current price and availability.',
  CHECKOUT_UNAVAILABLE: 'Checkout is currently unavailable. Your bag has been saved; please try again later.',
};

export async function requestCheckout(lines: CheckoutRequestLine[], request: typeof fetch = fetch): Promise<string> {
  const response = await request('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: lines.map(({ id, qty }) => ({ id, qty })) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errors[data?.error] || errors.CHECKOUT_UNAVAILABLE);
  let url: URL;
  try { url = new URL(data?.url); }
  catch { throw new Error(errors.CHECKOUT_UNAVAILABLE); }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) {
    throw new Error(errors.CHECKOUT_UNAVAILABLE);
  }
  return url.href;
}

export function checkoutErrorMessage(error: unknown): string {
  return error instanceof Error && Object.values(errors).includes(error.message)
    ? error.message
    : errors.CHECKOUT_UNAVAILABLE;
}
