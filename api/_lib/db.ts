import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Category, PublishState, EbayItem } from '../../types.js';
import type { InventoryRefreshPlan } from '../../server/inventory-refresh.js';
import { DEFAULT_PRICING_POLICY, normalizePricingPolicy, marginBasisPoints, type PricingPolicy } from './pricing.js';

export interface AppStateItem extends EbayItem {
  titleBoutique?: string;
  description?: string;
  publishStatus: PublishState;
  score: number;
}

export interface Settings {
  priceMin: Record<Category, number>;
  priceMax: Record<Category, number>;
  publishTarget: number;
  marginPercent: Record<Category, number>;
  sellerMinFeedback: number;
  sellerMinScore: number;
  vatMode: 'NOT_REGISTERED';
  pricingPolicy: PricingPolicy;
  blockKeywords: string;
}

const DEFAULT_SETTINGS: Settings = {
  priceMin: { [Category.WATCH]: 2000, [Category.HANDBAG]: 2000, [Category.JEWELLERY]: 2000 },
  priceMax: { [Category.WATCH]: 50000, [Category.HANDBAG]: 50000, [Category.JEWELLERY]: 50000 },
  publishTarget: 80,
  marginPercent: { [Category.WATCH]: 20, [Category.HANDBAG]: 20, [Category.JEWELLERY]: 20 },
  sellerMinFeedback: 99,
  sellerMinScore: 200,
  vatMode: 'NOT_REGISTERED',
  pricingPolicy: DEFAULT_PRICING_POLICY,
  blockKeywords: 'replica,fake,copy,aftermarket,custom,diamond set,ice,lab,moissanite'
};

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    // An empty serverless instance must never masquerade as a working database.
    const deployed = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    if (deployed || url || key || process.env.ALLOW_IN_MEMORY_DB !== 'true') {
      throw new Error('PERSISTENCE_NOT_CONFIGURED');
    }
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// --- Fallback (ephemeral) in-memory store for local dev only ---
const mem = {
  items: [] as AppStateItem[],
  settings: DEFAULT_SETTINGS as Settings,
  logs: [] as { ts: string; level: string; message: string }[],
};

