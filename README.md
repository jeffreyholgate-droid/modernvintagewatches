# Modern Vintage Watches

React/Vite storefront with Vercel Node APIs, Supabase inventory, eBay sourcing,
OpenAI-assisted description drafts and a guarded Stripe integration.

The business sources watches from eBay after a customer places an order.
The recovery branch is **not ready to accept real orders**. Checkout defaults
to disabled and permits test-mode keys only. Durable test orders, reservations
and signed webhooks are implemented. The preview includes retail pricing, manual sourcing and dispatch records, and Stripe Sandbox refund reconciliation. See [MVW launch handoff](MVW-LAUNCH.md) for the review procedure and remaining commercial requirements.

## Current position — 22 November 2026

Use Vercel project **modernvintagewatches**, with production alias
<https://modernvintagewatches.vercel.app>, as the recovery target. GitHub, Vercel
and Supabase CLI access are working. The production API failure was traced to
DNS lookup failure for the paused Supabase project `pvgqqmzuwepgwqudbbki`.
Resuming that project restored database access.

Production retains all **351 original inventory rows, 119 original logs and its settings**.
All 36 old real-source offers were confirmed ended, including the 11 that had
been published. They were withdrawn without deleting their records or curation.
Forty current offers passed individual eBay availability, price, shipping and
seller checks and were imported unpublished, bringing production to 391 rows.
Eight were published after a listing/image review and another source check;
the other 32 remain drafts. Scores remain zero: source availability and image
review do not establish physical condition or authenticity. All 315 mock rows
remain unpublished. RLS is enabled on the three existing tables, browser-role access
is revoked, and server access is preserved. Production still runs `b165b844`
from 18 March 2026; **the production order migration has not been applied**.

The isolated recovery preview is <https://mvw-recovery-preview.vercel.app>.
It uses the separate Free Supabase project `aognusoolndwhmcprter`, containing
76 real-source catalogue rows after the same refresh. Its Node 24 functions
connect to inventory and order storage; storefront and admin checks passed.
Stripe sandbox credentials and a test snapshot webhook are configured only for
this preview branch. Signature, timestamp and direct callback-routing checks
passed before enabling test checkout. Real keys/events remain rejected in code.
Sandbox payments consume only preview reservations and never buy from eBay.
Hosted sandbox payment, actual signed completion/expiry events and replay checks
passed. The paid test item remains sold only in preview. The validation procedure
below covers further material changes; a healthy endpoint alone is not proof
that a payment and its signed event were processed.

The duplicate Vercel projects `modernvintagewatches-us88` and
`modernvintagewatches-z9u1` initially returned empty inventory using the old
ephemeral fallback. They are not the recovery target and have not been deleted.

## Development and verification

Use Node 24.x and the existing dependency lockfile:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

