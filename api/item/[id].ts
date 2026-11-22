import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { getItemById, updateItem } from '../_lib/db.js';
import { verifyAdminToken } from '../_lib/auth.js';
import { PublishState } from '../../types.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);

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
    if (typeof patch?.publishStatus === 'string') allowed.publishStatus = patch.publishStatus;
    if (typeof patch?.titleBoutique === 'string') allowed.titleBoutique = patch.titleBoutique;
    if (typeof patch?.description === 'string') allowed.description = patch.description;
    if (typeof patch?.score === 'number') allowed.score = patch.score;

    try {
      await updateItem(id, allowed);
      const updated = await getItemById(id);
      return json(res, 200, { item: updated });
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

  // Reserved/sold inventory is available to admins only, even if still published.
  if (item.publishStatus !== PublishState.PUBLISHED || item.status !== 'ACTIVE') {
    const header = req.headers?.authorization || req.headers?.Authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return json(res, 404, { error: 'NOT_FOUND' });
    try {
      await verifyAdminToken(token);
    } catch {
      return json(res, 404, { error: 'NOT_FOUND' });
    }
  }

  return json(res, 200, { item });
}
