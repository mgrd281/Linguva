# Security Model

Status: the controls below are implemented and tested where a test is named (`tests/security/`, `tests/integration/`, `tests/unit/`), unless marked **planned**. The admin console (§5s, §6) is implemented and tested (its tests run in CI), not deployed.

## 1. Trust boundaries

| Boundary | Trusted? | Verification |
|---|---|---|
| Browser (embedded iframe) | **No** | Shopify ID token (JWT, HS256 with app secret) validated server-side by `authenticate.admin` |
| Shopify webhooks | Only after HMAC | `authenticate.webhook` (HMAC-SHA256 over the raw body). Invalid → 401 |
| Shopify Admin API responses | Yes (TLS) | — |
| AI provider responses | **No** | Treated as untrusted text: sanitized and validated before storage or publication |
| Operators | Yes (owner database role) | Command-line tools (`pnpm ops:complimentary`, `pnpm ops:admin`, `pnpm preflight`) run on the operator's machine with `MIGRATION_DATABASE_URL` |
| Admin console users (browser at `/admin`) | **No**, until signed in | Off unless `ADMIN_CONSOLE=on`, only on `ADMIN_HOST`; e-mail, password and a TOTP code; a session cookie, the role's capability, and Origin plus CSRF token on every write (`requireAdmin`, §6). Accounts only through `pnpm ops:admin` |
| Workers | Yes, but re-authorize | Re-check Shop status + entitlement from the DB on every job |

Every loader and action of an app or webhook route authenticates itself, through `requireShop`, `webhookAction` (the HMAC check) or a reviewed delegate that calls `requireShop`: React Router runs a child route's action without its parent's loader, so the layout's check never covers an action. `tests/security/structure.test.ts` parses each route module with the TypeScript compiler and requires the call in each exported loader and action itself (not elsewhere in the file, not in a nested function, imported from where it is defined); only the reviewed public routes are exempt: the website (`/`, `/preise`, `/impressum`, `/datenschutz`), the app's privacy policy and support page (`/privacy`, `/support`: static pages that read no database, Redis or Shopify, ignore `shop` and `host`, set no cookie, load nothing from another host, and answer 404 unless `PUBLIC_PAGES=on`), the login route (no form outside development) and the health checks. The admin console's routes (`app/routes/admin*.tsx`) authenticate with `requireAdmin` (`app/.server/admin/auth.ts`) instead, the same way, and its sign-in page with `requireAdminConsole`; the same test requires that, accepts nothing else there (no Shopify session), and keeps `requireAdmin` and the console's session code out of every other route.

## 1a. Access scopes, and why each one is needed

Every scope in `shopify.app.toml` has a row here (`tests/unit/scopes-documented.test.ts` checks it). No customer or order scopes (ADR-007). `write_locales` was removed: Linguva never adds, enables or publishes a language (it calls no `shopLocaleEnable`, `shopLocaleUpdate` or `shopLocaleDisable`), so requesting it would be over-requesting (requirement 3.2, Shopify's `SCOPE_OVER_REQUEST` check).

| Scope | Required or optional | Feature | API objects and mutations |
|---|---|---|---|
| `read_products` | Required | Products, collections, variants and option values, product images (alt text) | `products`, `collections`, `translatableResources(PRODUCT, COLLECTION, PRODUCT_OPTION, PRODUCT_OPTION_VALUE, MEDIA_IMAGE, COLLECTION_IMAGE)` |
| `read_content` | Required | Blogs and blog posts, their image alt texts | `translatableResources(BLOG, ARTICLE, ARTICLE_IMAGE)` |
| `read_online_store_pages` | Required | Pages | `translatableResources(PAGE)` |
| `read_translations` | Required | Reading existing translations, coverage counts, outdated detection | `translatableResources`, `translatableResource` (`translations`, `translatableContent` digests) |
| `write_translations` | Required | Publishing approved translations, removing a translation | `translationsRegister`, `translationsRemove` |
| `read_locales` | Required | Which languages the store has, which is primary, which are published | `shopLocales` |
| `read_markets` | Optional | Countries and markets on the Overview and language pages | `markets`, `backupRegion` (country → language) |
| `read_online_store_navigation` | Optional | Menus and menu links | `translatableResources(MENU, LINK)` |
| `read_metaobjects` | Optional | Metaobjects and their fields | `translatableResources(METAOBJECT)` |
| `read_themes` | Optional | Theme texts and sections | `translatableResources(ONLINE_STORE_THEME and its JSON templates)` |
| `read_legal_policies` | Optional | Store policies (refund, privacy, terms, shipping) | `translatableResources(SHOP_POLICY)` |
| `read_shipping` | Optional | Delivery method names | `translatableResources(DELIVERY_METHOD_DEFINITION)` |

`read_content` and `read_online_store_pages`: Shopify accepts either one for pages, blogs and articles in `translatableResources`. Both are kept until a check on the dev store (`docs/DEV_STORE_VERIFICATION.md`) shows that pages, blogs and articles all load with `read_content` alone; then `read_online_store_pages` can be dropped in a separate change that is deployed with `shopify app deploy`.

## 2. Multi-tenant controls

1. **Shop resolution:** `shopId` comes only from `session.shop` (verified token) → `Shop.shopDomain` lookup. Request params never select a tenant.
2. **Scoped queries:** tenant data is read and written inside `withTenant(shopId, fn)` (`app/.server/tenancy/with-tenant.ts`): one transaction with `app.shop_id` set transaction-locally, refusing anything but a UUID. There is no lint rule; row-level security is the enforcement: a query outside `withTenant` has no tenant and returns nothing, and a write fails (`tests/integration/rls.test.ts`, run as the runtime role).
3. **RLS:** fail-closed policies (see DATABASE_SCHEMA.md §3).
4. **Object references:** every ID from the client (job, draft, revision) is looked up with `WHERE id = $1 AND shopId = <verified shop>`, under RLS. Another shop's id finds nothing: a page answers 404 (never 403, so existence doesn't leak), an action leaves it alone.
5. **Caches/queues:** per-shop Redis keys (rate limits) are built by `shopKey()` as `lv:{env}:shop:{shopId}:…`, which refuses anything but a shop UUID. Queue jobs (BullMQ, prefix `lv:{env}`) carry ids only, checked by strict schemas (`INVALID_PAYLOAD` otherwise); the worker reloads every row with `where {id, shopId}` inside `withTenant(payload.shopId)` and takes the shop's domain from the database (`tests/security/bulk-jobs-security.test.ts`).
6. **Translation memory:** every query filters `shopId` first. There is no global memory. Cross-merchant sharing is out of scope unless explicitly authorized later.
7. **Live reads after the page:** Review's pictures come from a resource route (`app/routes/app.review_.previews.tsx`) that calls `requireShop`, takes at most 100 draft UUIDs and looks them up under RLS, so another shop's ids find nothing. The Shopify GIDs come from the stored drafts, never from the request; one `nodes()` read per 100 items; the answers are kept in memory for 60 s per shop and item, nothing is kept when the read fails, and nothing is written to the database (`tests/integration/review-previews.test.ts`).
8. **Rate limits:** per staff member and per shop for AI translation and memory suggestions (Redis token buckets, §5a). Background jobs share a per-shop Shopify Admin API budget (token bucket, `SHOPIFY_JOB_BUCKET_SIZE`); worker concurrency (`WORKER_CONCURRENCY`) is global, not per shop. Other actions have no request limit: they need the shop's session token and cost no provider money; except checks of a merchant's own engine key (Own key plan): 3 a minute per staff member and 6 per shop (`OWN_KEY_CHECKS_PER_MINUTE`), at most 20 a day per shop of which 10 refused or unreachable, and at most 100 refused or unreachable per hour for the whole deployment; only on that plan or with a pending change to it, and never outside a production build (mock mode).

