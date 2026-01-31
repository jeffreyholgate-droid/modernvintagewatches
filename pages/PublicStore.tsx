import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { globalStore, AppStateItem } from '../lib/store';
import { Category, PublishState } from '../types';

type SortMode = 'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC';

const PublicStore: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('NEWEST');
  const [items, setItems] = useState<AppStateItem[]>([]);

  useEffect(() => {
    const updateItems = () => {
      const all = globalStore.getItems();
      setItems(all.filter((i) => i.publishStatus === PublishState.PUBLISHED));
    };
    (async () => {
      try {
        await globalStore.refresh({ admin: false });
      } catch {
        // ignore
      }
      updateItems();
    })();
    return globalStore.subscribe(updateItems);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = items.filter((item) => {
      if (activeCategory !== 'ALL' && item.category !== activeCategory) return false;
      if (!q) return true;
      const hay = `${item.titleBoutique || ''} ${item.titleRaw || ''} ${item.sellerName || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...base].sort((a, b) => {
      if (sort === 'PRICE_ASC') return a.priceGbp - b.priceGbp;
      if (sort === 'PRICE_DESC') return b.priceGbp - a.priceGbp;
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
              Clean listings, transparent pricing, and a boutique experience — inspired by the editorial simplicity of modern luxury retail.
            </p>
          </div>

          <div className="w-full md:w-[420px]">
            <label className="text-[10px] uppercase tracking-widest text-muted">Search</label>
            <input
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
            <label className="text-[10px] uppercase tracking-widest text-muted">Sort</label>
            <select
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
        {filtered.length === 0 ? (
          <div className="py-24">
            <p className="text-muted">No published items yet.</p>
            <p className="mt-3 text-sm text-muted">If you’re the owner, curate and publish inventory in the Admin panel.</p>
            <Link to="/admin" className="inline-block mt-6 text-sm underline">Go to Admin</Link>
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
                  <p className="mt-2 text-sm">£{item.priceGbp.toLocaleString()}</p>
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
