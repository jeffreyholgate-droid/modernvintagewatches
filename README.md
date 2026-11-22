# Modern Vintage Watches

React/Vite storefront with Vercel Node APIs, Supabase inventory, eBay sourcing,
Gemini-assisted description drafts and a guarded Stripe integration.

The business sources watches from eBay after a customer places an order.
The recovery branch is **not ready to accept real orders**. Checkout defaults
to disabled and permits test-mode keys only. Durable test orders, reservations
and signed webhooks are implemented; live sourcing, refunds and pricing are not.

## Recovery baseline — 22 November 2026

Use Vercel project **modernvintagewatches**, with production alias
<https://modernvintagewatches.vercel.app>, as the recovery target.
All three existing Vercel projects reported deployments of `b165b844` (18 March
2026). Public checks found:

| Project | Existing `/api/health` | Existing `/api/items` |
| --- | --- | --- |
| modernvintagewatches | 200, persistent=true | 500 FUNCTION_INVOCATION_FAILED |
| modernvintagewatches-us88 | 200, persistent=false | 200, empty items |
| modernvintagewatches-z9u1 | 200, persistent=false | 200, empty items |

The main project is the only one that reports Supabase configuration. The two
copies use the old ephemeral fallback; their empty results are not evidence of
a working inventory database. The old health check only checked credential
presence. This patch replaces it with actual schema/connectivity reads.

Private Vercel configuration, Supabase project status, database contents and
the underlying production error have not yet been inspected. Do not delete the
duplicate projects or conclude that inventory has been lost. Historical
deployment bookmarks can expire; use the stable alias above.

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

1. Confirm the primary project's Supabase reference and environment scopes;
   inspect Vercel function logs, project availability, credentials and actual
   items/settings/logs schema. Restore connectivity and verify row counts and
   saved settings without overwriting inventory.
2. Validate the migration and complete flow against an isolated preview and test
   database as above. Local tests do not establish a working deployment, webhook
   delivery, or multi-session database concurrency.
3. Complete source-purchase tracking, fulfillment, reconciliation and a
   customer-visible cancellation/refund path. The implemented paid state waits
   for sourcing review. eBay availability checks cannot reserve another seller's
   inventory. Do not automate source purchases without an explicit workflow.
4. Define the retail pricing policy. `price_gbp` is currently the source price;
   configured margins are not applied to the storefront/checkout. Source
   shipping, payment fees and the intended margin need explicit treatment before
   accepting money. No margin was silently invented in this patch.
5. Complete product copy review, navigation/content and
   end-to-end sales testing before enabling live checkout or migrating a domain.

Production was not modified during this recovery work. A successful build is
not evidence that production database access or an end-to-end sale works.

Historical Stripe sessions created before this patch have no MVW verification
marker and will not be confirmed by the new return page. Check any such payment
directly in Stripe; an unconfirmed screen must not be interpreted as proof that
the customer did not pay.