export function isPersistent(): boolean {
  // Configuration presence only; callers must query the database to check health.
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export async function checkDatabase(): Promise<'connected' | 'memory'> {
  const supabase = getSupabase();
  if (!supabase) return 'memory';
  // Check the tables and columns actually needed by the app, not merely whether
  // credentials are present. Empty tables are healthy; inaccessible/missing
  // tables or an incompatible schema are not.
  const results = await Promise.all([
    supabase.from('items').select('id,ebay_item_id,url,title_raw,title_boutique,description,price_gbp,shipping_gbp,seller_name,seller_feedback_percent,seller_feedback_score,category,location_country,image_urls,status,last_seen_at,first_seen_at,publish_state,score,updated_at').limit(1),
    supabase.from('settings').select('id,data,updated_at').limit(1),
    supabase.from('logs').select('id,ts,level,message').limit(1),
  ]);
  for (const result of results) {
    if (result.error) throw new Error('DATABASE_UNAVAILABLE');
  }
  return 'connected';
}

export async function log(level: string, message: string) {
  const ts = new Date().toISOString();
  const supabase = getSupabase();
  if (!supabase) {
    mem.logs.unshift({ ts, level, message });
    mem.logs = mem.logs.slice(0, 200);
    return;
  }
  await supabase.from('logs').insert({ ts, level, message });
}

export async function getLogs(limit = 50) {
  const supabase = getSupabase();
  if (!supabase) return mem.logs.slice(0, limit);
  const { data, error } = await supabase.from('logs').select('*').order('ts', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getSettings(): Promise<Settings> {
  const supabase = getSupabase();
  if (!supabase) return normalizeSettings(mem.settings);
  const { data, error } = await supabase.from('settings').select('data').eq('id', 'default').single();
  if (error && error.code !== 'PGRST116') throw error; // not found
  return normalizeSettings(data?.data || DEFAULT_SETTINGS);
}

export function normalizeSettings(value: unknown, forWrite = false): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SETTINGS');
  const data = value as Record<string, any>;
  const categories = new Set<string>(Object.values(Category));
  for (const key of ['priceMin', 'priceMax', 'marginPercent']) {
    const map = data[key];
    if (map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map) ||
        Object.keys(map).some(category => !categories.has(category)))) throw new Error('INVALID_SETTINGS');
  }
  if (forWrite && (data.pricingPolicy === undefined || data.vatMode !== 'NOT_REGISTERED')) {
    throw new Error('INVALID_SETTINGS');
  }
  const next: Settings = {
    priceMin: { ...DEFAULT_SETTINGS.priceMin, ...data.priceMin },
    priceMax: { ...DEFAULT_SETTINGS.priceMax, ...data.priceMax },
    marginPercent: { ...DEFAULT_SETTINGS.marginPercent, ...data.marginPercent },
    publishTarget: data.publishTarget ?? DEFAULT_SETTINGS.publishTarget,
    sellerMinFeedback: data.sellerMinFeedback ?? DEFAULT_SETTINGS.sellerMinFeedback,
    sellerMinScore: data.sellerMinScore ?? DEFAULT_SETTINGS.sellerMinScore,
    blockKeywords: data.blockKeywords ?? DEFAULT_SETTINGS.blockKeywords,
    vatMode: 'NOT_REGISTERED',
    pricingPolicy: normalizePricingPolicy(data.pricingPolicy),
  };
  for (const category of Object.values(Category)) {
    const min = next.priceMin[category], max = next.priceMax[category];
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > 999999.99) {
      throw new Error('INVALID_SETTINGS');
    }
    marginBasisPoints(next.marginPercent[category]);
  }
  if (!Number.isInteger(next.publishTarget) || next.publishTarget < 0 || next.publishTarget > 10000 ||
      !Number.isFinite(next.sellerMinFeedback) || next.sellerMinFeedback < 0 || next.sellerMinFeedback > 100 ||
      !Number.isInteger(next.sellerMinScore) || next.sellerMinScore < 0 || next.sellerMinScore > 100000000 ||
      typeof next.blockKeywords !== 'string' || next.blockKeywords.length > 10000) throw new Error('INVALID_SETTINGS');
  return next;
}

export async function saveSettings(next: Settings): Promise<void> {
  next = normalizeSettings(next, true);
  const supabase = getSupabase();
  if (!supabase) { mem.settings = next; return; }
  const { error } = await supabase.from('settings').upsert({ id: 'default', data: next }, { onConflict: 'id' });
  if (error) throw error;
}

export async function listItems(opts: { publishedOnly: boolean }): Promise<AppStateItem[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return (opts.publishedOnly ? mem.items.filter(i => i.publishStatus === PublishState.PUBLISHED && i.status === 'ACTIVE') : mem.items);
  }
  let q = supabase.from('items').select('*').order('last_seen_at', { ascending: false });
  if (opts.publishedOnly) q = q.eq('publish_state', PublishState.PUBLISHED).eq('status', 'ACTIVE');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToItem);
}

