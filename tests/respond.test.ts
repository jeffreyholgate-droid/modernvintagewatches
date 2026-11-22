import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJson } from '../api/_lib/respond.js';

test('reads Vercel parsed JSON without waiting on an exhausted stream', async () => {
  assert.deepEqual(await readJson({ body: { lines: [{ id: 'watch-1', qty: 1 }] } }), { lines: [{ id: 'watch-1', qty: 1 }] });
});
test('reads local streamed JSON and raw Vercel bodies', async () => {
  assert.deepEqual(await readJson(Readable.from(['{"ok":', 'true}'])), { ok: true });
  assert.deepEqual(await readJson({ body: Buffer.from('{"ok":true}') }), { ok: true });
});
test('rejects malformed JSON', async () => {
  await assert.rejects(readJson({ body: '{' }), SyntaxError);
  await assert.rejects(readJson(Readable.from(['{'])), SyntaxError);
});
test('rejects an oversized streamed request', async () => {
  await assert.rejects(readJson(Readable.from(['x'.repeat(1024 * 1024 + 1), 'more'])), /REQUEST_TOO_LARGE/);
});
