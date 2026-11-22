import { json, methodNotAllowed } from './_lib/respond.js';
import { isPersistent, checkDatabase } from './_lib/db.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const persistent = isPersistent();
  try {
    const database = await checkDatabase();
    return json(res, 200, { ok: true, persistent, database, now: new Date().toISOString() });
  } catch {
    return json(res, 503, {
      ok: false,
      persistent,
      database: 'unavailable',
      error: 'DATABASE_UNAVAILABLE',
      now: new Date().toISOString(),
    });
  }
}

