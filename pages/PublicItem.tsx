import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchItem } from '../lib/api';
import { useCart } from '../lib/cart';
import { checkoutErrorMessage, checkoutNeedsPriceRefresh, requestCheckout } from '../lib/checkout';
import { formatPence, publicPrice, quotedCartLine } from '../lib/cart-pricing';
import { displayWatchPhotos } from '../lib/watch-photos';
import { WatchPhoto } from './WatchPhoto';

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
  const photos = useMemo(() => displayWatchPhotos(item?.imageUrls, item?.photoReview), [item]);
  const pricing = publicPrice(item);

  const addToBag = () => {
    const line = quotedCartLine(item);
    if (line) cart.add(line);
  };

  const buyNow = async () => {
    if (!item || !pricing || busy) return;
    setBusy(true);
    setCheckoutError('');
    try {
      window.location.href = await requestCheckout([{ id: item.id, qty: 1, expectedAmountPence: pricing.retailPricePence }]);
    } catch (error) {
      if (checkoutNeedsPriceRefresh(error)) {
        try { setItem(await fetchItem(item.id)); }
        catch { setLoadError('We couldn’t confirm the current price. Please try again.'); }
      }
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
          <span className="text-black">Watch details</span>
        </nav>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Gallery */}
          <div key={item.id} className="lg:col-span-7">
            <WatchGallery photos={photos} title={title} />
          </div>

          {/* Details */}
          <div className="lg:col-span-5">
            <h1 className="text-3xl md:text-4xl tracking-tight">{title}</h1>
            <p className="mt-3 text-xl">{pricing ? formatPence(pricing.retailPricePence) : 'Price unavailable'}</p>
            {pricing ? <p className="mt-2 text-sm text-muted">UK delivery included</p>
              : <p className="mt-2 text-sm text-muted">We’re confirming the current price. Please try again shortly.</p>}

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={addToBag}
                disabled={!pricing || busy}
                className="w-full border border-black py-3 text-sm uppercase tracking-widest hover:bg-black hover:text-white transition disabled:opacity-50"
              >
                Add to bag
              </button>
              <button
                onClick={buyNow}
                disabled={busy || !pricing}
                className="w-full bg-black text-white py-3 text-sm uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Starting checkout…' : 'Buy now'}
              </button>
            </div>

            {checkoutError ? <p role="alert" className="mt-4 text-sm text-red-700">{checkoutError}</p> : null}

            <div className="mt-8 border-t border-line pt-8">
              <h2 className="text-xs uppercase tracking-[0.25em]">Details and condition</h2>
              <p className="mt-4 whitespace-pre-line text-sm text-muted leading-relaxed">
                {item.description ||
                  'Condition details are awaiting review.'}
              </p>
            </div>

            <div className="mt-8 border-t border-line pt-8 text-xs text-muted leading-relaxed">
              <p>
                Condition and accessories are based on the seller’s listing. MVW checks the watch in person before dispatch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicItem;

function WatchGallery({ photos, title }: { photos: ReturnType<typeof displayWatchPhotos>; title: string }) {
  const [index, setIndex] = useState(0);
  const [original, setOriginal] = useState(false);
  const activeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const selected = photos[activeIndex];
  return <>
    <WatchPhoto photo={selected && original ? { url: selected.url, tone: 'original' } : selected}
      alt={photos.length > 1 ? `${title} · photo ${activeIndex + 1}` : title} eager originalView={original} />
    {photos.length > 1 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Watch photos">
      {photos.map((photo, i) => <button key={photo.url} type="button" onClick={() => setIndex(i)}
        aria-label={`Show photo ${i + 1}`} aria-pressed={i === activeIndex}
        className={`w-16 shrink-0 border ${i === activeIndex ? 'border-black' : 'border-transparent'}`}>
        <WatchPhoto photo={photo} alt="" />
      </button>)}
    </div>}
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
      <p>Photos supplied by the source seller.</p>
      {selected && (selected.mask || selected.tone !== 'original') &&
        <button type="button" onClick={() => setOriginal(value => !value)} className="underline">
          {original ? 'Show studio version' : 'Show original photo'}
        </button>}
      {selected && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="underline">Open original photo</a>}
    </div>
  </>;
}