The recovery branch pins `engines.node` to `24.x`, matching the local verification
runtime. This overrides the main Vercel project's existing `20.x` setting for
new deployments. Vercel stopped accepting new Node 20 deployments on 1 October
2026; already-deployed Node 20 functions continue to run. See the
[Vercel deprecation notice](https://vercel.com/changelog/node-js-20-is-being-deprecated)
and [runtime version configuration](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Vite alone serves the frontend; it does not execute Vercel `/api`
functions. Use a Vercel preview or the Vercel development runtime for integrated
testing. Tests compile TypeScript into ignored `.test-build/`. They mock external
network boundaries and execute the order migration in PGlite, a local PostgreSQL
engine; they do not contact live Supabase, Stripe or eBay. The SQL tests validate
transactional outcomes and permissions, but do not simulate independent database
connections racing. Lock ordering has also been reviewed.

Run the regression suite and production build after changes. These are separate
from deployed browser/payment checks; retain the resulting evidence for each deployment.

Copy `.env.example` to `.env.local` for local configuration. Server credentials
must stay server-side: never prefix them with `VITE_` or commit them. In Vercel,
set the variables separately for the intended environments and redeploy after
changes. Keep previews isolated from production data.

## What the recovery changes

- Re-imports preserve identity, curated copy, publication state and scores.
  Safe source fields refresh without overwriting concurrent editorial edits;
  sold/reserved records and newer observations remain protected. No database
  migration is required for this inventory fix alone.
- Refresh checks every active stored source ID as well as the latest search
  candidates. Confirmed ended offers are withdrawn; active offers outside policy
  require review, and uncertain source responses do not masquerade as expiry.
  New offers stay unpublished. Manual listing review is available without AI.
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
| OPENAI_API_KEY, OPENAI_TEXT_MODEL, OPENAI_STUDIO_ANALYSIS_MODEL, OPENAI_STUDIO_SCENE_MODEL | AI drafts and studio preparation (server only) |
| STRIPE_SECRET_KEY | Stripe test credentials for validation |
| STRIPE_WEBHOOK_SECRET | Signing secret for this deployment's test-mode webhook endpoint |
| PUBLIC_SITE_URL | Trusted HTTPS return origin for this deployment |
| CHECKOUT_ENABLED | Test checkout switch; false by default, live keys rejected |
| VITE_API_BASE | Optional frontend API origin; normally empty |

`db/schema.sql` describes the existing inventory schema. `db/inspect.sql` provides
a read-only schema/permission audit. Inspect the actual database and take a backup
before applying a migration. Never run schema setup just to conceal a wrong
project or an unavailable database.

## Preview pricing and UK delivery

MVW confirmed that it is **not VAT registered**. The supported preview policy is
`mvw-pricing-v1`: a **20% gross margin**, equivalent to 25% markup on the cost
basis, with UK delivery included. It is a starting commercial recommendation,
not a claim that every eBay retail listing is competitive at the resulting price.

For each watch, in integer pence:

```
cost basis = source watch price + source postage + delivery allowance
retail = round up to the next £5 (cost basis / (1 - gross margin))
estimated card fee = round up (retail × 3.5%) + £0.20
estimated contribution = retail - cost basis - estimated card fee
```

The initial delivery/packing allowance is **£50 per watch**, retained for each
line of a multi-watch basket. Source postage is the inbound procurement cost;
it is distinct from delivery to the customer. Customers see one retail price
and UK delivery included, with no extra checkout delivery or card surcharge.
The fee estimate is a conservative planning allowance, not a tax or provider
quote. The 20p estimate is allocated per watch, conservatively overestimating
the fixed fee for a multi-watch payment. Estimated contribution is before
overheads, sourcing work, returns, repairs and tax; it is not net profit.

Example: Tudor source £2,709.70 + source postage £15.95 + allowance £50 gives
£3,470 retail, £694.35 gross profit and £572.70 estimated contribution after
the £121.65 card-fee allowance. At this price the customer pays no extra shipping.

Admin settings control the gross margin and allowances; invalid values fail
closed. Source prices are never overwritten. Public prices and checkout use
the same calculation. New orders atomically preserve the cost and policy
breakdown; changes to inventory/settings do not reprice historical orders or
their Stripe sessions. A stale displayed amount must be reviewed before a new
payment. Historical lines without pricing snapshots remain explicitly legacy.

The allowance does **not** constitute an insured-carriage booking. Royal Mail
Special Delivery has up to £2,500 goods compensation; its £10,000 option is
consequential-loss cover, not increased cover for the watch. Higher-value
contents require a confirmed specialist arrangement, considering the full
parcel value. Confirm actual cost, coverage, packing and dispatch timing in the
sourcing workflow before taking real orders. No next-day-from-order promise
is made. UK-only checkout is enforced by Stripe's GB shipping-country restriction.

Sources checked 22 November 2026:
- [Stripe UK pricing](https://stripe.com/gb/pricing): standard UK cards 1.5% + 20p;
  premium UK 2.8% + 20p; international cards 3.15% + 20p, with additional conversion fees where applicable.
- [Royal Mail service and cover](https://www.royalmail.com/sending/uk/special-delivery-guaranteed-1pm)
  and [October 2026 tariff](https://www.royalmail.com/sites/royalmail.com/files/2026-10/online-price-guide-october-2026-v1.pdf).
- [Parcel Pro UK specialist quote](https://www.parcelpro.com/gb/en/insured-shipping/get-a-quote.html).

## Isolated preview validation

Database isolation, the preview migration, browser/admin checks, source refresh
and webhook-routing checks are complete. The steps below are the reproducible
validation procedure for further deployments and complete Stripe test payments.

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
   Then apply `db/migrations/20261122_retail_pricing.sql`. Preserve an encrypted
   backup first. Save the full pricing settings on the `default` settings row:
   20% category margins, £50 delivery allowance, 350 basis-point fee allowance,
   20p fixed fee allowance, 500p rounding and `NOT_REGISTERED` VAT status. This
   migration adds nullable pricing snapshots and replaces reservation calculation;
   existing orders, amounts and Stripe parameters must remain unchanged. Apply
   this only to the intended isolated preview before deploying the pricing code.
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
   reach the endpoint despite any preview access protection. For protected Vercel
   previews, Stripe's private endpoint URL can include an automation-bypass token;
   never put that credential in source control, public return URLs or client code.
   Keep the Vercel protection setting and the application's signature check enabled.
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

1. Keep source availability and prices current and complete physical-condition,
   authenticity and accessory checks before promising fulfillment. The November
   source refresh and listing/image review are not physical authentication.
2. Exercise the isolated Stripe test flow above after material payment changes.
   A successful build or health response does not establish webhook delivery or
   concurrent checkout behavior. Never substitute the return page for signed events.
3. Complete source-purchase tracking, fulfillment, reconciliation and a
   customer-visible cancellation/refund path. The implemented paid state waits
   for sourcing review. eBay availability checks cannot reserve another seller's
   inventory. Do not automate source purchases without an explicit workflow.
4. Review market competitiveness of the preview prices and obtain actual insured
   delivery quotes. `price_gbp` remains the source price; retail uses the policy
   above. Revisit tax treatment if VAT registration changes; no VAT margin-scheme
   or standard-VAT accounting is implemented or claimed.
5. Complete product copy review, navigation/content and end-to-end sales testing.
   Plan the production order migration separately before promoting this recovery
   code. Live checkout remains blocked; no domain migration is part of this work.

Production changes so far are limited to restoring and hardening the database,
withdrawing mock/ended listings, and importing/reviewing fresh source inventory.
No production order migration, new production deployment or real payment has
been performed.

Historical Stripe sessions created before this patch have no MVW verification
marker and will not be confirmed by the new return page. Check any such payment
directly in Stripe; an unconfirmed screen must not be interpreted as proof that
the customer did not pay.
