import test from 'node:test';
import assert from 'node:assert/strict';
import { EbayClient, evaluatePurchasableItem, evaluateRefreshItem } from '../server/ebay.js';
import { Category } from '../types.js';

const id = 'v1|123456789012|0';
const active = () => ({
  itemId: id,
  buyingOptions: ['FIXED_PRICE'],
  price: { value: '2500.00', currency: 'GBP' },
  itemLocation: { country: 'GB' },
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', deliveryOptions: ['SHIP_TO_HOME'] }],
  shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '12.50', currency: 'GBP' } }],
});

async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('live source evidence returns the GBP item and explicit shipping price', () => {
  assert.deepEqual(evaluatePurchasableItem(active(), id), { priceGbp: 2500, shippingGbp: 12.5 });
  const limited = active();
  limited.estimatedAvailabilities[0].estimatedAvailabilityStatus = 'LIMITED_STOCK';
  assert.equal(evaluatePurchasableItem(limited, id)?.priceGbp, 2500);
});

test('ended, sold-out, auction-only, foreign and non-GBP listings cannot be bought', () => {
  assert.equal(evaluatePurchasableItem({ ...active(), itemEndDate: '2020-01-01T00:00:00Z' }, id), null);
  assert.equal(evaluatePurchasableItem({ ...active(), estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, id), null);
  assert.equal(evaluatePurchasableItem({ ...active(), estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', estimatedAvailableQuantity: 0, deliveryOptions: ['SHIP_TO_HOME'] }] }, id), null);
  assert.equal(evaluatePurchasableItem({ ...active(), buyingOptions: ['AUCTION'] }, id), null);
  assert.equal(evaluatePurchasableItem({ ...active(), price: { value: '2500', currency: 'USD' } }, id), null);
  assert.equal(evaluatePurchasableItem({ ...active(), itemLocation: { country: 'US' } }, id), null);
});

test('unknown stock or shipping, mismatched item and malformed prices fail closed', () => {
  assert.throws(() => evaluatePurchasableItem({ ...active(), estimatedAvailabilities: [] }, id), /AVAILABILITY_UNKNOWN/);
  assert.throws(() => evaluatePurchasableItem({ ...active(), shippingOptions: [] }, id), /SHIPPING_UNKNOWN/);
  assert.throws(() => evaluatePurchasableItem({ ...active(), shippingOptions: [{ shippingCostType: 'CALCULATED', shippingCost: { value: '0', currency: 'GBP' } }] }, id), /SHIPPING_UNKNOWN/);
  assert.throws(() => evaluatePurchasableItem({ ...active(), itemId: 'different' }, id), /EVIDENCE_INVALID/);
  assert.throws(() => evaluatePurchasableItem({ ...active(), price: { value: 'NaN', currency: 'GBP' } }, id), /PRICE_INVALID/);
  assert.throws(() => evaluatePurchasableItem({ ...active(), price: { value: '0', currency: 'GBP' } }, id), /PRICE_INVALID/);
});

test('refresh distinguishes active ineligible offers from confirmed ended or sold-out stock', () => {
  for (const changed of [
    { ...active(), buyingOptions: ['AUCTION'] },
    { ...active(), price: { value: '2500', currency: 'USD' } },
    { ...active(), itemLocation: { country: 'US' } },
  ]) assert.throws(() => evaluateRefreshItem(changed, id), /EBAY_ITEM_INELIGIBLE/);
  assert.equal(evaluateRefreshItem({ ...active(), itemEndDate: '2020-01-01T00:00:00Z' }, id), null);
  assert.equal(evaluateRefreshItem({ ...active(), estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, id), null);
  assert.throws(() => evaluateRefreshItem({ ...active(), estimatedAvailabilities: [] }, id), /AVAILABILITY_UNKNOWN/);
});

test('missing eBay credentials never silently generates mock production inventory', async () => {
  await withEnvironment({ EBAY_CLIENT_ID: undefined, EBAY_CLIENT_SECRET: undefined, ALLOW_MOCK_EBAY: undefined, NODE_ENV: 'test', VERCEL: undefined }, () => {
    assert.throws(() => new EbayClient(), /Missing EBAY_CLIENT_ID/);
  });
  for (const mode of [{ NODE_ENV: 'production', VERCEL: undefined }, { NODE_ENV: 'test', VERCEL: '1' }]) {
    await withEnvironment({ EBAY_CLIENT_ID: undefined, EBAY_CLIENT_SECRET: undefined, ALLOW_MOCK_EBAY: 'true', ...mode }, () => {
      assert.throws(() => new EbayClient(), /Missing EBAY_CLIENT_ID/);
    });
  }
});

test('explicit local mock inventory cannot pass a purchase verification', async () => {
  await withEnvironment({ EBAY_CLIENT_ID: undefined, EBAY_CLIENT_SECRET: undefined, ALLOW_MOCK_EBAY: 'true', NODE_ENV: 'test', VERCEL: undefined }, async () => {
    const ebay = new EbayClient();
    assert.equal((await ebay.searchItems(Category.WATCH, 2000, 3000)).length, 15);
    await assert.rejects(ebay.verifyItem(id), /REAL_SOURCE_REQUIRED/);
  });
});

test('search accepts modern model descriptions but blocks whole-word mod listings', async () => {
  await withEnvironment({ EBAY_CLIENT_ID: 'test-client', EBAY_CLIENT_SECRET: 'test-secret', EBAY_ENV: 'sandbox', EBAY_MARKETPLACE_ID: 'EBAY_GB' }, async () => {
    const originalFetch = globalThis.fetch;
    const titles = ['Omega Seamaster modern model', 'Seiko mod', 'Seiko MODDED', 'Cartier fake'];
    globalThis.fetch = async (input) => String(input).endsWith('/identity/v1/oauth2/token')
      ? new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 })
      : new Response(JSON.stringify({ itemSummaries: titles.map((title, index) => ({
          ...active(), title, itemId: `v1|12345678901${index}|0`,
          itemWebUrl: `https://www.ebay.co.uk/itm/12345678901${index}`,
        })) }), { status: 200 });
    try {
      const items = await new EbayClient().searchItems(Category.WATCH, 2000, 3000);
      assert.deepEqual(items.map(item => item.titleRaw), ['Omega Seamaster modern model']);
      assert.equal(items[0].shippingGbp, 12.5);
    } finally { globalThis.fetch = originalFetch; }
  });
});

test('verification reads OAuth and the exact encoded source item, distinguishing not-found from upstream failure', async () => {
  await withEnvironment({ EBAY_CLIENT_ID: 'test-client', EBAY_CLIENT_SECRET: 'test-secret', EBAY_ENV: 'sandbox', EBAY_MARKETPLACE_ID: 'EBAY_GB' }, async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    let itemStatus = 200;
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return url.endsWith('/identity/v1/oauth2/token')
        ? new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 })
        : new Response(JSON.stringify(active()), { status: itemStatus });
    };
    try {
      const ebay = new EbayClient();
      assert.deepEqual(await ebay.getPurchasableItem(id), { priceGbp: 2500, shippingGbp: 12.5 });
      assert.equal(urls[1], `https://api.sandbox.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`);
      itemStatus = 404;
      assert.equal(await ebay.verifyItem(id), false);
      itemStatus = 429;
      await assert.rejects(ebay.verifyItem(id), /lookup failed: 429/);
    } finally { globalThis.fetch = originalFetch; }
  });
});

