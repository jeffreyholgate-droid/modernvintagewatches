import { json, methodNotAllowed } from './_lib/respond.js';
import { isPersistent } from './_lib/db.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  json(res, 200, { ok: true, persistent: isPersistent(), now: new Date().toISOString() });
}

