import test from 'node:test';
import assert from 'node:assert/strict';
import { Category, PublishState, type EbayItem } from '../types.js';
import { planInventoryRefresh, meetsRefreshPolicy, type RefreshPolicy } from '../server/inventory-refresh.js';

const ids = ['v1|100000000001|0','v1|100000000002|0','v1|100000000003|0','v1|100000000004|0'];
const policy: RefreshPolicy = {
  priceMin: { WATCH: 1500, HANDBAG: 1500, JEWELLERY: 1500 },
  priceMax: { WATCH: 6000, HANDBAG: 6000, JEWELLERY: 6000 },
  sellerMinFeedback: 95, sellerMinScore: 50, blockKeywords: 'mod, replica, ice',
};
function source(ebayItemId = ids[0]): EbayItem {
  return { id: `ebay_${ebayItemId}`, ebayItemId, url: 'https://www.ebay.co.uk/itm/100000000001',
    titleRaw: 'Omega modern model at a good price', priceGbp: 2000, shippingGbp: 10,
    sellerName: 'fixture', sellerFeedbackPercent: 99, sellerFeedbackScore: 500,
    category: Category.WATCH, locationCountry: 'GB', imageUrls: ['https://i.ebayimg.com/fixture.jpg'],
    status: 'ACTIVE', firstSeenAt: '2026-11-22T09:00:00Z', lastSeenAt: '2026-11-22T09:00:00Z' };
}

test('refresh inspects every existing ID beyond search results and only positively withdraws unavailable sources', async () => {
  const old = '2026-03-20T00:00:00Z';
  const existing = ids.slice(0,3).map((ebayItemId,index) => ({ id:`stable-${index}`, ebayItemId,
    category:Category.WATCH,status:'ACTIVE',firstSeenAt:old,lastSeenAt:old }));
  const calls:string[]=[];
  const plan=await planInventoryRefresh({ existing, candidateIds:[ids[3],ids[3]], policy,
    getSourceItem:async id=>{calls.push(id); if(id===ids[1])return null; if(id===ids[2])throw new Error('eBay Browse item lookup failed: 429');return source(id);} });
  assert.deepEqual(calls.sort(),ids);
  assert.equal(plan.sourceUpdates.length,1);
  assert.equal(plan.sourceUpdates[0].id,'stable-0');
  assert.equal(plan.sourceUpdates[0].firstSeenAt,old);
  assert.deepEqual(plan.withdrawals,[{id:'stable-1',ebayItemId:ids[1],reason:'ENDED',expectedLastSeenAt:old}]);
  assert.deepEqual(plan.unknown,[{ebayItemId:ids[2],reason:'SOURCE_LOOKUP_FAILED'}]);
  assert.equal(plan.newItems.length,1);
  assert.equal(plan.newItems[0].publishStatus,PublishState.UNPUBLISHED);
  assert.equal(plan.newItems[0].score,0);
});

test('reserved/sold inventory is untouched even when search rediscovers the same source', async () => {
  let calls=0;
  const plan=await planInventoryRefresh({ existing:ids.slice(0,2).map((ebayItemId,index)=>({id:`stable-${index}`,ebayItemId,
    category:Category.WATCH,status:index?'SOLD':'RESERVED',lastSeenAt:'2026-03-20T00:00:00Z'})),candidateIds:ids.slice(0,2),policy,
    getSourceItem:async()=>{calls++;return null;} });
  assert.equal(calls,0);
  assert.equal(plan.withdrawals.length+plan.newItems.length+plan.sourceUpdates.length,0);
  assert.deepEqual(plan.skipped.map(value=>value.reason),['PROTECTED_STATUS','PROTECTED_STATUS']);
});

test('configured block terms match whole words and revised out-of-policy offers require review rather than being declared ended', async () => {
  assert.equal(meetsRefreshPolicy(source(),policy),true);
  assert.equal(meetsRefreshPolicy({...source(),titleRaw:'Seiko mod'},policy),false);
  const plan=await planInventoryRefresh({existing:[{id:'stable',ebayItemId:ids[0],category:Category.WATCH,status:'ACTIVE',lastSeenAt:'2026-03-20T00:00:00Z'}],
    candidateIds:[ids[1]],policy,getSourceItem:async id=>({...source(id),priceGbp:7000})});
  assert.equal(plan.sourceUpdates.length,1);
  assert.equal(plan.withdrawals[0].reason,'REVIEW_REQUIRED');
  assert.equal(plan.newItems.length,0);
  assert.equal(plan.skipped[0].reason,'CANDIDATE_REJECTED');
});

test('active source ineligibility withdraws for review while source uncertainty stays untouched', async () => {
  const plan=await planInventoryRefresh({existing:ids.slice(0,2).map((ebayItemId,index)=>({id:`stable-${index}`,ebayItemId,
    category:Category.WATCH,status:'ACTIVE',lastSeenAt:'2026-03-20T00:00:00Z'})),candidateIds:[ids[2]],policy,
    getSourceItem:async id=>{throw new Error(id===ids[1]?'EBAY_ITEM_AVAILABILITY_UNKNOWN':'EBAY_ITEM_INELIGIBLE');}});
  assert.deepEqual(plan.withdrawals,[{id:'stable-0',ebayItemId:ids[0],reason:'REVIEW_REQUIRED',expectedLastSeenAt:'2026-03-20T00:00:00Z'}]);
  assert.deepEqual(plan.unknown,[{ebayItemId:ids[1],reason:'EBAY_ITEM_AVAILABILITY_UNKNOWN'}]);
  assert.deepEqual(plan.skipped,[{ebayItemId:ids[2],reason:'CANDIDATE_REJECTED'}]);
  assert.equal(plan.sourceUpdates.length+plan.newItems.length,0);
});