export async function upsertItems(newItems: AppStateItem[]): Promise<number> {
  const supabase = getSupabase();
  // eBay can return a listing more than once. Keep its newest observation and
  // avoid PostgreSQL conflict errors or duplicate entries in the local store.
  const candidates = new Map<string, AppStateItem>();
  for (const item of newItems) {
    if (!item.ebayItemId || !Number.isFinite(Date.parse(item.lastSeenAt))) {
      throw new Error('INVALID_INVENTORY_OBSERVATION');
    }
    const previous = candidates.get(item.ebayItemId);
    if (!previous || Date.parse(item.lastSeenAt) >= Date.parse(previous.lastSeenAt)) {
      candidates.set(item.ebayItemId, item);
    }
  }
  const unique = [...candidates.values()];
  if (!unique.length) return 0;
  if (!supabase) {
    let inserted = 0;
    for (const item of unique) {
      const index = mem.items.findIndex(existing => existing.ebayItemId === item.ebayItemId);
      if (index < 0) {
        mem.items.unshift({ ...item });
        inserted++;
      } else {
        const existing = mem.items[index];
        if (existing.status === 'ACTIVE' && Date.parse(existing.lastSeenAt) <= Date.parse(item.lastSeenAt)) {
          mem.items[index] = { ...existing, ...sourceItemPatch(item) };
        }
      }
    }
    return inserted;
  }
  // Insert-only on conflict. A full-row upsert would replace IDs, curation and
  // publish state, including changes made by an administrator during this scan.
  const { data, error } = await supabase.from('items')
    .upsert(unique.map(itemToRow), { onConflict: 'ebay_item_id', ignoreDuplicates: true })
    .select('ebay_item_id');
  if (error) throw error;
  const insertedIds = new Set((data ?? []).map(row => row.ebay_item_id));
  const existing = unique.filter(item => !insertedIds.has(item.ebayItemId));
  // Only source-owned columns are refreshed, with database-side guards against
  // stale overlapping scans and updates to sold/reserved inventory. There is no
  // read/merge/write of editorial columns, so concurrent curation is preserved.
  for (let start = 0; start < existing.length; start += 10) {
    await Promise.all(existing.slice(start, start + 10).map(async item => {
      const { error: updateError } = await supabase.from('items')
        .update(sourceRowPatch(item))
        .eq('ebay_item_id', item.ebayItemId)
        .eq('status', 'ACTIVE')
        .lte('last_seen_at', item.lastSeenAt);
      if (updateError) throw updateError;
    }));
  }
  return insertedIds.size;
}

