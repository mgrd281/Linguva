# Database Schema

Status: implemented tables are defined in `prisma/schema.prisma` (Session, Shop, ShopInstallation, ShopSettings, ShopLocale, WebhookEvent, AuditLog, PrivacyRequest, TranslationRevision, UsageLedger, TranslationJob, TranslationJobItem, TranslationMemory, Glossary, GlossaryTerm, TranslationDraft, CoverageReport, CoverageStat, CoverageGap, CoverageTitleHash), all tenant tables under fail-closed RLS, plus the non-tenant `PlatformUsageDay` (a date and a character count, for the platform cost cap). The Own key plan adds `ShopEngineCredential` (a store's own engine keys, encrypted) and `UsageLedger.payer` (migration `20261106090000`, SECURITY_MODEL §5r). Coverage tables hold only counts, resource ids and hashes. Entities below that are not in the schema yet (Subscription, Entitlement, ProviderUsage, AdminUser, FeatureFlag, ShopMarket) are still proposals.

## 1. Conventions

- PostgreSQL 16. IDs are `uuid` (generated with `gen_random_uuid()`), except `ShopSession.id`, which follows the Shopify session storage contract.
- **Every tenant-owned table has `shopId uuid NOT NULL` → `Shop.id`, `ON DELETE CASCADE`**, and an index that starts with `shopId`.
- Unique constraints on tenant data always include `shopId` (for example `@@unique([shopId, gid, locale, marketId, key])`).
- Timestamps: `createdAt`, `updatedAt` (`timestamptz`). Use soft delete (`deletedAt`) only where history must survive.
- Pagination is keyset (`WHERE (shopId, createdAt, id) > (...)`), never `OFFSET` on large tables.
- Money is stored as integer micro-units (`bigint`) plus a currency code. Usage is stored as integer characters.
- Private merchant text (source and translations) lives only in `TranslationEntry`, `TranslationRevision`, `TranslationMemory`, and `GlossaryTerm`. Logs never contain it.

## 2. Entities

### Tenancy and installation

| Model | Key fields | Constraints / notes |
|---|---|---|
| **Shop** | id, shopifyShopGid, myshopifyDomain, primaryLocale, planName, status (ACTIVE/UNINSTALLED/REDACTED), installedAt, uninstalledAt, redactAfter | `myshopifyDomain` unique, `shopifyShopGid` unique. **Not** under RLS (it is the tenant root). Read only through the tenancy service |
| **ShopSession** | id, shop, state, isOnline, scope, expires, accessTokenEnc, refreshTokenEnc, refreshTokenExpires, userId … | Mapped to the table required by `@shopify/shopify-app-session-storage-prisma`. Tokens are **encrypted** (ADR-006). Linked to Shop by domain |
| **ShopInstallation** | id, shopId, event (INSTALLED/UNINSTALLED/REINSTALLED/SCOPES_UPDATED), scopes, occurredAt, webhookEventId | Append-only history |
| **ShopSettings** | shopId (PK), sourceLocale, defaultProviderPolicy, autoTranslateNew, protectManualEdits, reviewRequired, aiDataProcessingConsentAt, consentVersion | 1:1 with Shop |
| **ShopLocale** | id, shopId, locale, enabled, published, isPrimary, syncedAt | unique(shopId, locale). Mirror of Shopify `shopLocales`. Shopify stays authoritative |
| **ShopMarket** | id, shopId, marketGid, name, locales[], webPresence, syncedAt | unique(shopId, marketGid) |

### Billing and entitlement

| Model | Key fields | Constraints / notes |
|---|---|---|
| **Subscription** | id, shopId, source (APP_PRICING/MANUAL/NONE), planHandle, status (ACTIVE/PENDING/CANCELLED/FROZEN/TRIAL), trialEndsAt, currentPeriodStart/End, lastReconciledAt, rawSnapshot jsonb | Local **cache** of Partner API `activeSubscription`. Never the sole authority |
| **ComplimentaryAccess** (implemented) | shopId (PK), shopifyShopGid, reason, grantedBy, monthlyCharLimit, grantedAt, expiresAt, revokedAt, revokedBy, revokeReason | Owner complimentary access (BILLING_DESIGN §4). RLS + FORCE; runtime role SELECT only, written by the operator tool with the owner role; CHECK constraints on the GID format and the limit |
| **ShopSubscription** (implemented) | shopId (PK), state, planHandle, pendingPlanHandle, trialEndsAt, cancelAtEndOfCycle, currentPeriodEnd, checkedAt | Cache of the Partner API `activeSubscription` (6 h TTL) |
| **ShopEngineCredential** (implemented) | id, shopId, engine (deepl/azure/google), secret, hint, dataLocation (eu/global), region (Azure), deeplPlan (free/pro, DeepL), status (OK/QUOTA/REFUSED/UNREADABLE/RECHECK), keyVersion, verifiedAt, lastErrorCode, lastErrorAt | The Own key plan's own engine keys, one row per shop and engine (unique(shopId, engine)). `secret` is a TokenCipher envelope bound by AAD to shop, engine, data location and region (CHECK: envelope format only, never plaintext); `hint` is exactly the key's last four characters (CHECK). `keyVersion` (+1 on every save or replace) guards every write about a used or checked key. RLS + FORCE; runtime role SELECT, INSERT, UPDATE, DELETE. CHECK constraints on every code column (SECURITY_MODEL §5r) |
| **Entitlement** (planned) | id, shopId, kind (PLAN/ENTERPRISE_CONTRACT), features jsonb, monthlyCharLimit, validFrom, validUntil, revokedAt, reason | For negotiated enterprise contracts |
| **UsageLedger** | id, shopId, periodKey (YYYY-MM), kind (RESERVE/COMMIT/RELEASE/ADJUST/REFUND), chars, costMicros, provider, jobId, idempotencyKey, origin, payer, createdAt | **Append-only.** unique(shopId, idempotencyKey). Balance = SUM per period. `payer`: NULL = Linguva's engines, `merchant` = the Own key plan's own keys (CHECK: never with `origin`). Allowance, daily cap and cost sums count only `payer IS NULL`; merchant rows never touch `PlatformUsageDay` |
| **UsageReservation** | id, shopId, jobId, reservedChars, committedChars, status (OPEN/COMMITTED/RELEASED/EXPIRED), expiresAt | unique(shopId, jobId). An expiry sweeper releases stale reservations |
| **ProviderUsage** | id, shopId, provider, model, requestId, chars, inputTokens, outputTokens, costMicros, latencyMs, outcome | Feeds the cost/margin dashboards. No text content |

### Translation

| Model | Key fields | Constraints / notes |
|---|---|---|
| **TranslationResource** | id, shopId, resourceGid, resourceType, title (display only), sourceUpdatedAt, lastDiscoveredAt | unique(shopId, resourceGid) |
| **TranslationEntry** | id, shopId, resourceId, key, locale, marketGid (nullable), sourceDigest, sourceValueHash, value, status (MISSING/QUEUED/DRAFT/APPROVED/PUBLISHED/STALE/FAILED), origin (AI/MANUAL/MEMORY/IMPORT), isManuallyLocked, provider, qualityFlags jsonb, publishedAt | unique(shopId, resourceId, key, locale, marketGid) (with `NULLS NOT DISTINCT`). Index (shopId, status, locale) |
| **TranslationRevision** | id, shopId, entryId, value, sourceDigest, origin, actor (USER/SYSTEM), createdAt | Append-only history. Supports rollback to a prior value (re-registered with the current digest) |
| **TranslationJob** | id, shopId, kind (BULK/SELECTED/AUTO/RECONCILE/PUBLISH), status (PENDING/RUNNING/PAUSED/COMPLETED/FAILED/CANCELLED), targetLocales[], filters jsonb, totals jsonb, requestedBy, idempotencyKey, startedAt, finishedAt | unique(shopId, idempotencyKey). Index (shopId, status, createdAt) |
| **TranslationJobItem** | id, shopId, jobId, entryId, attempt, status, errorClass, errorCode, nextRunAt | Index (jobId, status). Errors are stored as codes, never with text |
| **TranslationMemory** | id, shopId, sourceLocale, targetLocale, marketGid, sourceHash, sourceNormalized, target, approved, useCount, lastUsedAt | unique(shopId, sourceLocale, targetLocale, marketGid, sourceHash). Fuzzy match via `pg_trgm` GIN index on `sourceNormalized` (**per-shop** filter first) |
| **Glossary** | id, shopId, name, sourceLocale, isDefault | |
| **GlossaryTerm** | id, shopId, glossaryId, term, caseSensitive, rule (PROTECT/PREFERRED/FORBIDDEN), translations jsonb {locale: value}, marketGid, notes | unique(shopId, glossaryId, term, marketGid) |

### Platform

| Model | Key fields | Constraints / notes |
|---|---|---|
| **ProviderConfiguration** | id, provider, enabled, modelId, routingWeight, pricePer1MCharsMicros, regions, dpaStatus | Global (not tenant). Admin-managed. API keys are **not stored here**; they come from env/secret manager |
| **WebhookEvent** | id, shopId (nullable until resolved), topic, webhookId (`X-Shopify-Webhook-Id`), triggeredAt, receivedAt, processedAt, status, payloadHash | unique(webhookId) for duplicate suppression. The raw payload is kept only if needed and expires after N days |
| **AuditLog** | id, shopId (nullable), actorType (MERCHANT_USER/ADMIN/SYSTEM), actorId, action, targetType, targetId, metadata jsonb, ip, createdAt | Insert-only for the app role (no `SELECT`, `UPDATE` or `DELETE`): it holds entries of every shop and isn't under RLS |
| **PrivacyRequest** | id, shopId, topic, shopifyRequestId, receivedAt, dueAt (+30d), completedAt, status, notes | Tracks compliance webhook obligations |
| **AdminUser** | id, email, role (OWNER/SUPPORT/FINANCE/READONLY), mfaSecretEnc, mfaEnabledAt, lastLoginAt, disabledAt | Separate admin app only |
| **FeatureFlag** | key, description, defaultOn, rules jsonb (shop allow-list by Shop.id) | Global |

## 3. Row-level security (defense in depth)

Exception: `TranslationMemory` has RLS enabled but not forced, so that the owner-defined `linguva_memory_fuzzy()` function can use the shop + trigram GIN index (see SECURITY_MODEL §5c). The runtime role is subject to RLS on every table.


```sql
ALTER TABLE "TranslationEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TranslationEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TranslationEntry"
  USING ("shopId" = current_setting('app.shop_id', true)::uuid)
  WITH CHECK ("shopId" = current_setting('app.shop_id', true)::uuid);
```

- The app connects as role `linguva_app` (no `BYPASSRLS`, not the table owner). Migrations run as `linguva_migrator`.
- `withTenant(shopId, fn)` opens an interactive Prisma transaction and runs `SELECT set_config('app.shop_id', $1, true)` before `fn`. The setting is transaction-local, so pooled connections can't leak a tenant.
- With no tenant set, `current_setting` returns NULL and the policy matches **zero rows** (fail closed).
- Cross-tenant jobs (sweepers, reconciliation) iterate shops and enter `withTenant` per shop. They never use a bypass role.
- **Risk:** RLS + Prisma requires every tenant query to run inside `withTenant`. There is no lint rule: RLS fails closed (outside `withTenant` a query returns nothing and a write fails), and the integration and security suites run as the runtime role with RLS enforced. Pooler mode (PgBouncer transaction mode) is compatible because the setting is transaction-local.

## 4. Retention and deletion

| Data | Retention | Trigger |
|---|---|---|
| Sessions / tokens | Deleted on `app/uninstalled` | webhook |
| Own engine keys (`ShopEngineCredential`, Own key plan) | Deleted on `app/uninstalled` (also a replayed one) and on reinstall; shop/redact cascades; removed or replaced by the merchant at any time | webhook, Settings |
| Translations, memory, glossary, jobs | Kept 30 days after uninstall (allows reinstall), then hard-deleted | `shop/redact` (Shopify sends it ~48h after uninstall — **ASSUMPTION, verify**) or 30-day sweeper, whichever comes first |
| UsageLedger, Subscription, billing-relevant AuditLog | Retained for legal/tax periods (German HGB/AO up to 10 years — **legal review required**) with shop content removed | — |
| WebhookEvent payloads | 14 days | sweeper |
| ProviderUsage | 13 months, aggregated afterwards | sweeper |

Backups: managed PostgreSQL daily snapshots plus PITR in production. A restore drill is mandatory before launch (Definition of Done #12).

After any restore, before the app serves traffic, run this with the owner role (`MIGRATION_DATABASE_URL`). Backups keep encrypted copies of own engine keys (Own key plan) that were removed, replaced or uninstalled after the restore point; the block deletes the keys of every shop that isn't active and marks the rest RECHECK, which isn't used until the merchant's "Check again" succeeds, so a key removed or replaced after the restore point is never used again unnoticed. `ShopEngineCredential` is under FORCE row-level security, which binds the owner role too, so the block enters each shop's tenant (a plain `DELETE`/`UPDATE` without `app.shop_id` changes nothing). `tests/security/engine-credentials-security.test.ts` runs this exact block.

<!-- restore-runbook:start -->
```sql
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT "id", "status" FROM "Shop" LOOP
    PERFORM set_config('app.shop_id', s."id"::text, true);
    IF s."status" <> 'ACTIVE' THEN
      DELETE FROM "ShopEngineCredential" WHERE "shopId" = s."id";
    ELSE
      UPDATE "ShopEngineCredential" SET "status" = 'RECHECK', "lastErrorCode" = 'OWN_KEY_RECHECK', "lastErrorAt" = now()
      WHERE "shopId" = s."id";
    END IF;
  END LOOP;
  PERFORM set_config('app.shop_id', '', true);
END
$$;
```
<!-- restore-runbook:end -->
