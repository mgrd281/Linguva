# Billing Design

Status: **Implemented and tested locally against a simulated Partner API; not verified on Shopify.** Prices, trial and yearly prices are **decided** ([PRICING_DECISION.md](PRICING_DECISION.md), 2026-10-30, delegated by the owner); the allowances are unchanged. Plans themselves are created in the Partner Dashboard by the owner (PRICING_DECISION.md §9), not in code; until then no merchant is charged.

## 1. How Shopify App Pricing works (VERIFIED, shopify.dev, 2026-10)

- Plans, prices and trials live in the Partner Dashboard. Shopify hosts the plan selection page (`https://admin.shopify.com/store/<store>/charges/<app-handle>/pricing_plans`) and creates the subscription when the merchant approves. The app **never creates charges** (no `appSubscriptionCreate`, no `billing.request`).
- Subscription state comes from the **Partner API** `activeSubscription(appId, shopId)`, which returns `null` without a subscription. It needs a Partner API client with "Manage apps" permission, and the app must be public.
- There are **no billing webhooks**. After a plan is approved, Shopify redirects to the plan's welcome link with `plan_handle`. Changes outside a redirect (cancellation, freeze) must be read from the Partner API.
- **Testing is free:** on development stores of the same Partner organization every plan can be selected at $0, and a $0 private test plan exists.

## 1a. Implementation

