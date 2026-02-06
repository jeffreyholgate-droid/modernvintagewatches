import { json, methodNotAllowed } from './_lib/respond.js';
import { getLogs } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const limit = Number(req.query?.limit ?? 50);
  const logs = await getLogs(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50);
  return json(res, 200, { logs });
}
