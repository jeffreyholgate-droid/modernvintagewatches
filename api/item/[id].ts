import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { getItemById, updateItem, getSettings, publishReviewedWatch, publicWatchGallery } from '../_lib/db.js';
import { verifyAdminToken } from '../_lib/auth.js';
import { Category, PublishState } from '../../types.js';
import { pricedItem } from '../_lib/pricing.js';
import { parsePhotoReview, reviewedOakGallery, watchPhotoUrls } from '../../lib/watch-photos.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);
  res.setHeader('Cache-Control', 'no-store');

  const id = req.query?.id;
  if (typeof id !== 'string') return json(res, 400, { error: 'BAD_REQUEST' });

  if (req.method === 'PATCH') {
    const header = req.headers?.authorization || req.headers?.Authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return json(res, 401, { error: 'UNAUTHORIZED' });
    try {
      await verifyAdminToken(token);
    } catch {
      return json(res, 401, { error: 'UNAUTHORIZED' });
    }

    let patch: any;
    try {
      patch = await readJson(req);
    } catch {
      return json(res, 400, { error: 'INVALID_JSON' });
    }
    // We only allow a small patch surface for safety.
    const allowed: any = {};
    if (patch?.publishStatus !== undefined && !Object.values(PublishState).includes(patch.publishStatus)) {
      return json(res, 400, { error: 'INVALID_PUBLISH_STATE' });
    }
    if (patch?.publishStatus !== undefined) allowed.publishStatus = patch.publishStatus;
    if (typeof patch?.titleBoutique === 'string') allowed.titleBoutique = patch.titleBoutique;
    if (typeof patch?.description === 'string') allowed.description = patch.description;
    if (typeof patch?.score === 'number') allowed.score = patch.score;

    try {
      if (allowed.publishStatus === PublishState.PUBLISHED) {
        const current = await getItemById(id);
        if (!current || current.category !== Category.WATCH) return json(res, 404, { error: 'NOT_FOUND' });
        const urls = watchPhotoUrls(current.imageUrls);
        if (current.imageUrls.some(url => !urls.includes(url))) {
          return json(res, 409, { error: 'PHOTO_REVIEW_REQUIRED' });
        }
        const legacy = current.publishStatus === PublishState.PUBLISHED &&
          !current.photoReview?.some(photo => photo.oak);
        const photos = patch.oakCoverUrl !== undefined || !legacy
          ? reviewedOakGallery(urls, current.oakPhotoReview ?? [], patch.oakCoverUrl)
          : parsePhotoReview(patch.photoReview, urls, true)?.filter(photo => photo.mask);
        if (!photos || photos.length !== urls.length) {
          return json(res, 409, { error: legacy && patch.oakCoverUrl === undefined ? 'PHOTO_REVIEW_REQUIRED' : 'OAK_STUDIO_REVIEW_REQUIRED' });
        }
        if (!await publishReviewedWatch(current, allowed, photos)) {
          return json(res, 409, { error: 'LISTING_CHANGED' });
        }
      } else {
        await updateItem(id, allowed);
      }
      const updated = await getItemById(id);
      return json(res, 200, { item: updated ? pricedItem(updated, await getSettings(), true) : null });
    } catch {
      return json(res, 503, { error: 'INVENTORY_UNAVAILABLE' });
    }
  }

  let item;
  try {
    item = await getItemById(id);
  } catch {
    return json(res, 503, { error: 'INVENTORY_UNAVAILABLE' });
  }
  if (!item) return json(res, 404, { error: 'NOT_FOUND' });

  const header = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  let isAdmin = false;
  if (token) {
    try {
      await verifyAdminToken(token);
      isAdmin = true;
    } catch {
      return item.category !== Category.WATCH || item.publishStatus !== PublishState.PUBLISHED || item.status !== 'ACTIVE'
        ? json(res, 404, { error: 'NOT_FOUND' }) : json(res, 401, { error: 'UNAUTHORIZED' });
    }
  }
  // Reserved/sold inventory is available to admins only, even if still published.
  if (!isAdmin && (item.category !== Category.WATCH || item.publishStatus !== PublishState.PUBLISHED || item.status !== 'ACTIVE')) {
    return json(res, 404, { error: 'NOT_FOUND' });
  }
  try { return json(res, 200, { item: pricedItem(isAdmin ? item : publicWatchGallery(item), await getSettings(), isAdmin) }); }
  catch { return json(res, 503, { error: 'INVENTORY_UNAVAILABLE' }); }
}
