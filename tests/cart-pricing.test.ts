import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotalPence, publicPrice, quotedCartLine, reconcileCart, restoreCart } from '../lib/cart-pricing.js';
import { checkoutAttemptKey, checkoutNeedsPriceRefresh, hasCheckoutAttempt, requestCheckout, resumeExistingCheckout, type CheckoutAttemptStorage } from '../lib/checkout.js';

function item(id='watch-a',amount=125500) {
  return {id,titleBoutique:'Reviewed watch',status:'ACTIVE',publishStatus:'PUBLISHED',imageUrls:['https://example.com/watch.jpg'],
    pricing:{policyVersion:'mvw-pricing-v1',retailPricePence:amount,deliveryIncluded:true,deliveryRegion:'GB',vatMode:'NOT_REGISTERED'}};
}
function storage(): CheckoutAttemptStorage {
  const values=new Map<string,string>();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}};
}

test('legacy and tampered saved bags retain identities but cannot expose old source prices as retail quotes',()=>{
  const lines=restoreCart({lines:[{id:'watch-a',title:'Saved',priceGbp:0.01,qty:999,retailPricePence:1,pricingStatus:'ready'},
    {id:'watch-a',qty:1},{id:' watch-b',qty:1},{id:'watch-c',qty:1}]});
  assert.deepEqual(lines.map(line=>line.id),['watch-a','watch-c']);
  assert.ok(lines.every(line=>line.qty===1&&line.retailPricePence===null&&line.pricingStatus==='unchecked'));
  assert.equal(cartTotalPence(lines),null);
  const current=reconcileCart(lines,new Map([['watch-a',item('watch-a',125500)],['watch-c',item('watch-c',220500)]]));
  assert.equal(current.changed,true);
  assert.equal(current.ready,true);
  assert.equal(cartTotalPence(current.lines),346000);
});

test('missing or invalid retail quotes never fall back to source costs, and unavailable items block the total',()=>{
  assert.equal(publicPrice({priceGbp:100,shippingGbp:10}),null);
  for(const amount of [NaN,Infinity,-1,0,100.5,100000000])assert.equal(publicPrice({...item(),pricing:{...item().pricing,retailPricePence:amount}}),null);
  assert.equal(publicPrice({...item(),pricing:{...item().pricing,deliveryIncluded:false}}),null);
  const line=quotedCartLine(item())!;
  const missing=reconcileCart([line],new Map([['watch-a',null]]));
  assert.equal(missing.ready,false);
  assert.equal(cartTotalPence(missing.lines),null);
  assert.equal(missing.lines[0].pricingStatus,'unavailable');
  const wrongIdentity=reconcileCart([line],new Map([['watch-a',item('different')]]));
  assert.equal(wrongIdentity.ready,false);
  assert.equal(quotedCartLine({...item(),status:'RESERVED'}),null);
});

test('fresh server repricing signals review before checkout and all arithmetic stays in pence',()=>{
  const previous=quotedCartLine(item('watch-a',125500))!;
  const changed=reconcileCart([previous],new Map([['watch-a',item('watch-a',126000)]]));
  assert.equal(changed.changed,true);
  assert.equal(cartTotalPence(changed.lines),126000);
  const confirmed=reconcileCart(changed.lines,new Map([['watch-a',item('watch-a',126000)]]));
  assert.equal(confirmed.changed,false);
  assert.equal(confirmed.ready,true);
  assert.equal(cartTotalPence([quotedCartLine(item('a',10001))!,quotedCartLine(item('b',20002))!]),30003);
});

test('checkout sends the displayed expected amount and repricing keeps the existing retry key',async()=>{
  const attempts=storage();
  const original=[{id:'watch-a',qty:1,expectedAmountPence:125500}];
  const key=checkoutAttemptKey(original,attempts);
  let payload:any;
  await assert.rejects(requestCheckout(original,async(_url,options)=>{
    payload=JSON.parse(String(options?.body));
    return Response.json({error:'PRICE_CHANGED'},{status:409});
  },attempts),error=>checkoutNeedsPriceRefresh(error));
  assert.deepEqual(payload.lines,[{id:'watch-a',qty:1,expectedAmountPence:125500}]);
  const refreshed=[{id:'watch-a',qty:1,expectedAmountPence:126000}];
  assert.equal(checkoutAttemptKey(refreshed,attempts),key);
  const redirect=await requestCheckout(refreshed,async(_url,options)=>{
    payload=JSON.parse(String(options?.body));
    return Response.json({id:'cs_test_pricecheck',status:'open',url:'https://checkout.stripe.com/c/pay/cs_test_pricecheck'});
  },attempts);
  assert.equal(payload.checkoutKey,key);
  assert.equal(payload.lines[0].expectedAmountPence,126000);
  assert.equal(redirect,'https://checkout.stripe.com/c/pay/cs_test_pricecheck');
});

test('resuming reserved inventory requires an existing retry key and never submits a new-order quote',async()=>{
  const attempts=storage();
  const lines=[{id:'reserved-watch',qty:1,expectedAmountPence:300000}];
  let calls=0;
  await assert.rejects(resumeExistingCheckout(lines,async()=>{calls++;return Response.json({});},attempts));
  assert.equal(calls,0);
  assert.equal(hasCheckoutAttempt(lines,attempts),false);
  const existingKey=checkoutAttemptKey(lines,attempts);
  let payload:any;
  await resumeExistingCheckout(lines,async(_url,options)=>{
    payload=JSON.parse(String(options?.body));
    return Response.json({id:'cs_test_existing',status:'open',url:'https://checkout.stripe.com/c/pay/cs_test_existing'});
  },attempts);
  assert.equal(payload.checkoutKey,existingKey);
  assert.deepEqual(payload.lines,[{id:'reserved-watch',qty:1}]);
  await assert.rejects(resumeExistingCheckout(lines,async()=>Response.json({error:'CHECKOUT_EXPIRED'},{status:409}),attempts));
  assert.equal(hasCheckoutAttempt(lines,attempts),false);
  await assert.rejects(resumeExistingCheckout(lines,async()=>{calls++;return Response.json({});},attempts));
  assert.equal(calls,0);
});
