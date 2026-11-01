# Architecture

Status: the web app, tenancy, webhooks, translation engine, providers (DeepL, Microsoft Azure, Google Cloud, mock; several engines behind a router) and the bulk worker (§2.1–2.3) are **implemented and tested**; the admin center is **planned**. Domain code lives under `app/.server/` rather than a top-level `server/`, so React Router enforces that it never reaches the browser bundle.

## 1. Principles

1. **Modular monolith first.** One deployable web app plus one worker process share a typed domain layer. Split into services only when a measured bottleneck requires it.
2. **Shopify is the system of record** for storefront translations, locales, and billing. Our database stores drafts, history, memory, and usage. It never overrides Shopify's billing state.
3. **Tenant isolation is enforced twice**: application-level scoping plus PostgreSQL row-level security (RLS).
4. **Every side effect is idempotent**: translation writes, usage events, webhook handling, and billing events.
5. **Nothing loads a whole catalog into memory.** Discovery is paginated or uses bulk operations, and results stream into job items.

## 2. Components

```
                    Shopify Admin (embedded iframe)
                               │  ID token (App Bridge)
                               ▼
┌──────────────────────────────────────────────────────────┐
│ web (React Router app, @shopify/shopify-app-react-router) │
│  • loaders/actions → authenticate.admin → tenant context │
│  • /webhooks/* (HMAC verified) → enqueue, 200 fast       │
│  • Polaris web components UI                             │
└───────────────┬───────────────────────────┬──────────────┘
                │ Prisma (RLS: app.shop_id) │ BullMQ enqueue
                ▼                           ▼
        ┌──────────────┐           ┌─────────────────┐
        │ PostgreSQL   │◄──────────│ worker process   │
        │ (tenant RLS) │           │  • discovery     │
        └──────────────┘           │  • translate     │
                ▲                  │  • publish       │
                │                  │  • reconcile     │
        ┌──────────────┐           │  • usage/billing │
        │ Redis        │◄─────────►│  per-shop rate   │
        │ (namespaced) │           │  limiter         │
        └──────────────┘           └───┬─────────┬────┘
                                       │         │
                          Shopify Admin GraphQL   AI providers
                          (offline token, per    (DeepL, LLM via
                           shop throttle)          adapter layer)

┌──────────────────────────────────────────┐
│ admin (separate app + deployment, Phase 5)│
│  own auth + MFA + RBAC, audited, no      │
│  merchant secrets, separate DB role       │
└──────────────────────────────────────────┘
```

### 2.1 Web app

- Built from the official Shopify React Router template (`shopify app init`). Its auth, token exchange, and expiring offline tokens are kept, not reimplemented.
- Every loader and action calls `authenticate.admin(request)`. The shop is taken **only** from the verified session, never from the request body or query string.
- Long-running work is never done in a request. Requests enqueue jobs and return a job ID. The UI polls job status.

### 2.2 Worker

- A separate process (`worker/index.ts`) using BullMQ, deployed as its own Railway service (staging), or started by the web process as a supervised child process where no worker service exists (production, `app/.server/jobs/embedded-worker.ts`, docs/RAILWAY_STAGING.md §8b). The worker writes a heartbeat to Redis; `GET /healthz/worker` reports it.
- Queues: `discovery`, `translate`, `publish`, `webhook-ingest`, `reconcile`, `usage`, plus a dead-letter queue (`dlq`).
- Each job payload carries only `{ shopId, jobId, itemId, idempotencyKey }`. The worker reloads everything from the database inside a tenant-scoped transaction and re-checks that the installation is active.
- Shopify calls go through a **per-shop token bucket** fed by `throttleStatus`, so one large merchant can't starve others.
- Fairness: per-shop concurrency caps, with priority by plan (Business/Enterprise get higher priority, not exclusive capacity).

### 2.2.1 Bulk job flow (implemented)

1. The merchant clicks "Translate all" → `createBulkJob` (idempotency key per page view; an advisory lock allows one active job per shop + locale) → a discovery queue job.
2. **Discovery** (`translation-discovery` queue) reads one page of `translatableResources`, creates a `TranslationJobItem` only for resources with missing or outdated machine-translatable fields (`skipDuplicates`), advances the cursor and enqueues the items and the next page.
3. **Items** (`translation-items` queue, queue job id = item id) reload everything under `withTenant(shopId)`, take Admin API budget from the shop's token bucket, check consent, reserve usage, translate, save with digest re-check, and record counters atomically with job completion.
4. Error handling (`jobs/errors.ts`): rate limits → `moveToDelayed` (no attempt spent); transient errors → retry with exponential backoff + jitter (5 attempts) → `DEAD`; permanent → `FAILED`; quota/consent/auth → the whole job stops and remaining items are cancelled.
5. A sweeper re-enqueues items whose queue job no longer exists (crash between DB write and enqueue); items still waiting in the queue are left alone.

### 2.3 Translation provider layer