test('full source refresh maps detail fields and shares a token across concurrent item lookups', async () => {
  await withEnvironment({ EBAY_CLIENT_ID:'test-client', EBAY_CLIENT_SECRET:'test-secret', EBAY_ENV:'sandbox' }, async () => {
    const originalFetch=globalThis.fetch;
    let oauthCalls=0;
    let incomplete=false;
    globalThis.fetch=async input=>{
      if(String(input).endsWith('/identity/v1/oauth2/token')){
        oauthCalls++;
        return new Response(JSON.stringify({access_token:'test-token',expires_in:7200}));
      }
      return new Response(JSON.stringify({...active(),title:'Current source title',itemWebUrl:'https://www.ebay.co.uk/itm/123456789012',
        image:incomplete?undefined:{imageUrl:'https://i.ebayimg.com/image.jpg'},seller:{username:'fixture',feedbackPercentage:'99.8',feedbackScore:999}}));
    };
    try{
      const client=new EbayClient();
      const [first,second]=await Promise.all([client.getSourceItem(id,Category.WATCH),client.getSourceItem(id,Category.WATCH)]);
      assert.equal(oauthCalls,1);
      assert.equal(first?.titleRaw,'Current source title');
      assert.equal(first?.shippingGbp,12.5);
      assert.equal(second?.sellerFeedbackPercent,99.8);
      assert.equal(second?.imageUrls.length,1);
      incomplete=true;
      await assert.rejects(client.getSourceItem(id,Category.WATCH),/METADATA_INCOMPLETE/);
      assert.equal(oauthCalls,1);
    }finally{globalThis.fetch=originalFetch;}
  });
});
