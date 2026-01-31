import { json, methodNotAllowed, readJson } from './_lib/respond';
import { getSettings, saveSettings } from './_lib/db';
import { requireAdmin } from './_lib/auth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'PUT') return methodNotAllowed(res, ['GET','PUT']);
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  if (req.method === 'GET') {
    const settings = await getSettings();
    return json(res, 200, { settings });
  }

  const body = await readJson(req);
  await saveSettings(body.settings);
  return json(res, 200, { ok: true });
}
