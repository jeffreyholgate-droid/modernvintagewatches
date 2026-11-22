import { json, methodNotAllowed } from './_lib/respond.js';
import { listItems, getSettings } from './_lib/db.js';
import { verifyAdminToken } from './_lib/auth.js';
import { pricedItem } from './_lib/pricing.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  res.setHeader('Cache-Control', 'no-store');

  const header = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';

  let isAdmin = false;
  if (token) {
    try {
      await verifyAdminToken(token);
      isAdmin = true;
    } catch {
      return json(res, 401, { error: 'UNAUTHORIZED' });
    }
  }

  const publishedOnly = !isAdmin;
  try {
    const [items, settings] = await Promise.all([listItems({ publishedOnly }), getSettings()]);
    return json(res, 200, { items: items.map(item => pricedItem(item, settings, isAdmin)) });
  } catch {
    return json(res, 503, { error: 'INVENTORY_UNAVAILABLE' });
  }
}

