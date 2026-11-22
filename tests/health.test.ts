import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import items from '../api/items.js';

function response() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: {} as any,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    end(value: string) { this.body = JSON.parse(value); },
  };
}

test('configured but inaccessible database is unhealthy and inventory returns an explicit error', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://health-test.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-test-key';
  globalThis.fetch = async () => Response.json({ code: '42501', message: 'private-provider-detail' }, { status: 403 });
  try {
    const status = response();
    await health({ method: 'GET' }, status);
    assert.equal(status.statusCode, 503);
    assert.equal(status.body.ok, false);
    assert.equal(status.body.persistent, true);
    assert.equal(status.body.database, 'unavailable');
    assert.equal(JSON.stringify(status.body).includes('private-provider-detail'), false);
    const collection = response();
    await items({ method: 'GET', headers: {} }, collection);
    assert.equal(collection.statusCode, 503);
    assert.deepEqual(collection.body, { error: 'INVENTORY_UNAVAILABLE' });
    assert.equal(collection.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
