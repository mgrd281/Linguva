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
- Test basis (update after phase G): 648 Vitest tests (unit, integration with PostgreSQL and RLS, security, performance, structural guards) and 156 Playwright browser tests on the production build (13 more are desktop-only or phone-only variants), including 14 screenshot comparisons and pages in German, French and Spanish. All pass locally; CI status per commit in the PR.

## 2. Summary

| Area | Before (9a89523) | Round 1 | Phase A | Phase B | Phase C | Phase G | Phase H | Phase I | **Phase J** | Biggest gap now |
|---|---|---|---|---|---|---|---|---|---|---|
| Design and modernity | 5.5 | 6.5 | 7.5 | 7.5 | 7.5 | 7.5 | 8 | 8 | **8** | Not checked inside the real admin; competitor-based specification pending (UI_REVIEW.md §6); app icon and feature image not designed |
| Usability for beginners | 5.5 | 8 | 8 | 8 | 8.5 | 9 | 9 | 9 | **9** | No test with real merchants; French and Spanish not yet read by native speakers |
| Desktop and mobile | 5 | 7.5 | 8.5 | 8.5 | 9 | 9 | 9 | 9 | **9** | No check on real devices or in the Shopify mobile app |
| AI translation | 5 | 7 | 7 | 7 | 7 | 7 | 7 | 7 | **7** | No measured quality: the DeepL key isn't in this environment (harness ready: `pnpm test:deepl`) |
| Content coverage | 3 | 5 | 5 | 6.5 | 6.5 | 6.5 | 6.5 | 7 | **7** | Read-only coverage verified on a small real store (9 fields, no products yet); market-specific translations and third-party app content missing |
| SEO | 7 | 7 | 7 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | **7.5** | Storefront output (hreflang, translated URLs) not verified |
| Performance | 4.5 | 6.5 | 6.5 | 6.5 | 7 | 7.5 | 7.5 | 7.5 | **7.5** | First real measurement: 34 API pages in 16 s on an almost empty store; a real catalog not yet measured; no production monitoring |
| Security | 6.5 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | **8** | No external review; branch protection off; no production operations |
| Billing | 5 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | 5.5 | **5.5** | Plans and prices not created; characters per real product not measured |
| Shopify integration | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 | **7** | Read path verified on the dev store (gate, session, read contract, every type probed, scan = recount); writes, webhooks, App Bridge in the admin not yet |
| Error handling and loading states | 6 | 7 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | **8.5** | Errors are logged, but no error tracking service |
| **Average** | **5.4** | **6.8** | **7.1** | **7.3** | **7.4** | **7.5** | 7.5 | 7.6 | **7.6** | |

Scored against the same criteria each time. Round 1 changes are in §4, phase A changes in §4a, phase B changes in §4b, phase C changes in §4c, phase D in §4d, phase F in §4f, phase G in §4g, phase H in §4h, phase I in §4i, phase J in §4j (phases D–F added evidence, not new scores). A criterion only changes with new evidence; work that no criterion covers (for example clearer glossary inputs) doesn't change a score.

**Honest overall verdict: 7.6/10.** Since 2026-10-28 the read path is Verified on Shopify on the development store (read-only live run passed); everything that writes, the admin integration and billing are still Tested Locally only. Reaching 9–10 needs what code can't supply: the remaining store checks, the owner's decisions and accounts (DeepL key, prices, hosting), real merchants and an external security review. Those are listed in §5.

## 3. Areas in detail

