import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/orders.js';
import { signAdminToken } from '../api/_lib/auth.js';

function response() {
  return {
    statusCode: 0, body: {} as any, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    end(body: string) { this.body = JSON.parse(body); },
  };
}

test('orders list requires server-verified admin authentication and does not permit changes', async () => {
  const savedSecret = process.env.ADMIN_JWT_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.ADMIN_JWT_SECRET = 'test-admin-secret-for-order-auth';
  let contactedDatabase = false;
  globalThis.fetch = async () => { contactedDatabase = true; throw new Error('should not query'); };
  try {
    for (const headers of [{}, { authorization: 'Bearer fake' }]) {
      const res = response();
      await handler({ method: 'GET', headers }, res);
      assert.equal(res.statusCode, 401);
    }
    const res = response();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${await signAdminToken({ role: 'admin' })}` } }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'GET');
    assert.equal(contactedDatabase, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = savedSecret;
  }
});
