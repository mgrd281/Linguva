# Railway hosting: staging first, KARINEX production later

Status 2026-10-28. **Prepared and tested locally; nothing is set up on Railway yet.** Every step on Railway, Shopify or a store is the owner's, in the order below, and the ones marked **Approval** need an explicit yes first (§9).

Goal: Linguva runs permanently on Railway and is installed in the KARINEX store. Path: a staging environment that can only serve the development store, then (after approval) a separate production environment and Shopify app for KARINEX.

Never touched by any of this: the existing invoice project on Railway, the KARINEX and SOFTWAREFACH stores, paid AI.

## 1. The failed build on Railway (evidence)

| Question | Evidence |
|---|---|
| Does the old Dockerfile build? | Yes. Built locally from commit `ef8b414` with Docker 29.9 (BuildKit): all steps pass, the image exports (36 s), **1.3 GB** |
| Where does the size come from? | `pnpm install` layer **748 MB**: dev dependencies (405 MB) plus pnpm's package store (273 MB). `pnpm prune --prod` ran in a later layer, which can't shrink an earlier one. The image also carried tests, docs and build logs |
| Is 1.3 GB over a Railway limit? | No: image size limit 4 GB on Trial/Free, 100 GB on Hobby, unlimited on Pro (Railway pricing page, 2026-10-28) |
| So what failed? | **Not determined.** The local build exports fine, so the failure is in Railway's export/push step for a reason the visible log doesn't show. Please send the last 30–50 lines of the build log (the lines after "exporting"), without variable values |

Changed regardless (it removes the most likely export problems and is better practice): a **multi-stage image** (`Dockerfile`): build stage with all dependencies, a production-dependency stage, and a runtime stage with only production dependencies and the build output, running as the unprivileged `node` user. **783 MB** (−40 %), export 21 s. Further possible saving (later, changes the lockfile): `@react-router/dev`, `vite-tsconfig-paths` and other build tools are listed as runtime dependencies by Shopify's template.

CI now builds this image on every push, runs the migrations from it as the owner role, starts the web app and the worker in staging mode and runs the smoke checks (`scripts/ci/image-check.sh`). A Dockerfile that doesn't build or start fails CI before it reaches Railway.

## 2. Architecture

```
Railway project "Linguva" (separate from the invoice project)
├── environment "staging"            ← this document, now
│   ├── web       Dockerfile image · public domain · health check /healthz
│   │             pre-deploy: node scripts/migrate.mjs (owner role)
│   ├── worker    same image · start: node build/worker/index.js · no domain
│   ├── Postgres  Railway template, private network; database "linguva",
│   │             roles linguva_owner (migrations) and linguva_app (runtime)
│   └── Redis     Railway template, private network (queues, rate limits)
│   Shopify app "Linguva Staging" (its own client ID and secret)
│   serves only: linguva-test-lab.myshopify.com
│
└── environment "production"         ← later, after approval (§8)
    same four services, own database, Redis and secrets
    Shopify app "Linguva" (custom distribution to KARINEX first)
```

Region: EU West (as the existing service), for data protection.

One image for both services: the web app answers Shopify (pages, webhooks); the worker runs bulk jobs, coverage scans and automatic translation from the Redis queues. Both read the same variables.

## 3. Safety built into the app (Tested Locally)

| Guard | Where | Effect |
|---|---|---|
| `LINGUVA_STAGE=staging` requires `TRANSLATION_PROVIDER=mock` and refuses a `DEEPL_API_KEY` | Configuration check at start (web and worker) | No paid AI from staging; a wrong variable stops the start with the variable's name, never its value |
| `ALLOWED_SHOPS` required in staging; KARINEX and SOFTWAREFACH refused even if listed | Configuration check | Staging can't be configured for a production store |
| A store not in `ALLOWED_SHOPS` gets **403** | Every app page, `/auth/*`, the login form, the install hook | No session, no tenant, no data for that store |
| A webhook from such a store: acknowledged (200), dropped, logged | Shared webhook handler, after the signature check | Shopify stops retrying; nothing stored |
| On Railway, `LINGUVA_STAGE` must be set and equal the environment's name | Configuration check | Staging variables copied into production (or the reverse) stop the start |
| `LINGUVA_STAGE=production` needs `LINGUVA_PRODUCTION_APPROVED=yes` | Configuration check | No accidental production release: the owner sets it for an approved one |
| `/healthz`: 200 when the database answers, 503 otherwise | Public route, no details | Railway waits for a healthy web app before switching traffic |
| Database posture check (runtime role: no superuser, no RLS bypass, RLS on every tenant table) | First request, and `preflight` | Fails closed if the roles are wrong |

