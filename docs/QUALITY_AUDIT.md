# Quality audit

Audit date 2026-10-27. Branch `claude/gallant-pasteur-8opy75` (draft PR, not merged, not deployed). The goal is to be among the best Shopify translation apps. This audit shows how far Linguva is from that, area by area, with evidence and a plan.

## 1. How scores are given

Each area has **10 criteria** for what a top Shopify translation app needs. A score is the sum of the points:

| Mark | Points | Meaning |
|---|---|---|
| ✅ | 1 | Met, with automated evidence (test, measurement) in this repository |
| ◐ | 0.5 | Partly met, or met only against simulated Shopify where Shopify's real behaviour decides |
| ❌ | 0 | Not met |

Rules:

- **No area gets 10/10 without verification on a development store.** Every Shopify-facing criterion counts as ◐ at most until it is Verified on Shopify (FEATURE_STATUS.md).
- The criteria were written before scoring. Evidence names the test or document.
- There is **no measured comparison with competitor apps yet**. Their features were not tested, so "best in class" here means these criteria, not a benchmark.
- Test basis for this audit: 452 Vitest tests (unit, integration with PostgreSQL and RLS, security, performance) and 47 Playwright browser tests on the production build. All pass locally and in GitHub CI.

## 2. Summary

| Area | Score before this round | Score now | Biggest gap |
|---|---|---|---|
| Design and modernity | 5.5 | **6.5** | No rendered HTML preview; not checked inside the real admin |
| Usability for beginners | 5.5 | **8** | App interface only in English; no test with real merchants |
| Desktop and mobile | 5 | **7.5** | No check on real devices or in the Shopify mobile app |
| AI translation | 5 | **7** | No real provider tested (no DeepL key), no measured quality |
| Content coverage | 3 | **5** | Images and metafields only one by one; no automatic translation of new products |
| SEO | 7 | **7** | Storefront output (hreflang, translated URLs) not verified |
| Performance | 4.5 | **6.5** | Real Shopify latency not measured; Review text search not indexed |
| Security | 6.5 | **8** | No external review; branch protection off; no production operations |
| Billing | 5 | **5.5** | Plans and prices not created; nothing verified on Shopify |
| Shopify integration | 6.5 | **6.5** | Not verified on a development store |
| Error handling and loading states | 6 | **7** | No error tracking service |
| **Average** | **5.4** | **6.8** | |

"Before" is the state before this round (commit 9a89523), scored against the same criteria. The changes are in §4. Billing rose through the usage warnings; SEO and Shopify integration didn't change in this round.

**Honest overall verdict: 6.8/10, Tested Locally only.** The code base is solid and well tested. Reaching 9–10 needs two things code can't supply: verification on a development store, and the owner's decisions and accounts (DeepL key, prices, hosting). Those are listed in §5.

## 3. Areas in detail

### 3.1 Design and modernity: 6.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Shopify's Polaris web components throughout, no foreign UI framework | ✅ | All routes use `s-*` components; `tests/ui/pages.spec.ts` |
| 2 | Consistent page structure: title, primary action, sections | ✅ | Every app page; `tests/ui/pages.spec.ts` |
| 3 | Progress and status are visible: progress bars, badges | ✅ | `ProgressBar` (role=progressbar), Overview; `tests/integration/overview.test.ts` |
| 4 | Source and translation side by side in the editor | ✅ | `ResourceTranslationEditor`; `tests/ui/flows.spec.ts` |
| 5 | HTML texts shown rendered (sanitised), not as raw HTML | ❌ | Raw HTML in the editor and Review (BETA_READINESS §4) |
| 6 | Search result preview like on Google | ✅ | `SeoPreview`; `tests/ui/pages.spec.ts` (Editor) |
| 7 | Empty states with guidance and a next step | ✅ | `tests/ui/states.spec.ts` |
| 8 | Native admin elements: title bar, save bar, toasts, modals (App Bridge) | ◐ | Admin loading bar and navigation only |
| 9 | Checked visually inside the real Shopify admin | ❌ | Needs a development store |
| 10 | App Store assets: icon, screenshots, listing text | ❌ | Not created |

**Plan:** (5) sanitised HTML preview with a server-side allowlist sanitiser, plus security tests. (8) After the dev store check: the App Bridge save bar in the editor and toasts for publishing. (9) Screenshot review in the admin, light and dark. (10) Listing assets once the design is confirmed in the admin.

