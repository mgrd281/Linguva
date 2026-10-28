# Development store setup and live verification

Status (2026-10-28): **A development store is connected**: `linguva-test-lab.myshopify.com` in the organization "Mein Shop". The owner reports that Shopify CLI, PostgreSQL, Redis, migrations and `pnpm preflight` work and that Linguva opens as an embedded app in the admin. No other check has been run on the store yet; until a check is run and logged, its behaviour stays an assumption encoded in the fakes (`tests/support/fake-store.ts`), checked against the Admin API 2026-10 schema. The step-by-step verification for phase J is in DEV_STORE_VERIFICATION.md.

Installing the app itself with Shopify CLI is described step by step in SHOPIFY_CLI_SETUP.md. This document lists what the owner has to provide, how to run the guarded live contract tests, and the manual checks in the embedded admin.

## 1. What the owner provides (items 1, 2, 6, 7 done as of 2026-10-28)

| # | Needed | Why | Who |
|---|---|---|---|
| 1 | Shopify Partner organization / Dev Dashboard access | Owns the Linguva app and the dev store | Owner |
| 2 | A **development store** in that organization (not a KARINEX store, no real customer data) | Only target for tests | Owner |
| 3 | At least one additional language enabled on the dev store (for example German), ideally also an RTL language (Arabic) | Translation targets | Owner (Settings → Languages) |
| 4 | Optional: a second market with its own language (Settings → Markets) | Markets checks | Owner |
| 5 | Test catalog: a few products and collections created for testing (Shopify's sample data generator or by hand) | Content to translate | Owner |
| 6 | `shopify app config link` against the Partner app. This fills `client_id` in `shopify.app.toml` | Embedded app runs | Owner (local machine) |
| 7 | Local `.env` from `.env.example`, with `TOKEN_ENCRYPTION_KEYS` generated locally. **Never commit it** | App start | Owner (local machine) |
| 8 | For live contract tests: Dev Dashboard app credentials (see §2) | API access for tests | Owner |
| 9 | Optional: DeepL API Free key (`…:fx`, free, 500,000 characters/month) | Real AI quality checks. Without a key, the mock provider is used | Owner, needs approval |

Secrets are only ever set as local environment variables. They never go into the repository, the PR or a chat.

## 2. Live contract tests (`pnpm test:live`)

`tests/live/` runs the production code paths (GraphQL operations, digest-checked publishing, the bulk item processor, protection of existing translations, revisions and restore) against the dev store. They are **not run in CI**. Their GraphQL operations are validated against the schema by `pnpm graphql-codegen`, which CI runs.

### Safety gates (enforced in `tests/live/guard.ts`)

- Off unless `LIVE_SHOPIFY_SHOP` and credentials are set.
- `LIVE_SHOPIFY_SHOP` must be a `*.myshopify.com` domain. Domains containing `karinex` or `softwarefach`, plus anything in `LIVE_DENY_DOMAINS`, are refused.
- Before anything else, the tests read `shop { myshopifyDomain plan { partnerDevelopment } }` and stop unless the token belongs to exactly that store **and** `partnerDevelopment` is `true`. If a genuine dev store is refused, report its plan name. Don't loosen the check.
- Without `LIVE_ALLOW_WRITES=yes`, the tests only read.
- With writes enabled, the tests create their own fixtures: a **draft** product and an unpublished collection, named `Linguva live test <run id>` and tagged `linguva-live-test`. They write translations only to those fixtures, and delete them afterwards, even when a test fails. Bulk processing gets items for the fixtures only; there is no discovery over the store's catalog. Deletion refuses any resource the run didn't create.
- The mock translation provider is used, so there are no AI costs and no text is sent to a provider.

### Credentials

For **read-only** live checks no extra app is needed: `LIVE_USE_APP_SESSION=yes` uses the Linguva app's own offline session from the local development database (decrypted in memory, never printed; refused together with `LIVE_ALLOW_WRITES`). See DEV_STORE_VERIFICATION.md §4.1. For fixture writes:

Shopify no longer allows creating new custom apps in the Shopify admin. Use a Dev Dashboard app in the **same organization** as the dev store (client credentials grant, token valid for 24 hours):

1. In the Dev Dashboard, create an app "Linguva live tests" (separate from the Linguva app).
2. In its version, select these scopes: `read_products`, `write_products` (fixtures only), `read_content` and `read_online_store_pages` (pages, blogs, blog posts), `read_translations`, `write_translations`, `read_locales`, and optionally `read_markets`. Release the version.
3. Install it on the dev store.
4. Copy the client ID and secret into local environment variables only.

An existing admin-created custom app token (`LIVE_SHOPIFY_ADMIN_TOKEN`) also works.

### Run

```bash
pnpm db:up && pnpm db:migrate        # local PostgreSQL (the test database is used)
export LIVE_SHOPIFY_SHOP=your-dev-store.myshopify.com
export LIVE_SHOPIFY_CLIENT_ID=...    # or LIVE_SHOPIFY_ADMIN_TOKEN=...
export LIVE_SHOPIFY_CLIENT_SECRET=...
export LIVE_TARGET_LOCALE=de         # must already be enabled on the store
pnpm test:live                       # read-only checks
LIVE_ALLOW_WRITES=yes pnpm test:live # adds fixture writes
```

### What the live tests verify

| Check | Assumption verified |
|---|---|
| Products and collections are listed with SHA-256 digests | `translatableResources(resourceType:)` contract |
| Product keys include `title`, `body_html`, `handle`, `product_type`, `meta_title`, `meta_description`; collections the same, minus `product_type` | SEO fields are translatable resources |
| A translation registered with the current digest reads back with `outdated: false` | Publishing path |
| A wrong digest returns `INVALID_TRANSLATABLE_CONTENT` | Error code used by the fake store |
| A translated URL handle is accepted | Handle translation |
| Changing the source marks the translation `outdated: true`, changes the digest, and the old digest is refused | Outdated detection and conflict handling |
| `translationsRemove` removes a translation | Cleanup and future "remove" feature |
| A bulk item keeps a translation made outside Linguva, fills only the gaps, and keeps markup and links from the source | **Protection of existing translations** |
| With explicit permission, the translation is replaced and the old value is kept as an EXTERNAL revision | Overwrite permission and history |
| A collection is translated, and its handle is never machine-translated | Collections in bulk jobs |
| A manual edit is published, and the previous version is restored | Editor history and restore |
| Markets and web presences are readable with the app's query (with `read_markets`) | Markets page |
| Product, collection and blog post images expose `alt` as their only translatable key | Image alt text (MEDIA_IMAGE, nested COLLECTION_IMAGE / ARTICLE_IMAGE) |
| A text metafield on the fixture product is reported translatable, with key `value`, and its translation reads back | Metafield translation |

## 3. Manual checks in the embedded admin

The full list of test cases, with expected results and the beta exit criteria, is in DEV_STORE_TEST_PLAN.md. The short list below is the minimum.

Run `pnpm dev` (Shopify CLI tunnel) with the dev store and `TRANSLATION_PROVIDER=mock`, and Redis for bulk jobs. Record each result in §4.

1. Install: OAuth/token exchange, Overview page, a `Shop` row, sessions encrypted in the database.
2. Languages page: lists the store's languages, the 20-language limit, the RTL warning.
3. Products and Collections: coverage per language, pagination.
4. Editor: AI draft, edit, publish; reload shows Shopify's value; the outdated badge after changing the source in Shopify; the "still correct" confirmation.
5. Translation memory: publish a text, then a second product with the same text → zero AI characters used; "Fill from memory" on similar text.
6. Glossary: "never translate" term stays unchanged; a forbidden term blocks the result; CSV import and export.
7. Bulk: "Translate all" in review mode → drafts on the Review page, nothing published; approve → published; reject → not re-drafted.
8. Protection: translate a field by hand in Shopify's Translate & Adapt app, then run bulk → kept unless "also replace" is ticked.
9. History: restore an earlier version; refused after the source changed.
10. Second language, including RTL (Arabic): the editor's direction warning; storefront check.
11. Markets: note which markets and languages exist. Market-specific translations are not implemented yet (see SEO_ARCHITECTURE.md).
12. Uninstall and reinstall: sessions deleted, jobs cancelled; reinstall works. `shopify app webhook trigger` for the compliance topics.

## 4. Results log

| Date | Store | Check | Result | Notes |
|---|---|---|---|---|
| 2026-10-28 | linguva-test-lab | CLI link, preflight, embedded app opens | Reported by the owner | First open only; the checks in DEV_STORE_VERIFICATION.md are next |
