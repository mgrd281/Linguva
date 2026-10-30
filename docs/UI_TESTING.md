# UI tests (Playwright)

`pnpm test:ui` runs the embedded admin in a real browser (Chromium) and checks the merchant-facing pages: content, empty, error and loading states, the main flows, accessibility and phone layout.

## What is real and what is simulated

| Part | In the UI tests |
|---|---|
| App server | **Real**: the production build (`pnpm build`), served by `react-router-serve` |
| Authentication | **Real**: `authenticate.admin` validates HS256 session tokens signed with a test-only secret. Shopify-managed install runs through token exchange and the `afterAuth` hook, and tokens are stored encrypted |
| Database, Redis | **Real**: PostgreSQL with row-level security (runtime role), Redis |
| Polaris web components | **Real**: `polaris.js` from Shopify's CDN |
| Shopify Admin API, token exchange, Partner API | **Simulated** by `tests/ui/server/preload.ts`, loaded with `node --import` into the test server only. Any other request to a Shopify host is refused, so the tests can't reach a real store |
| Store images (Shopify's CDN) | **Simulated**: the simulated stores' images point at the test server, whose preload answers `/__fixtures/img/<name>.svg` with small drawings (`tests/support/fixture-images.ts`; `addImage(parent, alt, picture)` picks one) before the app sees the request. The app adds Shopify's `width` parameter as it does for real images |
| App Bridge | **Stub** (`tests/ui/helpers.ts`). The real script redirects to the admin outside its iframe. Like App Bridge, the stub adds the session token to the app's requests and records `shopify.loading()` and toasts. The navigation (`s-app-nav`), which the admin renders outside the app, is hidden |
| AI | Mock provider (`[de] …` pseudo-translations) |

Nothing in `app/` knows about the tests: there is no test mode and no auth bypass.

## Test shops (`tests/ui/fixtures/shops.ts`)

| Shop | Purpose |
|---|---|
| `ui-full` | 30 products, collections, pages, posts, image and metafield, German, French and Arabic, Pro plan, seeded review-mode job with French drafts |
| `ui-empty` | Only the primary language, no subscription |
| `ui-nocatalog` | German enabled, no products, no jobs, no drafts |
| `ui-failing` | Admin API answers 503 for resource queries (Shopify outage) |
| `ui-owner` | Owner complimentary access (granted by the operator tool in the setup) |
| `ui-visual` | Fixed content for screenshot comparisons (counted once, three product pictures); no test changes it |
| `ui-catalog` | 55 products (more than one page of an area's list) in every state, counted, with pictures; German is only read, the French tests start a translation |
| `ui-demo` | A realistic outdoor store (App Store screenshots, Overview by country, language page): a picture for every product and collection, German partly translated, French drafts, markets |
| `ui-slow` | Shopify answers translation queries only after 20 s (longer than the app's time limit, 3 s in these tests) |
| `ui-fresh` | Not seeded: installs during the test |

## Suites

| File | Covers |
|---|---|
| `install.spec.ts` | Install through token exchange, shop GID stored, tokens encrypted; forged session tokens and cross-store requests get no data |
| `pages.spec.ts` | Overview, Languages, Content, Products, Editor, Review, Jobs, Plan: content, axe (WCAG 2.1 A/AA, no serious or critical findings), accessible tables, no horizontal scrolling on desktop and phone (`@responsive`) |
| `states.spec.ts` | Empty states, Shopify outage (clear message, Try again, no internal details), not found, loading state of AI translation, a language page's examples loading after it and failing without taking the page down, admin loading bar on navigation |
| `flows.spec.ts` | Translate with AI → edit → publish → read back; history; alt text; Plan page for subscribed, unsubscribed and complimentary stores |
| `preview.spec.ts` | Rendered HTML in sandboxed frames (editor and Review), live preview with an attack payload that must not run, original and translation side by side (desktop) or stacked (phone), HTML code toggle |
| `content.spec.ts` | The Content page for one language: the language chips (visible languages first, the shown one no link, a hidden one marked), the language picked without `?lang` (never a hidden one), the select with more than six languages, when it was last counted and the way to its next steps, one permission card with one button that asks for every missing scope (allow-listed scopes only), each area as one link with its figure in the link's name and no figure while a part is refused or not counted, More texts (the theme's and notifications' parts open below their row, opened and scrolled to from a language page with `?open`), the folds of what isn't in the store and what Shopify doesn't let apps read, no language, nothing to translate (no count offered); then menu flow, theme texts with search and pages, permission prompt, invalid references, bulk options |
| `settings.spec.ts` | Translation style saved per language; usage figures from the plan |
| `tools.spec.ts` | Glossary (language by name, market number validation), translation memory, coverage report, Markets |
| `rtl.spec.ts` / `unsaved.spec.ts` | Right-to-left input; question before losing unpublished changes |
| `keyboard.spec.ts` | Translate, edit and publish with the keyboard only; visible focus; focus on "Stay" when leaving; Review checkboxes with Space |
| `network.spec.ts` | Hanging Shopify ends in a clear page within the time limit; loading bar on slow navigation; AI translation can't be sent twice |
| `timings.spec.ts` | Server response times of the main pages (PERFORMANCE.md) |
| `language-page.spec.ts` | A language's page: breadcrumb, figure (ring and words), one next step with the page's only primary button (at least 44 px high on a phone), the three steps to live, the areas in the order customers meet them with loaded pictures and alt attributes, "View all" (also on a phone), what the percentage leaves out, the folded words, the confirm dialog (contents, Cancel starts nothing, confirming opens the job), not counted, hidden, no access, unknown and primary language |
| `category-list.spec.ts` | One area of a language: figure and next step, filter chips that add up to "All", groups by state, rows with pictures, texts and the editor link, filters, paging (50 per page), search that keeps the filter, the confirm dialog, no access, not counted, unknown area or language |
| `visual.spec.ts` | Screenshot comparison of 10 pages on desktop and phone (see below) |
| `editor-states.spec.ts` | Every editor field starts with its state; the original description's preview fits its list |
| `ui-review-screenshots.spec.ts` | On demand (`UI_REVIEW_SCREENSHOTS=<folder>`): full-page screenshots of the key screens for the design review (docs/UI_REVIEW.md) |
| `i18n.spec.ts` | German interface from Shopify's `locale` parameter: 12 pages (with a language's page and its products) with axe, phone layout and no English interface text left; navigation stays German inside the app; the target language (`?lang=`) never changes the interface; German error page; browser language without the parameter |
| `job-report.spec.ts` | Job page results by reason, timing and support reference; CSV report in English and German; another store's report is 404 |

`openApp(page, shop, path, { locale: "de" })` opens a page as a German admin user would (Shopify adds `locale` to the app's URL). The app's own language parameter for the translation target is `lang`.

## Accessibility rule note

Polaris web components set ARIA roles through `ElementInternals`, which axe-core can't read, so axe reports `aria-required-children` on every `<s-table>`. That rule is replaced by `expectAccessibleTables`, which reads Chromium's accessibility tree and requires grid → row → columnheader/gridcell on desktop, or headed items with labelled values where Polaris renders tables as lists (phones). All other WCAG 2.1 A/AA rules apply.

## Visual comparisons

`visual.spec.ts` compares the Overview, Products, Editor, Review (empty), Glossary, Settings, Plan and Content pages, a language's page and one of its areas (German, Products), desktop and phone, with reference images (up to 1 % of pixels may differ). It uses the `ui-visual` store, waits until the Inter web font is loaded, and replaces dates (with their time, where a page shows it) with a fixed one. Polaris text has no box of its own, so masking can't cover it.

**CI is the reference.** GitHub's Ubuntu runners render the committed images `tests/ui/visual.spec.ts-snapshots/*-ci.png`. Other machines can render text differently: this development container has Inter installed as a system font, which the browser uses instead of Shopify's web font, with slightly different glyph widths (2–4 % of pixels). So other machines compare against their own `*-local.png` images. Those are created on the first run and not committed.

When a page changes on purpose, or when Shopify updates Polaris (it loads from Shopify's CDN, so its look can change without a change here):

1. Push. The visual test fails in CI, and the Playwright report artifact holds `<page>-actual.png` for each changed page.
2. Look at every changed image.
3. Commit the correct ones as `<page>-<desktop|mobile>-ci.png`.

Locally, run `pnpm test:visual:update` to refresh your own `*-local.png` images. A changed image is a review item, not a formality.

## Running

```bash
pnpm db:up                 # PostgreSQL + Redis (the test database is reset)
pnpm test:ui               # build, preload, Playwright (desktop + phone projects)
npx playwright test --ui   # interactive, after one pnpm test:ui
```

Behind an HTTPS proxy (cloud sessions) the browser uses `HTTPS_PROXY` for the CDN, with TLS verification on. `localhost` bypasses the proxy.