Evidence: `tests/unit/staging-config.test.ts` (20 tests with `config.test.ts`), `tests/integration/webhooks.test.ts` (staging cases), `tests/integration/healthz.test.ts`, `tests/unit/smoke-checks.test.ts`, `tests/unit/deploy-config.test.ts`, and the image itself: `scripts/ci/image-check.sh` (in CI) and the manual checks in §7.

## 4. Stop automatic production deploys first (owner, 2 minutes)

Right now the service in the environment "production" deploys every push to `claude/gallant-pasteur-8opy75`. With the fixed Dockerfile the next push would build successfully; the guards above make it refuse to start (no variables, no stage, no approval), but it should not be deploying at all.

1. Railway → project Linguva → environment **production** → the Linguva service → **Settings**.
2. Under the GitHub source: click **Disable** for automatic deploys (or disconnect the repository).
3. Optional: delete that service; production is set up fresh in §8.

Tell me when this is done: I hold back the next push until then. (Owner chose on 2026-10-28 to convert this environment into staging instead: §4a.)

## 4a. Converting the existing environment into staging (owner's choice, 2026-10-28)

The service that already runs in the environment named "production" (unexposed, deployed from this branch with the older image) becomes staging instead of being rebuilt. In this order:

1. **Service → Settings: Disable automatic deploys**, turn on **Wait for CI**. From here on, a push only builds when you click **Deploy Latest Commit**. Tell me, and I push the guarded version.
2. **Rename the environment to `staging`** (Project Settings → Environments). The app checks that `LINGUVA_STAGE` equals the environment's name. If renaming isn't offered: **+ New Environment → Duplicate Environment** named `staging`, then delete the old one.
3. **Variables of the service:** add `LINGUVA_STAGE=staging`, `ALLOWED_SHOPS=linguva-test-lab.myshopify.com`, `TRANSLATION_PROVIDER=mock`; remove `DEEPL_API_KEY` if present. Compare the rest with §5.3.
4. **Database roles:** `DATABASE_URL` must use `linguva_app` and `MIGRATION_DATABASE_URL` `linguva_owner` (§5.2). With Railway's `postgres` admin user as the runtime role, the app refuses to serve (posture check: superuser).
5. **Settings (§5.4):** pre-deploy command `node scripts/migrate.mjs` (the new image no longer migrates at start), health check `/healthz`, restart on failure, **Generate Domain**. Rename the service `web`.
6. Add **Redis** and the **worker** service (§5.1 steps 2 and 4, §5.3, §5.4) if they aren't there yet.
7. **Deploy Latest Commit** on `web`, then on `worker`; validate as §6.

Production for KARINEX is created later as a new, separate environment (§8).

## 5. Staging setup (owner, about 45 minutes; **Approval**: running services cost Railway usage)

### 5.1 Environment and services
1. Environment drop-down → **+ New Environment** → **Empty Environment** → name it exactly `staging` (the app checks the name).
2. In `staging`: **+ New** → Database → **PostgreSQL**. Then **+ New** → Database → **Redis**.
3. **+ New** → GitHub repo → `mgrd281/Linguva`, branch `claude/gallant-pasteur-8opy75` → rename the service `web`.
4. Same repository and branch again → rename it `worker`.
5. For **both** `web` and `worker` → Settings: automatic deploys **Disable**; turn on **Wait for CI**. Staging is then deployed only on purpose: Command Palette (CMD + K) → **Deploy Latest Commit**, after CI is green.

Railway reads the `Dockerfile` in the repository root for both. Config-as-code files (`railway.json`) are deprecated for new services (cutoff 2026-12-01), so the settings are made in the dashboard (§5.4).