### 3.1 Design and modernity: 8/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Shopify's Polaris web components throughout, no foreign UI framework | ✅ | All routes use `s-*` components; `tests/ui/pages.spec.ts` |
| 2 | Consistent page structure: title, primary action, sections | ✅ | Every app page; `tests/ui/pages.spec.ts` |
| 3 | Progress and status are visible: progress bars, badges | ✅ | `ProgressBar` (role=progressbar), Overview; `tests/integration/overview.test.ts` |
| 4 | Source and translation side by side in the editor | ✅ | `ResourceTranslationEditor`; `tests/ui/flows.spec.ts` |
| 5 | HTML texts shown rendered (sanitised), not as raw HTML | ✅ | Phase A: sanitiser + sandboxed frames; `tests/security/sanitize-html.test.ts`, `tests/ui/preview.spec.ts` |
| 6 | Search result preview like on Google | ✅ | `SeoPreview`; `tests/ui/pages.spec.ts` (Editor) |
| 7 | Empty states with guidance and a next step | ✅ | `tests/ui/states.spec.ts` |
| 8 | Native admin elements: title bar, save bar, toasts, modals (App Bridge) | ◐ | Phase E: save bar in the editor, toasts for every success, Polaris modals for actions that can't be undone (`tests/ui/unsaved.spec.ts`, `tests/ui/confirm.spec.ts`, App Bridge simulated). Stays ◐ until seen in the real admin |
| 9 | Checked visually inside the real Shopify admin | ❌ | Needs a development store |
| 10 | App Store assets: icon, screenshots, listing text | ◐ | Phase H: listing text in English and German within Shopify's limits and rules, 8 screenshots of the real app at 1600 × 900 (`docs/APP_STORE_LISTING.md`, `tests/unit/app-store-listing.test.ts`, `tests/ui/app-store-screenshots.spec.ts`). Icon and feature image missing; screenshots not yet taken inside the real admin |

**Plan:** (8) and (9) dev store: check save bar, toasts and modals in the admin, light and dark. (10) the icon (owner) and the final screenshots inside the real admin.

### 3.2 Usability for beginners: 9/10

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
| 9 | App interface in the merchant's language (at least German, French, Spanish) | ✅ | Phase C: German and English; phase G: French and Spanish, about 800 texts each, complete and consistent (`tests/unit/i18n.test.ts`), 10 pages per language without English text and accessible (`tests/ui/i18n.spec.ts`). Wording machine-assisted, native-speaker review pending (docs/I18N_REVIEW.md) |
| 10 | Tested with real merchants (usability sessions) | ❌ | Not done |

**Plan:** (9) a native speaker reads the French and Spanish texts (docs/I18N_REVIEW.md). (10) 3–5 beta merchants with a short task list. That needs the owner.

### 3.3 Desktop and mobile: 9/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | No horizontal scrolling on a phone (Pixel 7) on all main pages | ✅ | `@responsive` tests, `expectNoHorizontalScroll` |
| 2 | Tables become readable lists on a phone | ✅ | Polaris tables; checked in the mobile project |
| 3 | Main flows run on a phone, not only page views | ✅ | `@responsive`: settings, content, editor warnings, RTL |
| 4 | Comfortable touch targets | ✅ | Phase E: WCAG 2.2 2.5.8 (24 px or spacing) measured on 13 pages on a phone, `tests/ui/touch.spec.ts`; found and fixed the 21 px CSV file input |
| 5 | Right-to-left languages are typed right to left | ✅ | New: `tests/ui/rtl.spec.ts` |
| 6 | Checked on real devices and in the Shopify mobile app | ❌ | Needs a development store |
| 7 | Accessibility: axe WCAG 2.1 A/AA without serious findings | ✅ | `expectAccessible` on every tested page |
| 8 | Keyboard-only operation tested | ✅ | Phase A: `tests/ui/keyboard.spec.ts` (main flow, focus, Review) |
| 9 | Language set on input fields for screen readers | ✅ | New: `lang` on the editor fields (`tests/ui/rtl.spec.ts`) |
| 10 | Small download for mobile networks | ✅ | 122 KB gzipped JavaScript, split by page (PERFORMANCE.md §4) |

**Plan:** (6) Dev store check in the Shopify mobile app.

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

