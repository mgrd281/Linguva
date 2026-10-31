# Security Model

Status: the controls below are implemented and tested where a test is named (`tests/security/`, `tests/integration/`, `tests/unit/`), unless marked **planned**. The admin control center (§6) is planned only.

## 1. Trust boundaries

| Boundary | Trusted? | Verification |
|---|---|---|
| Browser (embedded iframe) | **No** | Shopify ID token (JWT, HS256 with app secret) validated server-side by `authenticate.admin` |
| Shopify webhooks | Only after HMAC | `authenticate.webhook` (HMAC-SHA256 over the raw body). Invalid → 401 |
| Shopify Admin API responses | Yes (TLS) | — |
| AI provider responses | **No** | Treated as untrusted text: sanitized and validated before storage or publication |
| Operators | Yes (owner database role) | Command-line tools (`pnpm ops:complimentary`, `pnpm preflight`) run on the operator's machine with `MIGRATION_DATABASE_URL`; no admin UI (planned, §6) |
| Workers | Yes, but re-authorize | Re-check Shop status + entitlement from the DB on every job |

Every loader and action of an app or webhook route authenticates itself, through `requireShop`, `webhookAction` (the HMAC check) or a reviewed delegate that calls `requireShop`: React Router runs a child route's action without its parent's loader, so the layout's check never covers an action. `tests/security/structure.test.ts` parses each route module with the TypeScript compiler and requires the call in each exported loader and action itself (not elsewhere in the file, not in a nested function, imported from where it is defined); only the reviewed public routes (landing page, login form, health checks) are exempt.

## 2. Multi-tenant controls

1. **Shop resolution:** `shopId` comes only from `session.shop` (verified token) → `Shop.shopDomain` lookup. Request params never select a tenant.
2. **Scoped queries:** tenant data is read and written inside `withTenant(shopId, fn)` (`app/.server/tenancy/with-tenant.ts`): one transaction with `app.shop_id` set transaction-locally, refusing anything but a UUID. There is no lint rule; row-level security is the enforcement: a query outside `withTenant` has no tenant and returns nothing, and a write fails (`tests/integration/rls.test.ts`, run as the runtime role).
3. **RLS:** fail-closed policies (see DATABASE_SCHEMA.md §3).
4. **Object references:** every ID from the client (job, draft, revision) is looked up with `WHERE id = $1 AND shopId = <verified shop>`, under RLS. Another shop's id finds nothing: a page answers 404 (never 403, so existence doesn't leak), an action leaves it alone.
5. **Caches/queues:** per-shop Redis keys (rate limits) are built by `shopKey()` as `lv:{env}:shop:{shopId}:…`, which refuses anything but a shop UUID. Queue jobs (BullMQ, prefix `lv:{env}`) carry ids only, checked by strict schemas (`INVALID_PAYLOAD` otherwise); the worker reloads every row with `where {id, shopId}` inside `withTenant(payload.shopId)` and takes the shop's domain from the database (`tests/security/bulk-jobs-security.test.ts`).
6. **Translation memory:** every query filters `shopId` first. There is no global memory. Cross-merchant sharing is out of scope unless explicitly authorized later.
7. **Live reads after the page:** Review's pictures come from a resource route (`app/routes/app.review_.previews.tsx`) that calls `requireShop`, takes at most 100 draft UUIDs and looks them up under RLS, so another shop's ids find nothing. The Shopify GIDs come from the stored drafts, never from the request; one `nodes()` read per 100 items; the answers are kept in memory for 60 s per shop and item, nothing is kept when the read fails, and nothing is written to the database (`tests/integration/review-previews.test.ts`).
8. **Rate limits:** per staff member and per shop for AI translation and memory suggestions (Redis token buckets, §5a). Background jobs share a per-shop Shopify Admin API budget (token bucket, `SHOPIFY_JOB_BUCKET_SIZE`); worker concurrency (`WORKER_CONCURRENCY`) is global, not per shop. Other actions have no request limit: they need the shop's session token and cost no provider money.

## 3. Secrets and tokens

