# Changelog

## [Unreleased]

### Added
- App scaffold from the official Shopify React Router template (Admin API 2026-10, expiring offline tokens), switched to pnpm and PostgreSQL.
- Prisma schema and migrations for shops, sessions, settings, locales, installation history, webhook delivery log, audit log and privacy requests.
- PostgreSQL row-level security on tenant tables with `withTenant()`, separate owner (migrations) and runtime database roles, append-only audit log.
- AES-256-GCM encryption of Shopify access and refresh tokens at rest, with key rotation support.
- Shop lifecycle: install, reinstall, uninstall (session deletion), scope updates.
- Webhook handling with HMAC verification, duplicate suppression by webhook id, and retry after failure.
- Mandatory compliance webhooks: `customers/data_request`, `customers/redact`, `shop/redact` (deletes all shop data).
- Overview and Languages pages reading the store's languages from Shopify, with the 20-language limit and RTL warnings.
- Validated environment configuration (zod) and structured logging with redaction (pino).
- Unit and integration test suites (Vitest, real PostgreSQL), CI workflow with migration drift check, GraphQL schema validation and secret scanning.
- Translation engine: HTML segmentation with XLIFF-style inline codes, protection of Liquid, placeholders, URLs, e-mails, merchant terms and SKU patterns, and rebuild of markup from the source only (provider output can't inject HTML).
- Translation validation: numbers (incl. Arabic-Indic and Persian digits), glossary forbidden/preferred terms, length ratio.
- Provider abstraction with a DeepL adapter (XML tag handling, batching under the request limit, retry with backoff and jitter, error classification).
- Usage ledger with per-shop monthly quota, concurrency-safe reservations and idempotent settlement.
- Products page with translation coverage per language, and a product translation editor with AI drafts, review, digest-checked publishing to Shopify, revision history and audit log.
- Versioned AI data-processing consent and a Settings page.
- Bulk translation worker (BullMQ 6.3, Redis): paginated discovery that only creates work for missing or outdated fields, item processing with digest-checked publishing, idempotent enqueue (queue job id = item id), exponential backoff with jitter, dead-letter state after the last attempt, job-wide stop conditions (quota, consent, provider or shop auth), cancel, retry and resume, stalled-item sweeper, graceful shutdown.
- Per-shop Admin API rate limiting with an atomic Redis token bucket; throttled work is delayed without spending retry attempts.
- Mock translation provider for development and tests (refused in production) and DeepL usage check (`GET /v2/usage`).
- Jobs pages (list, live progress, failed products, cancel, retry) and "Translate all" on the Products page.
- Security test suite: cross-tenant payloads, job access across shops, payload validation, no secrets or content in Redis, malicious provider output in bulk jobs.
- Translation memory per shop: segment-level exact matches (whitespace-insensitive hash), fuzzy suggestions with pg_trgm, APPROVED and MACHINE entries (approved entries are never downgraded), market-specific entries, reuse before any provider call so repeated text costs nothing, de-duplication of identical segments within a request, Memory page (search, approve, delete).
- Alignment of a person's translation with its source segment by segment (tag/attribute signatures), so manual translations feed the memory.
- Glossary: never translate, always translate as (enforced through opaque codes the provider can't change), never use (blocks the result); scoped by language and market; CSV import with per-line validation (all or nothing, 1 MB, 5,000 terms) and formula-safe export; Glossary page.
- Bulk review: jobs create drafts by default; Review page to edit, approve and publish, or reject; drafts go stale when the source changes; automatic publishing only after explicit, recorded confirmation in Settings.
- Protection of translations written or approved by a person, or made outside Linguva, from bulk jobs unless the merchant explicitly allows replacing them.
- Revision history with approval flag and actor; the previous Shopify value is kept as an EXTERNAL revision before overwriting; restore of earlier versions while the source is unchanged; History panel in the product editor; "Fill from memory" suggestions.
- Job statistics for memory reuse, characters saved and protected translations kept.
- Collections: list with coverage, translation editor and bulk jobs, sharing the product code paths; Collections navigation entry.
- Guarded live contract tests for a Shopify development store (`pnpm test:live`, never in CI) with a dev-store gate, deny list, fixture-only writes and cleanup; setup guide `docs/DEV_STORE_SETUP.md`.
- SEO and Markets architecture plan (`docs/SEO_ARCHITECTURE.md`).
- AI cost limits: daily cap per shop, platform-wide daily cap, maximum characters per interactive request, and request rate limits per staff member and per shop (Redis token buckets). Usage today is shown in the editor and Settings.
- SEO: checks for SEO titles and descriptions (length by display width, incl. CJK; unchanged from the source), a "Search engine listing" section in the editor with live counters and a search result preview, "Translate SEO fields only" in the editor, and SEO-only bulk jobs. Readable names for quality warnings in the editor and Review.
- Translation coverage report: a background scan of products and collections per language (no AI, no writes) with translated/outdated/missing counts by content, SEO and URL handles, SEO findings, duplicate SEO titles, items with the most gaps, and buttons to translate the gaps or only SEO fields.
- Jobs and Review: pagination, filters (status, language, content type, field group, only with warnings) and search on Review.
- Performance test suite (`pnpm test:performance`, in CI): fuzzy memory search with 100,000 entries.
- Online store pages, blog posts and blogs: lists with coverage, editor, bulk jobs, review filters and the coverage report, sharing the product code paths.
- URL handles per language: suggestion from the translated title, format check, and a required confirmation before changing a published handle.
- "Remove translation" in the editor; the removed value stays in the history and can be restored.
- Shopify App Pricing: plan entitlements (characters, languages, bulk, glossary, automatic publishing), subscription check through the Partner API with a 6-hour cache that never locks out a paying shop when the API fails, redirect to Shopify's plan selection page only for a verified "no subscription", welcome link and Plan page, enforcement in the editor, bulk jobs, settings, glossary and worker. The app creates no charges.
- Image alt text (product, collection and blog post images) and text metafields that Shopify marks translatable, in a new "Images and custom fields" section of the editor: AI drafts for missing or outdated values, publishing with digest checks and history.
- Read-only Markets page with the optional `read_markets` scope (asked for only when the page is opened): languages, addresses and published state per market, and checks for unpublished or unreachable languages.
- `docs/FEATURE_STATUS.md` (Implemented / Tested Locally / Verified on Shopify) and `docs/DEV_STORE_TEST_PLAN.md`.
- Owner complimentary access for the operator's own stores: every feature without a subscription when the store's Shopify GID is in `COMPLIMENTARY_SHOP_GIDS` and the operator tool (`pnpm ops:complimentary`, owner database role) granted it; AI usage stays metered with an internal cost estimate; audited.
- Shopify CLI readiness: complete `shopify.app.toml`, `.env` loading in development, `pnpm preflight`, `pnpm worker:dev`, docs/SHOPIFY_CLI_SETUP.md.
- Playwright UI tests (`pnpm test:ui`, in CI) of the production build with real authentication and Polaris against a simulated Shopify: pages, empty, error and loading states, accessibility (axe WCAG 2.1 AA), phone layout.
- Clear error pages with "Try again" on every page, the admin loading bar during navigation, page title, empty catalog state.
- docs/BETA_READINESS.md.
- Phase 0 documentation set.

### Security
- Review of `linguva_memory_fuzzy()` (docs/SECURITY_REVIEW_MEMORY_FUZZY.md): fixed `search_path` (`pg_catalog, pg_temp`) with schema-qualified names, input bound, migrations refuse to run as a superuser, and a database posture check that stops the app and worker in production if tenant isolation could be weakened.
- The runtime role can no longer read the audit log (entries of all shops).
- Adversarial PostgreSQL tests with three roles (runtime, owner, a user without grants).
- Any change to a SECURITY DEFINER function must be reviewed: the posture check compares each function's definition with a reviewed hash; CODEOWNERS and a PR checklist cover migrations and tenancy code.
- Images and metafields can only be written for the resource being edited: the server lists them from Shopify and reads form values only under those names.
- CI checks that no source file is hidden by `.gitignore` and that every test file belongs to a suite CI runs; GraphQL documents with interpolation (skipped by codegen) are refused.

### Fixed
- First open after install could fail when the app's loaders created the shop in parallel; reinstalls were recorded once per parallel request.
- `.env` wasn't loaded under `shopify app dev`; `.dockerignore` didn't exclude `.env` files.
- Shopify API errors showed a bare status code; language codes instead of names on Jobs and Review; SEO preview notes ran together.
- A replaced or removed translation that was already outdated is kept in the history as written for an older source, so restoring it can't mark it current for the new text.
- Fuzzy memory search couldn't use its index under row-level security and scanned the whole memory (446 ms at 100,000 entries); it now uses a shop + trigram index through a narrow security definer function (37 ms median).
- Review search treated `%` and `_` as wildcards.
- Bulk jobs with automatic publishing published results with quality warnings; these now go to Review. Jobs also stop publishing when the merchant switches back to review mode.
- Errors from memory suggestions are shown in the editor.
- Re-saving an outdated translation unchanged now requires an explicit "still correct" confirmation instead of being silently skipped.
- Rejected drafts are no longer re-created by the next bulk job for the same source text.
- Audit entries record the acting staff member from the session token.
- Latest revisions are read with one `DISTINCT ON` query instead of the full history; locale sync skips unchanged rows; fuzzy memory search uses the trigram index (new migration).
- Glossary CSV uploads over the size limit are refused before the body is parsed.
- Restoring from an editor only accepts revisions of the resource shown.

### Removed
- Template demo pages and the `write_products` scope.