### 3.2 Usability for beginners: 8/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Guided start: checklist from the store's real state, next step as the primary action | ✅ | `tests/integration/overview.test.ts`, `tests/ui/install.spec.ts` |
| 2 | Task-oriented navigation, at most 12 entries | ✅ | 12 entries (was 15) |
| 3 | Every action shows progress; no double submits | ✅ | Loading states on all buttons; `tests/ui/flows.spec.ts` checks the admin loading bar |
| 4 | Errors explain what happened and offer a way forward | ✅ | `RouteErrorBoundary`; `tests/ui/states.spec.ts` |
| 5 | Safe defaults: bulk results as drafts, automatic publishing only after confirmation | ✅ | `tests/security/draft-protection.test.ts` |
| 6 | Unpublished changes aren't lost by leaving the page | ✅ | New: `tests/ui/unsaved.spec.ts` |
| 7 | Every change can be undone | ✅ | Revisions and restore; integration tests |
| 8 | Search and filters on long lists | ✅ | Review, Jobs, theme texts; `tests/ui/content.spec.ts` |
| 9 | App interface in the merchant's language (at least German, French, Spanish) | ❌ | English only |
| 10 | Tested with real merchants (usability sessions) | ❌ | Not done |

**Plan:** (9) Move interface texts into message catalogues and use the admin's language from the session token; German first. This is a large change, so it goes in its own step. (10) 3–5 beta merchants with a short task list. That needs the owner.

### 3.3 Desktop and mobile: 7.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | No horizontal scrolling on a phone (Pixel 7) on all main pages | ✅ | `@responsive` tests, `expectNoHorizontalScroll` |
| 2 | Tables become readable lists on a phone | ✅ | Polaris tables; checked in the mobile project |
| 3 | Main flows run on a phone, not only page views | ✅ | `@responsive`: settings, content, editor warnings, RTL |
| 4 | Comfortable touch targets | ◐ | Polaris defaults; not measured |
| 5 | Right-to-left languages are typed right to left | ✅ | New: `tests/ui/rtl.spec.ts` |
| 6 | Checked on real devices and in the Shopify mobile app | ❌ | Needs a development store |
| 7 | Accessibility: axe WCAG 2.1 A/AA without serious findings | ✅ | `expectAccessible` on every tested page |
| 8 | Keyboard-only operation tested | ❌ | Not tested yet |
| 9 | Language set on input fields for screen readers | ✅ | New: `lang` on the editor fields (`tests/ui/rtl.spec.ts`) |
| 10 | Small download for mobile networks | ✅ | 122 KB gzipped JavaScript, split by page (PERFORMANCE.md §4) |

**Plan:** (8) Keyboard test for the main flow (tab order, focus after the "Leave?" question). (4) Measure touch targets in the mobile project. (6) Dev store check in the Shopify mobile app.

### 3.4 AI translation: 7/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | HTML, placeholders and Liquid survive translation, checked structurally | ✅ | Segment and structure tests; `tests/integration/content-types.test.ts` (Liquid) |
| 2 | Glossary: never translate, always translate as, never use | ✅ | Glossary tests (unit, integration, security) |
| 3 | Translation memory: exact reuse at no cost, fuzzy suggestions | ✅ | `tests/performance/fuzzy-memory.perf.test.ts` |
| 4 | Form of address per language (formal or informal) | ✅ | New: `tests/unit/translation-style.test.ts`, `tests/integration/translation-style.test.ts` |
| 5 | Store context: what the store sells, its tone, the content type | ✅ | New: same tests ("Store: … Product: …") |
| 6 | Automatic quality checks: numbers, length, untranslated, glossary, wrong script | ✅ | `validate.ts`; new WRONG_SCRIPT check |
| 7 | Flagged results are never published automatically | ✅ | New test for WRONG_SCRIPT under automatic publishing |
| 8 | Real provider tested | ❌ | No DeepL key; only stubbed HTTP |
| 9 | Quality measured on a reference set (samples per language, human ratings) | ❌ | Not possible without a provider |
| 10 | Style instructions beyond formality, or a second engine for polishing | ❌ | DeepL `custom_instructions` exists but its availability per plan and language isn't verified |

**Plan:** (8) Free DeepL API key, owner approval needed, no cost. (9) Then a reference set: about 50 real product texts × 5 languages, rated blind; findings feed back into the checks. (10) Evaluate `custom_instructions` with the key. An LLM engine only with a cost model and the owner's approval.

### 3.5 Content coverage: 5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Every translatable Shopify content type reachable (30 of 30) | ✅ | `tests/unit/content-types.test.ts` (against the Admin API schema) |
| 2 | Missing permissions are asked for on the page, not shown as errors | ✅ | `tests/ui/content.spec.ts` |
| 3 | Bulk translation for every safe type | ✅ | `tests/integration/content-types.test.ts` |
| 4 | Image alt texts | ✅ | Integration and security tests (editor) |
| 5 | Text metafields | ✅ | Integration and security tests (editor) |
| 6 | Rich text, JSON and list metafields | ❌ | Counted, not editable |
| 7 | Images and metafields in bulk jobs and the coverage report | ❌ | Editor only |
| 8 | Market-specific translations | ❌ | Markets page is read-only |
| 9 | New and changed products are translated automatically (webhooks) | ❌ | Planned |
| 10 | Coverage confirmed on a development store | ❌ | Live test probes all types, not run yet |

