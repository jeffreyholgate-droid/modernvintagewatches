import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/health.js';
import items from '../api/items.js';

const providerDetail = 'private-provider-detail: password=fixture-do-not-disclose';
const inventoryTables = ['items', 'settings', 'logs'];
const orderTables = ['orders', 'order_lines', 'inventory_reservations', 'stripe_events'];
const orderRpc = 'rpc/mvw_list_recent_orders';

type Failure = 'orders-table' | 'orders-rpc' | 'orders-network' | null;

function response() {
  return {
    statusCode: 0, body: {} as Record<string, any>, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    end(body: string) { this.body = JSON.parse(body); },
  };
}

async function checkHealth(failure: Failure) {
  const originalFetch = globalThis.fetch;
  const environment = {
    SUPABASE_URL: 'https://health-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
    NODE_ENV: 'production', VERCEL: '1',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, environment.SUPABASE_URL, 'the health check must use only the mocked database');
    const resource = url.pathname.replace(/^\/rest\/v1\//, '');
    assert.ok([...inventoryTables, ...orderTables, orderRpc].includes(resource), `unexpected database request: ${resource}`);
    calls.push(resource);
    if (failure === 'orders-network' && resource === 'orders') throw new Error(providerDetail);
    if ((failure === 'orders-table' && resource === 'orders') ||
        (failure === 'orders-rpc' && resource === orderRpc)) {
      return new Response(JSON.stringify({
        code: resource === orderRpc ? 'PGRST202' : 'PGRST205',
        message: providerDetail,
        details: 'Internal schema and SQL connection details must remain private',
        hint: providerDetail,
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.ok(Number.isFinite(Date.parse(res.body.now)), 'health responses include an ISO-compatible timestamp');
    assert.equal(res.headers['Content-Type'], 'application/json');
    for (const table of inventoryTables) assert.ok(calls.includes(table), `${table} schema was checked`);
    assert.equal(JSON.stringify(res.body).includes(providerDetail), false);
    assert.equal(JSON.stringify(res.body).includes('fixture-service-role-key'), false);
    return { res, calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('health returns 503 when inventory connects but the orders migration table is missing', async () => {
  const { res, calls } = await checkHealth('orders-table');
  assert.equal(res.statusCode, 503);
  assert.deepEqual({ ...res.body, now: undefined }, {
    ok: false, persistent: true, database: 'connected', orders: 'unavailable',
    error: 'ORDER_STORAGE_UNAVAILABLE', now: undefined,
  });
  assert.equal(calls.includes(orderRpc), false, 'do not report orders healthy from tables alone');
});

test('health returns 503 when order tables exist but their required migration RPC is missing', async () => {
  const { res, calls } = await checkHealth('orders-rpc');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.database, 'connected');
  assert.equal(res.body.orders, 'unavailable');
  assert.equal(res.body.error, 'ORDER_STORAGE_UNAVAILABLE');
  for (const table of orderTables) assert.ok(calls.includes(table));
  assert.ok(calls.includes(orderRpc));
  assert.equal('details' in res.body, false);
  assert.equal('hint' in res.body, false);
});

test('health returns 200 only when inventory, order schemas and the order RPC all respond', async () => {
  const { res, calls } = await checkHealth(null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual({ ...res.body, now: undefined }, {
    ok: true, persistent: true, database: 'connected', orders: 'connected', now: undefined,
  });
  assert.deepEqual([...calls].sort(), [...inventoryTables, ...orderTables, orderRpc].sort());
});

test('health sanitizes thrown provider errors while retaining the inventory connection result', async () => {
  const { res } = await checkHealth('orders-network');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.database, 'connected');
  assert.equal(res.body.error, 'ORDER_STORAGE_UNAVAILABLE');
  assert.equal(JSON.stringify(res.body).includes('password'), false);
});

test('configured but inaccessible database is unhealthy and inventory returns an explicit error', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://health-test.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-test-key';
  globalThis.fetch = async () => Response.json({ code: '42501', message: 'private-provider-detail' }, { status: 403 });
  try {
    const status = response();
    await handler({ method: 'GET' }, status);
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
