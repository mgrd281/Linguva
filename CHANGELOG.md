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
- Phase 0 documentation set.

### Removed
- Template demo pages and the `write_products` scope.
