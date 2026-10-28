# Roadmap, Risks and Decisions

Status as of 2026-10-27: **All features listed in FEATURE_STATUS.md are implemented and tested locally (and in GitHub CI) against simulated Shopify, Partner and DeepL APIs, real PostgreSQL and real Redis. Nothing is verified on a real Shopify store yet: no development store is connected. FEATURE_STATUS.md is the single source of truth for feature states; the table below is the history of the work.**

## 1. Progress checklist

States: **Implemented** (code exists), **Tested** (automated tests pass), **Verified** (confirmed on a real Shopify dev store), **Planned**, **Blocked**.

| Phase | Item | State |
|---|---|---|
| 0 | Environment assessment, API verification, design docs | Done. Items marked ASSUMPTION in SHOPIFY_API_MATRIX.md remain open |
| M1 | App from official Shopify React Router template (commit `48b841a`, Admin API 2026-10), pnpm, strict TS, ESLint, Vitest, CI, docker-compose, `.env.example` | Implemented, Tested (local) |
| M1 | GraphQL operations validated against the 2026-10 Admin schema via `@shopify/api-codegen-preset` | Implemented, Tested (local) |
| M2 | PostgreSQL schema: Session, Shop, ShopInstallation, ShopSettings, ShopLocale, WebhookEvent, AuditLog, PrivacyRequest | Implemented, Tested |
| M2 | Row-level security (fail-closed) + `withTenant()` + separate owner/runtime roles | Implemented, Tested (incl. a check that the tests fail when RLS is disabled) |
| M2 | AES-256-GCM token encryption with key rotation (`EncryptedSessionStorage`) | Implemented, Tested |
| M2 | Install / reinstall / uninstall lifecycle | Implemented, Tested (DB level). Not yet Verified on a dev store |
| M2 | Webhooks: HMAC (401), duplicate suppression, retry after failure | Implemented, Tested (route level and against the running production build) |
| M2 | Compliance webhooks: customers/data_request, customers/redact, shop/redact | Implemented, Tested. Not yet Verified via `shopify app webhook trigger` |
| M3 | Overview and Languages pages reading `shopLocales` | Implemented. **Blocked on a dev store** for verification |
| M4 | HTML segmenter (XLIFF-style inline codes), placeholder/Liquid/URL protection, XSS-safe rebuild | Implemented, Tested (29 unit tests) |
| M4 | Content validation (numbers incl. Arabic-Indic digits, glossary terms, length) | Implemented, Tested |
| M4 | Provider layer + DeepL adapter (batching, retry with backoff/jitter, error classes) | Implemented, Tested with a stubbed HTTP layer. **Not yet verified against live DeepL** (no key configured) |
| M4 | Usage ledger with quota reservation (advisory lock, idempotent) | Implemented, Tested (incl. concurrency) |
| M4 | Products list (coverage per locale) and product translation editor: AI drafts, review, digest-checked publish, revisions, audit log | Implemented, Tested against a simulated Admin API. **Blocked on a dev store** for verification |
| M4 | AI data-processing consent (versioned, audited) and Settings page | Implemented, Tested |
| M4 | Bulk translation worker: BullMQ queues (discovery + items), idempotent enqueue, exponential backoff with jitter, dead-letter state, per-shop Redis token bucket, job stop conditions, cancel/retry/resume, stalled-item sweeper, graceful shutdown | Implemented, Tested (integration with real Redis + BullMQ, security suite). **Not yet verified on a dev store** |
| M4 | Mock translation provider (refused in production) and DeepL Free readiness (`:fx` endpoint, `/v2/usage` check) | Implemented, Tested. DeepL not verified against the live API |
| M4 | Jobs pages (list, progress, failed products, cancel, retry) and "translate all" on Products | Implemented. Blocked on a dev store for verification |
| M5 | Translation memory: per shop, segment level, exact (hash) and fuzzy (pg_trgm) matches, APPROVED vs MACHINE entries (approved never downgraded), market-specific entries, reuse before any provider call, in-request de-duplication, Memory page | Implemented, Tested (unit, integration, security) |
| M5 | Glossary: never translate / always translate as / never use, per language and market, CSV import (all-or-nothing, line errors) and formula-safe export, Glossary page | Implemented, Tested |
| M5 | Bulk review: draft mode by default, Review page (edit, approve, reject), stale detection, automatic publishing only after explicit confirmation (recorded) | Implemented, Tested. UI not yet verified on a dev store |
| M5 | Protection of manual/approved translations (and translations made outside Linguva) from bulk jobs unless explicitly allowed | Implemented, Tested |
| M5 | Revision history per field, previous Shopify value kept as EXTERNAL revision, restore while the source is unchanged | Implemented, Tested. **Rollback after a source change isn't possible (Shopify accepts translations only for the current source digest)** |
| M5 | DeepL glossary API, TMX import/export, market-scoped publishing in jobs | Planned |
| M4 | Collections: list with coverage, editor (shared with products), bulk jobs (`resourceType` COLLECTION) | Implemented, Tested (fake store). Not yet Verified |
| M3 | Guarded live contract tests (`pnpm test:live`): dev-store gate (`plan.partnerDevelopment`), deny list, fixture-only writes with cleanup, mock provider; operations schema-validated in CI | Implemented; guard unit-tested. **Not run: no dev store connected (Blocked on owner)** |
| M7 | AI cost limits: daily cap per shop, platform-wide daily cap, per-request size cap, per-user and per-shop request rate limits (Redis) | Implemented, Tested (integration with real Redis/PostgreSQL incl. concurrency, security suite) |
| M5 | Draft protection: publishing only while automatic publishing is still enabled; flagged results always go to Review | Implemented, Tested (security suite, mutation-checked) |
| M6 | SEO and Markets plan (SEO_ARCHITECTURE.md) | Written |
| M5 | Jobs and Review: keyset pagination, filters and search | Implemented, Tested (integration incl. 20,000 drafts, cross-shop cursor) |
| M8 | Security review of the fuzzy search definer function and database privileges (SECURITY_REVIEW_MEMORY_FUZZY.md): hardened search path, superuser guard, runtime posture check (fail closed in production), AuditLog insert-only, adversarial tests with three roles, mutation-checked | Implemented, Tested (security suite in CI) |
| M8 | Fuzzy memory search at 100,000 entries: shop + trigram index via a hardened SECURITY DEFINER function | Implemented, Tested (performance suite in CI, security suite) |
| M6 | SEO S2: URL handle suggestions, format check, confirmation before changing a published handle | Implemented, Tested (unit, integration, mutation-checked) |
| M5 | Remove a translation from the editor (kept in history, restorable) | Implemented, Tested |
| M4 | Pages, blog posts and blogs (PAGE, ARTICLE, BLOG): list, editor, bulk, review, coverage | Implemented, Tested (fake store). GID format to be confirmed by the live read test |
| M6 | Coverage report (SEO S5): background scan per language and type, counts by field group, SEO findings, duplicate SEO titles, worst items, "translate gaps" / "SEO only" actions | Implemented, Tested (unit, integration incl. BullMQ worker, security: isolation and no stored text; mutation-checked). Not verified on a dev store |
| M6 | SEO S1: SEO title/description checks (width-based limits, untranslated), editor "Search engine listing" with live counters and result preview, "SEO fields only" AI and bulk jobs | Implemented, Tested (unit, integration, mutation-checked). Not verified on a dev store |
| M7 | Shopify App Pricing: entitlements, Partner API subscription check with cache, plan selection redirect, welcome link, gating | Implemented, Tested (simulated Partner API). Not verified |
| M6 | Image alt text and text metafields in the editor | Implemented, Tested (fake store, security tests). Not verified |
| M6 | Read-only Markets page (optional scope `read_markets`) | Implemented, Tested (unit). Not verified |
| M8 | Review guard for SECURITY DEFINER changes; CI checks for hidden files and orphan test files | Implemented, Tested |
| M7 | Owner complimentary access (allowlist + operator grant, metered, audited) | Implemented, Tested (unit, integration, security, UI) |
| M3 | Shopify CLI readiness (app config, .env in development, preflight) | Implemented; dev server start checked. Blocked on `config:link` (owner) |
| M8 | Playwright UI tests (production build, simulated Shopify, axe, phone layout); UX error/empty/loading states | Implemented, Tested (CI) |
| — | Beta readiness review (BETA_READINESS.md) | Done: blockers need the owner |
| — | CI on GitHub | Implemented, green on the first push |
| — | SEO_ARCHITECTURE, DEV_STORE_SETUP | Written |
| — | PRODUCT_REQUIREMENTS, PRIVACY_COMPLIANCE, DEPLOYMENT, TEST_PLAN | Planned |

