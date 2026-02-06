import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { requireAdmin } from '../_lib/auth.js';
import { getSettings, upsertItems, log, AppStateItem } from '../_lib/db.js';
import { Category, PublishState } from '../../types';
import { EbayClient } from '../../server/ebay';

function uid() {
  // crypto.randomUUID is available in modern Node runtimes
  return (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id_${Math.random().toString(36).slice(2)}`);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const body = await readJson(req);
  const overrides = body?.overrides ?? {};

  const settings = await getSettings();
  const ebay = new EbayClient();

  await log('INFO', 'INGEST: started');

  const all: AppStateItem[] = [];
  for (const cat of Object.values(Category)) {
    const priceMin = Number(overrides?.priceMin?.[cat] ?? settings.priceMin[cat as Category]);
    const priceMax = Number(overrides?.priceMax?.[cat] ?? settings.priceMax[cat as Category]);

    await log('INFO', `INGEST: scanning ${cat} (£${priceMin}-£${priceMax})`);

    const raw = await ebay.searchItems(cat as Category, priceMin, priceMax);
    const filtered = raw.filter(i => {
      const title = (i.titleRaw || '').toLowerCase();
      const blocked = settings.blockKeywords
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
        .some(k => title.includes(k));
      if (blocked) return false;
      if (i.sellerFeedbackPercent < settings.sellerMinFeedback) return false;
      if (i.sellerFeedbackScore < settings.sellerMinScore) return false;
      return true;
    });

    const candidates = filtered.map(item => ({
      ...item,
      id: uid(),
      publishStatus: PublishState.UNPUBLISHED,
      score: Math.floor(Math.random() * 10) + 90,
    }));

    all.push(...candidates);
  }

  const count = await upsertItems(all);
  await log('INFO', `INGEST: complete; candidates=${all.length}; upserted=${count}`);

  return json(res, 200, { ok: true, discovered: all.length, upserted: count });
}
