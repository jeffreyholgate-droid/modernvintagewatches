import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

type Confirmation = 'checking' | 'paid' | 'pending' | 'unconfirmed';
type OrderStatus = 'pending_payment' | 'paid_awaiting_source' | 'expired' | 'payment_review';
const orderLabels: Record<OrderStatus, string> = {
  pending_payment: 'Recording payment confirmation',
  paid_awaiting_source: 'Awaiting source review',
  expired: 'Checkout expired',
  payment_review: 'Order needs review',
};

const CheckoutSuccess: React.FC = () => {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const [confirmation, setConfirmation] = useState<Confirmation>('checking');
  const [attempt, setAttempt] = useState(0);
  const [testMode, setTestMode] = useState(false);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setConfirmation('checking');
    setOrderStatus(null);
    setTestMode(false);
    if (!sessionId) {
      setConfirmation('unconfirmed');
      return () => controller.abort();
    }
    (async () => {
      try {
        const response = await fetch(`/api/checkout?session_id=${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.testMode !== 'boolean' || !Object.hasOwn(orderLabels, data.orderStatus)) {
          throw new Error('UNCONFIRMED');
        }
        if (!controller.signal.aborted) {
          setTestMode(data.testMode);
          setOrderStatus(data.orderStatus);
          setConfirmation(data.paid === true ? 'paid' : data.status === 'expired' ? 'unconfirmed' : 'pending');
        }
      } catch {
        if (!controller.signal.aborted) setConfirmation('unconfirmed');
      }
    })();
    return () => controller.abort();
  }, [sessionId, attempt]);

  const heading = {
    checking: 'Checking payment',
    paid: testMode ? 'Test payment recorded' : 'Payment received',
    pending: 'Payment not yet confirmed',
    unconfirmed: 'Payment could not be confirmed',
  }[confirmation];
  const message = {
    checking: 'Please wait while we check your payment status.',
    paid: testMode
      ? 'Stripe recorded this test payment. No money was charged and no watch has been purchased or dispatched.'
      : 'Your card payment has been confirmed. This does not confirm source availability or dispatch of your watch.',
    pending: 'We have not confirmed payment yet. If you completed checkout, check again shortly. Please do not pay again while the status is pending.',
    unconfirmed: 'We could not verify a completed payment. Your bag has been preserved. If you believe you paid, please check your payment receipt before trying again.',
  }[confirmation];

  return (
    <div className="bg-page min-h-screen pt-28 pb-24">
      <div className="max-w-3xl mx-auto px-6">
        <div role="status" aria-live="polite">
          <h1 className="text-2xl tracking-tight">{heading}</h1>
          <p className="mt-4 text-muted leading-relaxed">{message}</p>
          {orderStatus ? <p className="mt-4 text-sm">Order status: {orderLabels[orderStatus]}</p> : null}
        </div>
        {confirmation === 'paid' && sessionId ? (
          <p className="mt-3 text-xs text-muted break-all">Payment reference: {sessionId}</p>
        ) : null}
        {sessionId && confirmation !== 'checking' && (confirmation !== 'paid' || orderStatus === 'pending_payment') ? (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-6 text-sm underline">
            Check payment again
          </button>
        ) : null}
        <div className="mt-8 flex gap-6">
          <Link to="/" className="text-sm underline">Continue browsing</Link>
          {confirmation !== 'paid' ? <Link to="/bag" className="text-sm underline">View bag</Link> : null}
        </div>
      </div>
    </div>
  );
};

export default CheckoutSuccess;
