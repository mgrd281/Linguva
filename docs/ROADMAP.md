# Roadmap, Risks and Decisions

Status as of 2026-10-27: **M1 and M2 implemented and tested (locally and in GitHub CI). M3 and the interactive part of M4 are implemented and tested against a simulated Admin API, but not yet verified on a real dev store.**

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
| M4 | Background jobs (BullMQ worker) for bulk translation | Planned (next) |
| — | CI on GitHub | Implemented, green on the first push |
| — | PRODUCT_REQUIREMENTS, PRIVACY_COMPLIANCE, SEO_ARCHITECTURE, DEPLOYMENT, TEST_PLAN | Planned |

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

## 5. Next task (proposed, not started)

**M1-T1: Scaffold the app from the official Shopify React Router template, without any Shopify credentials.**

- Steps: `npx @shopify/cli@4.9.4 app init --template=reactRouter` (exact template flag verified at run time) into the repo root, without linking a Partner app (`client_id` left empty). Switch to pnpm. Add TypeScript strict, ESLint, Vitest with one smoke test, `docker-compose.yml` (Postgres + Redis, local only), `.env.example`, and a CI workflow.
- Files: `package.json`, `app/**`, `shopify.app.toml` (no secrets), `prisma/schema.prisma` (template Session model only), `vitest.config.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`.
- Risks: the CLI may require Partner login for some init flows. If so, use the public template repository at a pinned tag instead.
- Validation: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Not included: no Partner app linking, no store access, no deployment.
