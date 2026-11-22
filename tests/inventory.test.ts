import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabase, getItemById, isPersistent, upsertItems, type AppStateItem } from '../api/_lib/db.js';
import { Category, PublishState } from '../types.js';

function observation(overrides: Partial<AppStateItem> = {}): AppStateItem {
  return {
    id: 'incoming-id', ebayItemId: 'v1|123|0', url: 'https://www.ebay.co.uk/itm/123',
    titleRaw: 'Updated source title', priceGbp: 3100, shippingGbp: 15,
    sellerName: 'seller', sellerFeedbackPercent: 100, sellerFeedbackScore: 500,
    category: Category.WATCH, locationCountry: 'GB', imageUrls: ['https://example.com/watch.jpg'],
    status: 'ACTIVE', lastSeenAt: '2026-11-22T10:00:00.000Z', firstSeenAt: '2026-11-22T10:00:00.000Z',
    publishStatus: PublishState.UNPUBLISHED, score: 0, ...overrides,
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stable-product-id', ebay_item_id: 'v1|123|0', title_raw: 'Original title',
    title_boutique: 'Reviewed Omega', description: 'Reviewed condition and provenance.',
    first_seen_at: '2026-03-01T00:00:00.000Z', last_seen_at: '2026-11-21T00:00:00.000Z',
    price_gbp: 3000, publish_state: PublishState.PUBLISHED, score: 91, status: 'ACTIVE',
    ...overrides,
  };
}

const envNames = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_ENV', 'VERCEL', 'ALLOW_IN_MEMORY_DB'] as const;

