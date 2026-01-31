import { createClient } from '@supabase/supabase-js';
import { Category, PublishState, EbayItem } from '../../types';

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
  vatMode: 'STANDARD' | 'MARGIN_SCHEME';
  blockKeywords: string;
}

const DEFAULT_SETTINGS: Settings = {
  priceMin: { [Category.WATCH]: 2000, [Category.HANDBAG]: 2000, [Category.JEWELLERY]: 2000 },
  priceMax: { [Category.WATCH]: 50000, [Category.HANDBAG]: 50000, [Category.JEWELLERY]: 50000 },
  publishTarget: 80,
  marginPercent: { [Category.WATCH]: 15, [Category.HANDBAG]: 20, [Category.JEWELLERY]: 25 },
  sellerMinFeedback: 99,
  sellerMinScore: 200,
  vatMode: 'MARGIN_SCHEME',
  blockKeywords: 'replica,fake,copy,aftermarket,custom,diamond set,ice,lab,moissanite'
};

type SupabaseClient = ReturnType<typeof createClient>;

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// --- Fallback (ephemeral) in-memory store for local dev only ---
const mem = {
  items: [] as AppStateItem[],
  settings: DEFAULT_SETTINGS as Settings,
  logs: [] as { ts: string; level: string; message: string }[],
};

export function isPersistent(): boolean {
  return !!getSupabase();
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
  if (!supabase) return mem.settings;
  const { data, error } = await supabase.from('settings').select('data').eq('id', 'default').single();
  if (error && error.code !== 'PGRST116') throw error; // not found
  return (data?.data as Settings) || DEFAULT_SETTINGS;
}

export async function saveSettings(next: Settings): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) { mem.settings = next; return; }
  const { error } = await supabase.from('settings').upsert({ id: 'default', data: next }, { onConflict: 'id' });
  if (error) throw error;
}

export async function listItems(opts: { publishedOnly: boolean }): Promise<AppStateItem[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return (opts.publishedOnly ? mem.items.filter(i => i.publishStatus === PublishState.PUBLISHED) : mem.items);
  }
  let q = supabase.from('items').select('*').order('last_seen_at', { ascending: false });
  if (opts.publishedOnly) q = q.eq('publish_status', PublishState.PUBLISHED);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToItem);
}

export async function upsertItems(newItems: AppStateItem[]): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) {
    const existing = new Set(mem.items.map(i => i.ebayItemId));
    const unique = newItems.filter(i => !existing.has(i.ebayItemId));
    mem.items = [...unique, ...mem.items];
    return unique.length;
  }
  const rows = newItems.map(itemToRow);
  const { data, error } = await supabase.from('items').upsert(rows, { onConflict: 'ebay_item_id' }).select('ebay_item_id');
  if (error) throw error;
  // Supabase returns all affected rows; we can't easily know how many were new without extra query.
  return data?.length ?? 0;
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
    publish_status: i.publishStatus,
    score: i.score,
    updated_at: new Date().toISOString(),
  };
}

function itemToRowPatch(p: Partial<AppStateItem>) {
  const out: any = { updated_at: new Date().toISOString() };
  if (p.titleBoutique !== undefined) out.title_boutique = p.titleBoutique;
  if (p.description !== undefined) out.description = p.description;
  if (p.publishStatus !== undefined) out.publish_status = p.publishStatus;
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
    publishStatus: r.publish_status,
    score: Number(r.score),
  };
}