### 5.2 Database roles (your terminal; passwords never leave it)
1. Postgres service → **Variables** → copy `DATABASE_PUBLIC_URL` (the admin connection; only into your terminal).
2. In the project folder:
   ```bash
   export LINGUVA_OWNER_PASSWORD="$(openssl rand -hex 24)"
   export LINGUVA_APP_PASSWORD="$(openssl rand -hex 24)"
   psql "<DATABASE_PUBLIC_URL>" -v ON_ERROR_STOP=1 -f scripts/db/hosted-roles.sql
   ```
   It prints both roles with `superuser f, bypass_rls f, create_role f, create_db f`. Safe to run again.
3. Keep the terminal open: the two passwords go into Railway variables next (§5.3), then close it.

Tested on a fresh PostgreSQL 16 (2026-10-28): roles created, second run changes nothing, stops when a password is missing, migrations run as `linguva_owner`, posture check passes as `linguva_app`.

### 5.3 Variables (staging)
Generate the encryption key in your terminal: `echo "k1:$(openssl rand -base64 32)"`. Enter secrets only in Railway's variable editor.

**Shared variables** (environment `staging` → Settings → Shared Variables):

| Variable | Value |
|---|---|
| `LINGUVA_STAGE` | `staging` |
| `TRANSLATION_PROVIDER` | `mock` |
| `ALLOWED_SHOPS` | `linguva-test-lab.myshopify.com` |
| `SHOPIFY_API_KEY` | Client ID of the "Linguva Staging" app (§5.5) |
| `SHOPIFY_API_SECRET` | Its client secret (secret) |
| `SCOPES` | `read_products,read_content,read_online_store_pages,read_translations,write_translations,read_locales,write_locales` |
| `TOKEN_ENCRYPTION_KEYS` | The generated `k1:…` value (secret; staging only, never reused in production) |
| `LINGUVA_APP_PASSWORD` | From §5.2 (secret) |
| `LOG_LEVEL` | `info` |

**Service `web`** (Variables):

| Variable | Value |
|---|---|
| `SHOPIFY_APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `DATABASE_URL` | `postgresql://linguva_app:${{shared.LINGUVA_APP_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/linguva` |
| `MIGRATION_DATABASE_URL` | `postgresql://linguva_owner:<LINGUVA_OWNER_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/linguva` (secret; only on `web`: only migrations need it) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |

**Service `worker`** (Variables):

| Variable | Value |
|---|---|
| `SHOPIFY_APP_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `DATABASE_URL` | same as `web` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `LOG_SERVICE` | `linguva-worker` |

Not set in staging: `DEEPL_API_KEY` (refused), `SHOPIFY_PARTNER_*` and `BILLING_REQUIRED` (billing off), `COMPLIMENTARY_SHOP_GIDS`, `LINGUVA_PRODUCTION_APPROVED`. `NODE_ENV=production` comes from the image.

### 5.4 Service settings

| Setting | `web` | `worker` |
|---|---|---|
| Builder | Dockerfile (detected) | Dockerfile (detected) |
| Custom start command | (empty: image default `react-router-serve ./build/server/index.js`) | `node build/worker/index.js` |
| Pre-deploy command | `node scripts/migrate.mjs` | (empty) |
| Health check path | `/healthz` | (none: no web server) |
| Restart policy | On failure | On failure |
| Networking | **Generate Domain** (`*.up.railway.app`) | none (private only) |
| Replicas | 1 | 1 |

### 5.5 Shopify app "Linguva Staging" (Dev Dashboard, free)
A separate app, so staging never shares a client ID, secret or installs with development or production.

1. Dev Dashboard (organization "Mein Shop") → **Create app** → name `Linguva Staging`.
2. Copy `deploy/shopify/shopify.app.staging.toml` to the project root as `shopify.app.staging.toml`; fill in `client_id` (the app's Client ID, not a secret) and replace `STAGING-DOMAIN` (twice) with the `web` domain from §5.4.
3. `pnpm shopify app deploy --config staging` sends the URLs, scopes and webhooks to the staging app (a Shopify app version of the staging app only). **Approval**.
4. Put its Client ID and secret into the shared variables (§5.3).
5. Install it on `linguva-test-lab` only (Dev Dashboard → the app → test on a development store).

Your local development app and `shopify.app.toml` stay as they are; `pnpm dev` is unaffected.

## 6. Deploy and validate staging

Order: Postgres and Redis running → roles (§5.2) → variables (§5.3) → **Deploy Latest Commit** on `web` (pre-deploy runs the migrations, then the health check must pass) → the same on `worker`.

| Check | How | Expected |
|---|---|---|
| Build | Railway build log of `web` | Ends with the image pushed; image about 780 MB |
| Migrations | `web` deploy log, pre-deploy step | `All migrations have been successfully applied.` |
| Health, webhooks, refusal of KARINEX | Your terminal: `pnpm ops:smoke --url https://<web domain> --refused-shop karinex.myshopify.com` | `All 6 checks passed.` |
| Worker | `worker` logs | `"worker started"` with `"provider":"mock"` |
| Database isolation | `web` logs after the first page | No `database posture` error (the app stops serving if the runtime role could bypass RLS) |
| Authentication | Open Linguva Staging in linguva-test-lab's admin | App opens embedded; Overview loads |
| Background jobs | Coverage → Scan store | Progress, then figures; `worker` logs show the scan |
| Webhooks | Change a product title on the dev store with automatic translation on | `web` logs `POST /webhooks/content 200`; an "Automatic" job appears (mock text) |
| Translations stay mock | Translate a product with AI | Draft text marked `[fr] …`; nothing sent to DeepL |