- Secrets come from environment variables only (Railway variables). `.env` is git-ignored, and `.env.example` contains names and local development defaults only.
- Config is validated at boot (zod). The app refuses to start if a secret is missing or `TOKEN_ENCRYPTION_KEYS` is weak; error messages name the variable, never its value (`tests/unit/config.test.ts`). `DEEPL_API_URL` must be an https address: the API key and merchant text go to it.
- Shopify access/refresh tokens are encrypted with AES-256-GCM, with a random 96-bit IV and a key ID (`kid`) prefix for rotation. Encryption and decryption happen in `EncryptedSessionStorage` (`app/.server/shopify/encrypted-session-storage.ts`), which wraps the Prisma session storage.
- Rotation: `TOKEN_ENCRYPTION_KEYS=kid1:…,kid2:…`; the first key encrypts, all of them decrypt. There is no re-encryption job: a session is encrypted with the active key whenever the library stores it (token exchange, refresh of an expiring offline token). One whose key was removed is treated as missing, and the next app open exchanges a new token.
- AI provider keys never reach the browser or the database. The internal AI cost rate reaches only the owner's complimentary stores (the Plan page's estimate; `tests/integration/complimentary.test.ts`).
- The owner role's database URL (`MIGRATION_DATABASE_URL`) is used by the pre-deploy migration and the operator tools only; the web process drops it from its environment at start (§5n).
- Logs: pino with a redaction list for credentials (access, refresh, id and session tokens, keys, secrets, passwords, `Authorization` and cookie headers in both spellings, Shopify's access token header), at the top level and up to two levels down (`tests/unit/logger.test.ts`). Unexpected request errors are logged with name and code; the message only for the app's own errors, whose messages are built from codes and numbers (a Prisma validation error repeats the failed call's arguments, merchant text included).
- CI runs secret scanning (gitleaks) and `pnpm audit --prod --audit-level high` (§5f). There is no Dependabot configuration.

## 4. Output safety (XSS)

- AI output for HTML fields is never trusted. The pipeline (TRANSLATION_ENGINE.md §3) translates **text nodes only** and rebuilds the HTML from the source DOM structure, so the provider can't introduce tags or attributes.
- A final pass runs a sanitizer allow-list (no `<script>`, no `on*` attributes, no `javascript:` URLs). The output tag/attribute set must be a subset of the source's.
- The admin UI renders translations as text or inside a sandboxed preview. It never uses `dangerouslySetInnerHTML` with unsanitized content.
- CSP and security headers are set (`frame-ancestors` names the requesting store and the admin, as required for embedded apps; without a shop only `https://admin.shopify.com`, never a wildcard, which Shopify's security check rates High as `STATIC_FRAME_ANCESTORS`).

## 5. Webhooks

- HMAC is verified before parsing. Invalid → 401 (required by Shopify for compliance topics).
- Duplicate suppression: `unique(webhookId)` on `WebhookEvent`. A duplicate gets a 200 and is not processed again; a failed or stale attempt may be retried.
- **Replays: no time window.** The HMAC covers only the body; neither `X-Shopify-Webhook-Id` nor `X-Shopify-Triggered-At` is signed, so a captured delivery can be sent again with a new id, and a window on an unsigned header couldn't stop that. The handlers' own state checks are the control:
  - `shop/redact` erases only a shop that is uninstalled (or already gone), deciding under a lock on its `Shop` row. For an installed shop it deletes nothing, records the request as `RECEIVED` with resolution `SHOP_ACTIVE_NOT_DELETED` and logs a warning with the webhook and shop ids, for the operator to check: a replay, or an uninstall that never reached the app (then the data has to be erased by hand). Tested by replaying a genuine delivery's body and HMAC with a new id after a reinstall (`tests/integration/webhooks.test.ts`).
  - A replayed `customers/*` request only records the evidence again; a content webhook only queues a check of the shop's own resource.
  - A replayed `app/uninstalled` marks the shop uninstalled, deletes its sessions, cancels its running jobs and forgets the cached plan; the next app open reinstalls it through token exchange and asks Shopify for the plan again. An interruption (cancelled jobs have to be started again), no data is deleted.
  - Residual: a replayed `shop/redact` while the shop is uninstalled erases its data before Shopify's own (48 hours after the uninstall), so a reinstall within those hours starts empty.
- Handlers only persist and enqueue, and respond within a few hundred ms; `shop/redact` deletes the shop's rows in the request itself (one transaction, longer for a large shop).
- The delivery log keeps finished entries for 14 days (`purgeWebhookLog`, run by the worker's sweep): long enough for Shopify's retries, short enough that frequent product webhooks don't grow the table. It stores topic, shop domain and a payload hash, never the payload.

## 5c. RLS and indexes: the fuzzy search function

PostgreSQL evaluates a query's own conditions after the RLS policy unless they are LEAKPROOF. Trigram (`%`) and `ILIKE` operators aren't, so under RLS no index can serve them. For translation memory this made fuzzy search scan all of a shop's entries.

`linguva_memory_fuzzy()` (migration `20261027180000_memory_fuzzy_function`) is a deliberate exception, and `linguva_draft_search()` (§5l) follows the same pattern:

- `SECURITY DEFINER`, owned by the (non-superuser) migration role, `search_path = pg_catalog, pg_temp` with every `public` object schema-qualified; `EXECUTE` revoked from PUBLIC and granted only to `linguva_app`. Full review, threat tests, residual risks and alternatives: [SECURITY_REVIEW_MEMORY_FUZZY.md](SECURITY_REVIEW_MEMORY_FUZZY.md).
- It takes **no shop argument**. The tenant comes from `current_setting('app.shop_id')`, the same transaction setting the RLS policy uses, so a caller can't choose another shop. Without a tenant it returns nothing.
- To run as the owner without RLS, `TranslationMemory` has RLS enabled but not forced. The runtime role stays fully under RLS for every direct query; only the owner (migrations) isn't forced.
- Covered by the security suite: no rows without a tenant, no rows of another tenant, the function's attributes, and RLS still on for the table.

## 5d. Database posture check

`checkDatabasePosture()` (`app/.server/lib/db-posture.ts`) runs once per process in the web app, the webhook handlers and the worker, as the runtime role. It checks that the runtime role:

- isn't superuser, BYPASSRLS or CREATEROLE;
- owns no tables or views;
- can't create objects in `public`;
- has no TRUNCATE (it ignores row-level security), REFERENCES or TRIGGER privilege on any table (`RUNTIME_TABLE_PRIVILEGE`);
- can read no view that runs with its owner's rights (`VIEW_NOT_SECURITY_INVOKER`: the owner isn't forced on `TranslationMemory` and `TranslationDraft`) and no materialized view (`RUNTIME_READS_MATERIALIZED_VIEW`: it holds what its owner read). Views of an extension (for example `pg_stat_statements`) aren't counted.

It also checks that:

- every tenant table, plain or partitioned, has RLS with exactly the reviewed policy, and FORCE (except `TranslationMemory` and `TranslationDraft`, §5c and §5l); a table in `public` without `shopId` must be one of the reviewed global tables;
- every tenant table has a foreign key on `shopId` to `Shop` with `ON DELETE CASCADE`, so `shop/redact` erases it (`TENANT_TABLE_WITHOUT_SHOP_CASCADE`);
- the only SECURITY DEFINER functions are the two reviewed ones (§5c, §5l), each unchanged since its review (definition hash), with the required `search_path`, a non-privileged owner and no PUBLIC execute;
- the runtime role can't write `ComplimentaryAccess` (free access is granted only by the operator tool with the owner role, BILLING_DESIGN §4).

In production a failed check makes requests and jobs fail instead of running with weakened isolation. `tests/security/postgres-privileges.test.ts` makes each mistake as the owner (a TRUNCATE grant, a view over `TranslationMemory` that shows every shop's rows, a partitioned tenant table without RLS, a tenant table without the cascade), asserts the finding and undoes it.

Grants of the runtime role on global tables: `AuditLog` insert only (no read); `Shop`, `Session`, `WebhookEvent`, `PrivacyRequest` read/write (they hold no merchant content; access is by verified shop domain or webhook id).

## 5a. AI cost and abuse limits (implemented, tested)

| Control | Where | Behaviour |
|---|---|---|
| Monthly allowance per shop | `UsageLedger` reservation (advisory lock) | Request refused, bulk job stops with `QUOTA_EXCEEDED` |
| Daily cap per shop (`AI_DAILY_CHAR_LIMIT`, never above the monthly allowance) | Same transaction | Refused / job stops with `DAILY_LIMIT`, resumable the next UTC day |
| Platform cap per day across all shops (`AI_PLATFORM_DAILY_CHAR_LIMIT`, our provider cost) | `PlatformUsageDay`, conditional `UPDATE` in the reservation transaction | Refused / `PLATFORM_LIMIT`. Concurrency-tested: never overshoots |
| Largest single interactive request (`AI_MAX_CHARS_PER_REQUEST`) | Before reservation | `REQUEST_TOO_LARGE`, no provider call |
| Requests per minute per staff member and per shop (AI translate, memory suggestions) | Redis token buckets (shared by all instances; Redis required in production) | `RATE_LIMITED_USER` / `RATE_LIMITED_SHOP` with retry time; no quota used. Staff ids are hashed in Redis keys |

`PlatformUsageDay` holds only a date and a number, so it isn't under RLS. The runtime role can read, insert and update it, but not delete.

**Production values when billing goes live** (PRICING_DECISION.md §8, §9 step 6):

- `AI_DAILY_CHAR_LIMIT=1000000`: each shop gets min(1,000,000, its monthly allowance) per UTC day, so at most $27.50 of DeepL cost per shop and day. A store in Shopify's trial has at most 100,000 AI characters a month (`TRIAL_AI_CHARS`).
- `AI_PLATFORM_DAILY_CHAR_LIMIT=3000000`: at most $82.50 a day across all shops. The code default stays 100,000 for development; with `BILLING_REQUIRED=true` and a platform cap below 1,000,000 the app logs a warning at start (`configWarnings` in `app/.server/lib/config.ts`), because one store's first pass would stop AI translation for every store.
- **Raise rule:** raise the platform cap when any day in the last 7 reaches 70% of it, or when `PLATFORM_LIMIT` appears in a job. Target: max(3,000,000; 3 × the sum of paying shops' monthly allowances ÷ 30), rounded up to whole millions, and always at least 3× the per-shop cap, so one first pass never blocks other stores. Move from DeepL Growth to Enterprise when the monthly total nears 40,000,000 characters.
- **Outer guard:** cost control in the DeepL account at €150 a month at launch, a backstop (DeepL then refuses every request until its billing period ends), not a throttle.

## 5b. No unintended publishing (implemented, tested)

- Bulk jobs create drafts by default. Automatic publishing needs an explicit, recorded confirmation.
- A job publishes only while automatic publishing is on for the job **and** still on in Settings. Switching back to review stops running jobs from publishing; their results become drafts.
- Even with automatic publishing, results with quality warnings go to Review instead of the storefront.
- The editor's AI and memory actions only fill the form. Publishing needs the merchant's save.
- Approval needs explicit draft ids of the same shop with status PENDING; rejected, stale and other shops' drafts are never published.

**Every write path (phase D audit).** Only two functions change translations in a store: `registerTranslations` (called only by `saveResourceTranslations`) and `removeTranslations` (called only by `history.removeTranslation`). `tests/security/structure.test.ts` fails if another caller or another Shopify mutation appears.

| Path | Who starts it | Guards |
|---|---|---|
| Editor save (`resource-editor`) | The merchant, per field | Session token; source digest (refused if the original changed); **translation unchanged since the page was opened** (phase D); handle changes need a confirmation; the value replaced is kept as a revision |
| Restore a version (`history`) | The merchant | Same shop's revision of the edited resource; source digest; refused for revisions written for an older original |
| Remove a translation (`history`) | The merchant | Same shop and resource; the removed value is kept as a revision |
| Approve drafts (`review/drafts`) | The merchant, explicit draft ids | Same shop, PENDING only; source digest; **the translation the draft replaces must still be in place** (`currentDigest`, phase D), otherwise STALE |
| Automatic publishing (`jobs/processors`) | A bulk or automatic job | Explicitly enabled and confirmed, still enabled in Settings, plan includes it, no quality warnings, translations a person wrote or approved skipped unless the job allows replacing them, source digest, **translation unchanged since planning** (phase D) |

**Bug found by the audit (fixed in phase D):** a draft or an automatically published result was made for the translation in place when the job ran. If someone wrote a translation afterwards (in Shopify's editor or Linguva's), approving the older draft, or the job finishing a moment later, replaced the person's newer translation. Drafts now store which translation they replace, and publishing checks it again on the store's current state (`tests/security/draft-protection.test.ts`, mutation-checked). The editor has the same check: each field carries a marker of the translation shown, so when two people edit the same field, the later save is refused with an explanation instead of replacing the earlier one (the marker only prevents accidents; a person can still replace a translation on purpose after reloading, and the replaced value is kept as a revision).

**Structure of rich text, lists and links (phase F).** For these types `saveResourceTranslations` itself refuses a value whose structure, number of items or link addresses differ from the original Shopify reports at that moment (`keepsSourceStructure`, code `STRUCTURE_CHANGED`), and a list with an untranslated item (`EMPTY_TRANSLATION`). Because every path above goes through it, a form or an edited draft can't point a link elsewhere or drop list items, whichever page posted it (`tests/integration/attached-resources.test.ts`, `bulk-attached.test.ts`). Trade-off: a rich text translation someone wrote in Shopify's own editor with different formatting stays in the store, but Linguva won't write it again (for example when restoring it from the history).

**Review, redesigned (Redesign 2, 2026-10-30).** The write path is unchanged: the "Approve drafts" row above, through `saveResourceTranslations`. New checks come before it. An emptied text is refused (`EMPTY_TRANSLATION`) and never replaced by the draft. A new web address is sent only when the merchant confirmed it on its own and `validateHandle` accepts it (`HANDLE_NOT_CONFIRMED`, `HANDLE_INVALID`). When Shopify doesn't answer in time (504), the texts already published stay published; the rest are marked `SHOPIFY_UNAVAILABLE` and stay pending. Rejecting writes one `drafts.rejected` audit entry with counts and language codes, never merchant text (`createMany`, so the runtime role needs no SELECT on `AuditLog`). Tests: `tests/integration/review-protection.test.ts`. Review's raw SQL (`app/.server/review/page.ts`: card order, paging, the tab and chip counts) is static `Prisma.sql` fragments with bound parameters, run inside `withTenant`. `CoverageItem.parentGid` and `resourceType` are read only to group, show and filter texts. The text search still goes through `linguva_draft_search` (§5l, unchanged).

## 5e. HTTP security headers (implemented, tested)

`app/.server/lib/security-headers.ts`, applied to every page and data response (`entry.server.tsx`):

| Header | Value | Why |
|---|---|---|
| Content-Security-Policy | Shopify's `frame-ancestors` for the store's admin, plus `base-uri 'self'; object-src 'none'` | Clickjacking, base-tag and plugin injection |
| (no shop in the request) | `frame-ancestors https://admin.shopify.com` | Before, such pages had no framing protection at all; no `*.myshopify.com` wildcard (Shopify's `STATIC_FRAME_ANCESTORS` check) |
| Content-Security-Policy `script-src` (phase G) | `'self' 'nonce-…' https://cdn.shopify.com`, a new nonce per page; React Router's inline scripts carry it. Not on the Vite dev server (its refresh script is inline) | An injected inline script or event handler doesn't run (tested); scripts only from the app and Shopify's CDN (App Bridge, Polaris) |
| X-Content-Type-Options | `nosniff` | MIME sniffing |
| Referrer-Policy | `strict-origin-when-cross-origin` | No full app URLs (with `shop`, `host`) sent to other sites |
| Permissions-Policy | camera, microphone, geolocation, payment, usb off | Not needed by the app |
| Strict-Transport-Security | `max-age=31536000`, production over HTTPS only | Never on local http |

Not set on purpose: `X-Frame-Options` (the admin must embed the app), `Cross-Origin-Opener-Policy` (App Bridge). Tests: `tests/unit/security-headers.test.ts`; the production build is checked in `tests/ui/install.spec.ts`, and `tests/ui/csp.spec.ts` runs the main flows under the script policy (Polaris from Shopify's CDN, previews, dialogs, toasts) with no violation and shows that an injected inline script is blocked. App Bridge is simulated there: the real one must be checked inside the admin on the development store (DEV_STORE_TEST_PLAN); if it needs another source, the policy is widened for that source only.

## 5f. Dependencies

CI runs `pnpm audit --prod --audit-level high` and fails on any high or critical advisory in what ships. Accepted exceptions (`pnpm.auditConfig.ignoreGhsas` in package.json), each reviewed:

| Advisory | Package and path | Why accepted | Remove when |
|---|---|---|---|
| GHSA-ggr8-5vv4-36mx (stack exhaustion with recursive objects) | `deepmerge-ts` 7.1.5 via `prisma` → `@prisma/config` | Only merges the repository's own Prisma configuration when the CLI runs (migrations); no merchant, Shopify or network input reaches it; not in the web app or worker bundle. Every Prisma 6 release pins 7.1.5 | Upgrading to Prisma 7 |

Development-only tools (not shipped, not run on user input) also have advisories as of 2026-10-27: `minimatch` (ReDoS) via ESLint plugins, `lodash` and `@graphql-tools/utils` via the GraphQL codegen preset. They run only on the repository's own files; they are reviewed when those tools are updated.

## 5g. Database change review: images and custom fields in bulk jobs (migration 20261029160000)

| Change | Review |
|---|---|
| `TranslationJob.includeAttached BOOLEAN NOT NULL DEFAULT false` | Set only by `createBulkJob`, and only true for all-field jobs of types with images and custom fields. Existing jobs keep false. No security meaning beyond "check more resources". |
| `TranslationDraft.parentGid TEXT NULL` with a CHECK on the GID format | Written only by the worker, from the job item's own resource (never from request input). Used for the Review page's editor link and type filter (`startsWith` a fixed GID prefix; no user text reaches it). |
| Row-level security | Unchanged: both tables keep `ENABLE` + `FORCE ROW LEVEL SECURITY` and their `tenant_isolation` policy on `shopId`, which covers new columns. No new grants, functions or roles. |
| Cross-tenant risk | A draft's `resourceGid`/`parentGid` come from Shopify for the job's own shop; approval re-reads the resource from that shop's Admin API and checks the source digest before publishing. Security tests for drafts and bulk jobs cover cross-shop access (`tests/security/bulk-jobs-security.test.ts`, `memory-glossary-review-security.test.ts`). |

## 5h. Database change review: automatic translation (migration 20261029180000)

| Change | Review |
|---|---|
| `ShopSettings.autoTranslateLocales TEXT[] NOT NULL DEFAULT '{}'` with a CHECK (at most 20 entries, locale code format) | Written only by `setAutoTranslate`, which keeps only the shop's own additional languages (from Shopify) and records an audit log entry (`auto_translate.enabled`/`disabled`, actor id, languages). `autoTranslateNew` already existed and stays false by default; turning it on without a language turns it off. The CHECK refuses malformed or too many values even if a later code path skipped the filter (tested). |
| Row-level security | Unchanged: `ShopSettings` keeps `ENABLE` + `FORCE ROW LEVEL SECURITY` and its `tenant_isolation` policy on `shopId`, which covers the new column. No new grants, functions or roles. |
| New webhook topics (`products/create|update`, `collections/create|update`) | Same route action as the other webhooks: HMAC verified by the Shopify library, duplicate deliveries suppressed by `webhookId`. The shop comes from the verified delivery; the resource id from the payload is accepted only when it is a numeric GID of the topic's type. `include_fields` limits the payload to the id and `updated_at` (no product data is stored). Nothing is queued unless the shop turned automatic translation on. |
| Queue `translation-auto` | Payload is ids only (`shopId`, resource GID, type), validated by a strict schema in the worker (`INVALID_PAYLOAD` otherwise, tested). The check re-reads consent, settings and plan for that shop, then creates items in that shop's tenant transaction; the item runs through the normal item queue, so publishing, protection of translations a person wrote or approved, AI allowance and daily caps apply unchanged. |
| Unintended publishing or overwriting | Automatic items never join a running job that only translates search listings or may replace protected translations (`overwriteProtected`); they wait for it. Results are drafts unless the shop enabled automatic publishing (§5b). A bulk job the merchant starts while an automatic job runs takes it over with the merchant's own settings. |
| Cross-tenant risk | Store B's webhooks never read store A's settings; an automatic check reads only its own shop's Admin API. Covered by `tests/integration/auto-translate.test.ts` ("stay within their store", RLS counts under the other tenant). |

## 5i. Database change review: draft remembers the translation it replaces (migration 20261029200000)

| Change | Review |
|---|---|
| `TranslationDraft.currentDigest TEXT NULL` with a CHECK (`none` or 64 hex characters) | Written only by the worker when it saves a draft, from the store's own translation of that field (sha256, never the value itself, so no merchant text is duplicated). Read only when the same shop approves the draft; a mismatch refuses publishing (STALE). NULL for drafts made before the migration keeps the earlier behaviour for them. |
| Row-level security | Unchanged: `TranslationDraft` keeps `ENABLE` + `FORCE ROW LEVEL SECURITY` and its `tenant_isolation` policy on `shopId`, which covers the new column. No new grants, functions or roles. |
| Cross-tenant risk | None added: the column is compared with the translation read from the approving shop's own Admin API. |

## 5j. Database change review: draft remembers its field type (migration 20261030090000)

| Change | Review |
|---|---|
| `TranslationDraft.valueType TEXT NULL` with a CHECK (upper-case letters and `_`, at most 64) | Written only by the worker when it saves a draft, from the content type Shopify reported for the field. Used only to display the draft (a list, link or rich text shown readably on Review). Never trusted for publishing: `saveResourceTranslations` checks rich text, lists and links against the type and source Shopify reports at that moment (`keepsSourceStructure`), so a wrong or missing value can't let a changed structure or link address through. |
| Row-level security | Unchanged: `TranslationDraft` keeps `ENABLE` + `FORCE ROW LEVEL SECURITY` and its `tenant_isolation` policy on `shopId`, which covers the new column. No new grants, functions or roles. |
| Cross-tenant risk | None added: the column holds a Shopify type name, never merchant text, and is read only by the draft's own shop. |

## 5k. Database change review: periodic check for automatic translation (migration 20261030100000)

| Change | Review |
|---|---|
| `ShopSettings.autoSweptAt TIMESTAMPTZ NULL` | A time, no merchant content. Written by `setAutoTranslate` (now when turned on, NULL when turned off) and by the worker's sweep after a complete check of the shop. Read only by the sweep to ask Shopify for resources changed since then. |
| Row-level security | Unchanged: `ShopSettings` keeps `ENABLE` + `FORCE ROW LEVEL SECURITY` and its `tenant_isolation` policy; the sweep reads and writes it per shop through `withTenant`. No new grants, functions or roles. |
| Cross-tenant risk | None added: the sweep lists active shops (the `Shop` table, as the stalled-item sweeper does), then works inside each shop's tenant context with that shop's own Admin API session; resource ids from Shopify are queued with the shop's id, never another's. |

## 5l. Database change review: indexed Review search (migration 20261030110000)

| Change | Review |
|---|---|
| `linguva_draft_search(text, integer)`: second `SECURITY DEFINER` function | Same pattern and hardening as §5c: no shop argument, tenant from `app.shop_id`, fixed `search_path`, schema-qualified, executable only by `linguva_app`, returns ids of PENDING drafts only (contents are read through RLS afterwards). Reviewed hash in `DEFINER_FUNCTIONS`. Full review: [SECURITY_REVIEW_MEMORY_FUZZY.md §10](SECURITY_REVIEW_MEMORY_FUZZY.md) |
| `TranslationDraft` RLS enabled but not forced | Only the owner (migration) role is unfiltered; the runtime role stays under RLS for every operation (tested). Second and last entry of `NOT_FORCED_TABLES` |
| Partial trigram index on pending drafts | No data change; makes the search a few milliseconds instead of a scan |

## 5m. Database change review: live translation coverage (migration 20261031090000)

| Change | Review |
|---|---|
| `CoverageItem`, `CoverageCount`, `CoverageSegment`: new tenant tables | RLS enabled **and forced**, `tenant_isolation` policy on `app.shop_id` (USING and WITH CHECK), granted to `linguva_app` only; no definer function, no `NO FORCE`. Isolation tested in `tests/security/coverage-security.test.ts` (no rows without a tenant, no write for another shop, forged queue payloads find nothing) |
| What is stored | Shopify field keys (`title`, `body_html`, theme and metafield keys), states, counts, GIDs and a 32-hex sha256 prefix of the normalised translated SEO title (duplicate check). **No merchant text**: the test scans every coverage row of a shop with translated titles, SEO titles, a custom field and an image and finds none of their words. Titles shown on the coverage page are read live from Shopify for the visible page only |
| `CoverageStat`, `CoverageGap`, `CoverageTitleHash` dropped | Replaced by the tables above; they held only counts, ids and hashes |
| Index `TranslationJobItem(shopId, resourceGid)` | No data change; finds the latest attempt per resource for "failed" |
| Writers | The scan worker, the webhook refresh (resource GID from the verified webhook, checked against `Product`/`Collection`), and the app after its own writes; all through `withTenant`, serialised per shop and language by an advisory lock so count changes never interleave |

**Review of every database change (phase D).** `tests/unit/migration-review.test.ts` checks that each migration after `20261029120000` names its review section here and the section exists, and that statements able to weaken isolation appear only in the migrations reviewed for them:

- `SECURITY DEFINER`, `NO FORCE`/`DISABLE ROW LEVEL SECURITY`, `BYPASSRLS`, grants to `PUBLIC`, `DROP POLICY`, `ALTER POLICY`, `CREATE`/`ALTER ROLE`;
- grants beyond reading and writing rows: `GRANT ALL`, `TRUNCATE`, `REFERENCES` or `TRIGGER` in a grant, a role granted to a role, grants `ON ALL TABLES IN SCHEMA`, `WITH GRANT OPTION`, `ALTER DEFAULT PRIVILEGES`;
- views and materialized views, partitioned and inheriting tables (`PARTITION BY`/`OF`, `ATTACH PARTITION`, `INHERITS`), `CREATE SCHEMA` and `OWNER TO`.

A policy may only be created together with its table (a second permissive policy on an existing table would be ORed with `tenant_isolation`; only `20261027090700`, which added the first policies, does otherwise), and a new table with `shopId` (`IF NOT EXISTS` included) gets RLS, FORCE and exactly the `tenant_isolation` policy in the same migration. The applied state is checked at runtime by the posture check (§5d).

## 5o. Database change review: automatic translation pauses at limits (migration 20261101090000)

| Change | Review |
|---|---|
| `ShopSettings.autoPausedUntil TIMESTAMPTZ NULL`, `ShopSettings.autoPauseReason TEXT NULL` (CHECK: an upper-case code of at most 40 characters) | A time and a reason code (for example `DAILY_LIMIT`), no merchant content. Written by the worker when an automatic job stops at a limit or for a missing provider, and cleared when the merchant turns automatic translation on or off. Read by the webhook handler, the automatic check and the periodic sweep, which do nothing until the time passes. |
| `TranslationJobItem.startedAt TIMESTAMPTZ NULL` | When the item's last run started reading the resource. A time only; written when a run claims the item, read by the automatic check to tell whether a change came after that read. |
| Row-level security | Unchanged: `ShopSettings` and `TranslationJobItem` keep `ENABLE` + `FORCE ROW LEVEL SECURITY` and their `tenant_isolation` policies; the worker writes them per shop through `withTenant`. No new grants, functions or roles. |
| Cross-tenant risk | None added: the pause is set from the stopped job's own shop (the queue payload's tenant, re-read under RLS). |

## 5p. Database change review: coverage freshness (migration 20261102120000)

| Change | Review |
|---|---|
| `CoverageItem.sourceDigests TEXT[]` (default empty) with a CHECK (hex digits only) | The first 16 hex characters of Shopify's own digest (`translatableContent.digest`) of each counted original, in `sourceKeys` order; written only by the coverage sync, normalised to lower-case hex (anything else is kept as an empty entry). Compared with a pending draft's `sourceDigest`, which drafts already keep in full, so a draft made for an older original no longer counts as a draft. No merchant text: the CHECK refuses anything but hex digits, and `tests/security/coverage-security.test.ts` still finds none of the store's words in any coverage row |
| Index `CoverageItem(shopId, parentGid)` | No data change; finds the custom fields of a deleted product or collection |
| `TranslationDraft.staleReason TEXT NULL` with a CHECK (an upper-case code of at most 40 characters) | A reason code, no merchant content. Set only when the language sync retires PENDING drafts of a language that is no longer one of the store's additional languages (`LOCALE_GONE`); drafts are never deleted (the runtime role has no DELETE on `TranslationDraft`) |
| New webhook topics `products/delete`, `collections/delete` (`/webhooks/content/delete`) | Same route action as the other webhooks (`webhookAction`): HMAC verified by the Shopify library (401 otherwise, tested), duplicate deliveries suppressed, stores the deployment doesn't serve dropped. The shop comes from the verified delivery; the GID is built from the payload's numeric id for the topic's type (or its `admin_graphql_api_id` when it has that type). The handler only removes that shop's coverage rows of the resource and of the custom fields it owns, in the shop's tenant transaction; nothing is stored. The subscriptions take effect after `shopify app deploy` |
| Coverage rows of languages that are no longer targets | When the language sync sees the store's additional languages change, items, counts and scan states of every other language are deleted in the shop's tenant transaction, under the per-language advisory lock every count writer takes |
| Row-level security | Unchanged: `CoverageItem` keeps `ENABLE` + `FORCE ROW LEVEL SECURITY`, `TranslationDraft` its RLS as in §5l, and both their `tenant_isolation` policies, which cover the new columns. No new grants, functions or roles |
| Cross-tenant risk | None added: every new write runs inside the shop's own tenant context (`withTenant`), with ids from the shop's verified webhook, its own Admin API or its own rows |

## 5q. Database change review: Smart Auto-Translate (migration 20261105090000)

| Change | Review |
|---|---|
| `SmartAutoConfig` (one row per shop): enabled, schedule (mode, time zone, times, weekdays), scope (languages, content types, field groups, images and custom fields), publish mode with who confirmed automatic publishing and when, the outdated-machine choice, daily and monthly budgets, pause (time, reason, until), next/last run, the primary-language snapshot, a form version | Codes, times, numbers and language codes; no merchant content. CHECK constraints refuse what the form validation refuses too: an unknown mode, a zone that isn't an IANA name, more than 6 times or values outside 0–1439, weekdays outside 1–7, malformed language codes, types or field groups, budgets outside 1–100,000,000, non-code pause reasons. |
| `SmartAutoRun` (activity): trigger, the occurrence it is for, the Check now key, status, error code, the scope snapshot, the coverage report id, counters | Ids, codes, counts and times only. One run per scheduled occurrence (`UNIQUE (shopId, occurrenceAt)`) and per Check now click (`UNIQUE (shopId, idempotencyKey)`, key format checked); run creation is serialised per shop with an advisory lock, which also keeps one run active per shop. |
| `SmartAutoExclusion`: resource GID, its type, who added it | Shopify ids only (format checked). |
| Row-level security | All three tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` and the one `tenant_isolation` policy on `app.shop_id`, FKs to `Shop` `ON DELETE CASCADE` (shop/redact removes them). Grants inside the role guard: `SELECT, INSERT, UPDATE` on the config (never deleted by the app), plus `DELETE` on runs (purged per shop after 90 days under `withTenant`) and exclusions (the merchant removes them). No `TRUNCATE`, functions, views or new roles. |
| `TranslationJob.smartRunId` (FK to `SmartAutoRun` `ON DELETE SET NULL`), `.fieldGroups`, `.replaceOutdatedMachine` | Inherit the job's RLS. The run id is only set from a run read under the same tenant; the FK itself isn't tenant-scoped (RLS doesn't apply to FK checks), so a forged id is never taken from a request or payload. |
| `CoverageReport.smartRunId`, `CoverageItem.sourceChars` (CHECK: no negative values), `CoverageCount.chars`, `UsageLedger.origin` (CHECK: null or `smart`) | Inherit their tables' RLS. A run id, the length of each counted original and their sum per language, type, field group and state (the estimate before anything is sent), and an origin code: numbers and codes, no merchant text (`tests/security/coverage-security.test.ts` still finds none of the store's words in any coverage row). Smart budgets sum the shop's own ledger rows under its tenant. |
| `Shop.smartNextRunAt` (indexed) | A global due index for the worker's tick, outside RLS like the rest of `Shop`, which the runtime role can update. It is only a hint: the tick re-reads the configuration under the shop's tenant before doing anything, and writes the hint only for the tenant it holds. |
| Cross-tenant risk | None added: every read and write of the new rows goes through `withTenant`; queue payloads carry ids only and are re-read under their tenant. |

## 5n. Hosted stages: staging isolation and release guard (no database change)

Hosting on Railway (docs/RAILWAY_STAGING.md) adds configuration guards, one public route and a container image; no migration.

- **Staging can't reach a production store.** `LINGUVA_STAGE=staging` requires `ALLOWED_SHOPS` (the test stores), refuses KARINEX and SOFTWAREFACH even when listed, requires the mock provider and refuses a DeepL key. A store outside the list gets 403 on every app page, `/auth/*`, the login form and the install hook (no session, no tenant), checked before Shopify's token exchange from the `shop` parameter and again from the verified session. Its webhooks are acknowledged after the HMAC check and dropped (nothing stored).
- **No accidental production release.** On Railway, `LINGUVA_STAGE` must be set and equal the environment's name; `production` also needs `LINGUVA_PRODUCTION_APPROVED=yes`, set by the owner for an approved release. Both web and worker validate this at start and exit otherwise.
- **`/healthz`**: public, read-only `SELECT 1` as the runtime role, answers only `{"status":"ok"}` or 503; no shop, no error details, `Cache-Control: no-store`.
- **`/healthz/worker`**: public, reads one Redis key (the worker's heartbeat: start time, mode, pid, commit, provider name; no secrets, no shop data); answers only `{"status":"ok"}` (200) or the state word (503), `Cache-Control: no-store`. At most one read is in flight per process (requests share it, 500 ms limit), so requests during a Redis outage whose connects hang can't pile up commands in the web process.
- **Worker inside the web container (production, RAILWAY_STAGING.md §8b)**: a child process of the web process with the web's variables, which no longer include `MIGRATION_DATABASE_URL` (below; the child's copy drops it again); it runs its own database posture check (§5d) and refuses to process jobs if the check fails; tenant isolation is unchanged (every job enters its shop's tenant context).
- **Image**: runs as the unprivileged `node` user; production dependencies only; `.env*`, `.git` and `.shopify` never enter the build context. Migrations run as the owner role in a pre-deploy step; the runtime role has no DDL (hosted roles: `scripts/db/hosted-roles.sql`, passwords from the shell environment, never in files).
- **Owner role's URL in the web service**: Railway runs the pre-deploy command with the service's variables, so `MIGRATION_DATABASE_URL` has to be a variable of `web`. The migrations run in their own process before the server starts (`node scripts/migrate.mjs`); nothing in the server uses the variable, so the web process deletes it from its environment at start, before it starts the worker (`app/entry.server.tsx`, `tests/unit/deploy-config.test.ts`, `tests/unit/embedded-worker.test.ts`). No request, log line or child process then holds it, and `tests/security/structure.test.ts` keeps app and worker code from using it. Residual: the container's start environment (`/proc/<pid>/environ` of the web process, readable by the `node` user) still contains it, so a file-read or code-execution flaw in the web process could find it. Removing it from `web` altogether would need migrations from a separate service or from the operator's machine.

Evidence: `tests/unit/staging-config.test.ts`, `tests/integration/webhooks.test.ts` (staging cases), `tests/integration/healthz.test.ts`, `tests/integration/worker-health.test.ts`, `tests/unit/embedded-worker.test.ts`, `tests/unit/deploy-config.test.ts`, `scripts/ci/image-check.sh` (CI: image built, migrated, started in staging mode, smoke-checked; started in production mode with the worker inside, worker killed and restarted, clean stop).

## 6. Admin control center (planned, not built)

There is no admin UI. Operators use the command-line tools with the owner role on their own machine (complimentary access: BILLING_DESIGN §4, audited). When an admin control center is built, it follows this plan:

- Separate deployment and domain. Email + password (argon2id) **plus mandatory TOTP/WebAuthn**.
- RBAC roles: OWNER, SUPPORT, FINANCE, READONLY.
- Sensitive actions (grant/revoke owner entitlement, view merchant content, change feature flags) require re-authentication and a reason. Each one writes an AuditLog entry.
- No impersonation of merchant sessions. Support views of content are read-only, time-boxed, and logged.

## 7. Threat model (STRIDE summary)

| # | Threat | Vector | Mitigation | Severity |
|---|---|---|---|---|
| T1 | Cross-tenant data access (IDOR) | Tampered job/draft ID in API call | `withTenant` + forced RLS (fail closed), `where {id, shopId}`, 404 on miss, IDOR tests (`tests/security/`) | Critical |
| T2 | Session forgery | Forged ID token | Library token validation, short-lived ID tokens, no cookies and no custom auth; every loader and action authenticates itself (§1) | Critical |
| T3 | Webhook forgery / replay | Unsigned POST, replayed payload | HMAC over the body, webhookId uniqueness, state checks in the handlers (`shop/redact` erases only an uninstalled shop, §5) | High |
| T4 | Token theft from DB dump/backup | DB compromise | AES-256-GCM token encryption with the key outside the DB: dumps and backups hold ciphertext only | High |
| T5 | Stored XSS via AI output | Malicious/hallucinated HTML in translation | Structure-preserving translation + sanitizer + subset check | High |
| T6 | Prompt injection via merchant content | Product text instructing the LLM | Text treated as data, delimited, output-validated; LLM gets no tools; output can only replace text nodes | Medium |
| T7 | Quota/billing abuse | Parallel requests racing quota | Usage reserved under a per-shop advisory lock, checked against the monthly, daily and platform limits in the same transaction (§5a, concurrency-tested) | High |
| T8 | Entitlement escalation | Client sets plan flag | Entitlements resolved server-side only, checked in the actions that use them and again in the worker (bulk translation and automatic publishing, per item); complimentary access needs the server allowlist and an operator grant written with the owner role (the runtime role can't write it, §5d), audited | High |
| T9 | Admin account takeover | Phishing / password reuse | No admin UI yet (§6): operator tools need the owner role's credentials on the operator's machine. Planned: MFA, separate domain, rate-limited login, alerts on login | High |
| T10 | Worker processes job for uninstalled/redacted shop | Stale queue | Worker re-checks Shop.status. Uninstall cancels queued jobs | Medium |
| T11 | Translation loop | Our write triggers `products/update`, which triggers re-translation | Compare source digest/hash, ignore if unchanged; ignore events attributable to translation-only changes; debounce | Medium |
| T12 | Sensitive data sent to AI provider | Merchant content includes personal data | No customer scopes; consent recorded in ShopSettings; DPA per provider; EU-region endpoints where available | Medium (legal review) |
| T13 | Dependency compromise | Malicious npm package | Lockfile, pinned versions, audit in CI, minimal deps | Medium |
| T14 | Log leakage | Logging translated text or tokens | Structured logger with a tested redaction list; request errors keep name and code, and the message only of the app's own errors (§3); call sites log ids and codes; no request bodies logged | Medium |

## 8. Items flagged for qualified review

- GDPR basis for sending merchant content to AI providers (Art. 28 processor role, subprocessor list, SCCs for non-EU providers).
- Retention periods for billing records under German law (HGB §257 / AO §147).
- Privacy policy and DPA wording.

Nothing in this document is a legal compliance claim.