### 3.5 Content coverage: 6.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Every translatable Shopify content type reachable (30 of 30) | ✅ | `tests/unit/content-types.test.ts` (against the Admin API schema) |
| 2 | Missing permissions are asked for on the page, not shown as errors | ✅ | `tests/ui/content.spec.ts` |
| 3 | Bulk translation for every safe type | ✅ | `tests/integration/content-types.test.ts` |
| 4 | Image alt texts | ✅ | Integration and security tests (editor) |
| 5 | Text metafields | ✅ | Integration and security tests (editor) |
| 6 | Rich text, JSON and list metafields | ◐ | Phase B: rich text translated with structure and links kept (`tests/unit/rich-text.test.ts`, attached-resources and bulk tests). Phase F: lists and links translated item by item, addresses and item count enforced on every write path (`tests/unit/structured-text.test.ts`, `tests/ui/structured.spec.ts`). JSON still counted only; nothing verified on Shopify |
| 7 | Images and metafields in bulk jobs and the coverage report | ◐ | Phase B: both in bulk jobs (`tests/integration/bulk-attached.test.ts`); both in the coverage report, custom fields per owner type (products, collections, pages, blog posts; every translatable one, `tests/integration/coverage.test.ts`). Blog, shop and variant custom fields aren't counted (COVERAGE_RULES §10); nothing verified on Shopify |
| 8 | Market-specific translations | ❌ | Markets page is read-only |
| 9 | New and changed products are translated automatically (webhooks) | ◐ | Phase B: products and collections, `tests/integration/auto-translate.test.ts` (incl. BullMQ end to end). Phase F: pages, blog posts and blogs, and missed webhooks, by a periodic check (`tests/integration/auto-sweep.test.ts`). Delivery and Shopify's sort order not verified on a store |
| 10 | Coverage confirmed on a development store | ❌ | Live test probes all types, not run yet |

**Plan, without external access:** (6) JSON metafields only where a schema says which values are text. (9) Menus, metaobjects and theme content in the periodic check. **Needs the dev store:** (6), (7) and (9) confirmation, (8), (10).

### 3.6 SEO: 7.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | SEO title and description translated and checked (length, untranslated) | ✅ | SEO tests |
| 2 | Search result preview | ✅ | UI test |
| 3 | Translated URL handles with protection for published addresses | ✅ | Handle tests |
| 4 | Coverage report per language and content type | ✅ | Coverage tests (incl. worker) |
| 5 | Duplicate SEO titles found | ✅ | Coverage tests |
| 6 | "SEO fields only" jobs | ✅ | Bulk tests |
| 7 | Languages visible to customers (otherwise no hreflang) | ◐ | Overview shows unpublished languages; storefront not checked |
| 8 | Image alt texts for image search | ✅ | Phase B: editor, bulk jobs and coverage report |
| 9 | Market-specific SEO | ❌ | Not implemented |
| 10 | Storefront output verified: hreflang, translated URLs, sitemaps | ❌ | Needs a development store (D1–D4, K1–K3) |

**Plan:** (10) dev store. (9) after market-specific translations.

### 3.7 Performance: 7.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Review and Jobs fast in a large shop (50,000 drafts, 5,000 jobs) | ✅ | New: `tests/performance/large-shop.perf.test.ts` (15–33 ms) |
| 2 | Stable keyset pagination | ✅ | Same test; Review and Jobs |
| 3 | Bulk jobs read large catalogs in bounded pages | ✅ | New: 5,000 products, 100 pages, one request per page |
| 4 | Fuzzy memory search indexed (100,000 entries) | ✅ | 33–37 ms |
| 5 | Text search in Review indexed | ✅ | Phase G: reviewed definer function with a trigram index, 207 → 12.5 ms at 50,000 drafts (`tests/performance/large-shop.perf.test.ts`); security tests `tests/security/draft-search.test.ts` |
| 6 | Fast page responses from the server | ✅ | New: `tests/ui/timings.spec.ts` (22–54 ms) |
| 7 | Small, split client bundle | ✅ | 122 KB gzipped |
| 8 | Real Shopify latency and throttling measured | ❌ | Needs a development store |
| 9 | Load test with many merchants at once | ◐ | Phase C: 20 shops at once and a large shop next to small ones with simulated Shopify (`tests/performance/multi-shop.perf.test.ts`); found and fixed queue unfairness. Not against real infrastructure |
| 10 | Production monitoring (response times, queue lengths) | ❌ | No hosting yet |

**Plan:** (9) Repeat the load test on the production host (several worker processes, its database limits). (8) and (10) with the dev store and hosting.

