# Feature status

Single source of truth for what Linguva can do. Status as of 2026-10-28 (after the first read-only store run), branch `claude/gallant-pasteur-8opy75` (draft PR, not merged). Builds of this branch run on Railway: staging for the test store, and since 2026-10-28 production for KARINEX only (RAILWAY_STAGING.md §6a, §8); changes made after the deployed commit reach KARINEX only when the owner deploys them.

Three states, never mixed:

- **Implemented**: the code exists in the repository.
- **Tested Locally**: automated tests pass locally and in GitHub CI, against real PostgreSQL (with row-level security) and Redis, but against **simulated** Shopify, Partner and DeepL APIs. "Server" means only the server logic is tested. "Server + UI" means the page is also tested in a real browser with Playwright (docs/UI_TESTING.md): the production build, real authentication and Polaris, a simulated Shopify.
- **Verified on Shopify**: confirmed on a real Shopify development store, by the live contract tests (`pnpm test:live`) or the manual checks in DEV_STORE_TEST_PLAN.md, with the result logged there.

**Verified on Shopify so far: read-only checks only, on a small store.** Since 2026-10-28 a development store is connected (`linguva-test-lab.myshopify.com`, organization "Mein Shop", French added as an unpublished language). The read-only live run passed there on 2026-10-28 (2 files, 7 passed, 13 skipped, 0 failed; DEV_STORE_VERIFICATION.md §0b). The store had no products, blog posts or images, so those parts had nothing to check. Nothing that writes to Shopify has been run on the store yet.

| On the real store | Status (2026-10-28) |
|---|---|
| Dev-store gate, read-only guard, unpublished target language, the app's own expiring offline session | **Verified** (read-only run) |
| Reading translatable content: collections, pages, blogs (GID types, digests, keys); probe of every content type | **Verified** (read-only run) |
| Coverage scan of every type, figures equal to an independent recount, kept counts equal to rebuilt counts | **Verified on a small sample** (9 fields: collections, pages, blogs; 34 API pages in 16.0 s) |
| CSV export | **Ran, empty**: products, 0 rows, equal to the recount |
| Products, blog posts, image alt text, metafields | **Not verified**: none on the store yet (fictional catalog prepared) |
| CSV import (drafts) | **Not verified**: not exercised (no products); the live check now also uses collections and pages |
| Publishing, removing, restoring, digest refusal, outdated detection, protection of outside translations | **Untested** on Shopify (fixture-write run not done) |
| Bulk jobs, review approval, automatic translation, webhooks, worker on real events | **Untested** on Shopify |
| Markets, countries without their language | **Untested** (`read_markets` granted on neither store yet) |
| Interface inside the admin (Polaris, App Bridge, save bar, mobile app) | Owner-reported: opens embedded; the checklist (U, V) not yet done |
| Production app "Linguva KARINEX" on the KARINEX store (no AI provider; background jobs inside the web service since the commit after `a53c718`, RAILWAY_STAGING.md §8b) | Owner-reported, 2026-10-28: installed, opens embedded; production smoke check passed (RAILWAY_STAGING.md §8). Nothing translated or published there yet |
| Billing | **Untested** |

Everything else is an assumption encoded in the fakes, checked against the Admin API 2026-10 schema, until its check is logged in DEV_STORE_TEST_PLAN.md §3.

