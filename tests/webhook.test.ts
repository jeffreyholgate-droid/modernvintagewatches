import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { handleStripeWebhook, StripeOrderEvent } from '../api/_lib/webhook.js';

const secret = 'whsec_unit_test_signing_secret';
const orderId = '624a953d-3acb-4318-8c56-a65ab31b2a13';
const event = (type = 'checkout.session.completed', paymentStatus = 'paid') => ({
  id: 'evt_testorder1', object: 'event', type, livemode: false,
  data: { object: {
    id: 'cs_test_123456', object: 'checkout.session', mode: 'payment', livemode: false,
    status: type === 'checkout.session.expired' ? 'expired' : 'complete',
    payment_status: paymentStatus, amount_total: 250000, currency: 'gbp',
    metadata: { checkout_origin: 'mvw-checkout-v1', order_id: orderId },
    customer_details: { email: 'private-test@example.invalid', name: 'Private test customer' },
  } },
});

function signedRequest(payload: string, options: { signature?: string; timestamp?: number; body?: string } = {}) {
  const signature = options.signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: options.timestamp });
  return new Request('https://mvw.invalid/api/stripe-webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: options.body ?? payload,
  });
}

test('signed raw bytes are verified unchanged and only minimal order fields reach storage', async () => {
  const payload = JSON.stringify({ ...event(), description: 'Spacing and Unicode £ ⌚' }, null, 2).replace(/\n/g, '\r\n');
  const events: StripeOrderEvent[] = [];
  const request = signedRequest(payload);
  request.json = async () => { throw new Error('Never parse before signature verification'); };
  const result = await handleStripeWebhook(request, { endpointSecret: secret, applyEvent: async value => { events.push(value); } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { received: true });
  assert.deepEqual(events, [{
    eventId: 'evt_testorder1', type: 'checkout.session.completed', orderId,
    sessionId: 'cs_test_123456', amountTotal: 250000, currency: 'gbp', paymentStatus: 'paid', livemode: false,
  }]);
  assert.ok(!JSON.stringify(events).includes('private-test'));
});

test('tampered body, missing signature, wrong secret and stale signatures cannot reach storage', async () => {
  const payload = JSON.stringify(event());
  let calls = 0;
  const dependencies = { endpointSecret: secret, applyEvent: async () => { calls++; } };
  const requests = [
    signedRequest(payload, { body: payload.replace('250000', '1') }),
    new Request('https://mvw.invalid/api/stripe-webhook', { method: 'POST', body: payload }),
    signedRequest(payload, { signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' }) }),
    signedRequest(payload, { timestamp: Math.floor(Date.now() / 1000) - 600 }),
  ];
  for (const request of requests) {
    const result = await handleStripeWebhook(request, dependencies);
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { error: 'INVALID_SIGNATURE' });
  }
  assert.equal(calls, 0);
});

test('test-only recovery rejects signed live events and inconsistent live session data', async () => {
  let calls = 0;
  const liveEvent = { ...event(), livemode: true };
  const liveSession = event();
  liveSession.data.object.livemode = true;
  liveSession.data.object.id = 'cs_live_123456';
  for (const value of [liveEvent, liveSession]) {
    const result = await handleStripeWebhook(signedRequest(JSON.stringify(value)), {
      endpointSecret: secret, applyEvent: async () => { calls++; },
    });
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 0);
});

test('unrelated and legacy events are acknowledged without creating orders', async () => {
  let calls = 0;
  const unrelated = { ...event(), type: 'invoice.paid' };
  const otherOrigin = event();
  otherOrigin.data.object.metadata.checkout_origin = 'another-shop';
  const legacy = event();
  delete (legacy.data.object.metadata as Record<string, string>).order_id;
  for (const value of [unrelated, otherOrigin, legacy]) {
    const result = await handleStripeWebhook(signedRequest(JSON.stringify(value)), {
      endpointSecret: secret, applyEvent: async () => { calls++; },
    });
    assert.equal(result.status, 200);
  }
  assert.equal(calls, 0);
});

test('unpaid completion remains unpaid and release/payment decisions stay in the atomic sink', async () => {
  const received: StripeOrderEvent[] = [];
  for (const [type, status] of [
    ['checkout.session.completed', 'unpaid'],
    ['checkout.session.async_payment_succeeded', 'paid'],
    ['checkout.session.expired', 'unpaid'],
    ['checkout.session.async_payment_failed', 'unpaid'],
  ]) {
    const result = await handleStripeWebhook(signedRequest(JSON.stringify(event(type, status))), {
      endpointSecret: secret, applyEvent: async value => { received.push(value); },
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(received.map(value => [value.type, value.paymentStatus]), [
    ['checkout.session.completed', 'unpaid'],
    ['checkout.session.async_payment_succeeded', 'paid'],
    ['checkout.session.expired', 'unpaid'],
    ['checkout.session.async_payment_failed', 'unpaid'],
  ]);
});

test('repeat deliveries reach the idempotent sink and both receive success acknowledgements', async () => {
  const processed = new Set<string>();
  let mutations = 0;
  let deliveries = 0;
  const payload = JSON.stringify(event());
  const applyEvent = async (value: StripeOrderEvent) => {
    deliveries++;
    const duplicate = processed.has(value.eventId);
    if (!duplicate) { mutations++; processed.add(value.eventId); }
    return { duplicate };
  };
  for (let i = 0; i < 2; i++) {
    const result = await handleStripeWebhook(signedRequest(payload), { endpointSecret: secret, applyEvent });
    assert.equal(result.status, 200);
  }
  assert.equal(deliveries, 2);
  assert.equal(mutations, 1);
});

test('storage failures and session-attachment races remain retryable without disclosing details', async () => {
  const payload = JSON.stringify(event());
  let attempts = 0;
  const dependencies = {
    endpointSecret: secret,
    applyEvent: async () => {
      attempts++;
      if (attempts === 1) throw new Error('ORDER_SESSION_PENDING private-test@example.invalid secret-sentinel');
    },
  };
  const first = await handleStripeWebhook(signedRequest(payload), dependencies);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), { error: 'WEBHOOK_RETRY' });
  const retry = await handleStripeWebhook(signedRequest(payload), dependencies);
  assert.equal(retry.status, 200);
  assert.equal(attempts, 2);
});

test('contradictory expiry status and invalid order IDs cannot mutate orders', async () => {
  const badStatus = event('checkout.session.expired', 'unpaid');
  badStatus.data.object.status = 'complete';
  const badOrder = event();
  badOrder.data.object.metadata.order_id = 'not-an-order';
  let calls = 0;
  for (const value of [badStatus, badOrder]) {
    const result = await handleStripeWebhook(signedRequest(JSON.stringify(value)), {
      endpointSecret: secret, applyEvent: async () => { calls++; },
    });
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 0);
});

test('methods, missing configuration and oversized streams fail before storage', async () => {
  let calls = 0;
  const applyEvent = async () => { calls++; };
  const method = await handleStripeWebhook(new Request('https://mvw.invalid/api/stripe-webhook'), { endpointSecret: secret, applyEvent });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  const unconfigured = await handleStripeWebhook(signedRequest(JSON.stringify(event())), { endpointSecret: undefined, applyEvent });
  assert.equal(unconfigured.status, 503);
  const large = signedRequest('x'.repeat(1024 * 1024 + 1));
  const oversized = await handleStripeWebhook(large, { endpointSecret: secret, applyEvent });
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});