### 3.8 Security: 8/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Tenant isolation in the database (RLS, fail-closed, runtime role without bypass) | ✅ | `tests/security/postgres-privileges.test.ts` and the posture check |
| 2 | Access tokens encrypted, keys rotatable | ✅ | Crypto tests; UI install test |
| 3 | Session tokens checked; forged and cross-store tokens refused | ✅ | `tests/ui/install.spec.ts` |
| 4 | Webhooks: HMAC, duplicates, mandatory compliance topics | ✅ | Webhook tests |
| 5 | Output safety (XSS) and payload limits | ✅ | Security suite |
| 6 | HTTP security headers | ✅ | `tests/unit/security-headers.test.ts`, checked on the production build. Phase G: `script-src` with a nonce per page; the main flows run under it without a violation and an injected inline script is blocked (`tests/ui/csp.spec.ts`); App Bridge itself still to be checked in the admin |
| 7 | Secret scanning and dependency audit in CI | ✅ | gitleaks; new `pnpm audit --prod --audit-level high` |
| 8 | Privileged database functions reviewed and guarded | ✅ | Definition hash, CODEOWNERS, PR template. Phase G: second definer function (Review search) reviewed the same way, with its own threat tests (`tests/security/draft-search.test.ts`, SECURITY_REVIEW_MEMORY_FUZZY.md §10) |
| 9 | Independent review or penetration test | ❌ | Not done |
| 10 | Safe operations: branch protection, backups, monitoring, incident plan | ❌ | Branch protection off, no hosting |

**Plan:** (10) owner: branch protection on `main` (a GitHub setting, free). Hosting decision with backups and alerts. (9) before the public launch. Confirm the `script-src` policy with the real App Bridge on the dev store (SECURITY_MODEL §5e).

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

### 3.11 Error handling and loading states: 8.5/10

| # | Criterion | Mark | Evidence |
|---|---|---|---|
| 1 | Every page has an error boundary with Try again | ✅ | `tests/ui/states.spec.ts` |
| 2 | Shopify outage: clear message, no internal details | ✅ | Same test (no stack traces, tokens or SQL) |
| 3 | Missing permission shows a prompt instead of an error | ✅ | `tests/ui/content.spec.ts` |
| 4 | Loading bar and button states for every action | ✅ | UI tests |
| 5 | Empty states | ✅ | UI tests |
| 6 | Failed job items visible and retryable | ✅ | Bulk tests |
| 7 | Limits and AI errors explained in plain words | ✅ | Error messages in the editor; usage tests |
| 8 | Errors reported to an error tracking service | ◐ | Phase A: unexpected server errors are logged (`handleError`); no tracking service yet |
| 9 | Lost connection and timeouts handled | ✅ | Phase A: time limit on every Shopify call, `tests/ui/network.spec.ts` (hanging Shopify, slow navigation, no double submit) |
| 10 | Real error cases checked on a development store | ❌ | Needs a dev store |

**Plan:** (8) error tracking with the hosting, needing the owner's approval (data protection: no merchant content in reports).

## 4. Changes in this round (all Tested Locally)

| Change | Area | Evidence |
|---|---|---|
| All 30 Shopify content types (was 8): menus, theme, policies, filters, metaobjects, more | Coverage | 996960f; unit, integration, UI tests |
| Guided Overview with a checklist, usage warnings; navigation 15 → 12 | Usability | 7fbd72a |
| Form of address per language, store context for the AI, wrong-script check | AI | 5163433 |
| Security headers; framing protection for pages without a shop; dependency audit in CI | Security | 859900a |
| Large-shop performance tests and page timings | Performance | PERFORMANCE.md |
| Right-to-left input, language on fields; warning before losing unpublished changes | Usability, mobile | e90d967 |

## 4a. Phase A: premium UI/UX (all Tested Locally)

| Change | Evidence |
|---|---|
| Rendered, safe HTML previews (server allowlist sanitiser + sandboxed frames), original and translation side by side | 545bd9a; 35 XSS vectors, browser tests, mutation-checked |
| Design pass from screenshot review: field actions under the translation, consistent layouts, filters side by side, languages by name, readable metafield names | b1d2311 |
| **Bug:** Settings showed the server default allowance instead of the plan's | b1d2311, UI test |
| **Bug:** Polaris layouts with several breakpoints were silently ignored | b1d2311, unit test of the syntax |
| **Bug:** Glossary and memory showed no languages to a merchant who opened them first | b1d2311, UI test |
| **Bug:** first open after install failed with a 500 in about 1 of 3 runs (race between install and page loads) | e178fe8; integration test reproduces it on the old code |
| **Bug:** Shopify calls without a time limit (a hanging Shopify blocked pages and worker slots) | e178fe8; unit and UI tests, mutation-checked |
| **Bug:** the public start page was still the template placeholder | e178fe8, UI test |
| Unexpected server errors logged (no request data) | e178fe8 |
| Keyboard, slow network, timeout and 14 screenshot tests | e178fe8 |

