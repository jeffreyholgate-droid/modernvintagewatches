import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { displayWatchPhotos, maskPath, studioPlacement, parsePhotoMask, parsePhotoReview, reviewedOakGallery, type WatchPhoto } from '../lib/watch-photos.js';

const a = 'https://example.com/front.jpg';
const b = 'https://example.com/detail.jpg';
const photos = [{ url: b, tone: 'original' }, { url: a, tone: 'soft-light' }] as const;
const mask = {
  width: 1000, height: 800,
  outlines: [[[200, 200], [800, 200], [800, 800], [200, 800]], [[400, 400], [600, 400], [500, 600]]],
};
const studio = photos.map(photo => ({ ...photo, mask }));

test('a cover change retains all source views and rejects missing, duplicate or altered entries', () => {
  assert.deepEqual(parsePhotoReview(photos, [a, b]), photos);
  assert.deepEqual(displayWatchPhotos([a, b, a], photos), photos);
  assert.equal(parsePhotoReview([photos[0]], [a, b]), null);
  assert.equal(parsePhotoReview([photos[0], photos[0]], [a, b]), null);
  assert.equal(parsePhotoReview([photos[0], { ...photos[1], tone: 'retouch' }], [a, b]), null);
  assert.deepEqual(displayWatchPhotos([a, b], null), [{ url: a, tone: 'original' }, { url: b, tone: 'original' }]);
});

test('normalised cutouts preserve source coordinates and support openings without zoom clipping', () => {
  const parsed = parsePhotoMask(mask)!;
  assert.deepEqual(parsed, mask);
  assert.equal(maskPath(parsed), 'M200 160 L800 160 L800 640 L200 640 Z M400 320 L600 320 L500 480 Z');
  const { viewBox, shadow } = studioPlacement(parsed);
  const [left, top, width, height] = viewBox.split(' ').map(Number);
  assert.equal(width, height);
  assert.ok(Math.abs(600 / width - 0.83) < 0.000001);
  assert.ok(Math.abs(left + width / 2 - 500) < 0.000001);
  assert.ok(Math.abs(top + height / 2 - 400) < 0.000001);
  assert.ok(shadow.cy + shadow.ry < top + height);
  assert.equal(parsePhotoMask({ ...mask, outlines: [[[1, 1], [2, 2], [3, 3]]] }), null);
  assert.equal(parsePhotoMask({ ...mask, outlines: [[[1, 1], [1001, 2], [300, 300]]] }), null);
  assert.equal(parsePhotoReview([studio[0], photos[1]], [a, b], true), null);
  assert.deepEqual(parsePhotoReview(studio, [a, b], true), studio);
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
    await db.exec(await readFile('db/migrations/20261124_watch_backdrops.sql', 'utf8'));
    await db.exec("update public.items set publish_state='PUBLISHED' where id='legacy'");
    await assert.rejects(db.exec("update public.items set publish_state='PUBLISHED' where id='new'"), /PHOTO_REVIEW_REQUIRED/);
    await assert.rejects(db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'",
      [JSON.stringify([photos[0]])]), /PHOTO_REVIEW_REQUIRED/);
    await assert.rejects(db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'",
      [JSON.stringify(photos)]), /PHOTO_BACKDROP_REQUIRED/);
    await assert.rejects(db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'",
      [JSON.stringify(studio.map(photo => ({ ...photo, mask: { ...mask, outlines: [[[1, 1], [2, 2], [3, 3]]] } })))]), /PHOTO_BACKDROP_REQUIRED/);
    await db.query("update public.items set publish_state='PUBLISHED', photo_review=$1 where id='new'", [JSON.stringify(studio)]);
    const { rows } = await db.query("select publish_state,photo_review,image_urls from public.items where id='new'");
    assert.deepEqual(rows, [{ publish_state: 'PUBLISHED', photo_review: studio, image_urls: [a, b] }]);
    await db.query("update public.items set image_urls=$1 where id='new'", [JSON.stringify([a])]);
    const unpublished = await db.query("select publish_state,photo_review from public.items where id='new'");
    assert.deepEqual(unpublished.rows, [{ publish_state: 'DRAFT', photo_review: null }]);
  } finally { await db.close(); }
});

test('Oak Study requires a genuine approval for each source and preserves the selected cover', () => {
  const oak = { itemId: 'bdae6777-7aff-4187-ab2b-cb4120f4b55f', sourceSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64) };
  const entries: WatchPhoto[] = [a, b].map(url => ({ url, oak, tone: 'original' }));
  assert.deepEqual(reviewedOakGallery([a, b], entries, b), [entries[1], entries[0]]);
  assert.equal(reviewedOakGallery([a, b], [entries[0]]), null);
  assert.equal(reviewedOakGallery([a, b], entries, 'https://example.com/other.jpg'), null);
  assert.equal(reviewedOakGallery([a, b], [{ ...entries[0], oak: { ...oak, outputSha256: '../private' } }, entries[1]]), null);
});

test('the Oak gallery migration preserves legacy covers and blocks unapproved new publications', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table public.items (id text primary key, category text, publish_state text, image_urls jsonb);`);
    const id = 'bdae6777-7aff-4187-ab2b-cb4120f4b55f';
    const gallery = JSON.stringify([a, b]);
    await db.query("insert into items values ('legacy', 'WATCH', 'PUBLISHED', $1), ($2, 'WATCH', 'DRAFT', $1)", [gallery, id]);
    for (const name of ['watch_photos', 'watch_backdrops', 'oak_study_gallery']) {
      await db.exec(await readFile(`db/migrations/20261124_${name}.sql`, 'utf8'));
    }
    await db.exec("update items set publish_state='PUBLISHED' where id='legacy'");
    await assert.rejects(db.query("update items set publish_state='PUBLISHED', photo_review=$1 where id=$2",
      [JSON.stringify(studio), id]), /OAK_STUDIO_REVIEW_REQUIRED/);
    const oak = { itemId: id, sourceSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64) };
    const approved = [a, b].map(url => ({ url, tone: 'original', oak }));
    await assert.rejects(db.query("update items set publish_state='PUBLISHED', photo_review=$1 where id=$2",
      [JSON.stringify(approved), id]), /OAK_STUDIO_REVIEW_REQUIRED/);
    await db.query("update items set oak_photo_review=$1 where id=$2", [JSON.stringify(approved), id]);
    await db.query("update items set publish_state='PUBLISHED', photo_review=$1 where id=$2",
      [JSON.stringify(approved), id]);
    await assert.rejects(db.query("update items set photo_review=$1 where id=$2", [JSON.stringify(studio), id]),
      /OAK_STUDIO_REVIEW_REQUIRED/);
    await db.query("update items set image_urls=$1 where id=$2", [JSON.stringify([a]), id]);
    assert.deepEqual((await db.query("select publish_state,photo_review,oak_photo_review from items where id=$1",
      [id])).rows, [{ publish_state: 'DRAFT', photo_review: null, oak_photo_review: [] }]);
  } finally { await db.close(); }
});
