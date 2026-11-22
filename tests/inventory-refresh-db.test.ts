import test from 'node:test';
import assert from 'node:assert/strict';
import { withdrawSourceItems } from '../api/_lib/db.js';

test('source withdrawal atomically guards active state and snapshot timestamp, preserving curated/source data', async () => {
  const savedUrl=process.env.SUPABASE_URL;
  const savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch=globalThis.fetch;
  const old='2026-03-20T00:00:00.000Z';
  const rows=['ACTIVE','RESERVED','SOLD','ACTIVE','ACTIVE'].map((status,index)=>({
    id:`stable-${index}`,ebay_item_id:`v1|10000000000${index}|0`,status,publish_state:'PUBLISHED',
    last_seen_at:index===3?'2026-11-22T10:00:00.000Z':old,first_seen_at:old,
    title_boutique:'Reviewed title',description:'Reviewed facts',score:85,price_gbp:2000,
  }));
  const before=structuredClone(rows);
  const writes:Array<Record<string,unknown>>=[];
  process.env.SUPABASE_URL='https://refresh-test.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    assert.equal(url.origin,'https://refresh-test.supabase.invalid');
    assert.equal(init?.method,'PATCH');
    assert.equal(url.searchParams.get('status'),'eq.ACTIVE');
    assert.equal(url.searchParams.get('last_seen_at'),`eq.${old}`);
    assert.equal(url.searchParams.get('select'),'id');
    const patch=JSON.parse(String(init?.body));
    writes.push(patch);
    const matched=rows.filter(row=>`eq.${row.id}`===url.searchParams.get('id')&&
      `eq.${row.ebay_item_id}`===url.searchParams.get('ebay_item_id')&&row.status==='ACTIVE'&&row.last_seen_at===old);
    for(const row of matched)Object.assign(row,patch);
    return Response.json(matched.map(row=>({id:row.id})));
  };
  try{
    const changed=await withdrawSourceItems(rows.map((row,index)=>({id:row.id,ebayItemId:row.ebay_item_id,
      reason:index===4?'REVIEW_REQUIRED':'ENDED',expectedLastSeenAt:old})));
    assert.equal(changed,2);
    assert.equal(rows[0].status,'ENDED');
    assert.equal(rows[0].publish_state,'UNPUBLISHED');
    assert.equal(rows[4].status,'ACTIVE');
    assert.equal(rows[4].publish_state,'UNPUBLISHED');
    for(const index of [1,2,3])assert.deepEqual(rows[index],before[index]);
    for(const row of rows){
      assert.equal(row.title_boutique,'Reviewed title');
      assert.equal(row.description,'Reviewed facts');
      assert.equal(row.price_gbp,2000);
      assert.equal(row.first_seen_at,old);
      assert.equal(row.score,85);
    }
    assert.deepEqual(Object.keys(writes[0]).sort(),['publish_state','status','updated_at']);
    assert.deepEqual(Object.keys(writes[4]).sort(),['publish_state','updated_at']);
    await assert.rejects(withdrawSourceItems([{id:'stable',ebayItemId:'mock',reason:'ENDED',expectedLastSeenAt:old}]),/INVALID_INVENTORY_OBSERVATION/);
    assert.equal(writes.length,5);
  }finally{
    globalThis.fetch=originalFetch;
    if(savedUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=savedUrl;
    if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;
  }
});
