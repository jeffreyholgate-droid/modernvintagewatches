import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { getItemById, updateItem } from '../_lib/db.js';
import { verifyAdminToken } from '../_lib/auth.js';
import { PublishState } from '../../types';

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

    const patch = await readJson(req);
    // We only allow a small patch surface for safety.
    const allowed: any = {};
    if (typeof patch.publishStatus === 'string') allowed.publishStatus = patch.publishStatus;
    if (typeof patch.titleBoutique === 'string') allowed.titleBoutique = patch.titleBoutique;
    if (typeof patch.description === 'string') allowed.description = patch.description;
    if (typeof patch.score === 'number') allowed.score = patch.score;

    await updateItem(id, allowed);
    const updated = await getItemById(id);
    return json(res, 200, { item: updated });
  }

  const item = await getItemById(id);
  if (!item) return json(res, 404, { error: 'NOT_FOUND' });

  // Public can only see published items.
  if (item.publishStatus !== PublishState.PUBLISHED) {
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
