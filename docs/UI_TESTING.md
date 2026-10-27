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
| `ui-fresh` | Not seeded: installs during the test |

## Suites

| File | Covers |
|---|---|
| `install.spec.ts` | Install through token exchange, shop GID stored, tokens encrypted; forged session tokens and cross-store requests get no data |
| `pages.spec.ts` | Overview, Languages, Products, Editor, Review, Jobs, Plan: content, axe (WCAG 2.1 A/AA, no serious or critical findings), accessible tables, no horizontal scrolling on desktop and phone (`@responsive`) |
| `states.spec.ts` | Empty states, Shopify outage (clear message, Try again, no internal details), not found, loading state of AI translation, admin loading bar on navigation |
| `flows.spec.ts` | Translate with AI → edit → publish → read back; alt text; Plan page for subscribed, unsubscribed and complimentary stores |

## Accessibility rule note

Polaris web components set ARIA roles through `ElementInternals`, which axe-core can't read, so axe reports `aria-required-children` on every `<s-table>`. That rule is replaced by `expectAccessibleTables`, which reads Chromium's accessibility tree and requires grid → row → columnheader/gridcell on desktop, or headed items with labelled values where Polaris renders tables as lists (phones). All other WCAG 2.1 A/AA rules apply.

## Running

```bash
pnpm db:up                 # PostgreSQL + Redis (the test database is reset)
pnpm test:ui               # build, preload, Playwright (desktop + phone projects)
npx playwright test --ui   # interactive, after one pnpm test:ui
```

Behind an HTTPS proxy (cloud sessions) the browser uses `HTTPS_PROXY` for the CDN, with TLS verification on. `localhost` bypasses the proxy.