## 2. Milestones

Each milestone ends with tests passing in CI and a report to the owner. Estimates are rough, for one AI-assisted engineer with owner review.

| M | Scope | Exit criteria (all automated unless noted) |
|---|---|---|
| **M1 Foundation** | Scaffold from the official React Router template; pnpm; TypeScript strict; ESLint; Vitest; docker-compose (Postgres 16 + Redis 7); zod config; structured logger; CI (typecheck, lint, unit, build, `prisma migrate diff` check, gitleaks) | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green locally and in CI |
| **M2 Tenancy + DB** | Prisma schema (tenancy, sessions, settings, audit, webhook events); RLS migration; `withTenant`; encrypted session storage; install/uninstall handling; compliance webhooks (3 topics, 401 on bad HMAC) | Integration tests against real Postgres: cross-tenant read/write blocked with RLS; HMAC forgery → 401; duplicate webhook processed once |
| **M3 Dev-store install** | Owner creates the Partner app + dev store (owner action); `shopify app dev`; embedded Overview page with Polaris web components; Languages page reading `shopLocales` / `availableLocales` | Manual: install on dev store succeeds, Overview loads. E2E smoke test (Playwright) where feasible |
| **M4 Translation core** | Discovery (products first); entry/job models; HTML normalizer + placeholder protection; Mock + DeepL providers; queue + worker + per-shop throttle; editor; publish with digest revalidation | Unit: normalizer round-trip property tests. Integration: stale digest → STALE, not published. Dev store: a product translated and verified by read-back |
| **M5 Intelligence** | Translation memory, glossary, validation rules, automation via webhooks + reconciliation, benchmark run | Duplicate webhook/loop tests, glossary tests, benchmark report committed |
| **M6 SEO + Markets** | SEO fields, coverage, handle warnings, market-scoped translations, locale enable/publish within the 20 limit | Coverage report matches dev-store state |
| **M7 Commercial** | App Pricing plans (Partner Dashboard, owner action), entitlement resolver, usage ledger + reservations, App Events outbox, owner private plan, admin center v1 (MFA, RBAC, audit) | Concurrency test: parallel jobs can't exceed quota; idempotent usage events; IDOR suite on admin |
| **M8 Hardening** | Load tests 100/1k/10k/100k synthetic products, failure tests, backup restore drill, monitoring/alerts, privacy docs | Measured results documented; claims limited to what passed |
| **M9 Launch** | Staging validation, owner-store pilot (**with explicit approval**), beta, listing, Shopify review | Definition of Done checklist |

