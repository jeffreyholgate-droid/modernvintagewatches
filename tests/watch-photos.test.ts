import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { displayWatchPhotos, parsePhotoReview } from '../lib/watch-photos.js';

const a = 'https://example.com/front.jpg';
const b = 'https://example.com/detail.jpg';
const photos = [{ url: b, tone: 'original' }, { url: a, tone: 'soft-light' }] as const;

test('a cover change retains all source views and rejects missing, duplicate or altered entries', () => {
  assert.deepEqual(parsePhotoReview(photos, [a, b]), photos);
  assert.deepEqual(displayWatchPhotos([a, b, a], photos), photos);
  assert.equal(parsePhotoReview([photos[0]], [a, b]), null);
  assert.equal(parsePhotoReview([photos[0], photos[0]], [a, b]), null);
  assert.equal(parsePhotoReview([photos[0], { ...photos[1], tone: 'retouch' }], [a, b]), null);
  assert.deepEqual(displayWatchPhotos([a, b], null), [{ url: a, tone: 'original' }, { url: b, tone: 'original' }]);
});

test('database requires a complete gallery for publication and withdraws changed source photos', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(`create table public.items (
      id text primary key, category text, publish_state text, image_urls jsonb
    );`);
    const gallery = JSON.stringify([a, b]);
    await db.query("insert into public.items values ('legacy', 'WATCH', 'PUBLISHED', $1), ('new', 'WATCH', 'DRAFT', $1)", [gallery]);
    await db.exec(await readFile('db/migrations/20261124_watch_photos.sql', 'utf8'));
    await db.exec("update public.items set publish_state='PUBLISHED' where id='legacy'");
    await assert.rejects(db.exec("update public.items set publish_state='PUBLISHED' where id='new'"), /PHOTO_REVIEW_REQUIRED/);
    await assert.rejects(db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'",
      [JSON.stringify([photos[0]])]), /PHOTO_REVIEW_REQUIRED/);
    await db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'", [JSON.stringify(photos)]);
    const { rows } = await db.query("select publish_state,photo_review,image_urls from public.items where id='new'");
    assert.deepEqual(rows, [{ publish_state: 'PUBLISHED', photo_review: photos, image_urls: [a, b] }]);
    await db.query("update public.items set image_urls=$1 where id='new'", [JSON.stringify([a])]);
    const unpublished = await db.query("select publish_state,photo_review from public.items where id='new'");
    assert.deepEqual(unpublished.rows, [{ publish_state: 'DRAFT', photo_review: null }]);
  } finally { await db.close(); }
});