Record the results in DEV_STORE_TEST_PLAN.md §3 like the store checks.

### 6a. Results on Railway staging (2026-10-28, owner's screenshots and terminal output)

Environment `staging` with `Linguva` (web), `worker`, Postgres and Redis; Shopify app "Linguva Staging" (version `linguva-staging-2`) installed on linguva-test-lab only; provider mock.

| Check | Result |
|---|---|
| Build and deploy of `web` | Deployment successful on `2b38f89` |
| `pnpm ops:smoke --url https://linguva-staging.up.railway.app --refused-shop karinex.myshopify.com` | **All 6 checks passed**: health 200 with database, public page 200, `nosniff`, unsigned webhook 401, app page without session 410, KARINEX 403 on `/app`, `/auth/login`, `/auth/callback` |
| Authentication | Linguva Staging opens embedded in linguva-test-lab; Overview loads (store, languages, AI usage) |
| Translation stays mock | Product "Premium Baumwoll-T-Shirt" → French: drafts `[fr] …`; usage 98 characters of the 20,000 allowance; no DeepL key exists in staging |
| Publishing to Shopify | Owner published the two drafts on purpose: "2 Übersetzungen veröffentlicht"; the editor's search preview then shows `[fr] …` read back from Shopify. French stays unpublished in the store |
| Background jobs | A bulk job stayed "In der Warteschlange" while no `worker` service existed; after adding `worker` (start `node build/worker/index.js`, variables of `web` without `MIGRATION_DATABASE_URL`), the queued job ran and finished ("Abgeschlossen", nothing left to translate) |
| Webhooks | Product title changed in the Shopify admin to "Premium Baumwoll-T-Shirt 2": Linguva marked the French title **Veraltet** (outdated) within 30 s, the unchanged description stayed "Übersetzt" |

Problems met on the way, for the next environment:

- 401 Unauthorized when opening the app: `SHOPIFY_API_SECRET` in Railway still belonged to the development app. It must be the client secret of the app whose client ID is `SHOPIFY_API_KEY`.
- `shopify app deploy --config staging` asks "Create this project as a new app?": answer **No, connect it to an existing app** and pick "Linguva Staging"; release only when the prompt names "Linguva Staging".
- The `worker` service is required: without it bulk jobs, coverage scans and automatic translation wait forever in the queue.

| Coverage scan (worker) | "Shop prüfen" finished in under a minute (21:01 UTC): French 15 % = 4 of 26 fields (3 outdated, 19 missing); by field 1/23 titles and names, 3/3 descriptions, handles 0/5 (not in the totals); the whole-store figure stays empty because French isn't published. The parts add up to the total; I did not recount against the Admin API this time (the earlier live run did, DEV_STORE_VERIFICATION.md) |

Still open on staging: an automatic-translation job triggered by a webhook, and the clean-up below.