## 3. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Provider cost exceeds plan revenue on large catalogs | High | High | Cost estimate before jobs, caps, TM, overage meter, measure real chars/product |
| R2 | Cross-tenant leak through a missed scope | Medium | Critical | RLS fail-closed + lint rule + IDOR tests |
| R3 | Shopify API changes (quarterly) | High | Medium | Pin `apiVersion`, typed ops via codegen, upgrade every quarter, CI schema check |
| R4 | Expiring offline tokens mandatory 2027-01-01 | Certain | High | Use the template with `expiringOfflineAccessTokens: true` from day one |
| R5 | Bulk discovery of translatable resources not bulk-eligible | Medium | Medium | Fall back to paginated discovery with a throttle. Test early in M4 |
| R6 | AI breaks HTML/placeholders → broken storefront | Medium | High | Structure-preserving translation, validator, drafts by default |
| R7 | GDPR: merchant content to non-EU AI providers | Medium | High | DPA, EU endpoints, consent, subprocessor list, legal review |
| R8 | App Events API still "unstable" path | Medium | Medium | Outbox abstraction. Verify before M7 |
| R9 | Translation loops from webhooks | Medium | Medium | Hash comparison, debounce, idempotent job IDs |
| R10 | App Store review rejection | Medium | Medium | `shopify app security check` in CI, follow review checklist |
| R11 | Prisma `latest` is an RC (8.0.0-rc) | Certain | Low | Pin stable 7.x unless the Shopify session adapter requires otherwise |
| R12 | Competing with established apps on price | High | Medium | Differentiate on quality validation, TM savings, transparency |

## 4. Unresolved decisions (owner input needed)

