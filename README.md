# Modern Vintage Watches

React/Vite storefront with Vercel Node APIs, Supabase inventory, eBay sourcing,
Gemini-assisted description drafts and a guarded Stripe integration.

The business sources watches from eBay after a customer places an order.
The recovery branch is **not ready to accept real orders**. Checkout defaults
to disabled and permits test-mode keys only. Durable test orders, reservations
and signed webhooks are implemented; live sourcing, refunds and pricing are not.

## Current position — 22 November 2026

Use Vercel project **modernvintagewatches**, with production alias
<https://modernvintagewatches.vercel.app>, as the recovery target. GitHub, Vercel
and Supabase CLI access are working. The production API failure was traced to
DNS lookup failure for the paused Supabase project `pvgqqmzuwepgwqudbbki`.
Resuming that project restored database access.

Production retains all **351 inventory rows, 119 logs and one settings row**.
The eight published mock listings were unpublished; all 315 mock rows remain
stored. The 11 remaining published items are watches with real eBay source
references. RLS is enabled on the three existing tables, browser-role access
is revoked, and server access is preserved. Production still runs `b165b844`
from 18 March 2026; **the production order migration has not been applied**.

The isolated recovery preview is <https://mvw-recovery-preview.vercel.app>.
It uses the separate Free Supabase project `aognusoolndwhmcprter`, containing
36 real-source catalogue rows, 11 published. Its first Node 24 build reached
Ready and `/api/health` returned 200 with inventory and order storage connected.
Checkout is disabled and Stripe credentials are not configured. Browser flows,
live webhook delivery and complete test payments have not yet been verified.
The source observations date from 18 March and must be refreshed; a real eBay
URL alone does not establish that a watch is still available.

The duplicate Vercel projects `modernvintagewatches-us88` and
`modernvintagewatches-z9u1` initially returned empty inventory using the old
ephemeral fallback. They are not the recovery target and have not been deleted.

## Development and verification

Use Node 24.x and the existing dependency lockfile:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

