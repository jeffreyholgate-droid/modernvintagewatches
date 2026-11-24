import { json, methodNotAllowed, readJson } from './_lib/respond.js';
import { getSettings, saveSettings } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'PUT') return methodNotAllowed(res, ['GET','PUT']);
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    try {
      const settings = await getSettings();
      return json(res, 200, { settings });
    } catch { return json(res, 503, { error: 'SETTINGS_UNAVAILABLE' }); }
  }

  let body: any;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: 'INVALID_JSON' }); }
  try {
    await saveSettings(body?.settings);
    return json(res, 200, { ok: true });
  } catch (error: any) {
    if (['INVALID_SETTINGS', 'INVALID_PRICING_SETTINGS'].includes(error?.message)) {
      return json(res, 400, { error: 'INVALID_SETTINGS' });
    }
    return json(res, 503, { error: 'SETTINGS_UNAVAILABLE' });
  }
}

