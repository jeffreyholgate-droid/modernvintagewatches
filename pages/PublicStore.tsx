import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppStateItem } from '../lib/store';
import { fetchPublicItems } from '../lib/api';
import { Category, PublishState } from '../types';
import { formatPence, publicPrice } from '../lib/cart-pricing';

type SortMode = 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC';

const PublicStore: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('NEWEST');
  const [items, setItems] = useState<AppStateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    fetchPublicItems()
      .then(value => { if (alive) setItems(value.filter(item => item.publishStatus === PublishState.PUBLISHED)); })
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [retry]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = items.filter((item) => {
      if (activeCategory !== 'ALL' && item.category !== activeCategory) return false;
      if (!q) return true;
      const hay = `${item.titleBoutique || ''} ${item.titleRaw || ''} ${item.sellerName || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...base].sort((a, b) => {
      if (sort === 'PRICE_ASC' || sort === 'PRICE_DESC') {
        const left = publicPrice(a)?.retailPricePence;
        const right = publicPrice(b)?.retailPricePence;
        if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
        return sort === 'PRICE_ASC' ? left - right : right - left;
      }
      // NEWEST
      return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
    });
    return sorted;
  }, [items, activeCategory, query, sort]);

  return (
    <div className="bg-page min-h-screen pt-24">
      {/* Minimal editorial header (SSENSE-like) */}
      <section className="max-w-7xl mx-auto px-6 pt-10 pb-8 border-b border-line">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-muted">Modern Vintage Watches</p>
            <h1 className="mt-2 text-3xl md:text-4xl tracking-tight">
              Curated pre‑owned timepieces.
            </h1>
            <p className="mt-3 text-sm text-muted max-w-2xl leading-relaxed">
              Explore the collection of pre-owned watches. Prices include UK delivery.
            </p>
          </div>

          <div className="w-full md:w-[420px]">
            <label htmlFor="watch-search" className="text-[10px] uppercase tracking-widest text-muted">Search</label>
            <input
              id="watch-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, model, reference…"
              className="mt-2 w-full border border-line px-4 py-3 text-sm outline-none focus:border-black"
            />
          </div>
        </div>
      </section>

      {/* Filter row */}
      <section className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {['ALL', ...Object.values(Category)].map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  aria-pressed={active}
                  onClick={() => setActiveCategory(cat)}
                  className={
                    `text-xs uppercase tracking-[0.25em] px-3 py-2 border ` +
                    (active ? 'border-black bg-black text-white' : 'border-line text-muted hover:text-black')
                  }
                >
                  {cat === 'ALL' ? 'All' : cat}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="watch-sort" className="text-[10px] uppercase tracking-widest text-muted">Sort</label>
            <select
              id="watch-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="border border-line px-3 py-2 text-sm bg-white outline-none focus:border-black"
            >
              <option value="NEWEST">Newest</option>
              <option value="PRICE_ASC">Price: Low → High</option>
              <option value="PRICE_DESC">Price: High → Low</option>
            </select>
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="max-w-7xl mx-auto px-6 pb-20">
        {loading ? (
          <p className="py-24 text-muted" role="status">Loading watches…</p>
        ) : loadError ? (
          <div className="py-24" role="alert">
            <p className="text-muted">We couldn’t load the collection. Please try again.</p>
            <button onClick={() => setRetry(value => value + 1)} className="mt-6 text-sm underline">Try again</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-24">
            <p className="text-muted">{items.length ? 'No watches match your search.' : 'Our collection is being prepared. Please check back soon.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-12">
            {filtered.map((item) => (
              <Link key={item.id} to={`/item/${item.id}`} className="group">
                <div className="aspect-square bg-gray-50 border border-line overflow-hidden flex items-center justify-center">
                  <img
                    src={item.imageUrls?.[0]}
                    alt={item.titleBoutique || item.titleRaw}
                    className="w-full h-full object-cover group-hover:opacity-95 transition"
                    loading="lazy"
                  />
                </div>
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-muted">
                    {(item.titleBoutique || item.titleRaw || '').split(' ')[0] || 'Watch'}
                  </p>
                  <p className="mt-1 text-sm leading-snug">
                    {item.titleBoutique || item.titleRaw}
                  </p>
                  <p className="mt-2 text-sm">{publicPrice(item) ? formatPence(publicPrice(item)!.retailPricePence) : 'Price unavailable'}</p>
                  {publicPrice(item) && <p className="mt-1 text-xs text-muted">UK delivery included</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PublicStore;
