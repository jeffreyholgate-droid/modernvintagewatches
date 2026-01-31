import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const CheckoutSuccess: React.FC = () => {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');

  return (
    <div className="bg-page min-h-screen pt-28 pb-24">
      <div className="max-w-3xl mx-auto px-6">
        <h1 className="text-2xl tracking-tight">Order confirmed</h1>
        <p className="mt-4 text-muted leading-relaxed">
          Thanks — we’ve received your order. If you paid by card, you’ll receive an email receipt from our payment provider.
        </p>
        {sessionId ? (
          <p className="mt-3 text-xs text-muted">Reference: {sessionId}</p>
        ) : null}
        <div className="mt-8 flex gap-6">
          <Link to="/" className="text-sm underline">Continue shopping</Link>
          <Link to="/admin" className="text-sm underline text-muted">Admin</Link>
        </div>
      </div>
    </div>
  );
};

export default CheckoutSuccess;