Clean-up the owner still has to do: new passwords for `linguva_owner` and `linguva_app` (they appeared in a terminal transcript) and updated `DATABASE_URL` / `MIGRATION_DATABASE_URL`; remove Postgres's public TCP proxy; rotate the development app's client secret that was pasted earlier.

## 7. Validated locally (2026-10-28, Tested Locally)

With the image built from this branch, local PostgreSQL 16 and Redis, staging variables with throwaway secrets:

- Migrations from the image as the owner role: all applied.
- Web app (`react-router-serve`) and worker start as user `node`; worker `"worker started"`, provider mock.
- `pnpm ops:smoke`: all 6 checks pass: health 200, public page with security headers, unsigned webhook 401, app page without session not served, KARINEX 403 on `/app`, `/auth/login` and `/auth/callback`.
- Login form with "karinex": 403. Allowed test store: normal Shopify login redirect (302).
- Signed `app/uninstalled` from KARINEX: 200, logged "webhook dropped", nothing stored. From the test store: 200, processed.
- Posture check inside the container: runtime role `linguva_app`, RLS enforced, no bypass.
- Like the current Railway production service (`RAILWAY_ENVIRONMENT_NAME=production`, no variables): exits at start. Staging variables with `RAILWAY_ENVIRONMENT_NAME=production`: exits with "LINGUVA_STAGE: must match the Railway environment's name".

Not verifiable here: Railway itself (build service, private network, domains, health check behaviour), the staging Shopify app, real webhooks from Shopify.

## 8. KARINEX production (started 2026-10-28 with the owner's approval of each step)

Plan as prepared:

1. Owner decisions first (OWNER_DECISIONS.md): DeepL key and its cost, plans/billing or complimentary access for the own store, backups, monitoring, privacy texts.
2. Railway environment `production` (fresh, its own Postgres and Redis, roles via §5.2 with new passwords, its own `TOKEN_ENCRYPTION_KEYS`).
3. Shopify: a production app with **custom distribution** to the KARINEX store first (App Store later); config from `deploy/shopify/shopify.app.production.toml`, deployed with `--config production`.
4. Variables as §5.3 but: `LINGUVA_STAGE=production`, `TRANSLATION_PROVIDER=deepl` with `DEEPL_API_KEY` (only after approval), `ALLOWED_SHOPS=<KARINEX's *.myshopify.com domain>` for the start, and `LINGUVA_PRODUCTION_APPROVED=yes` set by the owner when releasing.
5. A database backup before the first install; then install on KARINEX, review-first settings (no automatic publishing).

### 8a. What runs now (owner's screenshots and terminal output, 2026-10-28)

| Part | State |
|---|---|
| Railway environment `production` | `web` (Dockerfile build, pre-deploy `node scripts/migrate.mjs`, health check `/healthz`, restart on failure, automatic deploys off), `Postgres-B0jH`, `Redis-0ZIz`; public address `web-production-73603.up.railway.app`. Deployed commit `969ad79` |
| Database | Roles from §5.2 with new passwords, run from the owner's terminal; migrations applied by the pre-deploy step |
| Variables | `LINGUVA_STAGE=production`, `ALLOWED_SHOPS=45dv93-bk.myshopify.com` (KARINEX's Shopify domain; its admin address doesn't contain the name, so the staging guard lists it too), the app's client ID and secret, the 7 required scopes, a new `TOKEN_ENCRYPTION_KEYS`, database and Redis over Railway's private network, `LINGUVA_PRODUCTION_APPROVED=yes`. **No DeepL key**: AI translation is off, manual translation only |
| Smoke check | `pnpm ops:smoke` against the production address: all 6 checks passed |
| Shopify app | "Linguva KARINEX" in the karinex organization (versions `linguva-karinex-1`, `-2`), installed on KARINEX; opens embedded in the admin |

Not there yet, each one needs the owner's approval:

