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
- Phase 0 documentation set.

### Fixed
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
