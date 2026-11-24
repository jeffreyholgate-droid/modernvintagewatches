import { Category, PublishState, type EbayItem } from '../types.js';

export interface RefreshInventoryReference {
  id: string;
  ebayItemId: string;
  category: Category;
  status: string;
  lastSeenAt: string;
  firstSeenAt?: string;
}

export interface RefreshPolicy {
  priceMin: Record<Category, number>;
  priceMax: Record<Category, number>;
  sellerMinFeedback: number;
  sellerMinScore: number;
  blockKeywords: string;
}

export interface InventoryRefreshPlan {
  observedAt: string;
  // Apply these through the source-only guarded upsert, never a whole-row update.
  sourceUpdates: EbayItem[];
  newItems: Array<EbayItem & { publishStatus: PublishState.UNPUBLISHED; score: 0 }>;
  // ENDED requires positive source evidence. REVIEW_REQUIRED leaves status ACTIVE
  // but withdraws publication; a policy mismatch is not proof the seller ended it.
  withdrawals: Array<{ id: string; ebayItemId: string; reason: 'ENDED' | 'REVIEW_REQUIRED'; expectedLastSeenAt: string }>;
  unknown: Array<{ ebayItemId: string; reason: string }>;
  skipped: Array<{ ebayItemId: string; reason: 'PROTECTED_STATUS' | 'INVALID_SOURCE_ID' | 'CANDIDATE_REJECTED' }>;
}

const blockedSourceTerms = [
  'replica', 'fake', 'homage', 'mod', 'modded', 'aftermarket', 'redial',
  'for parts', 'for spares', 'spares or repair', 'spares & repair', 'broken',
  'not working', 'parts only', 'custom dial', 'refinished dial',
];

export function meetsRefreshPolicy(item: EbayItem, policy: RefreshPolicy): boolean {
  const title = item.titleRaw.toLowerCase();
  const configuredTerms = policy.blockKeywords.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const hasTerm = (term: string) => new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(title);
  return item.locationCountry === 'GB' && item.category === Category.WATCH &&
    Number.isFinite(item.priceGbp) && item.priceGbp >= policy.priceMin[item.category] && item.priceGbp <= policy.priceMax[item.category] &&
    item.sellerFeedbackPercent >= policy.sellerMinFeedback && item.sellerFeedbackScore >= policy.sellerMinScore &&
    !configuredTerms.some(hasTerm) && !blockedSourceTerms.some(hasTerm);
}

/** Read-only plan. Recheck every stored eBay ID; search omission never proves expiry. */
export async function planInventoryRefresh(input: {
  existing: RefreshInventoryReference[];
  candidateIds: string[];
  policy: RefreshPolicy;
  getSourceItem: (id: string, category: Category) => Promise<EbayItem | null>;
  now?: () => Date;
}): Promise<InventoryRefreshPlan> {
  const observedAt = (input.now?.() || new Date()).toISOString();
  const plan: InventoryRefreshPlan = { observedAt, sourceUpdates: [], newItems: [], withdrawals: [], unknown: [], skipped: [] };
  const existingBySourceId = new Map<string, RefreshInventoryReference>();
  for (const item of input.existing) {
    if (existingBySourceId.has(item.ebayItemId)) throw new Error('DUPLICATE_EXISTING_SOURCE_ID');
    existingBySourceId.set(item.ebayItemId, item);
  }
  const ids = [...new Set([...existingBySourceId.keys(), ...input.candidateIds])];
  for (let offset = 0; offset < ids.length; offset += 4) {
    await Promise.all(ids.slice(offset, offset + 4).map(async ebayItemId => {
      const previous = existingBySourceId.get(ebayItemId);
      if (!/^v1\|\d+\|\d+$/.test(ebayItemId)) {
        plan.skipped.push({ ebayItemId, reason: 'INVALID_SOURCE_ID' });
        return;
      }
      if (previous && previous.status !== 'ACTIVE') {
        plan.skipped.push({ ebayItemId, reason: 'PROTECTED_STATUS' });
        return;
      }
      try {
        const source = await input.getSourceItem(ebayItemId, previous?.category || Category.WATCH);
        if (source === null) {
          if (previous) plan.withdrawals.push({ id: previous.id, ebayItemId, reason: 'ENDED', expectedLastSeenAt: previous.lastSeenAt });
          else plan.skipped.push({ ebayItemId, reason: 'CANDIDATE_REJECTED' });
          return;
        }
        if (source.ebayItemId !== ebayItemId || source.status !== 'ACTIVE') throw new Error('EBAY_ITEM_EVIDENCE_INVALID');
        const eligible = meetsRefreshPolicy(source, input.policy);
        if (previous) {
          plan.sourceUpdates.push({ ...source, id: previous.id, firstSeenAt: previous.firstSeenAt || source.firstSeenAt });
          if (!eligible) plan.withdrawals.push({ id: previous.id, ebayItemId, reason: 'REVIEW_REQUIRED', expectedLastSeenAt: previous.lastSeenAt });
        } else if (eligible) {
          plan.newItems.push({ ...source, id: globalThis.crypto.randomUUID(), publishStatus: PublishState.UNPUBLISHED, score: 0 });
        } else {
          plan.skipped.push({ ebayItemId, reason: 'CANDIDATE_REJECTED' });
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'EBAY_ITEM_INELIGIBLE') {
          if (previous) plan.withdrawals.push({ id: previous.id, ebayItemId, reason: 'REVIEW_REQUIRED', expectedLastSeenAt: previous.lastSeenAt });
          else plan.skipped.push({ ebayItemId, reason: 'CANDIDATE_REJECTED' });
          return;
        }
        // Do not turn timeouts, throttling, malformed data or missing shipping into
        // sold/ended inventory. Unknown listings remain pending a later recheck.
        const reason = error instanceof Error && /^EBAY_[A-Z_]+$/.test(error.message)
          ? error.message : 'SOURCE_LOOKUP_FAILED';
        plan.unknown.push({ ebayItemId, reason });
      }
    }));
  }
  for (const values of [plan.sourceUpdates, plan.newItems, plan.withdrawals, plan.unknown, plan.skipped]) {
    values.sort((a, b) => a.ebayItemId.localeCompare(b.ebayItemId));
  }
  return plan;
}
