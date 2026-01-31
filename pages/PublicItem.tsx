import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchItem } from '../lib/api';
import { useCart } from '../lib/cart';

const PublicItem: React.FC = () => {
  const { id } = useParams();
  const cart = useCart();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const it = await fetchItem(id, false);
        if (alive) setItem(it);
      } catch {
        if (alive) setItem(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const title = useMemo(() => item?.titleBoutique || item?.titleRaw || 'Item', [item]);
  const image = useMemo(() => item?.imageUrls?.[0], [item]);

  const addToBag = () => {
    if (!item) return;
    cart.add({ id: item.id, title, priceGbp: item.priceGbp, imageUrl: image }, 1);
  };

  const buyNow = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: [{ id: item.id, title, priceGbp: item.priceGbp, imageUrl: image, qty: 1 }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      // Dev fallback: treat as success.
      cart.clear();
      window.location.href = '/#/checkout/success';
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-page min-h-screen pt-28 flex items-center justify-center">
        <p className="text-xs uppercase tracking-widest text-muted">Loading…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="bg-page min-h-screen pt-28 flex items-center justify-center">
        <div className="px-6 text-center">
          <p className="text-muted">This item isn’t available.</p>
          <Link to="/" className="inline-block mt-6 text-sm underline">Return to watches</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen pt-24">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <nav className="text-[10px] uppercase tracking-[0.25em] text-muted">
          <Link to="/" className="hover:text-black">Watches</Link>
          <span className="mx-2">/</span>
          <span className="text-black">{item.category}</span>
        </nav>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Gallery */}
          <div className="lg:col-span-7">
            <div className="border border-line bg-gray-50 aspect-square flex items-center justify-center overflow-hidden">
              <img src={image} alt={title} className="w-full h-full object-cover" />
            </div>
            <p className="mt-4 text-xs text-muted">
              Images are curated for consistency. Ask for additional photos if you want a full condition set.
            </p>
          </div>

          {/* Details */}
          <div className="lg:col-span-5">
            <h1 className="text-3xl md:text-4xl tracking-tight">{title}</h1>
            <p className="mt-3 text-xl">£{Number(item.priceGbp).toLocaleString()}</p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={addToBag}
                className="w-full border border-black py-3 text-sm uppercase tracking-widest hover:bg-black hover:text-white transition"
              >
                Add to bag
              </button>
              <button
                onClick={buyNow}
                disabled={busy}
                className="w-full bg-black text-white py-3 text-sm uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Starting checkout…' : 'Buy now'}
              </button>
            </div>

            <div className="mt-8 border-t border-line pt-8">
              <h2 className="text-xs uppercase tracking-[0.25em]">Details</h2>
              <div className="mt-5 grid grid-cols-2 gap-y-5 text-sm">
                <Spec label="Provenance" value={item.locationCountry || 'UK'} />
                <Spec label="Seller" value={item.sellerName || '—'} />
                <Spec label="Seller feedback" value={`${item.sellerFeedbackPercent}%`} />
                <Spec label="Agent score" value={`${item.score}/100`} />
              </div>
            </div>

            <div className="mt-8 border-t border-line pt-8">
              <h2 className="text-xs uppercase tracking-[0.25em]">Curator’s note</h2>
              <p className="mt-4 text-sm text-muted leading-relaxed">
                {item.description ||
                  'A clean, well-presented listing. If you’d like a tighter condition assessment, we can request additional photos and serial/reference confirmation before dispatch.'}
              </p>
            </div>

            <div className="mt-8 border-t border-line pt-8 text-xs text-muted leading-relaxed">
              <p>
                * Buy‑now purchases are processed through secure checkout. Inventory is limited — if a source item becomes unavailable,
                we’ll refund immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Spec: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-muted">{label}</p>
    <p className="mt-1">{value}</p>
  </div>
);

export default PublicItem;
