# Modern Vintage Watches

React/Vite storefront with Vercel Node APIs, Supabase inventory, eBay sourcing,
Gemini-assisted description drafts and a guarded Stripe integration.

The business sources watches from eBay after a customer places an order.
The recovery branch is **not ready to accept real orders**. Checkout defaults
to disabled and permits test-mode keys only while the order workflow is completed.

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

Use Node 20 or newer and the existing dependency lockfile:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Alternatively use `pnpm install --frozen-lockfile`, then the same scripts via
`pnpm run`. Vite alone serves the frontend; it does not execute Vercel `/api`
functions. Use a Vercel preview or the Vercel development runtime for integrated
testing. Unit tests compile TypeScript into ignored `.test-build/` and mock
external network boundaries; they do not contact live Supabase, Stripe or eBay.

Copy `.env.example` to `.env.local` for local configuration. Server credentials
must stay server-side: never prefix them with `VITE_` or commit them. In Vercel,
set the variables separately for the intended environments and redeploy after
changes. Keep previews isolated from production data.

## What the first recovery patch changes

- Re-imports preserve identity, curated copy, publication state and scores.
  Safe source fields refresh without overwriting concurrent editorial edits;
  sold/reserved records and newer observations remain protected. No database
  migration is required for this inventory fix.
- Missing persistence/eBay configuration fails closed. Temporary memory and mock
  inventory require explicit local-only opt-ins and are prohibited in production.
- `/api/health` queries required tables/columns. Storefront inventory failures
  show an error and retry action instead of pretending the collection is empty.
- Checkout uses database prices, validates unique item IDs and quantities, checks
  publication/source availability, and uses a configured redirect origin. Failed
  checkout does not clear the basket or pretend payment succeeded.
- The return page verifies payment server-side before displaying payment status.
  This is not a replacement for a signed webhook and durable order processing.
- AI output becomes a draft for human review. Imports no longer invent quality
  scores. Vercel-parsed JSON request bodies are supported.

## Configuration checklist

| Variables | Purpose |
| --- | --- |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Server database access to the intended Supabase project |
| ADMIN_PASSWORD, ADMIN_JWT_SECRET | Admin authentication |
| EBAY_CLIENT_ID, EBAY_CLIENT_SECRET | eBay application OAuth credentials |
| EBAY_ENV, EBAY_MARKETPLACE_ID | Source environment and market (production / EBAY_GB) |
| GEMINI_API_KEY, GEMINI_MODEL | AI draft generation |
| STRIPE_SECRET_KEY | Stripe test credentials for validation |
| PUBLIC_SITE_URL | Trusted HTTPS return origin for this deployment |
| CHECKOUT_ENABLED | Test checkout switch; false by default, live keys rejected |
| VITE_API_BASE | Optional frontend API origin; normally empty |

`db/schema.sql` describes the existing inventory schema. Inspect the actual
database and take a backup before applying any SQL. Never run schema setup just
to conceal a wrong project or an unavailable database.

## Remaining launch blockers, in order

1. Confirm the primary project's Supabase reference and environment scopes;
   inspect Vercel function logs, project availability, credentials and actual
   items/settings/logs schema. Restore connectivity and verify row counts and
   saved settings without overwriting inventory.
2. Validate the patch against an isolated preview and test database. Exercise
   a rescan against already curated inventory, draft review, unavailable sources,
   tampered prices and Stripe test-mode failures.
3. Implement durable orders, signed/idempotent Stripe webhook handling, unique
   item reservations and expiry, source-purchase/manual review states, and a
   customer-visible cancellation/refund path. eBay availability checks cannot
   reserve another seller's inventory. Do not automate source purchases without
   an explicit transaction workflow.
4. Define the retail pricing policy. `price_gbp` is currently the source price;
   configured margins are not applied to the storefront/checkout. Source
   shipping, payment fees and the intended margin need explicit treatment before
   accepting money. No margin was silently invented in this patch.
5. Complete product copy review, real dashboard metrics, navigation/content and
   end-to-end sales testing before enabling live checkout or migrating a domain.

Production was not modified during this recovery work. A successful build is
not evidence that production database access or an end-to-end sale works.

Historical Stripe sessions created before this patch have no MVW verification
marker and will not be confirmed by the new return page. Check any such payment
directly in Stripe; an unconfirmed screen must not be interpreted as proof that
the customer did not pay.
