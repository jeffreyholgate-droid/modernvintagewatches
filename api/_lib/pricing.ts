import { Category } from '../../types.js';

export const PRICING_VERSION = 'mvw-pricing-v1' as const;
export type PricingPolicy = {
  version: typeof PRICING_VERSION;
  deliveryAllowancePence: number;
  feeAllowanceBps: number;
  feeFixedPence: number;
  roundingPence: number;
  vatMode: 'NOT_REGISTERED';
};

export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  version: PRICING_VERSION,
  deliveryAllowancePence: 5000,
  feeAllowanceBps: 350,
  feeFixedPence: 20,
  roundingPence: 500,
  vatMode: 'NOT_REGISTERED',
};

export type PublicPricingQuote = {
  policyVersion: typeof PRICING_VERSION;
  retailPricePence: number;
  deliveryIncluded: true;
  deliveryRegion: 'GB';
  vatMode: 'NOT_REGISTERED';
};

export type PricingQuote = PublicPricingQuote & {
  sourceItemPence: number;
  sourceShippingPence: number;
  deliveryAllowancePence: number;
  costBasisPence: number;
  marginBps: number;
  feeAllowanceBps: number;
  feeFixedPence: number;
  roundingPence: number;
  estimatedFeePence: number;
  grossProfitPence: number;
  estimatedContributionPence: number;
};

export class PricingError extends Error {
  constructor(public code: 'INVALID_PRICING_SETTINGS' | 'ITEM_NOT_PRICEABLE') { super(code); }
}

const integerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export function normalizePricingPolicy(value: unknown): PricingPolicy {
  // Legacy settings acquire explicit defaults; malformed configured policies fail closed.
  if (value === undefined) return { ...DEFAULT_PRICING_POLICY };
  const p = value as PricingPolicy | null;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.version !== PRICING_VERSION ||
      p.vatMode !== 'NOT_REGISTERED' || !integerIn(p.deliveryAllowancePence, 0, 25000) ||
      !integerIn(p.feeAllowanceBps, 0, 1000) || !integerIn(p.feeFixedPence, 0, 500) ||
      ![100, 500, 1000].includes(p.roundingPence)) {
    throw new PricingError('INVALID_PRICING_SETTINGS');
  }
  return { version: PRICING_VERSION, deliveryAllowancePence: p.deliveryAllowancePence,
    feeAllowanceBps: p.feeAllowanceBps, feeFixedPence: p.feeFixedPence,
    roundingPence: p.roundingPence, vatMode: 'NOT_REGISTERED' };
}

export function marginBasisPoints(percent: unknown): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 5 || percent > 60 ||
      Math.abs(Math.round(percent * 100) - percent * 100) > 1e-7) {
    throw new PricingError('INVALID_PRICING_SETTINGS');
  }
  return Math.round(percent * 100);
}

function moneyPence(value: number, minimum: number): number {
  const pence = Math.round(value * 100);
  if (!Number.isFinite(value) || !integerIn(pence, minimum, 99999999) ||
      Math.abs(pence / 100 - value) > 1e-7) throw new PricingError('ITEM_NOT_PRICEABLE');
  return pence;
}

export function pricingForItem(
  item: { priceGbp: number; shippingGbp: number; category: Category },
  settings: { marginPercent: Record<Category, number>; pricingPolicy?: PricingPolicy },
): PricingQuote {
  const policy = normalizePricingPolicy(settings.pricingPolicy);
  const marginBps = marginBasisPoints(settings.marginPercent?.[item.category]);
  const sourceItemPence = moneyPence(item.priceGbp, 50);
  const sourceShippingPence = moneyPence(item.shippingGbp, 0);
  const costBasisPence = sourceItemPence + sourceShippingPence + policy.deliveryAllowancePence;
  // Gross margin is a percentage of the selling price, not a markup on cost.
  // Integer arithmetic and upward rounding avoid undercutting the target margin.
  const retailPricePence = Math.ceil(costBasisPence * 10000 /
    ((10000 - marginBps) * policy.roundingPence)) * policy.roundingPence;
  if (!integerIn(retailPricePence, 50, 99999999)) throw new PricingError('ITEM_NOT_PRICEABLE');
  const estimatedFeePence = Math.ceil(retailPricePence * policy.feeAllowanceBps / 10000) + policy.feeFixedPence;
  const grossProfitPence = retailPricePence - costBasisPence;
  return {
    policyVersion: policy.version, retailPricePence, deliveryIncluded: true,
    deliveryRegion: 'GB', vatMode: policy.vatMode, sourceItemPence, sourceShippingPence,
    deliveryAllowancePence: policy.deliveryAllowancePence, costBasisPence, marginBps,
    feeAllowanceBps: policy.feeAllowanceBps, feeFixedPence: policy.feeFixedPence,
    roundingPence: policy.roundingPence, estimatedFeePence, grossProfitPence,
    estimatedContributionPence: grossProfitPence - estimatedFeePence,
  };
}

export function publicPricing(quote: PricingQuote): PublicPricingQuote {
  return { policyVersion: quote.policyVersion, retailPricePence: quote.retailPricePence,
    deliveryIncluded: true, deliveryRegion: 'GB', vatMode: quote.vatMode };
}

export function pricedItem<T extends { priceGbp: number; shippingGbp: number; category: Category }>(
  item: T, settings: Parameters<typeof pricingForItem>[1], admin: boolean,
) {
  const { priceGbp: _sourcePrice, shippingGbp: _sourceShipping, ...publicItem } = item;
  const visibleItem = admin ? item : publicItem;
  try {
    const quote = pricingForItem(item, settings);
    return { ...visibleItem, pricing: admin ? quote : publicPricing(quote) };
  } catch (error) {
    if (error instanceof PricingError && error.code === 'ITEM_NOT_PRICEABLE') return { ...visibleItem, pricing: null };
    throw error;
  }
}
