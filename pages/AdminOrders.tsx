import React, { useEffect, useState } from 'react';
import { fetchOrders, type AdminOrderSummary } from '../lib/api';
import { formatPence } from '../lib/cart-pricing';

const labels: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid_awaiting_source: 'Paid · awaiting sourcing review',
  expired: 'Checkout expired',
  payment_review: 'Payment needs review',
};

function sourceLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const allowed = ['ebay.co.uk', 'ebay.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return allowed ? url.href : null;
  } catch { return null; }
}

const AdminOrders: React.FC = () => {
  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchOrders().then(value => { if (alive) setOrders(value); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex justify-between items-start gap-6 border-b border-line pb-6">
        <div>
          <h1 className="text-2xl">Orders</h1>
          <p className="mt-3 text-sm text-muted max-w-2xl">Recent test orders and their payment status. Payment does not confirm an eBay purchase or dispatch.</p>
        </div>
        <button onClick={() => setAttempt(n => n + 1)} disabled={loading} className="text-sm underline disabled:opacity-50">Refresh</button>
      </div>
      {loading ? <p role="status" className="py-12 text-muted">Loading orders…</p>
        : error ? <p role="alert" className="py-12 text-muted">Orders couldn’t be loaded. Check the database connection and order migration, then refresh.</p>
        : !orders.length ? <p className="py-12 text-muted">No orders recorded yet.</p>
        : <div className="divide-y divide-gray-200">
          {orders.map(order => (
            <article key={order.id} className="py-8">
              <div className="flex flex-wrap gap-4 justify-between">
                <div>
                  <p className="font-medium">{labels[order.status] || 'Status unavailable'}</p>
                  <p className="mt-2 text-xs text-muted break-all">Order {order.id}</p>
                  <p className="mt-1 text-xs text-muted">{new Date(order.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</p>
                </div>
                <p className="font-medium">{formatPence(order.totalPence)}</p>
              </div>
              <ul className="mt-5 space-y-3">
                {order.lines.map(line => {
                  const href = sourceLink(line.sourceUrl);
                  return <li key={line.itemId} className="flex flex-wrap gap-3 justify-between text-sm">
                    <div>
                      <span>{line.title} · {formatPence(line.amountPence)}</span>
                      {line.pricing ? <div className="mt-2 space-y-1 text-xs text-muted">
                        <p>Source item {formatPence(line.pricing.sourceItemPence)} · source postage {formatPence(line.pricing.sourceShippingPence)} · delivery allowance {formatPence(line.pricing.deliveryAllowancePence)}</p>
                        <p>Target gross margin {(line.pricing.marginBps / 100).toFixed(2)}% · estimated payment fee {formatPence(line.pricing.estimatedFeePence)}</p>
                        <p>Estimated contribution after fee {formatPence(line.pricing.estimatedContributionPence)}. Other business costs are not deducted.</p>
                        <p>UK delivery included · not VAT registered. Amounts reflect the order’s saved pricing.</p>
                      </div> : <p className="mt-2 text-xs text-muted">Legacy order: the original checkout amount is preserved; no pricing breakdown was recorded.</p>}
                    </div>
                    {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">Review eBay listing</a> : <span className="text-muted">Source link unavailable</span>}
                  </li>;
                })}
              </ul>
              {order.status === 'payment_review' ? <p className="mt-5 text-sm text-amber-800">Check this payment in Stripe before purchasing, releasing stock or retrying payment.</p> : null}
              {order.status === 'pending_payment' ? <p className="mt-5 text-xs text-muted">Items remain reserved until payment or a verified checkout-expiry notification.</p> : null}
            </article>
          ))}
        </div>}
    </div>
  );
};

export default AdminOrders;
