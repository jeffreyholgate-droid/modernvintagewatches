import { json, methodNotAllowed } from './_lib/respond';
import { listItems } from './_lib/db';
import { verifyAdminToken } from './_lib/auth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

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
  const items = await listItems({ publishedOnly });
  json(res, 200, { items });
}