**Plan, without external access:** (7) images and metafields in bulk and coverage, because they reuse existing code. (6) Rich text metafields with structure-aware segmenting, like HTML. (9) Webhook `products/update` → reconciliation job, only for languages the merchant switched on, as drafts. **Needs the dev store:** (8), (10).

### 3.6 SEO: 7/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | SEO title and description translated and checked (length, untranslated) | ✅ | SEO tests |
| 2 | Search result preview | ✅ | UI test |
| 3 | Translated URL handles with protection for published addresses | ✅ | Handle tests |
| 4 | Coverage report per language and content type | ✅ | Coverage tests (incl. worker) |
| 5 | Duplicate SEO titles found | ✅ | Coverage tests |
| 6 | "SEO fields only" jobs | ✅ | Bulk tests |
| 7 | Languages visible to customers (otherwise no hreflang) | ◐ | Overview shows unpublished languages; storefront not checked |
| 8 | Image alt texts for image search | ◐ | Editor only, not in bulk |
| 9 | Market-specific SEO | ❌ | Not implemented |
| 10 | Storefront output verified: hreflang, translated URLs, sitemaps | ❌ | Needs a development store (D1–D4, K1–K3) |

**Plan:** (8) together with images in bulk (§3.5). (10) dev store. (9) after market-specific translations.

### 3.7 Performance: 6.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Review and Jobs fast in a large shop (50,000 drafts, 5,000 jobs) | ✅ | New: `tests/performance/large-shop.perf.test.ts` (15–33 ms) |
| 2 | Stable keyset pagination | ✅ | Same test; Review and Jobs |
| 3 | Bulk jobs read large catalogs in bounded pages | ✅ | New: 5,000 products, 100 pages, one request per page |
| 4 | Fuzzy memory search indexed (100,000 entries) | ✅ | 33–37 ms |
| 5 | Text search in Review indexed | ◐ | 207 ms at 50,000 drafts, linear (PERFORMANCE.md §1) |
| 6 | Fast page responses from the server | ✅ | New: `tests/ui/timings.spec.ts` (22–54 ms) |
| 7 | Small, split client bundle | ✅ | 122 KB gzipped |
| 8 | Real Shopify latency and throttling measured | ❌ | Needs a development store |
| 9 | Load test with many merchants at once | ❌ | Not done |
| 10 | Production monitoring (response times, queue lengths) | ❌ | No hosting yet |

**Plan:** (5) a reviewed definer function for the search, with a security review. (9) Load test with k6 or autocannon against the production build with simulated Shopify: 50 shops in parallel. (8) and (10) with the dev store and hosting.

### 3.8 Security: 8/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Tenant isolation in the database (RLS, fail-closed, runtime role without bypass) | ✅ | `tests/security/postgres-privileges.test.ts` and the posture check |
| 2 | Access tokens encrypted, keys rotatable | ✅ | Crypto tests; UI install test |
| 3 | Session tokens checked; forged and cross-store tokens refused | ✅ | `tests/ui/install.spec.ts` |
| 4 | Webhooks: HMAC, duplicates, mandatory compliance topics | ✅ | Webhook tests |
| 5 | Output safety (XSS) and payload limits | ✅ | Security suite |
| 6 | HTTP security headers | ✅ | New: `tests/unit/security-headers.test.ts`, checked on the production build |
| 7 | Secret scanning and dependency audit in CI | ✅ | gitleaks; new `pnpm audit --prod --audit-level high` |
| 8 | Privileged database functions reviewed and guarded | ✅ | Definition hash, CODEOWNERS, PR template |
| 9 | Independent review or penetration test | ❌ | Not done |
| 10 | Safe operations: branch protection, backups, monitoring, incident plan | ❌ | Branch protection off, no hosting |

**Plan:** (10) owner: branch protection on `main` (a GitHub setting, free). Hosting decision with backups and alerts. (9) before the public launch. A `script-src` policy after the dev store test (SECURITY_MODEL §5e).