| Part | File | State |
|---|---|---|
| Plan handle → entitlements (characters, languages, bulk, glossary, automatic publishing); unknown handles get the free plan | `app/lib/plans.ts` | Implemented, Tested locally |
| List prices for display (`PLAN_PRICES`: Free, $29 / $290, $99 / $990, $299 monthly only), `TRIAL_DAYS`, `TRIAL_AI_CHARS`. A hand-kept copy of the Partner Dashboard, which decides what merchants pay; pinned by `tests/unit/plan-prices.test.ts` | `app/lib/plans.ts`, `app/lib/plan-prices.ts` | Implemented, Tested locally |
| Trial allowance: while the cached `trialEndsAt` is ahead of now, the monthly allowance is at most `TRIAL_AI_CHARS` (100,000); it only ever lowers an allowance. The full allowance applies the moment the trial ends, without a new check. `BillingStatus.trialEndsAt` is set only while the trial runs | `app/.server/billing/subscription.ts` (`statusFrom`) | Implemented, Tested locally |
| Partner API client: errors, timeouts and throttling raise "couldn't check", never "not subscribed"; token only in the header | `app/.server/billing/partner-api.ts` | Implemented, Tested locally |
| Cache `ShopSubscription` (RLS) with a 6-hour TTL; forced refresh after the welcome link; the last known state is kept when the Partner API fails | `app/.server/billing/subscription.ts` | Implemented, Tested locally |
| Redirect to the plan selection page only with a **verified** "no subscription" and `BILLING_REQUIRED=true` | `app/routes/app.tsx` | Implemented |
| Welcome link `/app/welcome` (re-checks; `plan_handle` isn't trusted), Plan page | `app/routes/app.welcome.tsx`, `app.plan.tsx` | Implemented |
| Plan page: the plan and its state, the enforced allowance (also the trial's) and when it renews, the languages the plan covers, the four plans with list prices, "Fits your store" (computed from the store's own use), the full comparison and FAQ. Read-only: every plan button links to Shopify's plan page; "Refresh" forces a check but reuses one from the last 30 seconds (`minAgeMs`) | `app/routes/app.plan.tsx`, `app/.server/billing/plan-page.ts`, `app/components/plan/` | Implemented, Tested locally |
| Enforcement: monthly characters from the plan (editor and worker), languages, bulk jobs (route and worker, checked per item), automatic publishing, glossary editing | editor, list, coverage, settings, glossary, processors | Implemented, Tested locally |
| Billing off (no Partner API settings): unmetered, environment limits | — | Implemented, Tested locally |
| Owner complimentary access (§4): configuration allowlist + operator grant, audit, cost estimate | `app/.server/billing/complimentary.ts`, `scripts/ops/complimentary.ts` | Implemented, Tested locally |
| Usage-based overage via App Events | — | Not at launch (Managed Pricing has no merchant spending cap) |

Testing without charges: locally, every subscription state (none, active plan, trial, pending downgrade, cancellation at period end, unknown plan handle, Partner API errors, throttling, timeouts) is simulated by `tests/support/fake-partner-api.ts` (`tests/unit/billing.test.ts`, `tests/integration/billing.test.ts`). On Shopify, DEV_STORE_TEST_PLAN.md §L walks through the same states on a development store, where every plan costs $0.

Configuration: `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN` (secret), `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`, `BILLING_REQUIRED`. The plan handles in the Partner Dashboard must be `free`, `starter`, `pro`, `business`, or `app/lib/plans.ts` must be changed to match them.

## 2. Plans (decided 2026-10-30, PRICING_DECISION.md; `app/lib/plans.ts` follows this table)

| Plan | Monthly (USD) | Yearly (USD) | Monthly characters | Languages with AI | Features (as the code enforces them) |
|---|---|---|---|---|---|
| FREE | 0 | — | 20,000 | 1 | Translating by hand in every language, AI one item at a time, review and approve, translation memory, SEO fields, image texts and custom fields, quality hints, history and restore, CSV import and export, coverage, markets |
| STARTER | 29 | 290 | 300,000 | 3 | + translating whole areas at once (bulk), automatic translation of new and changed content |
| PRO | 99 | 990 | 1,200,000 | 10 | + glossary editing, optional automatic publishing |
| BUSINESS | 299 | monthly only | 4,000,000 | 20 | + smart schedule (Smart Auto-Translate) |
| ENTERPRISE | private plan | — | negotiated | 20 | + custom limits. Its handle must be mapped in `app/lib/plans.ts` and deployed before the plan is created (unknown handles get Free's limits; PRICING_DECISION.md §9 step 4) |

- Trial: 7 days on Starter, Pro and Business ("Free trial duration" in the Partner Dashboard), with at most 100,000 AI characters while it runs (§1a, trial allowance). Free has no trial. `TRIAL_DAYS` in `app/lib/plans.ts` must equal the Partner Dashboard (0 there means 0 here, and no trial text anywhere).

- Characters = source characters sent to the provider after translation-memory hits, duplicate segments and glossary-only segments are removed (implemented: only `providerChars` is reserved). TM hits are free. That is a selling point and lowers our cost.
- Cost safety (implemented): a daily cap per shop, a platform-wide daily cap on our provider cost, a per-request size cap and request rate limits per staff member and shop (SECURITY_MODEL §5a). Plans will set the per-shop values.
- Overage: not at launch. Managed Pricing has no usage caps, so a merchant couldn't set a spending cap; $40 per extra million would earn 13.3% (PRICING_DECISION.md §6.3). If ever, at least $69 per extra million and only with an in-app cap.
- Yearly: Starter and Pro cost 10 × the monthly price (2 months free); Business is billed monthly only.
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

## 4. Owner complimentary access (implemented, tested locally)

The operator's own stores get every feature without a monthly subscription. No charge is created and none is bypassed: these stores simply don't need a plan. AI usage is still metered and costed internally.

**A store qualifies only when both hold** (`app/.server/billing/complimentary.ts`):

1. **Server configuration:** its Shopify shop GID (`gid://shopify/Shop/<id>`) is listed in `COMPLIMENTARY_SHOP_GIDS` of the app and the worker.
2. **Database grant:** an active `ComplimentaryAccess` row, created by the operator tool with the **owner** database role. The app's runtime role can only read it (under RLS, own shop only); the posture check fails (`RUNTIME_CAN_WRITE_GRANTS`) if it ever gains write access. The row's GID must equal `Shop.shopifyShopGid`, which comes from Shopify (`shop { id }` with the store's own token), never from a request.

Names, domains and e-mail addresses are never used for the decision. Removing the GID from the configuration ends access at the next request; so does revocation or expiry.

| | |
|---|---|
| Entitlements | Every feature (bulk, glossary, automatic publishing, 20 languages); `monthlyCharLimit` of the grant (default 2,000,000) is the cost cap. Daily and platform caps still apply |
| Metering | Every AI character is recorded in `UsageLedger` as for any shop; translation memory reuse stays free |
| Cost | `AI_COST_USD_PER_MILLION_CHARS` (default 25; set **27.5** in production, DeepL API Growth's rate per million, PRICING_DECISION.md §9 step 6) gives an estimate on the Plan page of complimentary stores and in the operator report |
| Audit | Grants and revocations write `AuditLog` entries (`complimentary_access.granted` / `.revoked`, operator, reason, limit, expiry) |

Operator steps:

```bash
# 1. Install the app on your store and open it once (stores the shop GID).
# 2. Grant (owner role; never from the app):
MIGRATION_DATABASE_URL=... pnpm ops:complimentary grant \
  --shop-gid gid://shopify/Shop/123 --reason "Own store" --operator owner \
  [--monthly-chars 2000000] [--expires 2027-12-31]
# 3. Add the GID to COMPLIMENTARY_SHOP_GIDS of the app and worker; restart them.
# Usage and estimated cost per month:
MIGRATION_DATABASE_URL=... COMPLIMENTARY_SHOP_GIDS=... pnpm ops:complimentary report [--period 2026-10]
# Revoke (also remove the GID from the configuration):
MIGRATION_DATABASE_URL=... pnpm ops:complimentary revoke --shop-gid gid://shopify/Shop/123 --reason "Store sold" --operator owner
```

The shop GID is shown in Shopify admin URLs only indirectly; the easiest way to read it is the operator report after the app was opened once, or the `Shop` table.

## 5. Usage metering

- **Reserve** (at job creation, in the same transaction): estimated characters. Rejected if `used + reserved + estimate > limit` (with `FOR UPDATE` locking on a per-shop period row).
- **Commit** per completed batch: actual characters. Idempotency key = item key.
- **Release** the unused remainder when the job ends. A sweeper expires reservations older than 24h.
- **Overage** events are sent to the App Events API with `idempotency_key = ledgerRowId`. A delivery outbox table plus retry guarantees at-least-once sending, and the idempotency key makes that effectively exactly-once.
- Monthly reconciliation compares ledger totals against App Events delivered and Shopify-reported charges, and alerts on drift.

## 6. Lifecycle cases

| Event | Handling |
|---|---|
| Trial | Shopify-managed; we read `trialEndsAt`. While it is ahead, the AI allowance is at most 100,000 characters (`TRIAL_AI_CHARS`); the Plan page shows the end date and both allowances, and the smart budgets say why they can't be higher. Trial days are tracked by Shopify across reinstalls (VERIFIED) |
| Upgrade / downgrade | Shopify prorates. On downgrade, extra languages stay but go read-only; nothing is deleted |
| Cancel / uninstall | Stop jobs and release reservations. Data is retained per DATABASE_SCHEMA §4 |
| Frozen (failed payment) | Read-only mode with a banner |
| Refund / correction | Partner Dashboard credit. The ledger gets an `ADJUST` row with a reason and an audit entry |
