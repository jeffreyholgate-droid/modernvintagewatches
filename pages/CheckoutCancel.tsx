import React from 'react';
import { Link } from 'react-router-dom';

const CheckoutCancel: React.FC = () => {
  return (
    <div className="bg-page min-h-screen pt-28 pb-24">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-2xl tracking-tight">Checkout cancelled</h1>
        <p className="mt-4 text-muted leading-relaxed">
          Your payment wasn’t completed. Your items are still in your bag.
        </p>
        <div className="mt-8 flex gap-6">
          <Link to="/bag" className="text-sm underline">Return to bag</Link>
          <Link to="/" className="text-sm underline text-muted">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
};

export default CheckoutCancel;