## 3. Secrets and tokens

- Secrets come from environment variables only (Railway variables). `.env` is git-ignored, and `.env.example` contains names and local development defaults only.
- Config is validated at boot (zod). The app refuses to start if a secret is missing or `TOKEN_ENCRYPTION_KEYS` is weak; error messages name the variable, never its value (`tests/unit/config.test.ts`). `DEEPL_API_URL` must be an https address: the API key and merchant text go to it.
- Shopify access/refresh tokens are encrypted with AES-256-GCM, with a random 96-bit IV and a key ID (`kid`) prefix for rotation. Encryption and decryption happen in `EncryptedSessionStorage` (`app/.server/shopify/encrypted-session-storage.ts`), which wraps the Prisma session storage.
- Rotation: `TOKEN_ENCRYPTION_KEYS=kid1:…,kid2:…`; the first key encrypts, all of them decrypt. Sessions have no re-encryption job: a session is encrypted with the active key whenever the library stores it (token exchange, refresh of an expiring offline token). One whose key was removed is treated as missing, and the next app open exchanges a new token. Merchant engine keys (Own key plan) are never re-encrypted on read. The worker's sweep re-encrypts them under the active key id (compare-and-swap) and logs, once per full cycle, how many are under each key id. Rotation: put the new key id first on every service, wait for a cycle with 0 keys under the old id, then remove it. A key under a key id the process doesn't have is skipped for now and nothing is written (translation retries); only a key that fails authentication under a known key id is marked unreadable and must be entered again. If a database backup leaks, rotate the keyring and ask the affected merchants to replace their keys.
- The operator's AI provider keys never reach the browser or the database. A merchant's own engine keys (Own key plan) are stored only as TokenCipher envelopes in `ShopEngineCredential`, bound by AAD to shop, engine, endpoint and region, and reach the browser only as their last four characters. They are used only for that shop's translations and never replaced by the operator's keys. The internal AI cost rate reaches only the owner's complimentary stores (the Plan page's estimate; `tests/integration/complimentary.test.ts`).
- The owner role's database URL (`MIGRATION_DATABASE_URL`) is used by the pre-deploy migration and the operator tools only; the web process drops it from its environment at start (§5n).
- Logs: pino with a redaction list for credentials (access, refresh, id and session tokens, keys, secrets, passwords, `Authorization` and cookie headers in both spellings, Shopify's access token header, Azure's `Ocp-Apim-Subscription-Key` and Google's `X-goog-api-key` in their spellings, a Google service account's `private_key` / `privateKey`, `credentials`, the signed `assertion` and `access_token`, a merchant engine key's `plaintext` and `apiKeys`, the admin console's `passwordHash`, `totpSecret`, `csrfToken` and `_csrf`), at the top level and up to two levels down, plus Azure's adapter option `options.key` at three depths (`tests/unit/logger.test.ts`). Unexpected request errors are logged with name and code; the message only for the app's own errors, whose messages are built from codes and numbers (a Prisma validation error repeats the failed call's arguments, merchant text included).
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
  - A replayed `app/uninstalled` marks the shop uninstalled, deletes its sessions, cancels its running jobs and forgets the cached plan; the next app open reinstalls it through token exchange and asks Shopify for the plan again. An interruption (cancelled jobs have to be started again); the only data deleted are the store's own engine keys (Own key plan), which the merchant enters again after the next app open. That stops nothing else and pauses nothing (`OWN_KEY_MISSING` sets no pause). Confirming the uninstall with an Admin API call first was rejected: it is unconfirmed whether Shopify revokes the token before delivering `app/uninstalled`, and a genuine uninstall must delete the keys.
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
- the runtime role can't write `ComplimentaryAccess`: no INSERT or UPDATE, also not on single columns, no DELETE or TRUNCATE (free access is granted only by the operator tool with the owner role, BILLING_DESIGN §4);
- the runtime role can't INSERT (on any column) or DELETE `AdminUser`, nor UPDATE its `id`, `email`, `passwordHash`, `totpSecret`, `role`, `disabledAt` or `createdAt` (`RUNTIME_CAN_WRITE_ADMIN_ACCOUNTS`), and can't UPDATE or DELETE `PlanPriceChange` (`RUNTIME_CAN_REWRITE_PRICE_HISTORY`): admin accounts are written only by `pnpm ops:admin` with the owner role, and the price history is append-only (§5s).

In production a failed check makes requests and jobs fail instead of running with weakened isolation. `tests/security/postgres-privileges.test.ts` makes each mistake as the owner (a TRUNCATE grant, a view over `TranslationMemory` that shows every shop's rows, a partitioned tenant table without RLS, a tenant table without the cascade, an INSERT grant on `AdminUser`, table-wide or on single columns, a column UPDATE grant on it, an INSERT or UPDATE grant on single columns of `ComplimentaryAccess`, an UPDATE or DELETE grant on `PlanPriceChange`), asserts the finding and undoes it.

Grants of the runtime role on global tables: `AuditLog` insert only (no read); `Shop`, `Session`, `WebhookEvent`, `PrivacyRequest` read/write (they hold no merchant content; access is by verified shop domain or webhook id); the admin console's `AdminUser` read plus UPDATE of the sign-in counters only, `AdminSession` read/write, `PlanPrice` read, insert and update, `PlanPriceChange` read and insert (§5s).

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
- **Further engines** (docs/AI_ENGINES.md): the platform cap is engine-agnostic. It counts the text without markup (Azure and Google bill markup too, a few percent on rich text) and includes partials lost to a failover (they cost the platform; the shop is charged only the answering engine). Owner-side caps: Azure F0 is a hard cap (2,000,000 characters a month), S1 only a budget alert in Azure Cost Management; Google's "characters per day" quota in the console.

### 4a. Translation engines (Microsoft Azure, Google Cloud)

- Keys only in headers, never in a URL (proxies and fetch errors log URLs). Azure's key goes only to Microsoft's two documented hosts: `AZURE_TRANSLATOR_ENDPOINT` must be `https://api-eur.cognitive.microsofttranslator.com` or `https://api.cognitive.microsofttranslator.com` (https only); its language list is read from the documented global URL without a key; its key check is an empty translate call to the same endpoint with the same headers (one empty text, no merchant data); the region is validated (`^[a-z0-9]{2,32}$`) before it is put into a header. Google's token URL is fixed (`https://oauth2.googleapis.com/token`, never the key file's `token_uri`); the JWT is signed with `node:crypto`, the token cache is keyed by a hash of the client email and key id.
- No body in errors or logs: adapter error messages carry the HTTP status, a numeric code or reason that passed a token check and the request id, never the body (it can echo input); `TranslationProviderError` stays in `PLAIN_MESSAGE_ERRORS`. The adapters log nothing.
- Staging refuses `AZURE_TRANSLATOR_KEY`, `GOOGLE_TRANSLATE_API_KEY` and `GOOGLE_TRANSLATE_CREDENTIALS`, even a value that doesn't validate (the message names the variable, never the value).
- A variable that doesn't validate turns its engine off with a warning and a preflight `fail` instead of refusing the start: a typo in a new variable must not take a production store down. With only DeepL configured, `getTranslationProvider()` returns today's DeepL object.
- Consent is fail-closed: a router translates with none of its engines unless the request lists the engines the shop's consent covers (`request.engines`); an empty list calls nothing.
- The worker heartbeat and logs show the engine label (`deepl+azure`) and ids only.
- Merchant keys (Own key plan, `docs/AI_ENGINES.md` "Merchant's own keys") go only to fixed hosts: DeepL by the key's `:fx` suffix (never `DEEPL_API_URL`), Azure's EU or global endpoint chosen from two options (never a typed URL), Google's v2 host. Process state (rests, refusals, list failures, Google language lists) for merchant keys is keyed by an HMAC fingerprint, never by the key and never shared with the operator's engines.
- Tests can't reach a real engine: `tests/support/env.ts` blanks every engine credential and `tests/support/no-real-engines.ts` refuses DeepL, Microsoft and Google hosts in the unit, integration, security and performance suites; the UI test server answers only the engines' free checks and refuses anything that would translate.

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

Not set on purpose outside `/admin`: `X-Frame-Options` (the admin must embed the app), `Cross-Origin-Opener-Policy` (App Bridge).

**The admin console** (`/admin` and below, its pages and data requests; `isAdminPath`, `adminHeaders`) is never embedded and gets a set of its own, which replaces whatever came before, so a `?shop=` the Shopify library reacts to can't loosen it:

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'none'; script-src 'self' 'nonce-…'; style-src 'self' https://cdn.shopify.com; font-src https://cdn.shopify.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`. In development without a nonce (Vite's dev server): `'unsafe-inline'` for scripts and styles and `ws: wss:` for the refresh socket |
| X-Frame-Options | `DENY` |
| Cache-Control | `no-store` |
| X-Robots-Tag | `noindex, nofollow` |
| Referrer-Policy | `same-origin` |
| X-Content-Type-Options, Permissions-Policy | as above |
| Link | removed (the library's preload of App Bridge and Polaris; the console loads neither) |

No inline `style` attributes in production (no `'unsafe-inline'` for styles). React Router hands some answers out as they are, past `entry.server`: a redirect, even on a page request, and whatever a resource route (such as sign-out) answers or throws. So every `Response` the console builds itself (its redirects, the 404 and 403 refusals, sign-out) carries the headers itself, with HSTS (`adminResponse`, `adminRedirect`), and `tests/security/structure.test.ts` refuses React Router's `redirect` and a bare `Response` in the admin routes. One answer lacks them: React Router's own refusal (400) of a page POST whose Origin names another host (it answers before any route code runs). Everything outside `/admin` is unchanged (`tests/unit/security-headers.test.ts`). Tests: `tests/unit/security-headers.test.ts`; the production build is checked in `tests/ui/install.spec.ts`, and `tests/ui/csp.spec.ts` runs the main flows under the script policy (Polaris from Shopify's CDN, previews, dialogs, toasts) with no violation and shows that an injected inline script is blocked. App Bridge is simulated there: the real one must be checked inside the admin on the development store (DEV_STORE_TEST_PLAN); if it needs another source, the policy is widened for that source only.

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

## 5r. Database change review: own engine keys (migration 20261106090000)

| Change | Review |
|---|---|
| `ShopEngineCredential` (new) | One row per shop and engine. `secret` holds a TokenCipher envelope (CHECK: envelope format only, never plaintext), bound by AAD to shop, engine, data location and region. `hint`: exactly 4 characters. `keyVersion` ≥ 1, +1 on every save or replace; every write about a used or checked key and every re-encryption is guarded by it (no lost updates). Codes only in `status` (incl. `RECHECK` for the restore runbook) and `lastErrorCode`. No free text. |
| `UsageLedger.payer` (new column) | NULL or `'merchant'` (and never with `origin`). Merchant rows skip every Linguva limit and never touch `PlatformUsageDay`; Linguva's sums filter `payer IS NULL`. The CHECK is added `NOT VALID` (every existing row is NULL; new and updated rows are checked; no full scan under ACCESS EXCLUSIVE on the hottest write table), with `lock_timeout = '5s'` for the whole migration. |
| Row-level security | `ShopEngineCredential`: ENABLE + FORCE + the standard `tenant_isolation` policy. `UsageLedger`: unchanged. |
| Grants | `ShopEngineCredential`: SELECT, INSERT, UPDATE, DELETE to `linguva_app` (replace, check, remove; uninstall deletes). `UsageLedger`: unchanged (SELECT, INSERT). |
| Cross-tenant risk | Reads and writes only through `withTenant`; FK `shopId` → `Shop` ON DELETE CASCADE (shop/redact erases the keys); a ciphertext copied to another row fails to decrypt (AAD). |

## 5n. Hosted stages: staging isolation and release guard (no database change)

Hosting on Railway (docs/RAILWAY_STAGING.md) adds configuration guards, one public route and a container image; no migration.

- **Staging can't reach a production store.** `LINGUVA_STAGE=staging` requires `ALLOWED_SHOPS` (the test stores), refuses KARINEX and SOFTWAREFACH even when listed, requires the mock provider and refuses a DeepL key. A store outside the list gets 403 on every app page, `/auth/*`, the login form and the install hook (no session, no tenant), checked before Shopify's token exchange from the `shop` parameter and again from the verified session. Its webhooks are acknowledged after the HMAC check and dropped (nothing stored).
- **No accidental production release.** On Railway, `LINGUVA_STAGE` must be set and equal the environment's name; `production` also needs `LINGUVA_PRODUCTION_APPROVED=yes`, set by the owner for an approved release. Both web and worker validate this at start and exit otherwise.
- **Merchant engine keys**: staging, local development (any `NODE_ENV` but production) and any deployment with the mock provider accept only test keys starting with `mock-`, check them offline and translate with the mock provider.
- **`/healthz`**: public, read-only `SELECT 1` as the runtime role, answers only `{"status":"ok"}` or 503; no shop, no error details, `Cache-Control: no-store`.
- **`/healthz/worker`**: public, reads one Redis key (the worker's heartbeat: start time, mode, pid, commit, provider name; no secrets, no shop data); answers only `{"status":"ok"}` (200) or the state word (503), `Cache-Control: no-store`. At most one read is in flight per process (requests share it, 500 ms limit), so requests during a Redis outage whose connects hang can't pile up commands in the web process.
- **Worker inside the web container (production, RAILWAY_STAGING.md §8b)**: a child process of the web process with the web's variables, which no longer include `MIGRATION_DATABASE_URL` (below; the child's copy drops it again); it runs its own database posture check (§5d) and refuses to process jobs if the check fails; tenant isolation is unchanged (every job enters its shop's tenant context).
- **Image**: runs as the unprivileged `node` user; production dependencies only; `.env*`, `.git` and `.shopify` never enter the build context. Migrations run as the owner role in a pre-deploy step; the runtime role has no DDL (hosted roles: `scripts/db/hosted-roles.sql`, passwords from the shell environment, never in files).
- **Owner role's URL in the web service**: Railway runs the pre-deploy command with the service's variables, so `MIGRATION_DATABASE_URL` has to be a variable of `web`. The migrations run in their own process before the server starts (`node scripts/migrate.mjs`); nothing in the server uses the variable, so the web process deletes it from its environment at start, before it starts the worker (`app/entry.server.tsx`, `tests/unit/deploy-config.test.ts`, `tests/unit/embedded-worker.test.ts`). No request, log line or child process then holds it, and `tests/security/structure.test.ts` keeps app and worker code from using it. Residual: the container's start environment (`/proc/<pid>/environ` of the web process, readable by the `node` user) still contains it, so a file-read or code-execution flaw in the web process could find it. Removing it from `web` altogether would need migrations from a separate service or from the operator's machine.

Evidence: `tests/unit/staging-config.test.ts`, `tests/integration/webhooks.test.ts` (staging cases), `tests/integration/healthz.test.ts`, `tests/integration/worker-health.test.ts`, `tests/unit/embedded-worker.test.ts`, `tests/unit/deploy-config.test.ts`, `scripts/ci/image-check.sh` (CI: image built, migrated, started in staging mode, smoke-checked; started in production mode with the worker inside, worker killed and restarted, clean stop).

## 5s. Database change review: admin console (migration 20261107090000)

| Change | Review |
|---|---|
| `AdminRole` (new enum) | `OWNER`, `FINANCE`, `SUPPORT`, `READONLY` |
| `AdminUser` (new, global) | One row per console account: `email` (unique), `passwordHash` (scrypt, parameters in the string), `totpSecret` (a TokenCipher envelope under `TOKEN_ENCRYPTION_KEYS`, AAD bound to the row's `id`), `role`, `disabledAt`, the sign-in counters `failedLogins`, `lockedUntil`, `lastTotpStep` (the last accepted TOTP step: each code works once), `lastLoginAt`, `createdAt`, `updatedAt`. CHECKs: e-mail lower case, at most 254 characters, `^[^@[:space:]]+@[^@[:space:]]+$`; the hash `scrypt$N$r$p$salt$hash` (base64url, salt ≥ 16, hash ≥ 43 characters); the secret only as an envelope `v1.<kid>.<iv>.<tag>.<ciphertext>` (never plaintext); `failedLogins` and `lastTotpStep` ≥ 0 |
| `AdminSession` (new, global) | One row per sign-in: `adminUserId` (FK to `AdminUser` `ON DELETE CASCADE`), `tokenHash` (unique; SHA-256 of the cookie's 32 random bytes, base64url: CHECK exactly 43 characters; the token itself is never stored), `createdAt`, `lastSeenAt`, `expiresAt` (CHECK: after `createdAt`), `revokedAt`. Index (`adminUserId`, `createdAt`). Rows stay 30 days after `expiresAt`, for the recent sign-ins, and are deleted at the account's next sign-in |
| `PlanPrice` (new, global) | The list price the website and the Plan page show for a plan: `handle` (PK; CHECK `free`, `starter`, `pro`, `business` or `own-key`), `monthlyCents`, `yearlyCents` (NULL: no yearly price), `updatedAt`. CHECK: Free is 0 with no yearly price; a paid plan costs 100 to 10,000,000 cents a month and NULL or 100 to 120,000,000 cents a year. The form and `savePrices` also require a yearly price of at least the monthly one and no yearly Own key price (not in the CHECK). No row: the default in `app/lib/plans.ts`; a row stays in force whether the console is on or off. Display only: Shopify charges the Partner Dashboard's price |
| `PlanPriceChange` (new, global) | Append-only history: `handle` (same CHECK), old and new monthly and yearly cents, `reason` (CHECK 3 to 500 characters; the console counts them as PostgreSQL does, in code points, and refuses control characters other than tab and line breaks, which become spaces), `adminUserId` (FK to `AdminUser` `ON DELETE SET NULL`), `createdAt` (indexed) |
| Row-level security | None on the four tables: global like `Shop` and `AuditLog`, no shop data and no `shopId`; listed in `GLOBAL_TABLES` (`app/.server/lib/db-posture.ts`). Tenant tables unchanged; no new policies, functions, views or roles |
| Grants (inside the `linguva_app` role guard) | `AdminUser`: SELECT, and UPDATE only on `failedLogins`, `lockedUntil`, `lastTotpStep`, `lastLoginAt`, `updatedAt`: the runtime role can't create or delete an account, change an e-mail, password, TOTP secret or role, or enable a disabled account. `AdminSession`: SELECT, INSERT, UPDATE, DELETE (sign-in, sign-out, activity, clean-up). `PlanPrice`: SELECT, INSERT, UPDATE (no DELETE: a missing row would show the default silently). `PlanPriceChange`: SELECT, INSERT |
| Posture check (§5d) | `RUNTIME_CAN_WRITE_ADMIN_ACCOUNTS` (INSERT on any column or DELETE on `AdminUser`, or UPDATE on `id`, `email`, `passwordHash`, `totpSecret`, `role`, `disabledAt`, `createdAt`) and `RUNTIME_CAN_REWRITE_PRICE_HISTORY` (UPDATE or DELETE on `PlanPriceChange`); `tests/security/postgres-privileges.test.ts` grants each, asserts the finding, revokes it, and runs every refused statement as the runtime role |
| Writers | The operator tool `pnpm ops:admin` (`scripts/ops/admin.ts`, owner role, `MIGRATION_DATABASE_URL`): accounts, passwords, TOTP secrets, roles, disable and enable, ending sessions. The console (runtime role): sign-in counters, sessions, `PlanPrice` and `PlanPriceChange` in one transaction under an advisory lock, the rows read `FOR UPDATE` (`savePrices`; a form read before another save is refused, nothing written), audit entries with `createMany` (no read back) |
| Audit (`AuditLog`, `actorType` ADMIN) | `admin.signed_in`, `admin.sign_in_failed` (metadata `{ reason }` only: `unknown_account`, `disabled`, `locked`, `wrong_password`, `wrong_code`, `reused_code`, `rate_limited`; `actorId` NULL for an unknown e-mail and the rate limit, at most one rate-limit row per window; never the e-mail or password), `admin.signed_out`, `admin.prices.changed` (target the handle; metadata the handle, old and new cents, reason), `admin.subscription.refreshed` (`shopId`, target `Shop`; metadata the new state and plan handle). The operator tool: `admin.account.created`, `.password_set`, `.totp_reset`, `.role_set`, `.disabled`, `.enabled`, actor `cli:<os user>` |
| Redis | Sign-in limits only: `lv:<env>:admin-login:<hash>` (per client, 15 minutes), `…:admin-login-fails:<hash>` (the run of wrong attempts of every e-mail: an enabled account's id with its last accepted code step, else the e-mail; kept 24 hours after the last attempt) and `…:admin-login-lock:<hash>` (the 15-minute lock of an e-mail without an enabled account; an account's lock is its `lockedUntil`). The parts are SHA-256 prefixes, never an address, e-mail or account id |
| Cross-tenant risk | The console lists `Shop` (global), then reads each shop's figures inside `withTenant(shop.id)`, one statement of static `Prisma.sql` fragments with bound parameters per shop, at most four at a time, as the scheduled jobs do (DATABASE_SCHEMA §3); a store's page reads only that store, inside its tenant. It never uses a bypass role or `set_config` outside `with-tenant.ts`. It reads ids, plans, dates, counts and usage figures, never merchant text, sessions or tokens (`tests/integration/admin-data.test.ts`: two shops' rows never mix; nothing without a tenant) |

## 6. Admin console (v1: implemented, tested, not deployed)

The operator's control panel at `/admin` (docs/ADMIN_CONSOLE.md): every store, its cached subscription, usage, an estimated revenue, and the list prices Linguva shows. Operators still use the command-line tools with the owner role for accounts (`pnpm ops:admin`) and complimentary access (`pnpm ops:complimentary`, BILLING_DESIGN §4).

**What v1 implements:**

- **Off by default, on its own host.** `ADMIN_CONSOLE` defaults to `off`: every `/admin` address answers 404 before any database access. `ADMIN_HOST`, when set, is the only host that answers; production refuses `ADMIN_CONSOLE=on` without it (the message names the variables only). On a hosted stage (`LINGUVA_STAGE` set) the console answers only over https (the request URL, or the right-most `X-Forwarded-Proto`), so the session cookie is always Secure there. Recommended deployment: a second Railway service from the same image, with its own domain, the console off on the merchant-facing `web` service.
- **One authentication root.** Every loader and action under `/admin` calls `requireAdmin` itself (`tests/security/structure.test.ts`): the console check (404), the session (else a redirect to `/admin/login?next=…`; `next` is only an `/admin` path of this site in printable ASCII that reads back exactly as written, without `//`, `%2f` or `%5c`, else `/admin`), the role's capability (else 403), and for every request other than GET and HEAD the Origin (when sent) and the session's CSRF token (else 403). The sign-in page calls `requireAdminConsole`; the posture check (§5d) runs before the session is read.
- **Accounts** only through `pnpm ops:admin` with the owner role; the runtime role can't write them (§5s). No sign-up, no password reset by e-mail, no self-service changes.
- **Sign-in:** e-mail, password and a TOTP code in one form, always all three; one generic answer for any mistake.
  - Passwords: scrypt from `node:crypto` (N = 32768, r = 8, p = 3, 16-byte salt, 32-byte hash, 64 MiB memory limit), NFC-normalised, 12 to 256 characters, compared in constant time. A malformed or out-of-range stored hash never verifies. Unknown and disabled e-mails are checked against a dummy hash, so they take as long.
  - Codes: RFC 6238 (HMAC-SHA-1, 6 digits, 30-second steps, one step of drift either way), every candidate compared in constant time. A code is accepted only if its step is later than the account's `lastTotpStep`, claimed in one atomic UPDATE that also refuses a disabled or locked account: each code works once, even for two requests at the same moment.
  - Wrong passwords and codes (sign-in and fresh codes together) are counted in runs, one Redis count for every e-mail: an enabled account's run is keyed by its id and its `lastTotpStep`, so an accepted code starts a new run; an unknown or disabled e-mail's by the e-mail. A run is forgotten 24 hours after its last attempt. Every 5th wrong attempt of a run locks for 15 minutes: an account through `lockedUntil` (sign-in refuses it, its sessions stop, the operator tool lifts it), an e-mail without an enabled account in Redis, for exactly as long. So the answers, and when they change, are the same for accounts and unknown e-mails. Each attempt is counted before it is checked: when Redis can't be reached, no password or code is checked (sign-in and saving prices fail). `failedLogins` only records the wrong attempts since the last accepted code, for the operator's list. At most 20 attempts per client in 15 minutes (Redis, shared by all instances); the client is the right-most `X-Forwarded-For` entry (the hop Railway's proxy adds), else one shared "local".
  - The sign-in POST must come from the console's own origin when the browser sends Origin.
- **Sessions:** a 32-byte random token in `__Host-lv_admin` (HttpOnly, Secure, SameSite=Strict, Path=/, 8 hours; `lv_admin` without Secure only over local http); the database keeps its SHA-256. A session ends after 8 hours, after 30 idle minutes (activity noted at most once a minute), on sign-out, and while the account is disabled or locked; a new password, a new TOTP secret and `disable` revoke its sessions; signing in again in the same browser revokes that browser's earlier session. Signing out is a POST with the CSRF token; `GET` or `HEAD /admin/logout` signs nobody out (it answers like any console address).
- **CSRF:** the token is SHA-256 of `csrf\0` and the session token (no storage; it dies with the session), sent as the `_csrf` form field or the `X-CSRF-Token` header and compared in constant time; SameSite=Strict on top.
- **Roles:** capabilities `view` (all), `refresh` ("Ask Shopify again": OWNER, FINANCE, SUPPORT), `prices` (OWNER, FINANCE). READONLY only views. The role is read from the database on every request.
- **Sensitive action:** saving list prices needs the `prices` capability, a fresh TOTP code (same replay protection; a wrong one counts towards the lock) and a reason of 3 to 500 characters, and is recorded in `PlanPriceChange` and `AuditLog`. A form read before another save is refused (409) with nothing written, checked before the code and again under the save's lock. A value the database refuses is a form error, never a 500. It changes only what Linguva shows; Shopify charges the Partner Dashboard's price.
- **No merchant content, no impersonation, no tokens:** the console shows stores, plans, dates, counts and usage figures only. It never reads `Session` rows or Shopify tokens; "Ask Shopify again" uses the Partner API token, as the Plan page does.
- **Headers** of its own (§5e); log redaction of `passwordHash`, `totpSecret`, `csrfToken` and `_csrf` (§3). Every admin action is audited (§5s).

**How v1 differs from the earlier plan** (a separate deployment; argon2id plus mandatory TOTP/WebAuthn; re-authentication and a reason for sensitive actions; time-boxed, logged support views of content):

| Planned | v1 | Why |
|---|---|---|
| A separate application and deployment, its own domain (ARCHITECTURE §2.4) | The same repository and image; the console is off by default and answers only on `ADMIN_HOST`. A second Railway service with its own domain is recommended, and production requires `ADMIN_HOST` | One build to review and test; the merchant-facing service keeps it off |
| argon2id | scrypt from `node:crypto` | No native dependency; the parameters are stored with each hash, so they can be raised later |
| TOTP or WebAuthn, mandatory | TOTP mandatory; WebAuthn not built | TOTP works with any authenticator app and needs no dependency |
| A dedicated PostgreSQL role | The runtime role `linguva_app` with narrow grants on the four tables (§5s); tenant data only through `withTenant` | No new role to provision on every stage; the posture check guards the grants |
| Re-authentication and a reason for sensitive actions | A fresh TOTP code and a reason for saving prices | The only sensitive action in v1 |
| Grant or revoke owner access, feature flags, support views of content | Not in the console: complimentary access stays in `pnpm ops:complimentary`; no feature flags; no merchant content at all | Smaller surface |
| Alerts on sign-in | Not built: sign-ins and failures are audited only | — |

**Residual risks:**

- **Lockout as a nuisance:** anyone who knows an admin's e-mail can keep that account locked with 5 attempts every 15 minutes (its sessions stop too). The unlinked `ADMIN_HOST` makes this harder; `pnpm ops:admin enable` unlocks.
- **The runtime role's grants:** a flaw that runs SQL as `linguva_app` could insert an `AdminSession` (and so act as any account), reset the sign-in counters (unlock an account, or let a code be used again within its 90 seconds), or change `PlanPrice` without a history row. Such a flaw already reaches every tenant's data; the console adds what a signed-in admin can do (the displayed list prices, subscription checks), never what Shopify charges, and no account changes.
- **Redis:** signing in and saving prices need it (each attempt is counted before it is checked). Emptying Redis ends every run of wrong attempts and the locks of e-mails without an account, while accounts' locks (`lockedUntil`) stay; a visitor of the console can't cause that. `pnpm ops:admin enable` and `set-password` lift a lock but don't reset the run's count.
- **The client address** for the per-client limit relies on Railway's proxy appending it as the right-most `X-Forwarded-For` entry (not verified on Railway).
- **No recovery codes:** a lost phone needs the operator tool (`reset-totp`).
- **Key rotation:** TOTP secrets aren't re-encrypted; removing the key they are under locks those accounts out until `reset-totp` (docs/ADMIN_CONSOLE.md §7).
- **Visible routes:** the console's route modules ship in the app's browser bundle on every service, also where the console is off (paths and interface texts, no data).
- **Not audited:** the client address of a sign-in (`AuditLog` has no column for it). Failed sign-ins are readable only with the owner role.

## 7. Threat model (STRIDE summary)

| # | Threat | Vector | Mitigation | Severity |
|---|---|---|---|---|
| T1 | Cross-tenant data access (IDOR) | Tampered job/draft ID in API call | `withTenant` + forced RLS (fail closed), `where {id, shopId}`, 404 on miss, IDOR tests (`tests/security/`) | Critical |
| T2 | Session forgery | Forged ID token | Library token validation, short-lived ID tokens, no cookies and no custom auth in the embedded app (the admin console's own sessions: T9); every loader and action authenticates itself (§1) | Critical |
| T3 | Webhook forgery / replay | Unsigned POST, replayed payload | HMAC over the body, webhookId uniqueness, state checks in the handlers (`shop/redact` erases only an uninstalled shop, §5) | High |
| T4 | Token theft from DB dump/backup | DB compromise | AES-256-GCM token encryption with the key outside the DB: dumps and backups hold ciphertext only, and merchant engine keys, encrypted and shop-bound (Own key plan) | High |
| T5 | Stored XSS via AI output | Malicious/hallucinated HTML in translation | Structure-preserving translation + sanitizer + subset check | High |
| T6 | Prompt injection via merchant content | Product text instructing the LLM | Text treated as data, delimited, output-validated; LLM gets no tools; output can only replace text nodes | Medium |
| T7 | Quota/billing abuse | Parallel requests racing quota | Usage reserved under a per-shop advisory lock, checked against the monthly, daily and platform limits in the same transaction (§5a, concurrency-tested) | High |
| T8 | Entitlement escalation | Client sets plan flag | Entitlements resolved server-side only, checked in the actions that use them and again in the worker (bulk translation and automatic publishing, per item); complimentary access needs the server allowlist and an operator grant written with the owner role (the runtime role can't write it, §5d), audited | High |
| T9 | Admin account takeover | Phishing, password reuse, guessing, a stolen session, cross-site requests | Admin console (§6): off by default and only on `ADMIN_HOST`; password (scrypt) plus a mandatory TOTP code, each code once; every 5th failure of a run locks 15 minutes (unknown e-mails alike), 20 attempts per client in 15 minutes; hashed session tokens in a `__Host-`, SameSite=Strict cookie, 8 hours and 30 idle minutes; Origin and CSRF token on every write; a fresh code for prices; accounts only through the owner-role tool; audited. Not built: WebAuthn, recovery codes, sign-in alerts. Operator tools still need the owner role's credentials on the operator's machine | High |
| T10 | Worker processes job for uninstalled/redacted shop | Stale queue | Worker re-checks Shop.status. Uninstall cancels queued jobs | Medium |
| T11 | Translation loop | Our write triggers `products/update`, which triggers re-translation | Compare source digest/hash, ignore if unchanged; ignore events attributable to translation-only changes; debounce | Medium |
| T12 | Sensitive data sent to AI provider | Merchant content includes personal data | No customer scopes; consent recorded in ShopSettings per engine and data location (`ai-consent.ts`), a router uses only consented engines; DPA per provider (DeepL, and Microsoft / Google before their keys are added); EU endpoints by default (Azure `api-eur`, Google v3 `translate-eu`) | Medium (legal review) |
| T13 | Dependency compromise | Malicious npm package | Lockfile, pinned versions, audit in CI, minimal deps | Medium |
| T14 | Log leakage | Logging translated text or tokens | Structured logger with a tested redaction list; request errors keep name and code, and the message only of the app's own errors (§3); call sites log ids and codes; no request bodies logged | Medium |
| T15 | Merchant engine key exfiltration from the database (Own key plan) | DB compromise, dump or backup | AES-256-GCM envelope; AAD binds shop, engine, endpoint, region; RLS FORCE; CHECK refuses plaintext; hint ≤ 4 characters (§5r) | High |
| T16 | Merchant engine key exfiltration through pages or logs | Loader data, URLs, log lines | Summaries only; `SecretValue` / `SealedProvider` (no enumerable key at any depth); redacted field names incl. Azure's `options.key`; codes-only errors; POST-only forms (no key in URLs); tests scan every response, request URL and log line | High |
| T17 | Cross-tenant use of a merchant engine key | Tampered ids, copied ciphertext | RLS on every read; AAD shop binding; per-credential process state | High |
| T18 | One shop's key failures affecting other shops | Shared engine state | State keyed by HMAC fingerprint; Google list failures scoped and bounded | Medium |
| T19 | Lost update between a key replace and a background write | Concurrent check, translation or re-encryption | No writes on read; every status write guarded by `keyVersion`; re-encryption compare-and-swap on the old envelope | Medium |
| T20 | Keyring mistake destroying every merchant's keys | Key id removed early, typo, rollback | Unknown key id = transient (skip, no write, retry); maintenance inventory per key id; rotation procedure with the wait step (§3) | High |
| T21 | Merchant key outliving the uninstall | Save racing `app/uninstalled`, restore from backup | Shop row `FOR SHARE` in the save; status first, then delete; reinstall deletes leftovers; restore runbook (RECHECK, `docs/DATABASE_SCHEMA.md`) | Medium |
| T22 | Key check as an oracle for stolen keys | Repeated key checks | Only own-key shops (on the plan or pending) can check; 3/6 checks a minute; 20 a day per shop, of which 10 refused; 100 refused per hour deployment-wide; failures audited (§2 item 8) | Medium |
| T23 | SSRF / merchant key sent to an attacker host | Crafted endpoint or region | DeepL and Google hosts fixed; Azure endpoint from an enum; region and key charsets validated (§4a) | High |
| T24 | Silent cost to Linguva for an Own key store | Fallback to the operator's engines | No operator provider for own-key shops; no platform counter; production refuses `OWN_KEY_PLAN_VISIBLE=on` with billing off; tests record every request | High |
| T25 | Real merchant keys on staging or in development | Pasted production key | Mock mode outside production builds accepts only `mock-` keys (§5n) | Medium |
| T26 | Replayed `app/uninstalled` for an installed Own key store | Captured delivery | Deletes the keys only (merchant re-enters them); no pause; documented residual (§5) | Low |

## 8. Items flagged for qualified review

- GDPR basis for sending merchant content to AI providers (Art. 28 processor role, subprocessor list, SCCs for non-EU providers), per engine: DeepL; Microsoft Ireland Operations Ltd. and Google Cloud EMEA Ltd. once set up, including the transfer mechanism for their global processing options (docs/LEGAL_FACTS.md, open question 4a).
- Own key plan: the roles when a store brings its own contract with DeepL, Microsoft or Google, DPA availability on the merchant's tier, and transfers for Google's API key (v2) and Microsoft's global endpoint (docs/LEGAL_FACTS.md, open question 9).
- Retention periods for billing records under German law (HGB §257 / AO §147).
- Privacy policy and DPA wording.

Nothing in this document is a legal compliance claim.
