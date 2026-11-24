import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { checkoutErrorMessage, checkoutNeedsPriceRefresh, hasCheckoutAttempt, requestCheckout, resumeExistingCheckout } from '../lib/checkout';
import { formatPence } from '../lib/cart-pricing';
import { WatchPhoto } from './WatchPhoto';

const Bag: React.FC = () => {
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState('');
  const basketKey = cart.state.lines.map(line => line.id).sort().join('|');
  const canResume = hasCheckoutAttempt(cart.state.lines);

  useEffect(() => {
    let alive = true;
    setChecking(true);
    cart.refreshPrices().then(result => {
      if (!alive) return;
      if (result.changed) setNotice('Your bag has been updated with current prices. Please review the total.');
      if (!result.ready && result.lines.length) setError('Some watches or prices could not be confirmed. Retry the check or remove those watches.');
      else setError('');
    }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [basketKey]);

  const retryPrices = async () => {
    setChecking(true);
    setError('');
    try {
      const result = await cart.refreshPrices();
      if (!result.ready) setError('Some watches or prices could not be confirmed. Retry the check or remove those watches.');
      if (result.changed) setNotice('Your bag has been updated with current prices. Please review the total.');
    } finally { setChecking(false); }
  };

  const onCheckout = async () => {
    if (busy || checking || cart.totalPence === null) return;
    setBusy(true);
    setError('');
    try {
      const current = await cart.refreshPrices();
      if (!current.ready) {
        setError('A watch or its price could not be confirmed. Review your bag before continuing.');
        return;
      }
      if (current.changed) {
        setNotice('Prices have changed. Review the updated total, then select Checkout again.');
        return;
      }
      window.location.href = await requestCheckout(current.lines.map(line => ({ id: line.id, qty: 1, expectedAmountPence: line.retailPricePence! })));
    } catch (err) {
      if (checkoutNeedsPriceRefresh(err)) await cart.refreshPrices();
      setError(checkoutErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (busy || checking || !canResume) return;
    setBusy(true);
    setError('');
    try { window.location.href = await resumeExistingCheckout(cart.state.lines); }
    catch (err) {
      setError(checkoutErrorMessage(err));
      // Confirmed expiry removes the stored key; refresh newly released stock.
      if (!hasCheckoutAttempt(cart.state.lines) || checkoutNeedsPriceRefresh(err)) await cart.refreshPrices();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-page min-h-screen pt-28 pb-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-baseline justify-between gap-6 border-b border-line pb-6">
          <h1 className="text-2xl tracking-tight">Bag</h1>
          <p className="text-sm text-muted">{cart.count} item{cart.count === 1 ? '' : 's'}</p>
        </div>

        {cart.state.lines.length === 0 ? (
          <div className="py-24">
            <p className="text-muted">Your bag is empty.</p>
            <Link to="/" className="inline-block mt-6 text-sm underline">Continue shopping</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 pt-10">
            <div className="lg:col-span-8 space-y-6">
              {cart.state.lines.map((l) => (
                <div key={l.id} className="flex gap-5 border-b border-line pb-6">
                  <div className="w-20 sm:w-28 shrink-0">
                    <WatchPhoto photo={l.imageUrl ? { url: l.imageUrl, tone: l.imageTone ?? 'original' } : undefined} alt={l.title} />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted">Watch</p>
                        <p className="mt-1">{l.title}</p>
                      </div>
                      <p className="whitespace-nowrap">{l.pricingStatus === 'ready' && l.retailPricePence !== null ? formatPence(l.retailPricePence) : checking ? 'Checking…' : 'Price unavailable'}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <label className="text-xs uppercase tracking-widest text-muted">Qty</label>
                        <input
                          type="number"
                          min={1}
                          max={1}
                          value={l.qty}
                          disabled={busy || checking}
                          onChange={(e) => cart.setQty(l.id, Number(e.target.value))}
                          className="w-20 border border-line px-2 py-1 text-sm"
                        />
                      </div>
                      <button disabled={busy} onClick={() => cart.remove(l.id)} className="text-sm underline text-muted hover:text-black disabled:opacity-50">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="lg:col-span-4">
              <div className="border border-line p-6 sticky top-28">
                <h2 className="text-sm uppercase tracking-widest">Summary</h2>
                <div className="mt-5 flex justify-between text-sm">
                  <span className="text-muted">Subtotal</span>
                  <span>{cart.totalPence === null ? 'To be confirmed' : formatPence(cart.totalPence)}</span>
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted">UK delivery</span>
                  <span className="text-muted">Included</span>
                </div>
                <div className="mt-5 border-t border-line pt-5 flex justify-between">
                  <span className="text-sm">Total</span>
                  <span className="text-sm">{cart.totalPence === null ? 'To be confirmed' : formatPence(cart.totalPence)}</span>
                </div>
                <button
                  onClick={onCheckout}
                  disabled={busy || checking || cart.totalPence === null}
                  className="mt-6 w-full bg-ink text-white py-3 text-sm uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Starting checkout…' : checking ? 'Checking prices…' : 'Checkout'}
                </button>
                {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
                {notice ? <p role="status" className="mt-4 text-sm text-muted">{notice}</p> : null}
                {cart.totalPence === null && !checking && <button disabled={busy} onClick={retryPrices} className="mt-4 text-sm underline">Retry price check</button>}
                {cart.totalPence === null && canResume && !checking && <div className="mt-5 border-t border-line pt-4">
                  <p className="text-xs text-muted">A checkout was previously started for this bag. Its watches may be reserved. You can reopen it at its original quoted price.</p>
                  <button disabled={busy} onClick={onResume} className="mt-3 text-sm underline disabled:opacity-50">Resume existing checkout</button>
                </div>}
                <p className="mt-4 text-xs text-muted leading-relaxed">
                  Availability is checked before checkout. Each watch is sourced individually.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Bag;
