import React from 'react';
import { Link } from 'react-router-dom';

export default function Ordering() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24 pt-32">
      <h1 className="text-3xl tracking-tight">How ordering works</h1>
      <div className="mt-8 space-y-8 leading-relaxed">
        <div>
          <h2 className="font-medium">Choose a watch</h2>
          <p className="mt-2 text-sm text-muted">Our collection features pre-owned watches listed by external sellers. The photos show the seller’s listing. UK delivery is included in the displayed price.</p>
        </div>
        <div>
          <h2 className="font-medium">Source review</h2>
          <p className="mt-2 text-sm text-muted">We check the seller’s offer before checkout. After payment, we review the source again before buying. Availability can change while the seller’s listing is active.</p>
        </div>
        <div>
          <h2 className="font-medium">Inspection and dispatch</h2>
          <p className="mt-2 text-sm text-muted">We check the watch in person before dispatch. Payment confirmation and dispatch are separate steps.</p>
        </div>
      </div>
      <Link to="/" className="mt-10 inline-block text-sm underline">Browse watches</Link>
    </section>
  );
}