| Area | Feature | Implemented | Tested Locally | Verified on Shopify | Test plan |
|---|---|---|---|---|---|
| Foundation | Install, token exchange, encrypted sessions (AES-256-GCM, key rotation) | Yes | Server + UI (install through token exchange, forged tokens refused) | Partly: installs and opens embedded (owner-reported); its stored expiring offline session reads the Admin API (read-only live run), 2026-10-28; reload, re-install not yet checked | A1–A3 |
| Foundation | Shopify CLI setup: complete app configuration, .env loading in development, `pnpm preflight` | Yes | Unit (configuration, checks); dev server start checked | Owner-reported working on linguva-test-lab (2026-10-28) | P5, A1 |
| Foundation | Tenant isolation (RLS fail-closed, runtime role without BYPASSRLS, posture check at start) | Yes | Yes (security suite) | No (database only, no Shopify part) | — |
| Foundation | Webhooks (HMAC, duplicates, retries), uninstall, compliance topics | Yes | Yes | No | A4, N1–N3 |
| Languages | Languages page from `shopLocales`, 20-language limit, RTL notice | Yes | Server + UI | No | B1–B2 |
| Editor | Products, collections, pages, blog posts, blogs: list with coverage, editor, digest-checked publish with read-back | Yes | Server; UI for products (list, editor, publish, read-back) | No | C1–C6 |
| Editor | AI drafts (never published without the merchant), consent, error messages | Yes | Server + UI (loading state, drafts not published) | No | C2, C7 |
| UX | Clear error pages (Shopify outage, not found) with Try again; admin loading bar; empty states; accessibility (axe WCAG 2.1 AA) and phone layout of the main pages | Yes | UI | No | — |
| Content | All 30 translatable content types (menus, links, theme content, policies, filters, metaobjects, product options, subscription plans, shipping and payment methods, notification templates, packing slip, store listing): overview with permissions, list, editor (search and pages for theme texts), bulk for safe types | Yes | Server + UI (overview, menu flow, theme paging, permission prompt) | **Partly, read-only**: probe of every type and editor references of real GIDs (2026-10-28); editing not yet done | C1–C6 |
| UX | Overview: headline figures (languages on the storefront, average translated share, countries in their language, waiting for review), "Get started" checklist (without AI: only the manual steps), translated share and field bar per language (phone included), start and follow the coverage measurement, countries without their language, usage warnings from 80 %; 12 navigation entries | Yes | Server + UI (`overview.spec.ts`: figures, shares, countries, measuring; accessibility, phone width) | No | — |
| Editor | Right-to-left input with the language set; question before leaving with unpublished changes | Yes | UI (desktop and phone) | No (admin navigation and reloads inside the admin frame) | C1 |
| AI | Translation style: form of address per language, store description as context; wrong-script warning | Yes | Server + UI (Settings); DeepL request shape stubbed | No (no key) | C7 |
| Editor | Rendered HTML preview (server sanitiser + sandboxed frames), original and translation side by side, in the editor and on Review | Yes | Security (35 XSS vectors) + UI (desktop and phone) | No | C1 |
| Foundation | Time limit on every Shopify Admin API call (pages: clear 504 page; worker: retry); race-free first open; unexpected server errors logged | Yes | Unit, integration (race reproduced), UI (hanging Shopify) | No | A1 |
| UX | Phase J design pass (docs/UI_REVIEW.md): coverage bars that never make drafts look finished (striped, percentage beside the bar), state badge at the top of every editor field, original previews that fit lists, compact coverage header with specific next-step actions, item rows grouped by state, compact onboarding, export defaulting to a published language, import summary, SEO length bars | Yes | Unit + UI (desktop, phone, accessibility); before/after screenshots | No (real admin not yet checked) | U, V |
| UX | Keyboard operation, slow-network behaviour, screenshot comparisons of 7 pages | Yes | UI | No (real admin and devices) | — |
| Security | HTTP security headers, dependency audit in CI | Yes | Unit + production build | No (headers inside the admin frame) | A1 |
| Editor | Outdated detection and "still correct" confirmation | Yes | Server | No | C4 |
| SEO | SEO title/description checks, search result preview, "SEO fields only" (editor and bulk) | Yes | Server | No | D1–D3 |
| SEO | URL handle suggestion, format check, confirmation before changing a published handle | Yes | Server | No | D4 |
| Coverage | Live coverage dashboard (phase I): every type, image alt text, custom fields per owner; six field states; drafts never complete; excluded types and URLs shown, not counted; published languages only in the whole-store figure; updated after saves, removals, drafts, job items and product/collection webhooks; drill-down with filters, title search, paging, bulk actions; reliable remaining time; SEO findings (docs/COVERAGE_RULES.md) | Yes | Unit (rules), integration (scan, sync, consistency), security (no store text, isolation), performance (150,000 items), UI (desktop, phone, accessibility) | **Partly, read-only**: scan of every type on linguva-test-lab, figures equal to the recount for collections, pages, blogs (9 fields); no products or images on the store yet (2026-10-28) | K1–K11 |
| Import/export | Translation CSV per type and language; imports become drafts on Review; rows checked against the shop's own data; formula-safe | Yes | Integration + UI | **Export ran, empty** (0 product rows, 2026-10-28); import not yet run on the store | K2.1–K2.4 |
| AI | AI language support per language read from DeepL (`/v2/languages`, cached) on the Languages page | Yes | Unit (stubbed DeepL) | No (no DeepL key) | K3.1 |
| Verification tools | `pnpm test:live` with the app's own session (read-only), coverage recount and CSV live checks; `pnpm ops:coverage-check` (read-only evidence: figures, scan state, consistency, webhook deliveries) | Yes | Unit (guard), integration (session decryption), run against local data | **Used on linguva-test-lab** (read-only run passed, 2026-10-28); rehearsal against a simulated store in CI (`pnpm test:live:rehearsal`) | §4 |
| Bulk | Bulk jobs (queues, retries, throttling, cancel, resume, stalled-item sweeper) | Yes | Server (real Redis and BullMQ); UI for the Jobs list | No | E1–E6 |
| Bulk | Drafts by default; automatic publishing only after explicit confirmation; flagged results always to Review | Yes | Yes (security suite, mutation-checked) | No | E2–E3 |
| Bulk | Translations made by people or outside Linguva are kept unless replacing is explicitly allowed | Yes | Server | No | E4 |
| Memory | Translation memory: exact reuse at no cost, fuzzy suggestions (100,000 entries: median 33–37 ms) | Yes | Yes (incl. performance and security suites) | No | F1–F3 |
| Glossary | Never translate / always translate as / never use, CSV import and export | Yes | Server | No | G1–G3 |
| Review | Review page: filters, search, pagination, approve, reject | Yes | Server; UI (content, empty state, accessibility) | No | H1–H2 |
| History | Revisions, restore, remove translation | Yes | Server | No | H3–H5 |
| Images | Image alt text for product images (MEDIA_IMAGE) and collection / blog post images (nested COLLECTION_IMAGE, ARTICLE_IMAGE): editor, AI drafts, publish | Yes | Server (incl. security tests) | No (live test prepared) | I1–I3 |
| Metafields | Metafields Shopify marks translatable (single and multi-line text): editor, AI drafts, publish. JSON and files are counted, not edited | Yes | Server (incl. security tests) | No (live test prepared) | I4–I6 |
| Metafields | Rich text metafields (`rich_text_field`): translated with structure, heading levels and link targets kept (any change is refused), rendered preview in editor and Review | Yes | Unit + server (tampered links, malformed JSON refused) | No | I4–I6 |
| Metafields, metaobject fields | Lists and links (`list.single_line_text_field`, `list.multi_line_text_field`, `link`, `list.link`): AI translates each item; the merchant edits item by item; number of items and link addresses always come from the original. Shown as lists in the editor and on Review, never as JSON. Every write path (editor, Review approval, bulk publishing) refuses a changed structure or address (`keepsSourceStructure`) and a list with an untranslated item | Yes | Unit + server (tampered address, dropped item, malformed JSON, blank item refused) + browser (`structured.spec.ts`) | No | I4–I6 |
| Bulk | Option "Also translate image alt text and custom fields" in bulk jobs (products, collections, pages, blog posts, blogs): drafts linked to their product, same protection and review rules | Yes | Server (incl. tenant isolation); UI (option shown) | No | E1, I1–I6 |
| SEO | Coverage report includes product, collection and blog post image alt text; "Translate gaps" starts the owner's job with images | Yes | Server | No (nesting of collection / blog post images unconfirmed) | K1–K3 |
| Automation | Automatic translation of new and changed products and collections (webhooks `products/*`, `collections/*`; off by default, per language in Settings): one check about a minute after the last save, same rules as bulk jobs (drafts, protected translations kept, allowance, plan, consent), shown as "Automatic" jobs | Yes | Server (real PostgreSQL, Redis, BullMQ) + UI (Settings) | No (webhook delivery not tested on a store) | P1–P5 |
| Automation | Pages, blog posts and blogs (no webhook topics exist) and missed product/collection webhooks: the worker checks every 30 minutes for content changed since the last check (sorted by `UPDATED_AT`; blogs by the `updated_at` filter) and queues the same check a webhook queues (same queue job id, so no double work). Starts when automatic translation is turned on (`autoSweptAt`), keeps its position after a failure, skips types without access, at most 500 changes per type and run (more: logged, left to "Translate all") | Yes | Server (`auto-sweep.test.ts`: types, start position, failure, missing scope, two stores, cap, worker payloads) | No | P1–P5 |
| Markets | Read-only Markets page (optional scope `read_markets`): languages and addresses per market, checks | Yes | Server | No (live read test prepared) | J1–J4 |
| Markets | Countries without their language: every country of the active markets (regions read 250 per page), the languages its customers read (CLDR's likely language, plus a reviewed list for multilingual countries such as Switzerland, Belgium and Canada), whether the store offers them there and why not (not added, hidden, not in that market), and how much is translated. On the Overview (summary, languages to add first with the Shopify setting to change) and as a table on the Markets page. Assumption to check on a real store: a market without its own domain or subfolder offers the shop's published languages on the primary domain | Yes | Unit (`country-coverage.test.ts`, `markets.test.ts`: pages, subdivisions, cache, errors) + UI (simulated markets) | No | J1–J4 |
| Billing | Owner complimentary access: shop GID in server configuration AND an operator grant (owner database role), metered AI usage, internal cost estimate, audit | Yes | Server (incl. security tests) + UI (Plan page) | No | L10 |
| Billing | Shopify App Pricing: plan entitlements, Partner API subscription check (6 h cache, never locks out a paying shop on API errors), plan selection redirect, welcome link, gating in editor, bulk, settings, glossary, worker | Yes | Server (simulated Partner API) + UI (Plan page states) | No | L1–L9 |
| Cost | Monthly, daily and platform-wide character caps, request size cap, request rate limits per staff member and shop | Yes | Yes (concurrency with real PostgreSQL and Redis) | No | M1–M3 |
| AI | DeepL provider (batching, retries, error classes, `/v2/usage`) | Yes | Stubbed HTTP only | No (no key) | C7 |
| AI | Mock provider for tests (refused in production) | Yes | Yes | — | — |
| Interface | German, French, Spanish and English interface from the admin user's language (Shopify's `locale`), localised numbers, dates and language names. French and Spanish (phase G) still need a native speaker's review (I18N_REVIEW.md) | Yes | Unit + UI (10 pages per language) | No (Shopify's `locale` parameter not seen live) | A1 |
| Jobs | Job report: results by reason, timing, remaining time, support reference, CSV download | Yes | Integration + UI | No | E1–E6 |
| Jobs | Fair share between shops in the queue | Yes | Performance test (20 shops; large and small shops) | No | — |
| Jobs | Background jobs without a worker service: the web process supervises the worker (production default, `LINGUVA_EMBEDDED_WORKER`), restart with backoff, clean stop; heartbeat and `GET /healthz/worker`; broken coverage measurements continue by themselves | Yes | Unit (supervisor with a simulated child and clock, heartbeat, setting) + integration (heartbeat expiry, `/healthz/worker`, re-queued measurements with real PostgreSQL, Redis, BullMQ) + container (image check: start, killed worker restarted, exit 0) | No (Railway production not yet observed with it) | — |
| AI | Check for the chosen form of address (de, fr, es, it, nl) | Yes | Unit + pipeline | No (no DeepL key) | C7 |
| Safety | A translation written in the meantime is never overwritten (draft approval, automatic publishing, two people in the editor) | Yes | Security suite (mutation-checked) | No | E2–E4 |
| Safety | Structural guards for write paths and database changes | Yes | Unit + security suites | — | — |

## Not implemented

| Feature | Notes |
|---|---|
| App interface in more languages (Italian, Dutch, Japanese, …) | Catalogue structure in place; French and Spanish exist |
| JSON and file metafields | JSON has no reliable text to translate; files are references |
| Custom fields in the coverage report | Shopify lists metafields only through their owner (the `METAFIELD` resource type is deprecated), so a scan would need one request per resource |
| Market-specific translations (`marketId`), changing markets or web presences | Markets page is read-only |
| Usage-based overage (App Events) | Planned |
| Automatic translation for menus, metaobjects, theme content and other types | Planned. Products, collections, pages, blog posts and blogs are implemented |
| Admin center for the operator (MFA, roles) | Planned |
| Production hosting, backups, monitoring | Not set up; needs the owner's approval |