The recovery branch pins `engines.node` to `24.x`, matching the local verification
runtime. This overrides the main Vercel project's existing `20.x` setting for
new deployments. Vercel stopped accepting new Node 20 deployments on 1 October
2026; already-deployed Node 20 functions continue to run. See the
[Vercel deprecation notice](https://vercel.com/changelog/node-js-20-is-being-deprecated)
and [runtime version configuration](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Alternatively use `pnpm install --frozen-lockfile`, then the same scripts via
`pnpm run`. Vite alone serves the frontend; it does not execute Vercel `/api`
functions. Use a Vercel preview or the Vercel development runtime for integrated
testing. Tests compile TypeScript into ignored `.test-build/`. They mock external
network boundaries and execute the order migration in PGlite, a local PostgreSQL
engine; they do not contact live Supabase, Stripe or eBay. The SQL tests validate
transactional outcomes and permissions, but do not simulate independent database
connections racing. Lock ordering has also been reviewed.

The recorded local regression run passed 83/83 tests, and the recorded Vite
production build passed. These are separate from deployed browser/payment checks.

Copy `.env.example` to `.env.local` for local configuration. Server credentials
must stay server-side: never prefix them with `VITE_` or commit them. In Vercel,
set the variables separately for the intended environments and redeploy after
changes. Keep previews isolated from production data.

## What the recovery changes

- Re-imports preserve identity, curated copy, publication state and scores.
  Safe source fields refresh without overwriting concurrent editorial edits;
  sold/reserved records and newer observations remain protected. No database
  migration is required for this inventory fix alone.
- Missing persistence/eBay configuration fails closed. Temporary memory and mock
  inventory require explicit local-only opt-ins and are prohibited in production.
- `/api/health` queries required inventory and order tables/columns and the order
  read RPC. A missing order migration returns `ORDER_STORAGE_UNAVAILABLE`.
  Storefront inventory failures
  show an error and retry action instead of pretending the collection is empty.
- Checkout uses database prices, validates unique item IDs and quantities, checks
  publication/source availability, and uses a configured redirect origin. Failed
  checkout does not clear the basket or pretend payment succeeded.
- Orders snapshot the selected items and prices and reserve the whole basket
  atomically. The same checkout key reuses the order and Stripe session on retries.
  Reserved and sold items are excluded from the public catalogue.
- Signed, raw-body Stripe webhooks process test events idempotently. A verified
  paid event records `paid_awaiting_source`; an unpaid expiry releases only that
  order's reservations. Mismatched or late payments require manual review. There
  is no clock-only release that could allow another payment against the same item.
- The return page verifies the linked payment server-side and labels test
  payments clearly. An authenticated Orders screen shows sourcing references and
  review status. No eBay purchase or dispatch occurs automatically.
- AI output becomes a draft for human review. Imports no longer invent quality
  scores. Dashboard counts come from inventory, replacing invented health figures
  and sales charts. Vercel-parsed JSON request bodies are supported.

## Configuration checklist

| Variables | Purpose |
| --- | --- |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Server database access to the intended Supabase project |
| ADMIN_PASSWORD, ADMIN_JWT_SECRET | Admin authentication |
| EBAY_CLIENT_ID, EBAY_CLIENT_SECRET | eBay application OAuth credentials |
| EBAY_ENV, EBAY_MARKETPLACE_ID | Source environment and market (production / EBAY_GB) |
| GEMINI_API_KEY, GEMINI_MODEL | AI draft generation |
| STRIPE_SECRET_KEY | Stripe test credentials for validation |
| STRIPE_WEBHOOK_SECRET | Signing secret for this deployment's test-mode webhook endpoint |
| PUBLIC_SITE_URL | Trusted HTTPS return origin for this deployment |
| CHECKOUT_ENABLED | Test checkout switch; false by default, live keys rejected |
| VITE_API_BASE | Optional frontend API origin; normally empty |

`db/schema.sql` describes the existing inventory schema. `db/inspect.sql` provides
a read-only schema/permission audit. Inspect the actual database and take a backup
before applying a migration. Never run schema setup just to conceal a wrong
project or an unavailable database.

## Isolated preview validation

Database isolation, the preview migration and the initial deployment/health
check are complete. The steps below remain the reproducible validation procedure;
browser, source-refresh and Stripe test-flow checks still need completion.

1. Confirm the intended Vercel project, production branch and Supabase project
   reference without disclosing secret values. Inspect the failing function's
   logs, database availability and environment scopes. Record inventory counts,
   publication states and existing settings before changing anything.
2. Create an isolated test database or restored test copy. For a new empty test
   database, apply `db/schema.sql` first. Against a verified compatible schema,
   apply `db/migrations/20261122_orders.sql`. The migration is transactional and
   also enables RLS on items/settings/logs and revokes browser-role access. The
   server uses its service-role key. Review this change against any other clients
   before applying it to an existing project. Standard Supabase roles are required.
3. Deploy this branch as a preview with test database credentials, admin secrets,
   valid eBay credentials and `CHECKOUT_ENABLED=false`. Set `PUBLIC_SITE_URL` to
   that preview's trusted HTTPS origin. Verify `/api/health` reports both inventory
   and orders connected, `/api/items` loads, and admin-only endpoints reject
   unauthenticated requests. Confirm the webhook route is deployed successfully.
4. In Stripe test mode, register `https://<preview-host>/api/stripe-webhook` for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired` and `checkout.session.async_payment_failed`.
   Configure its `whsec_...` secret and a test API key in the preview environment.
   Redeploy, then enable test checkout in that preview. Stripe must be able to
   reach the endpoint despite any preview access protection.
5. Re-import an already curated item and confirm identity/copy/publication survive.
   Generate and review a draft. Check the storefront's explicit error state and
   retries when the database is unavailable.
6. Exercise a test payment, cancellation, duplicate checkout click, network failure
   after session creation, webhook replay, unpaid expiry and concurrent attempts
   against one item. Check saved totals and reservation ownership in the database.
   The return page must never substitute for webhook delivery. In Stripe, expire
   a test session to exercise the verified expiry path; do not merely delete a
   reservation. Review out-of-order events and the `payment_review` state.

An unresolved session creation or attachment deliberately keeps stock reserved.
Reconcile it with Stripe using the order ID in metadata before taking manual
action. Attempts older than 23 hours without a saved session require review,
because Stripe may eventually discard its idempotency key. A `payment_review`
order may already have been paid: never treat that status as permission to charge
again or release stock. This recovery build has no administrative release/refund
button. It stores minimal payment-event evidence; customer delivery details stay
in Stripe at this stage.

## Remaining launch blockers, in order

1. Refresh and verify the stale March eBay source inventory in the isolated
   preview. Review availability, prices, shipping and descriptions before
   treating the existing catalogue as sellable stock.
2. Complete browser/admin checks and the Stripe test flow against the isolated
   preview as above. The successful build and health response do not establish
   webhook delivery or multi-session database concurrency. Keep checkout disabled
   until the test credentials, endpoint and validation are ready.
3. Complete source-purchase tracking, fulfillment, reconciliation and a
   customer-visible cancellation/refund path. The implemented paid state waits
   for sourcing review. eBay availability checks cannot reserve another seller's
   inventory. Do not automate source purchases without an explicit workflow.
4. Define the retail pricing policy. `price_gbp` is currently the source price;
   configured margins are not applied to the storefront/checkout. Source
   shipping, payment fees and the intended margin need explicit treatment before
   accepting money. No margin was silently invented in this patch.
5. Complete product copy review, navigation/content and end-to-end sales testing.
   Plan the production order migration separately before promoting this recovery
   code. Live checkout remains blocked; no domain migration is part of this work.

Production changes so far are limited to restoring the existing database,
hardening access to its three tables and unpublishing the eight mock listings.
No production order migration, new production deployment or real payment has
been performed.

Historical Stripe sessions created before this patch have no MVW verification
marker and will not be confirmed by the new return page. Check any such payment
directly in Stripe; an unconfirmed screen must not be interpreted as proof that
the customer did not pay.
