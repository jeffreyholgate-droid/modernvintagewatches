import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/item/[id].js';
import { signAdminToken } from '../api/_lib/auth.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'watch-a', ebay_item_id: 'v1|100|0', url: 'https://www.ebay.co.uk/itm/100',
    title_raw: 'Source title', title_boutique: 'Reviewed title', description: 'Reviewed description',
    price_gbp: 2500, shipping_gbp: 0, seller_name: 'seller', seller_feedback_percent: 100,
    seller_feedback_score: 500, category: 'WATCH', location_country: 'GB', image_urls: [],
    status: 'ACTIVE', last_seen_at: '2026-11-22T00:00:00Z', first_seen_at: '2026-11-01T00:00:00Z',
    publish_state: 'PUBLISHED', score: 90, ...overrides,
  };
}

async function withDatabase(reply: (method: string, payload: any) => Response, run: (token: string) => Promise<void>) {
  const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, jwt: process.env.ADMIN_JWT_SECRET };
  const oldFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://mvw-test.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  process.env.ADMIN_JWT_SECRET = 'test-admin-secret-for-item-tests';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://mvw-test.supabase.invalid');
    if (url.pathname === '/rest/v1/settings') {
      assert.equal(url.searchParams.get('id'), 'eq.default');
      return Response.json({ data: { marginPercent: { WATCH: 20, HANDBAG: 20, JEWELLERY: 20 } } });
    }
    assert.equal(url.pathname, '/rest/v1/items');
    assert.equal(url.searchParams.get('id'), 'eq.watch-a');
    return reply(init?.method || 'GET', init?.body ? JSON.parse(String(init.body)) : undefined);
  };
  try { await run(await signAdminToken({ role: 'admin' })); }
  finally {
    globalThis.fetch = oldFetch;
    if (env.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url;
    if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
    if (env.jwt === undefined) delete process.env.ADMIN_JWT_SECRET; else process.env.ADMIN_JWT_SECRET = env.jwt;
  }
}

async function request(method = 'GET', token?: string, body?: unknown) {
  let output = '';
  const headers: Record<string, string> = {};
  const response = { statusCode: 200, setHeader: (name: string, value: string) => { headers[name] = value; }, end: (text: string) => { output = text; } };
  await handler({ method, query: { id: 'watch-a' }, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, response);
  return { status: response.statusCode, body: JSON.parse(output), headers };
}

test('item GET database failures return sanitized 503 instead of missing-product 404', async () => {
  await withDatabase(() => Response.json({ code: '42P01', message: 'private provider detail' }, { status: 400 }), async () => {
    const result = await request();
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'INVENTORY_UNAVAILABLE' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
  });
});

test('item missing row remains 404 and a published active item remains public', async () => {
  await withDatabase(() => Response.json({ code: 'PGRST116', message: 'No row' }, { status: 406 }), async () => {
    assert.equal((await request()).status, 404);
  });
  await withDatabase(() => Response.json(row()), async () => {
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.body.item.id, 'watch-a');
    assert.equal(result.body.item.pricing.retailPricePence, 319000);
    assert.equal(result.body.item.pricing.deliveryIncluded, true);
    assert.equal('priceGbp' in result.body.item, false);
    assert.equal('shippingGbp' in result.body.item, false);
  });
});

test('reserved, sold and unpublished item details remain hidden publicly but visible to admins', async () => {
  for (const overrides of [{ status: 'RESERVED' }, { status: 'SOLD' }, { publish_state: 'DRAFT' }]) {
    await withDatabase(() => Response.json(row(overrides)), async token => {
      assert.equal((await request()).status, 404);
      assert.equal((await request('GET', 'invalid-token')).status, 404);
      const admin = await request('GET', token);
      assert.equal(admin.status, 200);
      assert.equal(admin.body.item.id, 'watch-a');
      assert.equal(admin.body.item.priceGbp, 2500);
      assert.equal(admin.body.item.pricing.sourceItemPence, 250000);
    });
  }
});

test('PATCH authenticates before parsing, rejects malformed JSON, and sanitizes database failures', async () => {
  let called = 0;
  await withDatabase(() => { called++; return Response.json({ code: '42501', message: 'private database detail' }, { status: 403 }); }, async token => {
    assert.equal((await request('PATCH', undefined, '{')).status, 401);
    const malformed = await request('PATCH', token, '{');
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.body, { error: 'INVALID_JSON' });
    assert.equal(called, 0);
    const unavailable = await request('PATCH', token, { titleBoutique: 'Edited title' });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.body, { error: 'INVENTORY_UNAVAILABLE' });
  });
});

test('PATCH preserves its existing allowed field surface and returns the saved item', async () => {
  let savedPatch: any;
  await withDatabase((method, payload) => {
    if (method === 'PATCH') { savedPatch = payload; return new Response(null, { status: 204 }); }
    return Response.json(row({ title_boutique: 'Edited title' }));
  }, async token => {
    const result = await request('PATCH', token, { titleBoutique: 'Edited title', status: 'ACTIVE', priceGbp: 1, id: 'replacement' });
    assert.equal(result.status, 200);
    assert.equal(result.body.item.titleBoutique, 'Edited title');
    assert.equal(savedPatch.title_boutique, 'Edited title');
    for (const disallowed of ['status', 'price_gbp', 'id']) assert.equal(Object.hasOwn(savedPatch, disallowed), false);
  });
});

test('publishing requires review of every current photo and rejects a stale write', async () => {
  const url = 'https://example.com/front.jpg';
  let writes = 0;
  await withDatabase((method) => {
    if (method === 'PATCH') { writes++; return Response.json([]); }
    return Response.json(row({ publish_state: 'DRAFT', image_urls: [url] }));
  }, async token => {
    const unreviewed = await request('PATCH', token, { publishStatus: 'PUBLISHED' });
    assert.equal(unreviewed.status, 409);
    assert.equal(unreviewed.body.error, 'PHOTO_REVIEW_REQUIRED');
    assert.equal(writes, 0);
    const stale = await request('PATCH', token, { publishStatus: 'PUBLISHED', photoReview: [{ url, tone: 'soft-light' }] });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'LISTING_CHANGED');
    assert.equal(writes, 1);
  });
});