### 3.9 Billing: 5.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Shopify App Pricing via the Partner API | ◐ | Simulated Partner API only |
| 2 | Plan limits enforced on the server in every path (editor, bulk, worker, settings) | ✅ | Billing tests |
| 3 | A paying shop is never locked out by an API error | ✅ | Billing tests |
| 4 | Character caps per month, day and platform, also under concurrency | ✅ | Real PostgreSQL and Redis |
| 5 | Usage visible to the merchant, with warnings from 80 % | ✅ | Overview and Plan page; UI tests |
| 6 | Owner complimentary access, secure and audited | ✅ | Security tests |
| 7 | Plans and prices decided and created in the Partner Dashboard | ❌ | Owner decision |
| 8 | Verified with test charges on a development store | ❌ | L1–L10 |
| 9 | Usage-based billing beyond the plan (App Events) | ❌ | Planned |
| 10 | Prices backed by real AI costs | ❌ | Estimate only (COST_MODEL.md) |

**Plan:** owner: prices (BILLING_DESIGN §2), plans in the Partner Dashboard, Partner API client. Then L1–L10 on the dev store, where test charges cost nothing. (10) after real DeepL usage.

### 3.10 Shopify integration: 6.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Official template, Admin API 2026-10, operations checked against the schema | ✅ | `graphql-codegen` in CI |
| 2 | Shopify-managed install with token exchange | ◐ | Simulated; UI install test |
| 3 | Optional scopes only when needed | ✅ | `tests/unit/content-types.test.ts` (scopes vs. `shopify.app.toml`) |
| 4 | Webhooks configured in `shopify.app.toml` | ✅ | Configuration tests |
| 5 | Shopify API throttling handled | ◐ | Shop limiter; simulated only |
| 6 | Embedded app with App Bridge and Polaris | ✅ | UI tests |
| 7 | Shopify CLI ready (`shopify app dev`) | ✅ | `pnpm preflight`, SHOPIFY_CLI_SETUP.md |
| 8 | Live contract tests against a real store | ◐ | Prepared (`pnpm test:live`), not run |
| 9 | Verified on a development store | ❌ | Not connected |
| 10 | App Store requirements: listing, privacy policy, GDPR texts | ❌ | Owner, with legal review |

**Plan:** owner: `pnpm config:link`, a development store, then `pnpm test:live` and DEV_STORE_TEST_PLAN A–N. That one step changes the most scores in this audit.

### 3.11 Error handling and loading states: 7/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Every page has an error boundary with Try again | ✅ | `tests/ui/states.spec.ts` |
| 2 | Shopify outage: clear message, no internal details | ✅ | Same test (no stack traces, tokens or SQL) |
| 3 | Missing permission shows a prompt instead of an error | ✅ | `tests/ui/content.spec.ts` |
| 4 | Loading bar and button states for every action | ✅ | UI tests |
| 5 | Empty states | ✅ | UI tests |
| 6 | Failed job items visible and retryable | ✅ | Bulk tests |
| 7 | Limits and AI errors explained in plain words | ✅ | Error messages in the editor; usage tests |
| 8 | Errors reported to an error tracking service | ❌ | Not set up |
| 9 | Lost connection and timeouts handled in the browser | ❌ | Not tested |
| 10 | Real error cases checked on a development store | ❌ | Needs a dev store |

**Plan:** (9) a test with the simulated Shopify answering slowly or not at all. (8) error tracking with the hosting, needing the owner's approval (data protection: no merchant content in reports).

## 4. Changes in this round (all Tested Locally)

| Change | Area | Evidence |
|---|---|---|
| All 30 Shopify content types (was 8): menus, theme, policies, filters, metaobjects, more | Coverage | 996960f; unit, integration, UI tests |
| Guided Overview with a checklist, usage warnings; navigation 15 → 12 | Usability | 7fbd72a |
| Form of address per language, store context for the AI, wrong-script check | AI | 5163433 |
| Security headers; framing protection for pages without a shop; dependency audit in CI | Security | 859900a |
| Large-shop performance tests and page timings | Performance | PERFORMANCE.md |
| Right-to-left input, language on fields; warning before losing unpublished changes | Usability, mobile | e90d967 |

## 5. Next steps, in order of effect

**Without external access (I can continue):**

1. Images and metafields in bulk jobs and the coverage report (coverage, SEO)
2. Sanitised HTML preview in the editor and Review (design), with security tests
3. Keyboard and slow-network tests (mobile, error handling)
4. Load test with many shops in parallel (performance)
5. Automatic translation of changed products as drafts (coverage), as a design first
6. App interface in German (usability), as a design first because of its size

**Need the owner (accounts, decisions, money):**

1. Development store and `pnpm config:link`, then the live tests and DEV_STORE_TEST_PLAN. This affects every area.
2. Free DeepL API key, then a measured quality reference set
3. Prices and plans in the Partner Dashboard
4. Branch protection on `main`
5. Hosting, backups, monitoring, error tracking
6. Privacy policy, data processing terms, App Store listing
