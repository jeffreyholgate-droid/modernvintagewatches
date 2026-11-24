import React, { useRef, useState } from 'react';
import { manageOrder, type AdminOrderSummary } from '../lib/api';
import { formatPence } from '../lib/cart-pricing';
import type { Operation, RefundReason, SourceCheck } from '../api/_lib/order-operations';

const reasons: Record<RefundReason, string> = {
  source_unavailable: 'Source unavailable',
  cost_changed: 'Source cost changed',
  customer_cancelled: 'Customer cancelled',
  other: 'Other',
};

const transitions = {
  awaiting_source: [{ action: 'purchase_in_progress', label: 'Start sourcing',
    confirm: 'Reserve this order for manual sourcing? Check each listing and confirm the actual purchase cost before buying.' }],
  purchase_in_progress: [
    { action: 'sourced', label: 'Record purchase', confirm: 'Have you purchased every watch in this order?' },
    { action: 'awaiting_source', label: 'Release sourcing hold', confirm: 'Confirm that no watch in this order was purchased.' },
  ],
  sourced: [{ action: 'inspected', label: 'Record inspection', confirm: 'Have all watches passed physical authenticity, condition and order checks?' }],
  inspected: [{ action: 'dispatched', label: 'Record dispatch', confirm: 'Have all watches been handed to the carrier with suitable insured service and tracking?' }],
  dispatched: [],
  refund_requested: [],
  refunded: [],
} as const;

export const operationLabels: Record<Operation['state'], string> = {
  awaiting_source: 'Paid · awaiting sourcing review',
  purchase_in_progress: 'Sourcing in progress',
  sourced: 'Purchased · awaiting inspection',
  inspected: 'Inspected · awaiting dispatch',
  dispatched: 'Dispatched',
  refund_requested: 'Refund requested',
  refunded: 'Full refund confirmed',
};

function describeSource(check: SourceCheck) {
  if (check.status === 'unknown') return 'eBay did not provide a reliable quote. Check the listing manually.';
  if (check.status === 'unavailable') return 'eBay does not currently show a qualifying UK fixed-price offer.';
  if (check.status !== 'available') return '';
  const difference = check.savedCostPence === null ? null : check.costPence - check.savedCostPence;
  const comparison = difference === null ? 'No saved cost to compare.'
    : difference === 0 ? 'Matches the saved cost.'
    : `${formatPence(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'} the saved cost.`;
  return `Estimated source cost with postage ${formatPence(check.costPence)}. ${comparison} Confirm at eBay before buying.`;
}

export function OrderOperations({ order, onChange }: { order: AdminOrderSummary; onChange: (operation: Operation) => void }) {
  const state = order.operation?.state ?? 'awaiting_source';
  const revision = order.operation?.revision ?? 0;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState<RefundReason>('source_unavailable');
  const [sources, setSources] = useState<Record<string, SourceCheck>>({});

  async function run(action: Parameters<typeof manageOrder>[1]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await manageOrder(order.id, action);
      const { source, refund, operation } = result;
      if (source && action.action === 'check_source') {
        setSources(previous => ({ ...previous, [action.itemId]: source }));
      }
      if (refund) {
        setMessage(refund.complete ? 'Stripe confirmed the full test refund.'
          : `Stripe confirmed ${formatPence(refund.succeededPence)} of ${formatPence(order.totalPence)} refunded.${refund.pending ? ' A refund is pending.' : ''}${refund.needsAttention ? ' Check the refund history in Stripe.' : ''}`);
      }
      if (operation) onChange(operation);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : '';
      setError(code === 'OPERATION_CHANGED' ? 'Another admin changed this order. Refresh before continuing.'
        : code === 'PAYMENT_ALREADY_REFUNDING' ? 'Stripe shows a refund or a pending refund. Review the payment in Stripe.'
        : code === 'REFUND_EVIDENCE_INVALID' ? 'Stripe did not return matching refund evidence. Review the payment in Stripe.'
        : 'The order action could not be completed. Refresh to confirm the current state before retrying.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <div className="mt-6 space-y-4 border-t border-line pt-4 text-sm" aria-busy={busy}>
    {['awaiting_source', 'purchase_in_progress'].includes(state) && <ul className="space-y-2">
      {order.lines.map(line => {
        const checked = sources[line.itemId];
        return <li key={line.itemId}>
          <button disabled={busy} className="underline disabled:opacity-50" onClick={() => run({ action: 'check_source', itemId: line.itemId })}>
            Check eBay offer · {line.title}
          </button>
          {checked && <p role="status" className="mt-1 text-muted">
            {describeSource(checked)} Checked at {new Date(checked.checkedAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })} UK time.
          </p>}
        </li>;
      })}
    </ul>}
    {state === 'refund_requested' && <div className="space-y-2">
      <p>{order.operation?.refundReason && reasons[order.operation.refundReason]}. Review this payment in Stripe Sandbox and reconcile the full refund here.</p>
      <button disabled={busy} className="underline disabled:opacity-50" onClick={() => run({ action: 'check_refund', revision })}>Check refund in Stripe</button>
    </div>}
    <div className="flex flex-wrap items-center gap-4">
      {transitions[state].map(({ action, label, confirm }) =>
        <button key={action} disabled={busy} className="underline disabled:opacity-50"
          onClick={() => window.confirm(confirm) && run({ action, revision })}>{label}</button>
      )}
      {state === 'awaiting_source' && <>
        <button disabled={busy} className="underline disabled:opacity-50"
          onClick={() => run({ action: 'check_refund', revision })}>Check Stripe for refunds</button>
        <label className="flex items-center gap-2">Refund reason
          <select disabled={busy} className="border border-line bg-page p-1" value={reason}
            onChange={event => setReason(event.target.value as RefundReason)}>
            {Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button disabled={busy} className="underline disabled:opacity-50"
          onClick={() => window.confirm('Record a full refund request and put this order on hold for sourcing?') &&
            run({ action: 'refund_requested', reason, revision })}>Record refund request</button>
      </>}
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="text-amber-900">{error}</p>}
  </div>;
}
