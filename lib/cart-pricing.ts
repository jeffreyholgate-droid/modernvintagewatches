export type PublicPrice = {
  policyVersion: string;
  retailPricePence: number;
  deliveryIncluded: true;
  deliveryRegion: 'GB';
  vatMode: 'NOT_REGISTERED';
};

export type CartLine = {
  id: string;
  title: string;
  imageUrl?: string;
  qty: 1;
  retailPricePence: number | null;
  policyVersion: string | null;
  pricingStatus: 'unchecked' | 'ready' | 'unavailable';
};

export function publicPrice(item: unknown): PublicPrice | null {
  const value = (item as { pricing?: unknown } | null | undefined)?.pricing as Partial<PublicPrice> | null | undefined;
  return value && typeof value.policyVersion === 'string' && value.policyVersion.length > 0 &&
    Number.isSafeInteger(value.retailPricePence) && value.retailPricePence! >= 50 && value.retailPricePence! <= 99999999 &&
    value.deliveryIncluded === true && value.deliveryRegion === 'GB' && value.vatMode === 'NOT_REGISTERED'
    ? value as PublicPrice : null;
}

export function formatPence(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);
}

/** Preserve saved basket identities, never trust legacy source costs or persisted quote readiness. */
export function restoreCart(value: unknown): CartLine[] {
  const lines = (value as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return [];
  const seen = new Set<string>();
  return lines.filter(line => {
    if (!line || typeof line.id !== 'string' || !line.id.trim() || line.id !== line.id.trim() ||
        line.id.length > 200 || /[\x00-\x1f\x7f]/.test(line.id) || seen.has(line.id)) return false;
    seen.add(line.id);
    return true;
  }).slice(0, 20).map(line => ({
    id: line.id, title: typeof line.title === 'string' ? line.title : 'Watch',
    imageUrl: typeof line.imageUrl === 'string' ? line.imageUrl : undefined, qty: 1,
    retailPricePence: null, policyVersion: null, pricingStatus: 'unchecked',
  }));
}

export function quotedCartLine(item: any): CartLine | null {
  const price = publicPrice(item);
  if (!price || typeof item?.id !== 'string' || item.status !== 'ACTIVE' || item.publishStatus !== 'PUBLISHED') return null;
  return { id: item.id, title: item.titleBoutique || item.titleRaw || 'Watch', imageUrl: item.imageUrls?.[0], qty: 1,
    retailPricePence: price.retailPricePence, policyVersion: price.policyVersion, pricingStatus: 'ready' };
}

export function cartTotalPence(lines: CartLine[]): number | null {
  if (lines.some(line => line.pricingStatus !== 'ready' || !Number.isSafeInteger(line.retailPricePence) || line.retailPricePence! < 50 || line.qty !== 1)) return null;
  const total = lines.reduce((sum, line) => sum + line.retailPricePence!, 0);
  return Number.isSafeInteger(total) && total <= 99999999 ? total : null;
}

export function reconcileCart(lines: CartLine[], observations: Map<string, any | null>) {
  let changed = false;
  const next = lines.map(line => {
    if (!observations.has(line.id)) return line;
    const quote = quotedCartLine(observations.get(line.id));
    if (!quote || quote.id !== line.id) return { ...line, retailPricePence: null, policyVersion: null, pricingStatus: 'unavailable' as const };
    if (line.retailPricePence !== quote.retailPricePence || line.policyVersion !== quote.policyVersion) changed = true;
    return quote;
  });
  return { lines: next, changed, ready: next.length > 0 && cartTotalPence(next) !== null };
}

/** Remove only stored order IDs after both payment and durable order confirmation. */
export function removeVerifiedPaidItems(lines: CartLine[], confirmation: unknown): CartLine[] {
  const data = confirmation as { paid?: unknown; status?: unknown; orderStatus?: unknown; itemIds?: unknown } | null;
  if (data?.paid !== true || data.status !== 'complete' || data.orderStatus !== 'paid_awaiting_source' ||
      !Array.isArray(data.itemIds) || data.itemIds.length < 1 || data.itemIds.length > 20 ||
      data.itemIds.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) ||
      new Set(data.itemIds).size !== data.itemIds.length) return lines;
  const paid = new Set(data.itemIds);
  return lines.filter(line => !paid.has(line.id));
}
