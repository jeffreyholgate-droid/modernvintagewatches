import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { requireAdmin } from '../_lib/auth.js';
import { getSettings, listItems, upsertItems, withdrawSourceItems, log } from '../_lib/db.js';
import { Category, PublishState } from '../../types.js';
import { EbayClient } from '../../server/ebay.js';
import { meetsRefreshPolicy, planInventoryRefresh } from '../../server/inventory-refresh.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  const ok = await requireAdmin(req, res);
  if (!ok) return;

  let body: any;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: 'INVALID_JSON' }); }
  try {
    const settings = await getSettings();
    const priceMin = Number(body?.overrides?.priceMin?.WATCH ?? settings.priceMin.WATCH);
    const priceMax = Number(body?.overrides?.priceMax?.WATCH ?? settings.priceMax.WATCH);
    if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMin < 0 || priceMax < priceMin) {
      return json(res, 400, { error: 'INVALID_PRICE_RANGE' });
    }
    const policy = { ...settings, priceMin: { ...settings.priceMin, WATCH: priceMin }, priceMax: { ...settings.priceMax, WATCH: priceMax } };
    const ebay = new EbayClient();
    await log('INFO', 'INGEST: refreshing stored source offers and searching current watches');
    const [existing, raw] = await Promise.all([
      listItems({ publishedOnly: false }),
      ebay.searchItems(Category.WATCH, priceMin, priceMax),
    ]);
    const candidates = raw.filter(item => meetsRefreshPolicy(item, policy));
    const plan = await planInventoryRefresh({
      existing,
      candidateIds: candidates.map(item => item.ebayItemId),
      policy,
      getSourceItem: (id, category) => ebay.getSourceItem(id, category),
    });
    // Withdraw first: a policy-change withdrawal is guarded by the timestamp
    // from before this scan's source update. Orders/newer scans still win.
    const withdrawn = await withdrawSourceItems(plan.withdrawals);
    const count = await upsertItems([...plan.sourceUpdates, ...plan.newItems].map(item => ({
      ...item, publishStatus: PublishState.UNPUBLISHED, score: 0,
    })));
    await log('INFO', `INGEST: complete; new=${count}; refreshed=${plan.sourceUpdates.length}; withdrawn=${withdrawn}; sourceUnknown=${plan.unknown.length}`);
    return json(res, 200, {
      ok: true, discovered: candidates.length, inserted: count, upserted: count,
      checkedExisting: existing.filter(item => /^v1\|\d+\|\d+$/.test(item.ebayItemId) && item.status === 'ACTIVE').length,
      refreshed: plan.sourceUpdates.length, withdrawn, sourceUnknown: plan.unknown.length,
    });
  } catch {
    return json(res, 503, { error: 'INVENTORY_REFRESH_UNAVAILABLE' });
  }
}

