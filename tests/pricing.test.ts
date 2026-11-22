import test from 'node:test';
import assert from 'node:assert/strict';
import { Category } from '../types.js';
import { DEFAULT_PRICING_POLICY, normalizePricingPolicy, pricingForItem, publicPricing, pricedItem } from '../api/_lib/pricing.js';
import { normalizeSettings } from '../api/_lib/db.js';

const settings = {
  marginPercent: { WATCH: 20, HANDBAG: 20, JEWELLERY: 20 },
  pricingPolicy: { ...DEFAULT_PRICING_POLICY },
};
const tudor = { priceGbp: 2709.70, shippingGbp: 15.95, category: Category.WATCH };

test('retail covers both delivery legs with 20% gross margin, rounded up to £5', () => {
  const q = pricingForItem(tudor, settings);
  assert.equal(q.sourceItemPence, 270970);
  assert.equal(q.sourceShippingPence, 1595);
  assert.equal(q.costBasisPence, 277565);
  assert.equal(q.retailPricePence, 347000);
  assert.equal(q.grossProfitPence, 69435);
  assert.equal(q.estimatedFeePence, 12165);
  assert.equal(q.estimatedContributionPence, 57270);
  assert.equal(q.vatMode, 'NOT_REGISTERED');
  assert.ok(q.grossProfitPence / q.retailPricePence >= 0.20);
  assert.equal(tudor.priceGbp, 2709.70, 'source cost is never overwritten');
});

test('exact rounding boundary stays exact; one penny above it rounds up', () => {
  assert.equal(pricingForItem({ ...tudor, priceGbp: 1950, shippingGbp: 0 }, settings).retailPricePence, 250000);
  assert.equal(pricingForItem({ ...tudor, priceGbp: 1950.01, shippingGbp: 0 }, settings).retailPricePence, 250500);
});

test('category margin and delivery settings change retail, fee estimates never surcharge checkout', () => {
  const higher = { ...settings, marginPercent: { ...settings.marginPercent, WATCH: 25 } };
  assert.equal(pricingForItem(tudor, higher).retailPricePence, 370500);
  const feeChange = { ...settings, pricingPolicy: { ...settings.pricingPolicy, feeAllowanceBps: 1000 } };
  assert.equal(pricingForItem(tudor, feeChange).retailPricePence, 347000);
  assert.ok(pricingForItem(tudor, feeChange).estimatedContributionPence < pricingForItem(tudor, settings).estimatedContributionPence);
  const deliveryChange = { ...settings, pricingPolicy: { ...settings.pricingPolicy, deliveryAllowancePence: 10000 } };
  assert.equal(pricingForItem(tudor, deliveryChange).retailPricePence, 353500);
});

test('each watch carries its own fulfilment allowance and conservative fee estimate', () => {
  const quotes = [tudor, { ...tudor, priceGbp: 5999, shippingGbp: 0 }].map(item => pricingForItem(item, settings));
  assert.equal(quotes.reduce((sum, q) => sum + q.deliveryAllowancePence, 0), 10000);
  assert.equal(quotes.reduce((sum, q) => sum + q.feeFixedPence, 0), 40);
  assert.ok(quotes.every(q => Number.isSafeInteger(q.retailPricePence)));
});

test('invalid source values and money overflow never become a sellable price', () => {
  for (const priceGbp of [-1, 0, NaN, Infinity, 1.001, 999999.99]) {
    assert.throws(() => pricingForItem({ ...tudor, priceGbp }, settings));
  }
  for (const shippingGbp of [-1, NaN, Infinity, 0.001]) {
    assert.throws(() => pricingForItem({ ...tudor, shippingGbp }, settings));
  }
  assert.equal(pricedItem({ ...tudor, priceGbp: NaN }, settings, false).pricing, null);
});

test('missing legacy pricing receives defaults but malformed policy/margin fails closed', () => {
  assert.deepEqual(normalizePricingPolicy(undefined), DEFAULT_PRICING_POLICY);
  for (const patch of [{ deliveryAllowancePence: -1 }, { deliveryAllowancePence: 1.5 }, { feeAllowanceBps: 1100 },
    { feeFixedPence: -1 }, { roundingPence: 0 }, { vatMode: 'MARGIN_SCHEME' }, { version: 'future' }]) {
    assert.throws(() => normalizePricingPolicy({ ...DEFAULT_PRICING_POLICY, ...patch }));
  }
  for (const margin of [NaN, Infinity, 100, -1, 0, 20.001, '20']) {
    assert.throws(() => pricingForItem(tudor, { ...settings, marginPercent: { ...settings.marginPercent, WATCH: margin as number } }));
  }
});

test('public price DTO contains delivery and retail amount without internal margin/fee breakdown', () => {
  assert.deepEqual(publicPricing(pricingForItem(tudor, settings)), {
    policyVersion: 'mvw-pricing-v1', retailPricePence: 347000, deliveryIncluded: true,
    deliveryRegion: 'GB', vatMode: 'NOT_REGISTERED',
  });
  const serialized = pricedItem(tudor, settings, false);
  assert.equal('priceGbp' in serialized, false);
  assert.equal('shippingGbp' in serialized, false);
  assert.equal('estimatedContributionPence' in serialized.pricing!, false);
  const admin = pricedItem(tudor, settings, true);
  assert.equal((admin as any).priceGbp, 2709.70);
  assert.equal((admin.pricing as any).estimatedContributionPence, 57270);
});

test('settings migration preserves existing category margins; saves require explicit supported VAT/policy', () => {
  const legacy = normalizeSettings({ marginPercent: { WATCH: 23 }, vatMode: 'MARGIN_SCHEME' });
  assert.equal(legacy.marginPercent.WATCH, 23);
  assert.equal(legacy.vatMode, 'NOT_REGISTERED');
  assert.deepEqual(legacy.pricingPolicy, DEFAULT_PRICING_POLICY);
  assert.throws(() => normalizeSettings({ marginPercent: { WATCH: 20 } }, true));
  assert.throws(() => normalizeSettings({ ...legacy, priceMin: { WATCH: 6000 }, priceMax: { WATCH: 1000 } }, true));
  assert.throws(() => normalizeSettings({ ...legacy, marginPercent: { WATCH: 100 } }, true));
  for (const key of ['marginPercent', 'priceMin', 'priceMax']) {
    for (const value of ['bad', [], null, { UNKNOWN: 20 }]) {
      assert.throws(() => normalizeSettings({ ...legacy, [key]: value }, true));
    }
  }
  assert.doesNotThrow(() => normalizeSettings(legacy, true));
});
