# Linguva

AI translation and multilingual SEO app for Shopify merchants (public app, planned for the Shopify App Store).

**Status:** foundation (authentication, multi-tenant database with row-level security, encrypted tokens, compliance webhooks) and interactive product translation (AI drafts via DeepL, review, digest-checked publishing, usage metering) are implemented and tested. Nothing has been verified on a real development store yet. See [docs/ROADMAP.md](docs/ROADMAP.md) for exactly what is implemented, tested, and verified.

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
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test               # unit tests
pnpm test:integration   # needs PostgreSQL with scripts/db/init-roles.sql applied
pnpm build
pnpm graphql-codegen    # re-validates GraphQL operations against the Admin API schema
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
  lib/              code shared by server and UI
  routes/           pages (app.*) and webhook endpoints (webhooks.*)
prisma/             schema and migrations (incl. RLS policies)
scripts/db/         local/CI database roles
tests/              unit/ and integration/
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
| [docs/ROADMAP.md](docs/ROADMAP.md) | Progress, milestones, risks, decisions |
| [CHANGELOG.md](CHANGELOG.md) | Change history |

## Project boundaries

This repository is independent from all existing production systems (SOFTWAREFACH, KARINEX storefronts, accounting apps, existing Railway services). It never accesses a production store without explicit authorization, and nothing is deployed without explicit approval.
