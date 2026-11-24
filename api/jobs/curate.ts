import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { requireAdmin } from '../_lib/auth.js';
import { getItemById, updateItem, log } from '../_lib/db.js';
import { buildCurationDraft } from '../_lib/curation.js';
import { GeminiService } from '../../server/gemini.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const body = await readJson(req);
  const id = (body?.id ?? '').toString();
  if (!id) return json(res, 400, { error: 'BAD_REQUEST' });

  const item = await getItemById(id);
  if (!item) return json(res, 404, { error: 'NOT_FOUND' });

  await log('INFO', `CURATE: start id=${id}`);

  const gemini = new GeminiService();
  try {
    const normalized = await gemini.normalizeListing(item.category, item.titleRaw, 'N/A');
    const copy = await gemini.generateCopy(item.category, normalized);

    await updateItem(id, buildCurationDraft(normalized, copy));

    await log('INFO', `CURATE: draft ready for review id=${id}`);
    const updated = await getItemById(id);
    return json(res, 200, { ok: true, item: updated });
  } catch {
    // Provider error messages may include request details; do not persist or return them.
    await log('ERROR', `CURATE: failed id=${id}`);
    return json(res, 500, { error: 'CURATE_FAILED' });
  }
}

