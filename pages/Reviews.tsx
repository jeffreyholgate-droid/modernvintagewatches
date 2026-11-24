import React from 'react';
import { Link } from 'react-router-dom';

const feedbackProfile = 'https://www.ebay.co.uk/fdbk/feedback_profile/jeffholgate';

// Selected excerpts from eBay feedback marked as verified purchases.
const reviews = [
  { watch: 'Nivada Grenchen Chronomaster', excerpt: 'The watch was exactly as described' },
  { watch: 'Rolex Sea-Dweller 126600', excerpt: 'The communication with the seller was superb' },
  { watch: 'Omega Seamaster Bumper 2576-1', excerpt: 'Accurate description and photos.' },
  { watch: 'Movado Triple Date Calendar', excerpt: 'Packaged with care.' },
  { watch: 'Universal Genève Polerouter', excerpt: 'Great communication, amazing watch' },
];

export default function Reviews() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24 pt-32">
      <h1 className="text-3xl tracking-tight">Customer reviews</h1>
      <p className="mt-5 max-w-prose text-sm leading-relaxed text-muted">
        Selected excerpts from verified watch purchases made through our Modern Vintage Watches eBay shop.
      </p>
      <ul className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {reviews.map(({ watch, excerpt }) => (
          <li key={watch} className="border-t border-line pt-5">
            <figure>
              <blockquote cite={feedbackProfile} className="font-serif text-lg leading-relaxed">“{excerpt}”</blockquote>
              <figcaption className="mt-3 text-sm text-muted">{watch} · Verified eBay purchase</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <div className="mt-12 flex flex-wrap gap-6 text-sm">
        <a href={feedbackProfile} className="underline">Read all feedback on eBay</a>
        <Link to="/" className="underline">Browse watches</Link>
      </div>
    </section>
  );
}
