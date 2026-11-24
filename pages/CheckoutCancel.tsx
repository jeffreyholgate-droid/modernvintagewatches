import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkoutErrorMessage, recentCheckout, resumeExistingCheckout } from '../lib/checkout';

const CheckoutCancel: React.FC = () => {
  const [basket, setBasket] = useState(recentCheckout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  async function resume() {
    if (!basket || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      window.location.href = await resumeExistingCheckout(basket);
    } catch (caught) {
      setError(checkoutErrorMessage(caught));
      setBasket(recentCheckout());
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="bg-page min-h-screen pt-28 pb-24">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-2xl tracking-tight">You left checkout</h1>
        <p className="mt-4 text-muted leading-relaxed">
          {basket ? 'Reopen your last checkout to continue or check its payment status.' : 'Return to your bag or keep browsing the collection.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-6">
          {basket && <button type="button" onClick={resume} disabled={busy} className="text-sm underline disabled:opacity-50">
            {busy ? 'Opening checkout…' : 'Resume last checkout'}
          </button>}
          <Link to="/bag" className="text-sm underline">Return to bag</Link>
          <Link to="/" className="text-sm underline text-muted">Continue shopping</Link>
        </div>
        {error && <p role="alert" className="mt-5 text-sm text-amber-900">{error}</p>}
      </div>
    </div>
  );
};

export default CheckoutCancel;
