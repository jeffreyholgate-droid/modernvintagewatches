import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';

const Bag: React.FC = () => {
  const cart = useCart();
  const navigate = useNavigate();

  const onCheckout = async () => {
    // Create Stripe Checkout session (server-side). Falls back to a simulated checkout if Stripe env vars are missing.
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: cart.state.lines }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    // Simulated success (dev fallback)
    cart.clear();
    navigate('/checkout/success');
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
                  <div className="w-28 h-28 bg-gray-50 border border-line flex items-center justify-center overflow-hidden">
                    {l.imageUrl ? (
                      <img src={l.imageUrl} alt={l.title} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted">Watch</p>
                        <p className="mt-1">{l.title}</p>
                      </div>
                      <p className="whitespace-nowrap">£{l.priceGbp.toLocaleString()}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <label className="text-xs uppercase tracking-widest text-muted">Qty</label>
                        <input
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) => cart.setQty(l.id, Number(e.target.value))}
                          className="w-20 border border-line px-2 py-1 text-sm"
                        />
                      </div>
                      <button onClick={() => cart.remove(l.id)} className="text-sm underline text-muted hover:text-black">
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
                  <span>£{cart.subtotalGbp.toLocaleString()}</span>
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted">Shipping</span>
                  <span className="text-muted">Calculated at checkout</span>
                </div>
                <div className="mt-5 border-t border-line pt-5 flex justify-between">
                  <span className="text-sm">Total</span>
                  <span className="text-sm">£{cart.subtotalGbp.toLocaleString()}</span>
                </div>
                <button
                  onClick={onCheckout}
                  className="mt-6 w-full bg-ink text-white py-3 text-sm uppercase tracking-widest hover:opacity-90"
                >
                  Checkout
                </button>
                <p className="mt-4 text-xs text-muted leading-relaxed">
                  Secure checkout. Inventory is limited; your order is confirmed once payment completes.
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
