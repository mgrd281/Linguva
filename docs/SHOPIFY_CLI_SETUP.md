# Installing Linguva on a development store with Shopify CLI

This guide takes the owner from a fresh checkout to Linguva running inside a Shopify **development store**. It uses the commercial app's own code and Shopify CLI. Nothing here deploys to production, creates charges, or touches a KARINEX or SOFTWAREFACH store.

What runs where:

| Part | Where | Started by |
|---|---|---|
| Embedded app (React Router web server) | Your machine, reached by Shopify through the CLI tunnel | `pnpm dev` (`shopify app dev`) |
| Worker (bulk jobs, coverage) | Your machine | Started by `pnpm dev` when the CLI has a worker web configuration; otherwise `pnpm worker:dev` |
| PostgreSQL 16, Redis 7 | Your machine | `pnpm db:up` (Docker) or local services |
| App configuration, scopes, webhooks | Shopify, applied to the dev store by `shopify app dev` | `shopify.app.toml` |

## 1. Accounts (owner, once)

1. A Shopify Partner organization (Dev Dashboard access). Use the organization that will own the commercial app.
2. A **development store** in that organization: Dev Dashboard → Stores → Create development store. Use the test data generator, and no real customer data.
3. On the store: Settings → Languages → add German (published) and Arabic (unpublished), as in DEV_STORE_TEST_PLAN.md P1.

## 2. Local setup

```bash
git clone https://github.com/mgrd281/Linguva && cd Linguva
git checkout claude/gallant-pasteur-8opy75     # until PR #1 is approved and merged
corepack enable && pnpm install                 # Node.js 22.12 or later
pnpm db:up                                      # PostgreSQL + Redis (Docker)
# without Docker: create the roles yourself
#   psql -U postgres -f scripts/db/init-roles.sql
cp .env.example .env
```

Edit `.env` (it is git-ignored and excluded from Docker images; never commit it):

| Variable | Value for the dev store |
|---|---|
| `TOKEN_ENCRYPTION_KEYS` | Generate: `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"` |
| `TRANSLATION_PROVIDER` | `mock` (no costs). A DeepL Free key (`…:fx`) only with your approval |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `REDIS_URL` | Keep the defaults from `.env.example` for the local services |
| `SHOPIFY_DEV_STORE` | Optional: your dev store domain, checked by preflight against the production deny list |
| Billing variables | Leave unset for the first run (all features available). See section 6 |

Do **not** put `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` or `SHOPIFY_APP_URL` in `.env`: `shopify app dev` provides them.

```bash
pnpm db:migrate        # applies migrations as the owner role
```

## 3. Link the app (creates the Linguva development app)

```bash
pnpm config:link       # = shopify app config link
```

- Log in with the Partner account, pick the organization.
- Choose **"Yes, create it as a new app"** and name it, for example "Linguva Dev". This app is only for development. The production app gets its own configuration later (`shopify.app.production.toml`, with `automatically_update_urls_on_dev = false`), only with your approval.
- The CLI writes the app's `client_id` into a configuration file (it may create `shopify.app.<name>.toml` and select it). The `client_id` is not a secret. Review the file before committing it.

## 4. Preflight

```bash
pnpm preflight
```

It checks without contacting Shopify:

- the Node version;
- the app link and that every webhook subscription has a route;
- that no production store is configured;
- the environment and that the encryption key isn't an example key;
- the database posture (runtime role under RLS, no bypass) and that migrations are applied;
- Redis;
- whether the AI provider costs money.

Fix every ✗ before continuing.

## 5. Run on the development store

Terminal 1:

```bash
pnpm dev               # = shopify app dev; choose your development store when asked
```

The worker (bulk jobs, coverage scans, automatic translation) must run as well. If your Shopify CLI setup starts it together with the app (a worker web configuration with its own `dev` command), `pnpm dev`'s output shows the worker's `"worker started"` line; then don't start it again. Otherwise, in a second terminal:

```bash
pnpm worker:dev        # only if `pnpm dev` doesn't already start the worker
```

Two workers at once give no wrong results (jobs are idempotent) but double the Shopify API use and make logs confusing.

What happens on the first run:

