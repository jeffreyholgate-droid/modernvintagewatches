import { applyStripeEvent } from './_lib/orders.js';
import { handleStripeWebhook } from './_lib/webhook.js';

// Vercel's Node runtime supports this Web Standard handler for plain api/*.ts files.
// Using Request avoids the parsed-body helpers on traditional Node req/res handlers.
// https://vercel.com/docs/functions/runtimes/node-js
export default {
  fetch(request: Request): Promise<Response> {
    return handleStripeWebhook(request, {
      endpointSecret: process.env.STRIPE_WEBHOOK_SECRET,
      applyEvent: applyStripeEvent,
    });
  },
};
