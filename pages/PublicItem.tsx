import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchItem } from '../lib/api';
import { useCart } from '../lib/cart';
import { checkoutErrorMessage, requestCheckout } from '../lib/checkout';

const PublicItem: React.FC = () => {
  const { id } = useParams();
  const cart = useCart();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoadedId(id);
    setLoading(true);
    setItem(null);
    setLoadError('');
    setCheckoutError('');
    (async () => {
      try {
        if (!id) return;
        const it = await fetchItem(id, false);
        if (alive) setItem(it);
      } catch (error: any) {
        if (alive) {
          setItem(null);
          if (error?.status !== 404) {
            setLoadError('We couldn’t load this watch right now. Please try again.');
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const title = useMemo(() => item?.titleBoutique || item?.titleRaw || 'Item', [item]);
  const image = useMemo(() => item?.imageUrls?.[0], [item]);

  const addToBag = () => {
    if (!item) return;
    if (cart.state.lines.some((line) => line.id === item.id)) {
      cart.setQty(item.id, 1);
    } else {
      cart.add({ id: item.id, title, priceGbp: item.priceGbp, imageUrl: image }, 1);
    }
  };

  const buyNow = async () => {
    if (!item || busy) return;
    setBusy(true);
    setCheckoutError('');
    try {
      window.location.href = await requestCheckout([{ id: item.id, qty: 1 }]);
    } catch (error) {
      setCheckoutError(checkoutErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  // Hide a previous product immediately on navigation, before the effect runs.
  if (loading || loadedId !== id) {
    return (
      <div className="bg-page min-h-screen pt-28 flex items-center justify-center">
        <p className="text-xs uppercase tracking-widest text-muted">Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-page min-h-screen pt-28 flex items-center justify-center">
        <div className="px-6 text-center">
          <p role="alert" className="text-muted">{loadError}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-6 text-sm underline">
            Try again
          </button>
          <Link to="/" className="block mt-6 text-sm underline">Return to watches</Link>
        </div>
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
              Images supplied by the source seller.
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

            {checkoutError ? <p role="alert" className="mt-4 text-sm text-red-700">{checkoutError}</p> : null}

            <div className="mt-8 border-t border-line pt-8">
              <h2 className="text-xs uppercase tracking-[0.25em]">Details</h2>
              <div className="mt-5 grid grid-cols-2 gap-y-5 text-sm">
                <Spec label="Source location" value={item.locationCountry || 'Not provided'} />
                <Spec label="Seller" value={item.sellerName || '—'} />
                <Spec label="Seller feedback" value={`${item.sellerFeedbackPercent}%`} />
                <Spec label="Review score" value={item.score > 0 ? `${item.score}/100` : 'Not scored'} />
              </div>
            </div>

            <div className="mt-8 border-t border-line pt-8">
              <h2 className="text-xs uppercase tracking-[0.25em]">Curator’s note</h2>
              <p className="mt-4 text-sm text-muted leading-relaxed">
                {item.description ||
                  'This watch is listed by an external seller. Condition details are awaiting review, and availability must be confirmed before fulfillment.'}
              </p>
            </div>

            <div className="mt-8 border-t border-line pt-8 text-xs text-muted leading-relaxed">
              <p>
                Each watch is sourced from an external seller. Availability must be confirmed before an order can be fulfilled.
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
