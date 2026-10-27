# Billing Design

Status: **Phase 0 — proposal.** Plan prices and limits are **assumptions** for discussion. They require owner approval and cost validation (see COST_MODEL.md).

## 1. Authority

- **Shopify App Pricing is authoritative** for subscription state (VERIFIED as the default for new public apps).
- Our `Subscription` table is a cache, refreshed (a) after the plan-selection welcome redirect, (b) on `app_subscriptions/update` webhook (ASSUMPTION — confirm the topic still fires under App Pricing), and (c) by a reconciliation job every 6h through Partner API `activeSubscription`.
- If the cache and Shopify disagree, Shopify wins, and the mismatch raises an alert.

## 2. Plans (proposed)

| Plan | Price (USD/mo) | Monthly characters | Languages | Features |
|---|---|---|---|---|
| FREE | 0 | 20,000 | 1 target | Manual editor, AI on demand, basic coverage |
| STARTER | 19 | 300,000 | 3 | + bulk translate, basic SEO fields |
| PRO | 59 | 1,200,000 | 10 | + translation memory, glossary, automation, advanced SEO |
| BUSINESS | 179 | 4,000,000 | 20 | + premium AI routing, analytics, priority queue |
| ENTERPRISE | private plan | negotiated | 20 | + custom limits, support SLA |

- Characters = source characters sent to the provider after translation-memory hits, duplicate segments and glossary-only segments are removed (implemented: only `providerChars` is reserved). TM hits are free. That is a selling point and lowers our cost.
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
