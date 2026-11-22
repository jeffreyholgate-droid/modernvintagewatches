import { json, methodNotAllowed } from './_lib/respond.js';
import { isPersistent, checkDatabase } from './_lib/db.js';
import { checkOrdersDatabase } from './_lib/orders.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const persistent = isPersistent();
  let database: 'connected' | 'memory';
  try {
    database = await checkDatabase();
  } catch {
    return json(res, 503, {
      ok: false,
      persistent,
      database: 'unavailable',
      error: 'DATABASE_UNAVAILABLE',
      now: new Date().toISOString(),
    });
  }
  if (persistent) {
    try { await checkOrdersDatabase(); }
    catch {
      return json(res, 503, {
        ok: false, persistent, database, orders: 'unavailable',
        error: 'ORDER_STORAGE_UNAVAILABLE', now: new Date().toISOString(),
      });
    }
  }
  return json(res, 200, { ok: true, persistent, database, orders: persistent ? 'connected' : 'disabled', now: new Date().toISOString() });
}