| ID | Decision | Recommendation |
|---|---|---|
| D-01 | Product/app name "Linguva" final? Affects app handle, domain, listing | Confirm before M3 |
| D-02 | Plan prices and limits (BILLING_DESIGN §2) | Approve as a starting hypothesis; revisit after the M5 benchmark |
| D-03 | Admin center: same repo, separate deployment vs. separate repo | Same repo, separate build and deployment |
| D-04 | Which LLM provider(s) for premium routing; EU data residency requirement? | Decide after M5 benchmark; require DPA + EU option |
| D-05 | Prisma version: stable 7.x vs 8 RC | Stable 7.x |
| D-06 | Hosting: Railway for staging/prod (separate projects, new account/team?) | New, separate Railway project; no paid resources until approved |
| D-07 | Partner organization: which one owns the app; who creates the dev store | Owner creates; credentials go only into env vars |
| D-08 | Push/PR policy: may Claude push to the feature branch `claude/gallant-pasteur-8opy75` and open draft PRs, or only commit locally? | Allow pushes to the feature branch + draft PRs (no merge) |

## 5. Verification status (what is actually proven)

| Area | Unit/integration (local + CI) | Security suite | Real dev store |
|---|---|---|---|
| Install, sessions, token encryption, webhooks, compliance | Yes | Yes | No |
| Languages page (`shopLocales`) | Yes (fake) | — | No |
| Products and collections: list, editor, publish with digest check | Yes (fake) | Yes | No |
| Translation memory (exact, fuzzy), glossary | Yes | Yes | No |
| Bulk jobs, drafts, review, approve/reject | Yes (fake + real Redis/BullMQ) | Yes | No |
| Protection of existing translations, EXTERNAL history, restore | Yes (fake) | Yes | No (live test prepared) |
| Shopify error codes and `outdated` behaviour assumed by the fakes | Schema only | — | No (live test prepared) |
| DeepL | Stubbed HTTP only | — | No key configured |
| SEO checks, handles, coverage report | Yes (fake) | Yes (coverage) | No |
| Image alt text, text metafields | Yes (fake) | Yes | No (live test prepared) |
| Markets page (read-only) | Yes (fake) | — | No (live read test prepared) |
| Shopify App Pricing | Yes (simulated Partner API) | — | No |

## 6. Open issues

| ID | Issue | Severity | Plan |
|---|---|---|---|
| O1 | Dev store connected 2026-10-28 (linguva-test-lab); checks not yet run | High | Owner runs DEV_STORE_VERIFICATION.md (`pnpm test:live` with `LIVE_USE_APP_SESSION=yes`, then the manual checklist) |
| O2 | ~~Fuzzy memory search slow at scale~~ | Fixed | Under RLS no index could serve the trigram operator (not LEAKPROOF), so every search scanned the shop's whole memory (446 ms at 100k). Now a hardened SECURITY DEFINER function uses a shop + trigram GIN index: median 37 ms, p95 49 ms, recall 10/10 at 100,000 entries (performance test in CI) |
| O3 | ~~No per-user rate limit on interactive AI endpoints~~ | Fixed | Request limits per user and shop, daily and platform caps (SECURITY_MODEL §5a) |
| O4 | Images and metafields are in the editor only (not in bulk jobs or the coverage report); market-specific translations are missing. (Metaobjects, menus, theme content and all other content types are done.) | Medium | Images and metafields in bulk: next; markets after live verification |
| O10 | CODEOWNERS only blocks merges when branch protection requires code owner review on `main` | Medium | Owner: enable "Require review from Code Owners" in the branch protection rule |
| O5 | ~~Deleting a translation from the UI isn't supported~~ | Fixed | Editor "Remove translation" (two-step), removed value kept as a revision, audit entry |
| O6 | ~~No pagination on Review and Jobs~~ | Fixed | Keyset pagination, filters (status, language, type, field group, warnings) and search (wildcards escaped) |
| O9 | Search on Review (ILIKE) can't use an index under RLS either | Low | Fine at 20,000 drafts (tested). Revisit with the same function approach if shops exceed ~100k pending drafts |
| O7 | Rollback after a source change is impossible (Shopify accepts only the current digest) | By design | Shown in the UI |
| O8 | The repository is public | Medium | Owner: consider making it private; set `main` as default branch and protect it |

## 7. Next steps

1. Owner: link the app and connect a development store (SHOPIFY_CLI_SETUP.md), then run DEV_STORE_TEST_PLAN.md (live tests first). Log the results there. The blockers are listed in BETA_READINESS.md.
2. Fix whatever the live run shows before building anything new; update FEATURE_STATUS.md to "Verified on Shopify" only for cases that passed.
3. Owner decisions for the beta: plan prices and limits (BILLING_DESIGN §2), AI provider key and budget, hosting.
4. Then: images and metafields in bulk jobs and coverage, market-specific translations, automation on product updates.