- **Background jobs** run inside the `web` service since the commit after `a53c718` (§8b); no `worker` service is needed in production. Until that deploy, "Messen" (coverage), bulk jobs and automatic translation waited in the queue (KARINEX's first measurement waited from 2026-10-28; it continues by itself after the deploy).
- **New code**: production runs `969ad79` until the next deploy. Railway deploys the connected branch `claude/gallant-pasteur-8opy75` itself once GitHub CI is green (auto deploy plus "Wait for CI"; found on 2026-10-28, switched off while the owner decided, switched on again by the owner the same night). Every commit of this branch that passes CI therefore reaches KARINEX; the owner can stop it with "Disable" under web, Settings, Source.
- **Countries on the Overview** need the optional permission `read_markets`: the button "Show countries" asks for it in KARINEX (read-only, Linguva never changes markets).
- **KARINEX's languages are already published.** Anything published from Linguva is visible to customers immediately; drafts stay invisible until published.

### 8b. Background jobs inside the web service (production)

Production has no `worker` service. The `web` process starts the worker itself, as a child process running the same `build/worker/index.js` a separate worker service runs (`app/.server/jobs/embedded-worker.ts`, started from `app/entry.server.tsx`):

- **On by default only when `LINGUVA_STAGE=production`.** `LINGUVA_EMBEDDED_WORKER=on` or `off` decides elsewhere; any other value means off (the variable exists to switch jobs off, so a typo fails safe). Staging keeps its own worker service and runs none in `web`.
- **The web keeps serving whatever the worker does.** A crashed or killed worker is restarted after 1 s, 2 s, 4 s … up to 5 minutes; a run of a minute or more resets the delay. Lower CPU priority and first in line for the out-of-memory killer (best effort). The child gets the web's variables without `MIGRATION_DATABASE_URL`.
- **Redeploys:** SIGTERM reaches the worker through the web process; active jobs get the time Railway allows (draining) and are picked up again by the next worker. A coverage measurement whose chain of page jobs broke (killed between saving a page and queueing the next) continues by itself within 15 minutes (`requeueStalledReports`, part of the worker's 5-minute sweep, one worker at a time).
- **Heartbeat:** while its queues run, the worker writes `lv:production:worker:heartbeat` to Redis every 15 s with a 45 s expiry. `GET /healthz/worker` answers 200 while it exists, else 503 (no details). Check from your machine: `pnpm ops:smoke --url https://web-production-73603.up.railway.app --expect-worker`. Railway's deploy health check stays `/healthz` (database only).
- **Logs** (Railway, web service): `embedded worker on` → `embedded worker started` → `worker started` with `"mode":"embedded"`; after a crash `embedded worker exited` with the restart delay. Filter by `"service":"linguva-worker"`.
- **Cost:** one more Node process in the same service, about 100–150 MB of memory (roughly 1–2 USD a month at Railway's memory price); no new service.
- **Emergency switch**, only if asked: web, Variables, `LINGUVA_EMBEDDED_WORKER` = `off`, deploy.
- **Payloads stay compatible** across a deploy overlap (old and new worker run together for a few seconds; each job goes to one of them).
- **The DeepL key** goes into the `web` service's variables only; the worker inherits them.

Clean-up still open (owner): Postgres-B0jH's public TCP proxy (only needed while creating the roles), the file with the production passwords on the owner's computer, and the client secret of "Linguva KARINEX" that was pasted into a chat (owner decided to keep it for now).

## 9. Changes that need your approval

| # | Change | Why approval | Cost |
|---|---|---|---|
| 1 | Disable automatic deploys of the "production" environment (§4) | Your Railway project | None |
| 2 | Create the `staging` environment with web, worker, Postgres, Redis (§5.1) | Running services | Railway usage (4 small services around the clock; I haven't measured it: check the project's Usage page after a day) |
| 3 | Create the "Linguva Staging" app and `shopify app deploy --config staging` (§5.5) | New Shopify app in your organization | Free |
| 4 | Install Linguva Staging on linguva-test-lab | Store change (dev store only) | Free |
| 5 | Everything in §8 (production, KARINEX) | Production, real store, paid AI | DeepL and Railway production usage |
| 6 | ~~A `worker` service in production~~: not needed, the `web` service runs the worker (§8b) | — | About 100–150 MB more memory in `web` |
| 7 | Deploying newer commits to production (§8a) | Changes what KARINEX's staff see | None beyond the running service |

What I changed in the repository (this branch, nothing deployed): the Dockerfile, `.dockerignore`, the staging guards, `/healthz`, `pnpm ops:smoke`, `scripts/db/hosted-roles.sql`, `scripts/ci/image-check.sh` and its CI step, the two Shopify app templates in `deploy/shopify/`, and this document.