`TranslationProvider` interface (`app/.server/providers/types.ts`): `id`, optional `capabilities` (`formality`, `context`; absent = everything, as DeepL), `translate(request, signal?)` returning the translations, the characters charged to the shop, the engine that answered (`provider`) and, for the HTML-transport engines, what they couldn't apply (`dropped`) and per-segment notes (`notes`); optional `targetSupport(locales)` read from the engine's own language list. Errors are `TranslationProviderError` with a `kind` (retryable, quota, auth, invalid), an optional `reason` (`UNSUPPORTED_LANGUAGE`, `REQUEST_TOO_LARGE`, `RATE_LIMITED`, `CONFIGURATION`, `TOKEN_GRANT`) and what earlier batches billed. Adapters: DeepL (one key or a key pool), Microsoft Azure Translator v3, Google Cloud Translation (v2 with an API key, v3 on the EU endpoint with a service account; markup through `html-transport.ts`), and a mock for tests. With one engine configured `getTranslationProvider()` returns it; with two or more an `EngineRouter` (`engine-router.ts`): consented engines only, DeepL first, failover per request, rests per process (docs/AI_ENGINES.md).

### 2.4 Admin control center

A separate application with separate authentication (not Shopify OAuth), mandatory MFA, RBAC, and a dedicated PostgreSQL role. It is built in Phase 5. It never sees access tokens. Support access to merchant content requires a reason and is logged.

## 3. Request lifecycle (translation of selected products)

1. Merchant selects products and target locales in the UI. The action validates the input with zod.
2. The server resolves `shopId` from the session, checks the entitlement and quota, then creates a `TranslationJob` and a `UsageReservation` (estimated characters) in **one** transaction.
3. The job is enqueued (`jobId` is the BullMQ job ID, so a duplicate enqueue is a no-op).
4. The worker fans out `TranslationJobItem`s (resource × field × locale).
5. For each item: fetch source and digest → normalize → translation memory lookup → provider → validate → save `TranslationEntry` (draft or approved).
6. Publish step: re-fetch digests. If a digest changed, mark the item `STALE` and requeue discovery for it. Otherwise call `translationsRegister` (≤250 translations per call), then read back to verify.
7. Usage is committed from actual characters. The reservation is released. Usage events are emitted idempotently.

## 4. Environments

| Env | Shopify | DB / Redis | Deploy |
|---|---|---|---|
| development | Dev store in owner's Partner org | Local Docker Postgres 16 + Redis 7 | local |
| staging | Separate dev store, separate app config (`shopify.app.staging.toml`) | Separate Railway project | manual, on approval |
| production | Public app listing | Separate Railway project, backups, PITR | manual, explicit approval only |

None of these environments share anything with SOFTWAREFACH, KARINEX production, or existing Railway services.

## 5. Proposed repository structure

```
linguva/
├── app/                      # React Router app (from Shopify template)
│   ├── routes/
│   │   ├── app._index.tsx    # Overview
│   │   ├── app.languages.tsx
│   │   ├── app.products.tsx  … (one route per nav section)
│   │   ├── webhooks.*.tsx    # HMAC-verified, enqueue only
│   │   └── api.*.ts          # internal JSON endpoints (session-token auth)
│   ├── shopify.server.ts
│   └── root.tsx
├── server/                   # domain layer, framework-agnostic
│   ├── tenancy/              # withTenant(), RLS session var, guards
│   ├── shopify/              # typed GraphQL ops, throttle, digests
│   ├── translation/          # pipeline, normalizers, validators
│   ├── providers/            # deepl, azure, google, html-transport, engine-router, mock
│   ├── memory/               # translation memory
│   ├── glossary/
│   ├── seo/
│   ├── billing/              # entitlements, App Pricing reconciliation
│   ├── usage/                # ledger, reservations, App Events
│   ├── jobs/                 # queue defs, idempotency, DLQ
│   ├── privacy/              # compliance webhooks, retention
│   ├── audit/
│   └── lib/                  # config (zod env), logger, crypto, db, redis
├── worker/
│   └── index.ts              # worker entrypoint
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── rls/                  # SQL policies, applied by migration
├── tests/
│   ├── unit/  integration/  e2e/  security/  load/
│   └── fixtures/             # synthetic catalogs, benchmark corpus
├── docs/                     # this documentation set
├── docker-compose.yml        # local Postgres + Redis only
├── shopify.app.toml          # dev config (no secrets)
└── .github/workflows/ci.yml
```

`admin/` (the control center) is added in Phase 5 as a separate build target and deployment in the same repository. See decision D-03 in ROADMAP.md.

## 6. Architecture decision records

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Modular monolith (web + worker) over microservices | Proposed |
| ADR-002 | Shopify React Router template + Polaris web components | Proposed (per verified Shopify guidance) |
| ADR-003 | PostgreSQL + Prisma with RLS as defense in depth | Proposed |
| ADR-004 | BullMQ on Redis, one worker service, per-shop rate limiter | Proposed |
| ADR-005 | Shopify App Pricing for billing. Owner access via a free **private plan** plus an internal audited `Entitlement` | Proposed |
| ADR-006 | Access tokens encrypted at rest (AES-256-GCM, key from env/KMS) through a custom session storage wrapper | Proposed |
| ADR-007 | No customer/order scopes. The app processes catalog and content data only | Proposed |
