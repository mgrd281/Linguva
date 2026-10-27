# Feature status

Single source of truth for what Linguva can do. Status as of 2026-10-27, branch `claude/gallant-pasteur-8opy75` (draft PR, not merged, not deployed).

Three states, never mixed:

- **Implemented**: the code exists in the repository.
- **Tested Locally**: automated tests pass locally and in GitHub CI, against real PostgreSQL (with row-level security) and Redis, but against **simulated** Shopify, Partner and DeepL APIs. "Server" means only the server logic is tested. "Server + UI" means the page is also tested in a real browser with Playwright (docs/UI_TESTING.md): the production build, real authentication and Polaris, a simulated Shopify.
- **Verified on Shopify**: confirmed on a real Shopify development store, by the live contract tests (`pnpm test:live`) or the manual checks in DEV_STORE_TEST_PLAN.md, with the result logged there.

**No feature is Verified on Shopify yet.** No development store has been connected. Every Shopify behaviour is so far an assumption encoded in the fakes, checked only against the Admin API 2026-10 schema.

| Area | Feature | Implemented | Tested Locally | Verified on Shopify | Test plan |
|---|---|---|---|---|---|
| Foundation | Install, token exchange, encrypted sessions (AES-256-GCM, key rotation) | Yes | Server + UI (install through token exchange, forged tokens refused) | No | A1–A3 |
| Foundation | Shopify CLI setup: complete app configuration, .env loading in development, `pnpm preflight` | Yes | Unit (configuration, checks); dev server start checked | No (needs `shopify app config link`) | P5, A1 |
| Foundation | Tenant isolation (RLS fail-closed, runtime role without BYPASSRLS, posture check at start) | Yes | Yes (security suite) | No (database only, no Shopify part) | — |
| Foundation | Webhooks (HMAC, duplicates, retries), uninstall, compliance topics | Yes | Yes | No | A4, N1–N3 |
| Languages | Languages page from `shopLocales`, 20-language limit, RTL notice | Yes | Server + UI | No | B1–B2 |
| Editor | Products, collections, pages, blog posts, blogs: list with coverage, editor, digest-checked publish with read-back | Yes | Server; UI for products (list, editor, publish, read-back) | No | C1–C6 |
| Editor | AI drafts (never published without the merchant), consent, error messages | Yes | Server + UI (loading state, drafts not published) | No | C2, C7 |
| UX | Clear error pages (Shopify outage, not found) with Try again; admin loading bar; empty states; accessibility (axe WCAG 2.1 AA) and phone layout of the main pages | Yes | UI | No | — |
| Content | All 30 translatable content types (menus, links, theme content, policies, filters, metaobjects, product options, subscription plans, shipping and payment methods, notification templates, packing slip, store listing): overview with permissions, list, editor (search and pages for theme texts), bulk for safe types | Yes | Server + UI (overview, menu flow, theme paging, permission prompt) | No (live test probes all types) | C1–C6 |
| UX | Overview with a "Get started" checklist, progress per language, attention items, usage warnings from 80 %; 12 navigation entries | Yes | Server + UI | No | — |
| Editor | Right-to-left input with the language set; question before leaving with unpublished changes | Yes | UI (desktop and phone) | No (admin navigation and reloads inside the admin frame) | C1 |
| AI | Translation style: form of address per language, store description as context; wrong-script warning | Yes | Server + UI (Settings); DeepL request shape stubbed | No (no key) | C7 |
| Security | HTTP security headers, dependency audit in CI | Yes | Unit + production build | No (headers inside the admin frame) | A1 |
| Editor | Outdated detection and "still correct" confirmation | Yes | Server | No | C4 |
| SEO | SEO title/description checks, search result preview, "SEO fields only" (editor and bulk) | Yes | Server | No | D1–D3 |
| SEO | URL handle suggestion, format check, confirmation before changing a published handle | Yes | Server | No | D4 |
| SEO | Coverage report per language and type, SEO findings, duplicate SEO titles, "translate gaps" | Yes | Server (incl. BullMQ worker) | No | K1–K3 |
| Bulk | Bulk jobs (queues, retries, throttling, cancel, resume, stalled-item sweeper) | Yes | Server (real Redis and BullMQ); UI for the Jobs list | No | E1–E6 |
| Bulk | Drafts by default; automatic publishing only after explicit confirmation; flagged results always to Review | Yes | Yes (security suite, mutation-checked) | No | E2–E3 |
| Bulk | Translations made by people or outside Linguva are kept unless replacing is explicitly allowed | Yes | Server | No | E4 |
| Memory | Translation memory: exact reuse at no cost, fuzzy suggestions (100,000 entries: median 33–37 ms) | Yes | Yes (incl. performance and security suites) | No | F1–F3 |
| Glossary | Never translate / always translate as / never use, CSV import and export | Yes | Server | No | G1–G3 |
| Review | Review page: filters, search, pagination, approve, reject | Yes | Server; UI (content, empty state, accessibility) | No | H1–H2 |
| History | Revisions, restore, remove translation | Yes | Server | No | H3–H5 |
| Images | Image alt text for product images (MEDIA_IMAGE) and collection / blog post images (nested COLLECTION_IMAGE, ARTICLE_IMAGE): editor, AI drafts, publish | Yes | Server (incl. security tests) | No (live test prepared) | I1–I3 |
| Metafields | Metafields Shopify marks translatable (single and multi-line text): editor, AI drafts, publish. Rich text, JSON, lists, links and files are counted, not edited | Yes | Server (incl. security tests) | No (live test prepared) | I4–I6 |
| Markets | Read-only Markets page (optional scope `read_markets`): languages and addresses per market, checks | Yes | Server | No (live read test prepared) | J1–J4 |
| Billing | Owner complimentary access: shop GID in server configuration AND an operator grant (owner database role), metered AI usage, internal cost estimate, audit | Yes | Server (incl. security tests) + UI (Plan page) | No | L10 |
| Billing | Shopify App Pricing: plan entitlements, Partner API subscription check (6 h cache, never locks out a paying shop on API errors), plan selection redirect, welcome link, gating in editor, bulk, settings, glossary, worker | Yes | Server (simulated Partner API) + UI (Plan page states) | No | L1–L9 |
| Cost | Monthly, daily and platform-wide character caps, request size cap, request rate limits per staff member and shop | Yes | Yes (concurrency with real PostgreSQL and Redis) | No | M1–M3 |
| AI | DeepL provider (batching, retries, error classes, `/v2/usage`) | Yes | Stubbed HTTP only | No (no key) | C7 |
| AI | Mock provider for tests (refused in production) | Yes | Yes | — | — |

## Not implemented

| Feature | Notes |
|---|---|
| Images and metafields in bulk jobs and the coverage report | Editor only for now |
| Rendered (sanitised) preview of HTML texts | Raw HTML in the editor and Review |
| App interface in other languages | English only |
| Review text search through an index | Linear scan under RLS (PERFORMANCE.md §1) |
| Rich text, JSON, list, link and file metafields | Need structure-aware editing |
| Market-specific translations (`marketId`), changing markets or web presences | Markets page is read-only |
| Usage-based overage (App Events) | Planned |
| Automation on product updates (webhooks + reconciliation) | Planned |
| Admin center for the operator (MFA, roles) | Planned |
| Production hosting, backups, monitoring | Not set up; needs the owner's approval |
