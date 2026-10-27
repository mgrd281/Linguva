# Billing Design

Status: **Implemented and tested locally against a simulated Partner API; not verified on Shopify.** Plan prices and limits are still **proposals** for the owner to decide (see COST_MODEL.md). Plans themselves are created in the Partner Dashboard, not in code.

## 1. How Shopify App Pricing works (VERIFIED, shopify.dev, 2026-10)

- Plans, prices and trials live in the Partner Dashboard. Shopify hosts the plan selection page (`https://admin.shopify.com/store/<store>/charges/<app-handle>/pricing_plans`) and creates the subscription when the merchant approves. The app **never creates charges** (no `appSubscriptionCreate`, no `billing.request`).
- Subscription state comes from the **Partner API** `activeSubscription(appId, shopId)`, which returns `null` without a subscription. It needs a Partner API client with "Manage apps" permission, and the app must be public.
- There are **no billing webhooks**. After a plan is approved, Shopify redirects to the plan's welcome link with `plan_handle`. Changes outside a redirect (cancellation, freeze) must be read from the Partner API.
- **Testing is free:** on development stores of the same Partner organization every plan can be selected at $0, and a $0 private test plan exists.

## 1a. Implementation

| Part | File | State |
|---|---|---|
| Plan handle → entitlements (characters, languages, bulk, glossary, automatic publishing); unknown handles get the free plan | `app/lib/plans.ts` | Implemented, Tested locally |
| Partner API client: errors, timeouts and throttling raise "couldn't check", never "not subscribed"; token only in the header | `app/.server/billing/partner-api.ts` | Implemented, Tested locally |
| Cache `ShopSubscription` (RLS) with a 6-hour TTL; forced refresh after the welcome link; the last known state is kept when the Partner API fails | `app/.server/billing/subscription.ts` | Implemented, Tested locally |
| Redirect to the plan selection page only with a **verified** "no subscription" and `BILLING_REQUIRED=true` | `app/routes/app.tsx` | Implemented |
| Welcome link `/app/welcome` (re-checks; `plan_handle` isn't trusted), Plan page | `app/routes/app.welcome.tsx`, `app.plan.tsx` | Implemented |
| Enforcement: monthly characters from the plan (editor and worker), languages, bulk jobs (route and worker, checked per item), automatic publishing, glossary editing | editor, list, coverage, settings, glossary, processors | Implemented, Tested locally |
| Billing off (no Partner API settings): unmetered, environment limits | — | Implemented, Tested locally |
| Owner complimentary access (§4), usage-based overage via App Events | — | Planned |

Testing without charges: locally, every subscription state (none, active plan, trial, pending downgrade, cancellation at period end, unknown plan handle, Partner API errors, throttling, timeouts) is simulated by `tests/support/fake-partner-api.ts` (`tests/unit/billing.test.ts`, `tests/integration/billing.test.ts`). On Shopify, DEV_STORE_TEST_PLAN.md §L walks through the same states on a development store, where every plan costs $0.

Configuration: `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN` (secret), `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`, `BILLING_REQUIRED`. The plan handles in the Partner Dashboard must be `free`, `starter`, `pro`, `business`, or `app/lib/plans.ts` must be changed to match them.

## 2. Plans (proposed; the values in `app/lib/plans.ts` follow this table)

| Plan | Price (USD/mo) | Monthly characters | Languages | Features |
|---|---|---|---|---|
| FREE | 0 | 20,000 | 1 target | Manual editor, AI on demand, basic coverage |
| STARTER | 19 | 300,000 | 3 | + bulk translate, basic SEO fields |
| PRO | 59 | 1,200,000 | 10 | + translation memory, glossary, automation, advanced SEO |
| BUSINESS | 179 | 4,000,000 | 20 | + premium AI routing, analytics, priority queue |
| ENTERPRISE | private plan | negotiated | 20 | + custom limits, support SLA |

- Characters = source characters sent to the provider after translation-memory hits, duplicate segments and glossary-only segments are removed (implemented: only `providerChars` is reserved). TM hits are free. That is a selling point and lowers our cost.
- Cost safety (implemented): a daily cap per shop, a platform-wide daily cap on our provider cost, a per-request size cap and request rate limits per staff member and shop (SECURITY_MODEL §5a). Plans will set the per-shop values.
- Overage (PRO and above, opt-in, with a merchant-set cap): usage-based meter via the App Events API, proposed at $40 per additional 1M characters.
- Yearly option ≈ 2 months free.
- Up to 8 public plans are allowed (VERIFIED). We use 4 public plans plus private plans.

## 3. Entitlement resolution (server-side only)

```
effective = resolve(shopId):
  owner   = Entitlement where kind=OWNER_COMPLIMENTARY, not revoked, valid now
  sub     = Subscription (fresh ≤ 6h, else reconcile synchronously)
  if owner → owner.features, limit = owner.monthlyCharLimit, costCap = owner.costCapMicros
  elif sub.status in (ACTIVE, TRIAL) → plan features
  elif sub.status == FROZEN → read-only (view/edit existing, no AI, no publish of new AI output)
  else → FREE
```

## 4. Owner (KARINEX) complimentary access

1. In the Partner Dashboard, create a **free private plan** ("Owner") targeted at the explicit `*.myshopify.com` domains of the owner's stores. Private plans are restricted to the stores you select (VERIFIED). This keeps billing inside Shopify's rules: no bypass.
2. In the admin center, an OWNER admin creates `Entitlement(kind=OWNER_COMPLIMENTARY)` for the matching `Shop.id`, with a reason. Re-auth and MFA are required. An AuditLog entry is written.
3. Both must be true for unlimited features. A private plan alone gives plan-level limits. An Entitlement without the plan isn't honoured unless the shop is a dev store.
4. AI usage is **still metered** in `UsageLedger` and `ProviderUsage`, with a configurable monthly cost cap and alert.
5. Revocation: set `revokedAt` (audited) and remove the store from the private plan.
6. Nothing keys off a name or email address.

## 5. Usage metering

- **Reserve** (at job creation, in the same transaction): estimated characters. Rejected if `used + reserved + estimate > limit` (with `FOR UPDATE` locking on a per-shop period row).
- **Commit** per completed batch: actual characters. Idempotency key = item key.
- **Release** the unused remainder when the job ends. A sweeper expires reservations older than 24h.
- **Overage** events are sent to the App Events API with `idempotency_key = ledgerRowId`. A delivery outbox table plus retry guarantees at-least-once sending, and the idempotency key makes that effectively exactly-once.
- Monthly reconciliation compares ledger totals against App Events delivered and Shopify-reported charges, and alerts on drift.

## 6. Lifecycle cases

| Event | Handling |
|---|---|
| Trial | Shopify-managed. We read `TRIAL` status. Trial days are tracked by Shopify across reinstalls (VERIFIED) |
| Upgrade / downgrade | Shopify prorates. On downgrade, extra languages stay but go read-only; nothing is deleted |
| Cancel / uninstall | Stop jobs and release reservations. Data is retained per DATABASE_SCHEMA §4 |
| Frozen (failed payment) | Read-only mode with a banner |
| Refund / correction | Partner Dashboard credit. The ledger gets an `ADJUST` row with a reason and an audit entry |
