import { Category, PublishState } from '../../../types.js';
import { oakSourceUrl, photoHashPattern, studioItemPattern, watchPhotoUrls } from '../../../lib/watch-photos.js';
import { signStudioProof, verifyStudioProof } from '../auth.js';
import { getItemById, getSupabase, saveOakPhoto } from '../db.js';
import { json } from '../respond.js';
import { digest, loadSource } from './images.js';
import type { PhotographManifest } from './photograph.js';

const bucketName = 'mvw-oak-study';
const objectPath = (itemId: string, hash: string) => `${itemId}/${hash}.png`;

function photoStorage() {
  const client = getSupabase();
  if (!client) throw new Error('STUDIO_STORAGE_UNAVAILABLE');
  return client.storage;
}

export async function inventoryStudioSource(itemId: unknown, url: unknown) {
  if (typeof itemId !== 'string' || !studioItemPattern.test(itemId) || typeof url !== 'string') {
    throw new Error('INVALID_STUDIO_LISTING');
  }
  const item = await getItemById(itemId);
  if (!item || item.category !== Category.WATCH || item.status !== 'ACTIVE' || !watchPhotoUrls(item.imageUrls).includes(url)) {
    throw new Error('SOURCE_CHANGED');
  }
  return { item, url, source: { url: oakSourceUrl(url) } };
}

export async function checkPhotoStorage() {
  const { data, error } = await photoStorage().getBucket(bucketName);
  if (error || data?.public !== false) throw new Error('STUDIO_STORAGE_UNAVAILABLE');
}

export async function stageOakPhoto(itemId: string, url: string, png: Buffer, manifest: PhotographManifest) {
  const path = objectPath(itemId, manifest.outputSha256);
  const { error } = await photoStorage().from(bucketName).upload(path, png, {
    contentType: 'image/png', upsert: true, cacheControl: '0',
  });
  if (error) throw new Error('STUDIO_STORAGE_UNAVAILABLE');
  return signStudioProof({ itemId, url, sourceSha256: manifest.sourceSha256, outputSha256: manifest.outputSha256 });
}

export async function approveOakPhoto(proof: unknown) {
  if (typeof proof !== 'string' || proof.length > 6_000) throw new Error('STUDIO_REVIEW_EXPIRED');
  const { itemId, url, sourceSha256, outputSha256 } = await verifyStudioProof(proof);
  if (typeof sourceSha256 !== 'string' || !photoHashPattern.test(sourceSha256) ||
      typeof outputSha256 !== 'string' || !photoHashPattern.test(outputSha256)) {
    throw new Error('STUDIO_REVIEW_EXPIRED');
  }
  const linked = await inventoryStudioSource(itemId, url);
  const previous = linked.item.oakPhotoReview?.find(photo => photo.url === linked.url)?.oak;
  if (previous?.outputSha256 === outputSha256 && previous.sourceSha256 === sourceSha256) return;
  if ((await loadSource(linked.source)).sha256 !== sourceSha256) throw new Error('SOURCE_CHANGED');
  if (!await saveOakPhoto(linked.item, {
    url: linked.url, tone: 'original', oak: { itemId: linked.item.id, outputSha256, sourceSha256 },
  })) throw new Error('LISTING_CHANGED');
}

export async function serveOakPhoto(itemId: unknown, hash: unknown, admin: boolean, res: any) {
  if (typeof itemId !== 'string' || !studioItemPattern.test(itemId) ||
      typeof hash !== 'string' || !photoHashPattern.test(hash)) return json(res, 404, { error: 'NOT_FOUND' });
  try {
    const item = await getItemById(itemId);
    const published = item?.category === Category.WATCH && item.status === 'ACTIVE' &&
      item.publishStatus === PublishState.PUBLISHED && item.photoReview?.some(photo =>
        photo.oak?.itemId === itemId && photo.oak.outputSha256 === hash);
    const internal = admin && item?.oakPhotoReview?.some(photo =>
      photo.oak?.itemId === itemId && photo.oak.outputSha256 === hash);
    if (!published && !internal) return json(res, 404, { error: 'NOT_FOUND' });
    const { data, error } = await photoStorage().from(bucketName).download(objectPath(itemId, hash));
    if (error || !data || data.size > 4_300_000) throw new Error();
    const png = Buffer.from(await data.arrayBuffer());
    if (digest(png) !== hash) throw new Error();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    return res.end(png);
  } catch {
    return json(res, 503, { error: 'STUDIO_STORAGE_UNAVAILABLE' });
  }
}