1. The CLI opens a tunnel and updates the app URL and redirect URL in the development app (`automatically_update_urls_on_dev = true`). The placeholders `https://example.com` in `shopify.app.toml` are replaced only in the Dev Dashboard. Don't commit tunnel URLs.
2. The CLI applies `shopify.app.toml` to the dev store: scopes, optional scope `read_markets`, and webhook subscriptions (`app/uninstalled`, `app/scopes_update`, the three compliance topics).
3. Press `p` (or open the preview URL) to install. Shopify shows the requested scopes; approve them. Installation uses Shopify-managed installation and **token exchange**; there is no OAuth redirect to the app.
4. Linguva opens inside the admin. `afterAuth` stores the shop and its Shopify GID; the offline token is stored encrypted (AES-256-GCM).

Check: Overview loads, Languages lists German and Arabic, Products lists the test catalog. Then follow DEV_STORE_TEST_PLAN.md.

## 6. Permissions (scopes)

| Scope | Why |
|---|---|
| `read_products` | Products, collections, product images and metafields as translation sources |
| `read_content`, `read_online_store_pages` | Pages, blogs and blog posts |
| `read_translations`, `write_translations` | Read and publish translations |
| `read_locales` | Languages page: which languages the store has and which are published (Linguva doesn't add or publish languages) |
| `read_markets` (optional) | Markets page, requested only when it is opened |

No customer or order scopes. Changing scopes needs merchant re-approval; the unit test `tests/unit/preflight-checks.test.ts` fails on any change, so a change is always deliberate.

## 7. Webhooks

Subscriptions are declared in `shopify.app.toml` (API version 2026-10) and handled by `app/routes/webhooks.*.tsx`. Every delivery is HMAC-checked; an invalid signature gets 401.

Send sample deliveries while `pnpm dev` runs (the tunnel URL is shown by the CLI):

```bash
shopify app webhook trigger --api-version 2026-10 --topic app/uninstalled \
  --address https://<tunnel-host>/webhooks/app/uninstalled
shopify app webhook trigger --api-version 2026-10 --topic customers/data_request \
  --address https://<tunnel-host>/webhooks/customers/data_request
shopify app webhook trigger --api-version 2026-10 --topic customers/redact \
  --address https://<tunnel-host>/webhooks/customers/redact
shopify app webhook trigger --api-version 2026-10 --topic shop/redact \
  --address https://<tunnel-host>/webhooks/shop/redact
```

Sample payloads are always the same and aren't retried (Shopify CLI documentation). For an end-to-end check, uninstall the app from the dev store (DEV_STORE_TEST_PLAN.md N1–N3).

## 8. Billing on the dev store (optional, no charges)

1. In the Partner Dashboard: Apps → Linguva Dev → Pricing. Choose Shopify App Pricing, create the plans with the handles `free`, `starter`, `pro`, `business` (BILLING_DESIGN §2). On development stores every plan costs $0.
2. Partner Dashboard → Settings → Partner API clients: create a client with "Manage apps". Put its token in `.env` as `SHOPIFY_PARTNER_API_TOKEN`, and the organization id, app GID and app handle as in `.env.example`. The token reads data of every store in the organization: keep it only in `.env` or a secret manager.
3. `BILLING_REQUIRED=true`, restart `pnpm dev`, and follow DEV_STORE_TEST_PLAN.md §L.

Owner complimentary access for your own stores is a separate, server-side mechanism (BILLING_DESIGN §4). Don't test it on a customer store.

## 9. Clean up

- Stop `pnpm dev`. To remove the dev preview from the store: `shopify app dev clean`, or uninstall the app.
- `pnpm db:up` volumes keep local data; `docker compose down -v` deletes them.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Invalid environment configuration (…)" | `.env` incomplete; `pnpm preflight` names the variables |
| "Database security posture check failed" | `DATABASE_URL` uses the owner or a superuser role; use `linguva_app` |
| App loads but Products is empty | The store has no products, or a missing scope (reinstall after approving scopes) |
| Bulk job stays "Pending" | Worker not running (no `"worker started"` line in `pnpm dev`'s output: start `pnpm worker:dev`) or Redis unreachable |
| Markets page asks for permission | Expected: `read_markets` is optional; approve it on the page |