## 4b. Phase B: translation coverage (all Tested Locally)

| Change | Evidence |
|---|---|
| Image alt text and custom fields in bulk jobs (option), drafts linked to their product, same protection and review | 5820cce; `tests/integration/bulk-attached.test.ts` incl. tenant isolation |
| Image alt text in the coverage report, "Translate gaps" with images | 5820cce; coverage tests |
| Rich text custom fields with structure, heading levels and link targets enforced | 5820cce; unit, editor (tampered link, malformed JSON) and bulk tests |
| Automatic translation of new and changed products and collections (webhooks, debounce, same rules as bulk, never joins jobs with other settings) | 77fc8dc; 14 integration tests incl. BullMQ, webhook route, UI test |
| Webhook log retention | 77fc8dc; integration test |
| **Bug found by the UI test:** Polaris choice lists submit multiple values comma-separated | 77fc8dc |
| Shopify limits documented (SHOPIFY_API_MATRIX §2.2) | docs |

## 4c. Phase C: interface languages, quality checks, reports, load (all Tested Locally)

| Change | Evidence |
|---|---|
| Interface in German and English from the admin user's language (Shopify's `locale` parameter), about 520 texts per language; numbers, dates and language names per language | a7ed130, 62fb95b, ff33977; `tests/unit/i18n.test.ts` (complete, consistent catalogues), `tests/ui/i18n.spec.ts` (10 German pages, accessibility, phone layout, no English left) |
| **Bug:** the app's own `?locale=` (language to translate into) collided with Shopify's `locale` (admin language) | 62fb95b; target language now `?lang=`, UI test |
| **Bug:** dates were formatted with the server's and the browser's own locale and time zone (hydration mismatch risk) | 62fb95b; dates in UTC with "UTC" |
| Job report: results by reason, timing and remaining time, support reference, CSV download; save errors with codes | b13c247; integration and UI tests (incl. another store's report: 404) |
| **Bug:** a shop starting a job waited behind another shop's whole queued catalogue | 0e5b30b; load test, mutation-checked |
| Quality check for the chosen form of address (Sie/du and others) | 4b4fe22; unit and pipeline tests |
| Client JavaScript 122 → 155 KB gzipped because of the texts of both languages | PERFORMANCE.md §4 |

## 4d. Phase D: publishing and overwrite protection, isolation, database changes (all Tested Locally)

No score changes: the criteria these areas are measured by were already met (Security 1, 4, 8; Usability 5, 7). Phase D made them harder to break and closed gaps the criteria didn't name.

| Change | Evidence |
|---|---|
| Audit of every way to change a store's translations (two Shopify mutations, four save paths, one removal path), with the guards of each | SECURITY_MODEL §5b |
| **Bug:** approving an older draft, or automatic publishing a moment after someone translated the same field, replaced that person's newer translation. Drafts now remember the translation they replace; publishing re-checks it | c68a2d2; security tests, mutation-checked; migration 20261029200000 reviewed in §5i |
| **Gap:** two people editing the same field in the editor, last save won silently. Now refused with an explanation | 436771c; security test |
| Structural guards: new write paths, Shopify mutations, unauthenticated pages or the owner database role in app code fail a test | `tests/security/structure.test.ts` (fails on a probe file) |
| Every database change reviewed: each migration names its review section; isolation-weakening statements only where reviewed; new tenant tables get RLS, FORCE and a policy | `tests/unit/migration-review.test.ts` (fails on a probe migration) |
| Tenant isolation of everything added in phases B–D (automatic translation, job reports, queue fairness) | Integration and UI tests per feature; runtime posture check (§5d) |
| Keyboard test failed once in CI: focus on "Stay on this page" made robust (retries until the button takes it) | 1ef1366; not reproducible locally |

## 4f. Phase F: translation completeness (all Tested Locally)

No score changes: the two criteria this phase works on (3.5 #6, #9) stay ◐ because JSON metafields are still missing and nothing is verified on Shopify.

| Change | Evidence |
|---|---|
| Lists and links (metafields, metaobject fields): AI and manual translation item by item, shown as lists in the editor and on Review, never as JSON | `tests/unit/structured-text.test.ts`, `tests/integration/attached-resources.test.ts`, `tests/ui/structured.spec.ts` |
| Structure, item count and link addresses of rich text, lists and links checked in `saveResourceTranslations`, so every write path enforces them (was: editor form only) | Same tests plus `bulk-attached.test.ts` (an edit on Review approval that changes an address is refused) |
| Bug found: approving drafts failed for all selected drafts when one product had been deleted in Shopify; now those drafts become outdated and the others publish | `review-and-history.test.ts` (fails without the fix) |
| Automatic translation of pages, blog posts and blogs, and of missed product/collection webhooks, by a 30-minute check per shop; starts when turned on, resumes after failures | `tests/integration/auto-sweep.test.ts` (8 tests incl. two stores, missing scope, failure) |
| Two database changes reviewed (SECURITY_MODEL §5j, §5k) | `tests/unit/migration-review.test.ts` |

## 4g. Phase G: languages, search, script policy (all Tested Locally)

| Change | Area | Evidence |
|---|---|---|
| French and Spanish interface, about 800 texts each, from the admin user's language; review points for native speakers listed | Usability 8.5 → 9 | `tests/unit/i18n.test.ts` (complete, same placeholders, nothing left in English, no irregular whitespace), `tests/ui/i18n.spec.ts` (10 pages per language, accessibility); docs/I18N_REVIEW.md |
| Review text search through a second reviewed definer function and a partial trigram index: 207 → 12.5 ms at 50,000 drafts | Performance 7 → 7.5 | `tests/performance/large-shop.perf.test.ts`; `tests/security/draft-search.test.ts` (9 threat tests); SECURITY_REVIEW_MEMORY_FUZZY.md §10 |
| `script-src` with a per-page nonce; injected inline scripts are blocked | Security (criterion 6 already ✅) | `tests/unit/security-headers.test.ts`, `tests/ui/csp.spec.ts` |
| Language names in lower case in French and Spanish | Usability | `tests/unit/i18n.test.ts` |

## 4h. Phase H: market and launch preparation (documents; listing assets Tested Locally)

| Change | Area | Evidence |
|---|---|---|
| Competitive analysis against Langify and Transcy from their public listings, help centers and reviews, with sources; gaps and positioning | — (no criterion) | docs/COMPETITIVE_ANALYSIS.md, docs/research/competitors-raw.md |
| App Store listing draft (EN/DE) within Shopify's limits and rules; 8 screenshots of the real app at 1600 × 900 from a demo catalog | Design 7.5 → 8 (criterion 10 ❌ → ◐) | docs/APP_STORE_LISTING.md, `tests/unit/app-store-listing.test.ts`, `tests/ui/app-store-screenshots.spec.ts` |
| 30-day launch plan with a launch gate, weekly steps, targets and risks | — | docs/LAUNCH_PLAN_30_DAYS.md |
| Precise list of what the owner must provide or decide, with steps and estimated costs | — | docs/OWNER_DECISIONS.md |

**Where 10/10 stops today.** The remaining points in every area need one of: the development store (Shopify behaviour, the real admin, App Bridge, webhooks, billing), a DeepL key (measured quality), the owner's decisions (prices, hosting, legal, branch protection), real merchants (usability, reviews) or an external security review. None of these can be replaced by more local tests, so the honest score stays 7.5 until they happen.

## 4i. Phase I: live coverage dashboard, import/export, AI languages, launch readiness (all Tested Locally)

| Change | Area | Evidence |
|---|---|---|
| Live coverage per item and language for every translatable type, image alt text and custom fields per owner; six field states (complete, needs review, draft, failed, outdated, missing); drafts never complete; empty originals and 0/0 not counted; theme, notifications and URLs shown but not in the totals; published languages only in the whole-store figure | Content coverage | a27ae1a; `tests/unit/coverage-rules.test.ts` (16), `tests/integration/coverage.test.ts` (15) |
| Kept current after saves, removals, drafts, job items and product/collection webhooks; an older scan never overwrites a newer save; counts kept with every change equal counts rebuilt from items | Content coverage | Same integration tests (`expectCountsConsistent`) |
| Dashboard: whole store, next step, language cards with segmented bars, per type and field, SEO findings, market filter, running jobs; drill-down with filters, title search where Shopify can search, paging, bulk actions; 4 interface languages | Design, usability | `tests/ui/coverage.spec.ts` (accessibility, phone layout), i18n tests |
| 50,000 products × 3 languages: summary 170 ms, item pages ≤ 11 ms, update after a save 22 ms | Performance | `tests/performance/coverage-scale.perf.test.ts` |
| No merchant text in coverage tables; tenant isolation; migration reviewed (SECURITY_MODEL §5m) | Security | `tests/security/coverage-security.test.ts` |
| Remaining time only when reliable (10 items, 5 %, 30 s), also on the job page | Error handling | `tests/unit/coverage-rules.test.ts` |
| CSV export/import of translations: imports become drafts on Review, rows checked against the shop's own data (unknown, changed original, empty, unchanged, broken structure, duplicates), formula-safe | Content coverage, security | `tests/integration/csv-transfer.test.ts`, `tests/ui/transfer.spec.ts` |
| AI languages read from DeepL (`/v2/languages`, cached) and shown per language | AI translation | `tests/unit/deepl.test.ts` |
| Launch documents: screencast script and test instructions, listing audit, icon and feature image brief, storefront selector strategy, second-engine plan, measured characters per demo product | Launch | SUBMISSION_DEMO.md, APP_STORE_LISTING.md, BRAND_ASSETS.md, STOREFRONT_LANGUAGE_SELECTOR.md, AI_ENGINES.md, COST_MODEL.md §2a |

Content coverage moves from 6.5 to 7: every translatable type is now measured per item with tested rules, and CSV import adds a path for languages and content AI doesn't cover. It stays below 8 because nothing is verified on Shopify and market-specific translations are still missing. AI translation stays at 7: language support is now read from DeepL, but quality is still unmeasured.

## 4j. Phase J: development store connected, first real results (2026-10-28)

The development store `linguva-test-lab.myshopify.com` exists and Linguva opens in its admin (owner report). A score moves only with logged results of the checks in DEV_STORE_VERIFICATION.md. Prepared in this phase: the verification runbook with exact commands, live checks that compare Linguva's coverage with an independent recount of the store's data and run CSV export/import against it, read-only live tests with the app's own session (no extra app needed), and `pnpm ops:coverage-check` for evidence after every manual step.

Scores expected to change once the checks pass (not before): Shopify integration, content coverage, SEO and design (real admin), each by the evidence logged.

**Defect found before the first store run (fixed, regression-tested).** The real Shopify library throws GraphQL errors instead of returning them, while the simulated store returned them. The coverage scan recognised a missing optional scope only in the returned form, so on a real store without, for example, the navigation scope, the first scan would have stopped at Menus and failed as a whole instead of marking the type "no access". Also, any type that kept failing ended the whole report. Fix: access denial is recognised in both forms in the coverage listing, custom field owners, title search and the automatic-translation check; a type that keeps failing is marked "scan didn't finish" and the other types are still scanned (only a revoked shop access stops the report). Evidence: the new tests failed on the old code and pass now (`coverage.test.ts`: "library throws", "keeps failing"; `auto-sweep.test.ts` with both error forms); the simulated store can now throw like the library (`throwsLikeLibrary`).

**First real-store result (Verified on Shopify, read-only).** The read-only live run on linguva-test-lab with French unpublished passed: 2 files, 7 passed, 13 skipped, 0 failed, 31.65 s. Coverage scan 34 API pages in 16,003 ms; figures equal to an independent recount; dashboard summary 8 ms, items page 2 ms (local database). The store had 0 products, 1 collection (2 fields missing), 2 pages (5 fields: 2 complete, 3 missing), 1 blog (2 missing), 0 posts and 0 images, so products, images and the CSV import had nothing to check (DEV_STORE_VERIFICATION.md §0b).

| Area | Score | Why |
|---|---|---|
| Shopify integration | 6.5 → **7** | The read path works against the real Admin API 2026-10: dev-store gate, the app's expiring offline session, read contract for collections, pages and blogs, every content type probed with editor references round-tripping. Writes, webhooks and App Bridge inside the admin still unverified |
| Content coverage | 7 (unchanged) | Scan = recount on a real store, but only 9 fields and no products; moves with the fictional catalog run |
| Performance | 7.5 (unchanged) | 16 s for 34 sequential API calls (about 0.47 s each) on an almost empty store is a first real number, not yet a catalog-size measurement |

**After the run (Tested Locally):** a live check with nothing to check is reported as skipped with its reason, not as passed; the CSV live check exports every titled type and imports the first missing title; the live suites run in CI against a simulated store shaped like the dev store (`pnpm test:live:rehearsal`, both the measured shape and the fictional catalog); a fictional 8-product catalog for Shopify's own product import (`docs/dev-store/demo-catalog-products.csv`).

**UI and UX (Tested Locally; UI_REVIEW.md):** prioritized review of 10 screens with before/after screenshots. Fixed: drafts made coverage bars look finished (now striped, percentage beside the bar), the original description's preview cut off list items (regression-tested), field states moved to the top of every editor field (missing fields now say so), compact coverage header, specific next-step actions, whole-store key, item rows grouped by state (−43 % height), finished onboarding steps on one line, export defaults to a published language, import summary, SEO length bars. Design stays at 8: the criterion needs the real admin, and the layout decisions that remain wait for the competitor-based specification.

## 4k. Phase K: Smart Auto-Translate for the Business plan (2026-10-29, all Tested Locally)

Scheduled, budgeted automatic translation (SMART_AUTO_TRANSLATE.md), after an audit of the existing pipeline that found and fixed defects first (SMART_AUTO_TRANSLATE_AUDIT.md): fields retranslated by a reused job item, a periodic check that could drop changes beyond its cap, usage keys that could collide, a pause that let queued items continue, coverage that could say 100 % over what it hadn't read, deleted products and removed languages left in coverage, and custom fields after an owner's first 50 metafields not counted.

Evidence added: unit and integration tests for schedules (daylight saving, catch-up, one run per occurrence with five ticks at once), planning while measuring (only missing and outdated machine fields of the chosen scope; people's translations, drafts waiting for review, removals and exclusions kept), budgets and pauses, the plan checked on the server for every action, tick and item, forged requests (form and database); a performance test of a run over 5,000 products in two languages (31 s, median 14 ms per page, nothing planned twice); browser tests of the settings card and page on desktop and phone with accessibility checks; screenshots on desktop, tablet and iPhone (`docs/ui-review/smart-auto/`).

An independent review of the smart backend found 6 problems and several smaller ones, each reproduced against PostgreSQL (a merchant's pause lifted by a plan or consent change, double translation beside a merchant's bulk job, the budget window at midnight, a run left QUEUED, a resource hidden by a stopped job's leftover, an estimate of 0 for stores measured earlier). All are fixed with a test that fails without the fix (SMART_AUTO_TRANSLATE_AUDIT.md §12).

Scores unchanged: every criterion this touches is either met already (performance 3, billing 2) or waits for a store (content coverage 9: webhooks and the periodic check on real events; Shopify integration: writes and webhooks). Smart Auto-Translate is not verified on Shopify yet; DEV_STORE_TEST_PLAN.md §Q lists the checks.

## 5. Next steps, in order of effect

**Without external access (I can continue):**

1. JSON metafields where a definition says which values are text (coverage); menus, metaobjects and the other types are in the smart schedule (Business) since phase K, basic automatic translation keeps the five main types
2. Glossary suggestions from the catalogue and a quality reference set prepared for the DeepL test (AI translation)
3. App Store screenshots generated from the UI tests (design, launch)

**Need the owner (accounts, decisions, money):**

1. On the development store (connected; read-only run passed): import the fictional catalog, run the read-only live tests again, then the checklist of DEV_STORE_VERIFICATION.md §3 (editor, CSV import, review, webhooks, admin UI, phone). This affects every area.
2. Free DeepL API key, then a measured quality reference set
3. Prices and plans in the Partner Dashboard
4. Branch protection on `main`
5. Hosting, backups, monitoring, error tracking
6. Privacy policy, data processing terms, App Store listing