/** Apply withdrawals BEFORE source updates so each snapshot timestamp still matches. */
export async function withdrawSourceItems(withdrawals: InventoryRefreshPlan['withdrawals']): Promise<number> {
  for (const entry of withdrawals) {
    if (!entry.id || !/^v1\|\d+\|\d+$/.test(entry.ebayItemId) ||
        !Number.isFinite(Date.parse(entry.expectedLastSeenAt)) ||
        !['ENDED', 'REVIEW_REQUIRED'].includes(entry.reason)) throw new Error('INVALID_INVENTORY_OBSERVATION');
  }
  const supabase = getSupabase();
  let withdrawn = 0;
  for (const entry of withdrawals) {
    if (!supabase) {
      const item = mem.items.find(value => value.id === entry.id && value.ebayItemId === entry.ebayItemId &&
        value.status === 'ACTIVE' && Date.parse(value.lastSeenAt) === Date.parse(entry.expectedLastSeenAt));
      if (item) {
        item.publishStatus = PublishState.UNPUBLISHED;
        if (entry.reason === 'ENDED') item.status = 'ENDED';
        withdrawn++;
      }
      continue;
    }
    // An order reservation or newer source scan wins over this old observation.
    // Editorial columns, IDs and first/last-seen timestamps are never written.
    const { data, error } = await supabase.from('items').update({
      publish_state: PublishState.UNPUBLISHED,
      ...(entry.reason === 'ENDED' ? { status: 'ENDED' } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', entry.id).eq('ebay_item_id', entry.ebayItemId)
      .eq('status', 'ACTIVE').eq('last_seen_at', entry.expectedLastSeenAt).select('id');
    if (error) throw error;
    withdrawn += data?.length || 0;
  }
  return withdrawn;
}

function sourceItemPatch(item: AppStateItem): Partial<AppStateItem> {
  return {
    url: item.url,
    titleRaw: item.titleRaw,
    priceGbp: item.priceGbp,
    shippingGbp: item.shippingGbp,
    sellerName: item.sellerName,
    sellerFeedbackPercent: item.sellerFeedbackPercent,
    sellerFeedbackScore: item.sellerFeedbackScore,
    category: item.category,
    locationCountry: item.locationCountry,
    imageUrls: item.imageUrls,
    lastSeenAt: item.lastSeenAt,
  };
}

function sourceRowPatch(item: AppStateItem) {
  const source = sourceItemPatch(item);
  return {
    url: source.url,
    title_raw: source.titleRaw,
    price_gbp: source.priceGbp,
    shipping_gbp: source.shippingGbp,
    seller_name: source.sellerName,
    seller_feedback_percent: source.sellerFeedbackPercent,
    seller_feedback_score: source.sellerFeedbackScore,
    category: source.category,
    location_country: source.locationCountry,
    image_urls: source.imageUrls,
    last_seen_at: source.lastSeenAt,
    updated_at: new Date().toISOString(),
  };
}

export async function updateItem(id: string, patch: Partial<AppStateItem>): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    mem.items = mem.items.map(i => i.id === id ? { ...i, ...patch } : i);
    return;
  }
  const { error } = await supabase.from('items').update(itemToRowPatch(patch)).eq('id', id);
  if (error) throw error;
}

export async function getItemById(id: string): Promise<AppStateItem | null> {
  const supabase = getSupabase();
  if (!supabase) return mem.items.find(i => i.id === id) ?? null;
  const { data, error } = await supabase.from('items').select('*').eq('id', id).single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data ? rowToItem(data) : null;
}

function itemToRow(i: AppStateItem) {
  return {
    id: i.id,
    ebay_item_id: i.ebayItemId,
    url: i.url,
    title_raw: i.titleRaw,
    title_boutique: i.titleBoutique ?? null,
    description: i.description ?? null,
    price_gbp: i.priceGbp,
    shipping_gbp: i.shippingGbp,
    seller_name: i.sellerName,
    seller_feedback_percent: i.sellerFeedbackPercent,
    seller_feedback_score: i.sellerFeedbackScore,
    category: i.category,
    location_country: i.locationCountry,
    image_urls: i.imageUrls,
    status: i.status,
    last_seen_at: i.lastSeenAt,
    first_seen_at: i.firstSeenAt,
    publish_state: i.publishStatus,
    score: i.score,
    updated_at: new Date().toISOString(),
  };
}

function itemToRowPatch(p: Partial<AppStateItem>) {
  const out: any = { updated_at: new Date().toISOString() };
  if (p.titleBoutique !== undefined) out.title_boutique = p.titleBoutique;
  if (p.description !== undefined) out.description = p.description;
  if (p.publishStatus !== undefined) out.publish_state = p.publishStatus;
  if (p.score !== undefined) out.score = p.score;
  if (p.titleRaw !== undefined) out.title_raw = p.titleRaw;
  if (p.priceGbp !== undefined) out.price_gbp = p.priceGbp;
  if (p.imageUrls !== undefined) out.image_urls = p.imageUrls;
  return out;
}

function rowToItem(r: any): AppStateItem {
  return {
    id: r.id,
    ebayItemId: r.ebay_item_id,
    url: r.url,
    titleRaw: r.title_raw,
    titleBoutique: r.title_boutique ?? undefined,
    description: r.description ?? undefined,
    priceGbp: Number(r.price_gbp),
    shippingGbp: Number(r.shipping_gbp),
    sellerName: r.seller_name,
    sellerFeedbackPercent: Number(r.seller_feedback_percent),
    sellerFeedbackScore: Number(r.seller_feedback_score),
    category: r.category,
    locationCountry: r.location_country,
    imageUrls: Array.isArray(r.image_urls) ? r.image_urls : (r.image_urls || []),
    status: r.status,
    lastSeenAt: typeof r.last_seen_at === 'string' ? r.last_seen_at : new Date(r.last_seen_at).toISOString(),
    firstSeenAt: typeof r.first_seen_at === 'string' ? r.first_seen_at : new Date(r.first_seen_at).toISOString(),
    publishStatus: r.publish_state,
    score: Number(r.score),
  };
}

