import React from 'react';
import { Link } from 'react-router-dom';

export default function Reviews() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24 pt-32">
      <h1 className="text-3xl tracking-tight">Customer reviews</h1>
      <p className="mt-5 text-sm leading-relaxed text-muted">Watch buyer feedback will appear here once verified.</p>
      <Link to="/" className="mt-10 inline-block text-sm underline">Browse watches</Link>
    </section>
  );
}
