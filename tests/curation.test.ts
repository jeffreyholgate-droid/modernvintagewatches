import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler from '../api/jobs/curate.js';
import { signAdminToken } from '../api/_lib/auth.js';
import { getItemById, getLogs, upsertItems } from '../api/_lib/db.js';
import { OpenAIService } from '../server/openai.js';
import { Category, PublishState } from '../types.js';

test('AI curation saves only drafts and failed generation preserves them without exposing provider details', async () => {
  const env = { ALLOW_IN_MEMORY_DB: 'true', NODE_ENV: 'test', ADMIN_JWT_SECRET: 'test-secret-with-at-least-thirty-two-characters', VERCEL: undefined, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await upsertItems([{
      id: 'curation-test-item', ebayItemId: 'v1|999999999999|0', url: 'https://www.ebay.co.uk/itm/999999999999',
      titleRaw: 'Omega Seamaster', priceGbp: 2500, shippingGbp: 0, sellerName: 'test',
      sellerFeedbackPercent: 100, sellerFeedbackScore: 1000, category: Category.WATCH,
      locationCountry: 'GB', imageUrls: [], status: 'ACTIVE', lastSeenAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(), publishStatus: PublishState.UNPUBLISHED, score: 0,
    }]);
    mock.method(OpenAIService.prototype, 'normalizeListing', async () => ({ brand: 'Omega', model: 'Seamaster' }));
    let shouldFail = false;
    mock.method(OpenAIService.prototype, 'generateCopy', async () => {
      if (shouldFail) throw new Error('provider-request-contained-secret-sentinel');
      return { long_description: 'Generated description for human review.' };
    });
    const token = await signAdminToken({ role: 'admin' });
    const req = Object.assign(Readable.from([JSON.stringify({ id: 'curation-test-item' })]), {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    });
    let body = '';
    const res = { statusCode: 0, setHeader() {}, end(value: string) { body = value; } };
    await handler(req, res);
    assert.equal(res.statusCode, 200, body);
    const item = await getItemById('curation-test-item');
    assert.equal(item?.publishStatus, PublishState.DRAFT);
    assert.equal(item?.titleBoutique, 'Omega Seamaster');
    assert.equal(item?.description, 'Generated description for human review.');
    assert.equal(JSON.parse(body).item.publishStatus, PublishState.DRAFT);

    shouldFail = true;
    const failedReq = Object.assign(Readable.from([JSON.stringify({ id: 'curation-test-item' })]), {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    });
    await handler(failedReq, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(JSON.parse(body), { error: 'CURATE_FAILED' });
    assert.equal((await getItemById('curation-test-item'))?.description, 'Generated description for human review.');
    assert.ok(!JSON.stringify(await getLogs()).includes('secret-sentinel'));
  } finally {
    mock.restoreAll();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
