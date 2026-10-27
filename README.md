# Linguva

AI translation and multilingual SEO app for Shopify merchants (public app, planned for the Shopify App Store).

**Status:** commercial feature set in development on a draft PR (not merged, not deployed). Implemented and tested locally against simulated Shopify, Partner and DeepL APIs: tenancy with row-level security, encrypted tokens, compliance webhooks, translation editor for products, collections, pages, blog posts and blogs (including image alt text and text metafields), SEO checks and handles, coverage report, bulk jobs with review, translation memory, glossary, history and restore, cost limits, Shopify App Pricing and a read-only Markets page. **Nothing is verified on a real Shopify store yet.** See [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) for the exact state of each feature and [docs/DEV_STORE_TEST_PLAN.md](docs/DEV_STORE_TEST_PLAN.md) for the verification plan.

## Stack

| Layer | Choice |
|---|---|
| App framework | Official Shopify React Router template (`@shopify/shopify-app-react-router` 3.x), React Router 7 |
| Admin API | GraphQL, version `2026-10`. Operations are type-checked against the downloaded schema |
| UI | Polaris web components + App Bridge |
| Auth | Token exchange, expiring offline access tokens |
| Database | PostgreSQL 16 + Prisma 6, row-level security |
| Tests | Vitest (unit + integration against real PostgreSQL) |

## Local development

Prerequisites: Node ≥ 22.12, pnpm 10, PostgreSQL 16 (or Docker), a Shopify Partner account and a **development store** (never a production store).

```bash
pnpm install
pnpm db:up                       # Docker: Postgres + Redis (creates roles and databases)
# without Docker: psql -U postgres -f scripts/db/init-roles.sql
cp .env.example .env             # then set TOKEN_ENCRYPTION_KEYS (see the comment in the file)
pnpm db:migrate                  # runs migrations as the owner role
pnpm exec prisma generate
pnpm dev                         # shopify app dev: links the Partner app and opens the dev store
pnpm build && pnpm worker        # background worker (needs REDIS_URL); use TRANSLATION_PROVIDER=mock without a DeepL key
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test               # unit tests
pnpm test:integration   # needs PostgreSQL (scripts/db/init-roles.sql applied) and Redis
pnpm test:security      # tenant isolation, payload and XSS tests (same services)
pnpm test:performance   # fuzzy memory search with 100,000 entries (same services)
pnpm test:live          # optional: guarded contract tests on a dev store (docs/DEV_STORE_SETUP.md), never in CI
pnpm build
pnpm graphql-codegen    # re-validates GraphQL operations against the Admin API schema
pnpm check:ignored      # before pushing: no source file hidden by .gitignore
```

CI (`.github/workflows/ci.yml`) runs all of these plus a migration drift check and a secret scan.

## Layout

```
app/
  .server/          server-only domain code (never bundled for the browser)
    lib/            config (zod), logger (pino), crypto, Prisma client
    tenancy/        withTenant() (RLS), shop lifecycle
    shopify/        encrypted session storage, requireShop()
    webhooks/       verification + duplicate suppression
    privacy/        compliance webhook handlers
    locales/        shopLocales sync
    translation/    segmentation, protection, validation, translate/save services
    providers/      DeepL, mock, retry
    jobs/           bulk jobs: processors, queues, errors
    queue/          Redis connection, token bucket
    usage/          usage ledger and quota
    memory/         translation memory and segment alignment
    glossary/       glossary terms, CSV import/export
    review/         drafts for bulk review
  lib/              code shared by server and UI
  routes/           pages (app.*) and webhook endpoints (webhooks.*)
prisma/             schema and migrations (incl. RLS policies)
worker/             background worker entrypoint
scripts/db/         local/CI database roles
tests/              unit/, integration/, security/ and live/ (dev store only)
docs/               architecture, security, billing, roadmap
```

## Documentation

| Document | Content |
|---|---|
| [docs/SHOPIFY_API_MATRIX.md](docs/SHOPIFY_API_MATRIX.md) | Verified Shopify API findings and open assumptions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture and ADRs |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Data model, RLS, retention |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | Tenant isolation, secrets, threat model |
| [docs/TRANSLATION_ENGINE.md](docs/TRANSLATION_ENGINE.md) | Feasibility matrix, translation pipeline |
| [docs/BILLING_DESIGN.md](docs/BILLING_DESIGN.md) | Shopify App Pricing, entitlements, metering |
| [docs/COST_MODEL.md](docs/COST_MODEL.md) | Unit economics (assumptions) |
| [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) | Implemented / Tested Locally / Verified on Shopify, per feature |
| [docs/DEV_STORE_TEST_PLAN.md](docs/DEV_STORE_TEST_PLAN.md) | Test cases on a development store, beta exit criteria, results log |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Progress, milestones, risks, decisions |
| [docs/DEV_STORE_SETUP.md](docs/DEV_STORE_SETUP.md) | Dev store setup, live contract tests, manual checks, results log |
| [docs/SEO_ARCHITECTURE.md](docs/SEO_ARCHITECTURE.md) | Multilingual SEO and Markets plan |
| [docs/SECURITY_REVIEW_MEMORY_FUZZY.md](docs/SECURITY_REVIEW_MEMORY_FUZZY.md) | Security review of the fuzzy search function, roles and grants |
| [CHANGELOG.md](CHANGELOG.md) | Change history |

## Project boundaries

This repository is independent from all existing production systems (SOFTWAREFACH, KARINEX storefronts, accounting apps, existing Railway services). It never accesses a production store without explicit authorization, and nothing is deployed without explicit approval.