async function withEnvironment(values: Partial<Record<typeof envNames[number], string>>, run: () => Promise<void>) {
  const saved = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
  for (const key of envNames) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try { await run(); } finally {
    for (const key of envNames) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// Exercise the real Supabase/PostgREST client through a deterministic HTTP
// boundary. This applies its actual conflict policy and update predicates.
async function withDatabase(
  initial: Array<Record<string, any>>,
  run: (rows: Array<Record<string, any>>, requests: Array<{ method: string; body: any; url: URL }>) => Promise<void>,
  onInsert?: (rows: Array<Record<string, any>>) => void,
) {
  const rows = initial.map(row => ({ ...row }));
  const requests: Array<{ method: string; body: any; url: URL }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://mvw-test.supabase.invalid');
    assert.equal(url.pathname, '/rest/v1/items');
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, body, url });
    if (method === 'POST') {
      assert.match(new Headers(init?.headers).get('Prefer') || '', /resolution=ignore-duplicates/);
      assert.equal(url.searchParams.get('on_conflict'), 'ebay_item_id');
      const inserted: Array<{ ebay_item_id: string }> = [];
      for (const candidate of body) {
        if (rows.some(row => row.ebay_item_id === candidate.ebay_item_id)) continue;
        rows.push({ ...candidate });
        inserted.push({ ebay_item_id: candidate.ebay_item_id });
      }
      onInsert?.(rows);
      return Response.json(inserted, { status: 201 });
    }
    assert.equal(method, 'PATCH');
    assert.equal(url.searchParams.get('status'), 'eq.ACTIVE');
    const ebayId = url.searchParams.get('ebay_item_id')?.slice(3);
    const maxSeen = url.searchParams.get('last_seen_at')?.slice(4);
    assert.ok(maxSeen);
    for (const row of rows) {
      if (row.ebay_item_id === ebayId && row.status === 'ACTIVE' && Date.parse(row.last_seen_at) <= Date.parse(maxSeen)) {
        Object.assign(row, body);
      }
    }
    return new Response(null, { status: 204 });
  };
  try {
    await withEnvironment({ SUPABASE_URL: 'https://mvw-test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' }, () => run(rows, requests));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('re-import refreshes source data while preserving product identity and concurrent curation', async () => {
  await withDatabase([storedRow()], async (rows, requests) => {
    assert.equal(await upsertItems([observation()]), 0);
    assert.equal(rows[0].id, 'stable-product-id');
    assert.equal(rows[0].first_seen_at, '2026-03-01T00:00:00.000Z');
    assert.equal(rows[0].title_boutique, 'Editor changed this during the scan');
    assert.equal(rows[0].description, 'New reviewed description');
    assert.equal(rows[0].publish_state, PublishState.DRAFT);
    assert.equal(rows[0].score, 98);
    assert.equal(rows[0].price_gbp, 3100);
    assert.equal(rows[0].title_raw, 'Updated source title');
    const update = requests.find(request => request.method === 'PATCH')!.body;
    for (const field of ['id', 'ebay_item_id', 'first_seen_at', 'title_boutique', 'description', 'publish_state', 'score', 'status']) {
      assert.equal(Object.hasOwn(update, field), false, `${field} must not be written by a refresh`);
    }
  }, rows => {
    Object.assign(rows[0], { title_boutique: 'Editor changed this during the scan', description: 'New reviewed description', publish_state: PublishState.DRAFT, score: 98 });
  });
});

test('duplicate observations insert a new product once using the newest source data', async () => {
  await withDatabase([], async (rows, requests) => {
    const older = observation({ id: 'older-id', lastSeenAt: '2026-11-20T00:00:00.000Z', priceGbp: 1000 });
    const newer = observation({ id: 'newer-id', priceGbp: 3200 });
    assert.equal(await upsertItems([newer, older, newer]), 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'newer-id');
    assert.equal(rows[0].price_gbp, 3200);
    assert.equal(rows[0].publish_state, PublishState.UNPUBLISHED);
    assert.equal(requests.filter(request => request.method === 'PATCH').length, 0);
    assert.equal(await upsertItems([older]), 0);
    assert.equal(rows[0].price_gbp, 3200, 'a stale overlapping scan cannot regress the source price');
  });
});

test('a rescan cannot reactivate or change sold or reserved inventory', async () => {
  for (const status of ['SOLD', 'RESERVED']) {
    await withDatabase([storedRow({ status })], async rows => {
      await upsertItems([observation({ status: 'ACTIVE' })]);
      assert.equal(rows[0].status, status);
      assert.equal(rows[0].price_gbp, 3000);
      assert.equal(rows[0].last_seen_at, '2026-11-21T00:00:00.000Z');
    });
  }
});

test('explicit local memory mode has the same preservation and deduplication behaviour', async () => {
  await withEnvironment({ ALLOW_IN_MEMORY_DB: 'true', NODE_ENV: 'development' }, async () => {
    const original = observation({ id: 'memory-stable', ebayItemId: 'memory-item', titleBoutique: 'Reviewed', description: 'Keep me', publishStatus: PublishState.PUBLISHED, score: 95 });
    assert.equal(await upsertItems([original, original]), 1);
    assert.equal(await upsertItems([observation({ id: 'discard-me', ebayItemId: 'memory-item', priceGbp: 3500, lastSeenAt: '2026-11-23T00:00:00.000Z' })]), 0);
    const saved = await getItemById('memory-stable');
    assert.equal(saved?.priceGbp, 3500);
    assert.equal(saved?.titleBoutique, 'Reviewed');
    assert.equal(saved?.description, 'Keep me');
    assert.equal(saved?.publishStatus, PublishState.PUBLISHED);
    assert.equal(saved?.score, 95);
    assert.equal(saved?.firstSeenAt, original.firstSeenAt);
    assert.equal(await getItemById('discard-me'), null);
  });
});

test('missing or partial persistence configuration fails closed outside explicit local mode', async () => {
  for (const values of [
    {},
    { NODE_ENV: 'production', ALLOW_IN_MEMORY_DB: 'true' },
    { VERCEL: '1', ALLOW_IN_MEMORY_DB: 'true' },
    { SUPABASE_URL: 'https://mvw-test.supabase.invalid', ALLOW_IN_MEMORY_DB: 'true' },
  ]) {
    await withEnvironment(values, async () => {
      assert.equal(isPersistent(), false);
      await assert.rejects(upsertItems([observation()]), /PERSISTENCE_NOT_CONFIGURED/);
    });
  }
});

test('invalid timestamps are rejected before database writes', async () => {
  await withDatabase([], async (_, requests) => {
    await assert.rejects(upsertItems([observation({ lastSeenAt: 'not-a-date' })]), /INVALID_INVENTORY_OBSERVATION/);
    assert.equal(requests.length, 0);
  });
});

test('database health checks real tables and accepts an empty but valid database', async () => {
  const originalFetch = globalThis.fetch;
  const queried = new Map<string, string>();
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://mvw-test.supabase.invalid');
    queried.set(url.pathname, url.searchParams.get('select') || '');
    assert.equal(url.searchParams.get('limit'), '1');
    return Response.json([]);
  };
  try {
    await withEnvironment({ SUPABASE_URL: 'https://mvw-test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' }, async () => {
      assert.equal(await checkDatabase(), 'connected');
      assert.equal(queried.size, 3);
      assert.match(queried.get('/rest/v1/items') || '', /publish_state/);
      assert.match(queried.get('/rest/v1/settings') || '', /data/);
      assert.match(queried.get('/rest/v1/logs') || '', /message/);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('database health rejects an incompatible schema without leaking provider errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new URL(String(input)).pathname.endsWith('/items')
    ? Response.json({ message: 'provider detail that must remain private', code: '42703' }, { status: 400 })
    : Response.json([]);
  try {
    await withEnvironment({ SUPABASE_URL: 'https://mvw-test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' }, async () => {
      assert.equal(isPersistent(), true, 'credentials alone do not imply a healthy database');
      await assert.rejects(checkDatabase(), { message: 'DATABASE_UNAVAILABLE' });
    });
  } finally { globalThis.fetch = originalFetch; }
});
