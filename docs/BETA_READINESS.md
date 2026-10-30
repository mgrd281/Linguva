# Beta readiness review

Review date: 2026-10-27, branch `claude/gallant-pasteur-8opy75` (draft PR, not merged, not deployed). Feature states are in FEATURE_STATUS.md, test cases in DEV_STORE_TEST_PLAN.md.

**Verdict: not ready for a beta yet.** The code is feature-complete for a first beta and tested locally: 513 unit, integration, security and performance tests and 81 browser tests, all in CI. What is missing is verification on Shopify and the operator's accounts and decisions, listed below. **Verified on Shopify so far: the read-only checks** on the development store (2026-10-28: read contract, every content type probed, coverage scan equal to an independent recount on a small store). Nothing that writes to Shopify, no webhook, billing or admin UI check yet (FEATURE_STATUS.md).

## 1. Blockers

### 1a. Need the owner (external accounts or decisions)

| # | Blocker | Why it blocks | Next step |
|---|---|---|---|
| B1 | Development store connected (linguva-test-lab, 2026-10-28), but nothing verified on it yet | Every Shopify behaviour is an assumption encoded in fakes until a check is logged | Owner: DEV_STORE_VERIFICATION.md (commands and checklist), results in DEV_STORE_TEST_PLAN.md §3 |
| B2 | App not linked (`client_id` empty) | `shopify app dev` can't run | Owner: `pnpm config:link` (creates the development app) |
| B3 | Plans not created in the Partner Dashboard; no Partner API client | Billing can't be verified (L1–L14); prices decided 2026-10-30 (PRICING_DECISION.md) | Owner: create exactly the decided plans `free/starter/pro/business` (PRICING_DECISION.md §9), Partner API client |
| B4 | AI provider not verified (no DeepL key) | Translation quality, real character counts and costs unknown | Owner: approve a DeepL API Free key first (no cost), then a budget |
| B5 | No production hosting, backups, monitoring, error tracking | A beta needs a reachable, monitored service | Owner: choose and approve hosting (separate from KARINEX/SOFTWAREFACH systems) |
| B6 | Legal: privacy policy, data processing terms, sub-processor list (DeepL), App Store listing | Required by the App Store and GDPR | Owner, with legal review |
| B7 | Branch protection on `main` (required reviews, code owners) not enabled; repository public | Reviews of security-sensitive changes aren't enforced | Owner: GitHub settings |

### 1b. Engineering (no accounts needed)

None open. The defects found in this round are fixed (§3). The remaining engineering items in §4 don't block a beta with a small number of known merchants.

## 2. Requirements by area

| Area | Tested Locally | What the dev store must confirm (cases) |
|---|---|---|
| Install and auth | Install through token exchange, encrypted tokens, forged and cross-store tokens refused (UI tests); concurrent first open | A1–A5, real OAuth scopes approval |
| Translation and publishing | Editor, AI drafts, publish with digest check and read-back (integration + UI) | C1–C7 (outdated flags, storefront) |
| SEO | Checks, preview, handles, SEO-only jobs, coverage | D1–D4, K1–K3 |
| Bulk jobs | Queues, retries, throttling, cancel/resume, drafts by default | E1–E6 (real throttling, large catalogs) |
| Translation memory, glossary | Unit, integration, security, 100k performance | F1–F3, G1–G3 |
| Review and restore | Integration; Review page in the browser | H1–H5 |
| Images, metafields, Markets | Integration and security; live tests prepared | I1–I6, J1–J4 (nested image ids, `Metafield.translatable`) |
| Billing | Simulated Partner API; Plan page with prices and the trial allowance in the browser; complimentary access | L1–L14 (no charges on dev stores) |
| Uninstall, compliance | Webhook routes, HMAC, data deletion | N1–N3 with `shopify app webhook trigger` |
| UX and accessibility | Error, empty and loading states; axe WCAG 2.1 AA; phone layout | Visual check inside the real admin (App Bridge title bar and navigation) |

## 3. Defects found and fixed in this round

| Defect | Impact | Fix |
|---|---|---|
| First open after install failed: parallel loaders created the shop twice (unique constraint) | Every new merchant could see an error page on first open | Concurrency-safe install, tests with 6 parallel installs (7d8de34) |
| The app couldn't start under `shopify app dev`: nothing loaded `.env` | Dev store install impossible without exporting every variable | `.env` loaded in development only (2eaebec) |
| `.dockerignore` didn't exclude `.env` | Local secrets could end up in a Docker image | Excluded (2eaebec) |
| `shopify.app.toml` lacked `application_url`, `embedded`, `[build]`, `[auth] redirect_urls` | CLI prompts or fails; redirect URLs are required | Completed per the official template (2eaebec) |
| Shopify API errors showed a bare "503" page | Merchants were left without explanation or a way forward | Clear error pages with Try again on every page (8733b64) |
| No `<title>`, language codes instead of names, Review actions only at the end of long lists, SEO preview notes run together | Accessibility and usability | Fixed (8733b64) |
| An empty Redis snapshot was committed by accident | None (no data) | Removed, `*.rdb` ignored (79ae979) |

Quality scores per area with evidence: QUALITY_AUDIT.md (7.1/10 on average after phase A, Tested Locally only).

## 4. Known non-blocking items

| Item | Notes |
|---|---|
| Images and metafields aren't in bulk jobs or the coverage report | Editor only |
| Rich text, JSON and list metafields aren't editable | Need structure-aware editing |
| Market-specific translations | Markets page is read-only |
| Bulk jobs started from the UI need the worker (started by `pnpm dev` with a worker web configuration, or `pnpm worker:dev`) | Documented; the UI tests don't run a worker |
| Polaris tables: axe can't read roles set through `ElementInternals` | Checked in Chromium's accessibility tree instead (UI_TESTING.md) |
| Shopify's library logs `config.future.expiringOfflineAccessTokens` on every token exchange | Library behaviour, harmless |

## 5. Owner complimentary access (for the owner's own stores)

Implemented and tested locally (BILLING_DESIGN §4). To use it on an own store after the beta release: install the app on the store, open it once, run `pnpm ops:complimentary grant` with the owner database role, and add the store's GID to `COMPLIMENTARY_SHOP_GIDS`. It must never be used for a customer store. Test it first on a second development store (DEV_STORE_TEST_PLAN.md L10), not on a production store.
