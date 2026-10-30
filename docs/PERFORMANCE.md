# Performance

Measured on 2026-10-27 in the development container (4 vCPU, PostgreSQL 16, Node 22), Shopify simulated. All values are **Tested Locally**. Real timings in the admin add Shopify's API latency and throttling; they are measured on a development store (DEV_STORE_TEST_PLAN.md E1–E6).

The tests run in CI with generous limits for shared runners and print the measured values. A limit failing means a regression, not normal variance.

## 1. Database at large-shop scale

`tests/performance/large-shop.perf.test.ts`: one shop with 50,000 pending drafts and 5,000 jobs, plus a second shop with 10,000 drafts and 1,000 jobs. Each value is the median of 7 runs after a warm-up.

| Operation | Median | CI limit |
|---|---|---|
| Review: first page (50 drafts and the total) | 21–29 ms | 300 ms |
| Review: later page (keyset cursor) | 25–33 ms | 300 ms |
| Review: language and "with warnings" filter | 15 ms | 300 ms |
| Review: pending count | 17 ms | 300 ms |
| Review: text search, 3+ characters (indexed, since phase G; was 207–214 ms) | 12.5 ms | 300 ms |
| Review: text search, 1–2 characters (scan) | 102 ms | 1,000 ms |
| Jobs: first page, filtered page, next page | 4 ms | 300 ms |

`tests/performance/fuzzy-memory.perf.test.ts`: fuzzy translation memory search at 100,000 entries, median 33–37 ms.

### Review text search (indexed since phase G)

Under row-level security PostgreSQL can't use an index for `ILIKE` (not leakproof): the tenant check runs first, so every pending draft of the shop was read (about 4 ms per 1,000 drafts, 207 ms at 50,000, about 2 s at 500,000).

Since phase G, text of three characters or more goes through `linguva_draft_search()`, a reviewed `SECURITY DEFINER` function with a partial trigram index on pending drafts (same pattern as the memory search; SECURITY_MODEL.md §5l, review in SECURITY_REVIEW_MEMORY_FUZZY.md §10): 12.5 ms at 50,000 drafts. Shorter text, and text so common that it matches more than 5,000 drafts, still scans (correct, slower).

### Review's cards (Redesign 2, 2026-10-30)

Since Redesign 2 the Review page reads whole cards: `searchReviewPage` (`app/.server/review/page.ts`) returns the page, the matching count, the page's position and the counts of the tabs and chips. The Review rows of the first table measure the earlier list query (`searchPendingDrafts`), which the test still runs; the pending count is the Overview's.

Same file and the same 50,000 pending drafts, of which 5 % are image descriptions drafted without their owner (the coverage scan knows the product). Medians measured when the page was built:

| Operation | Quiet machine | Beside another test run on the same 4 CPUs | CI limit |
|---|---|---|---|
| First page (page, counts, position, tab and chip counts) | 120 ms | 154 ms | 300 ms |
| Later page (cursor, position) | 163 ms | 225 ms | 300 ms |
| Language and area (owner look-up) | 87 ms | 165 ms | 300 ms |
| Language and "With notes" | 82 ms | 108 ms | 300 ms |
| Text search (indexed) | 125 ms | 170 ms | 300 ms |

Per query: the page 47–55 ms, the matching count 14 ms, the position 33 ms, the tab and chip counts 55–62 ms. The page query stays under 100 ms, so no index was added for the card order. The tab and chip counts are the largest part of every load: if CI comes close to its limit, keeping them for a short time or an expression index would cut it. `tests/integration/review-cards.test.ts` also opens pages with 20,000 waiting texts (under 3 s each, a generous bound).

The pictures load after the page (`app/routes/app.review_.previews.tsx`): one `nodes()` read per 100 items, kept a minute per shop and item.

## 2. Bulk jobs with a large catalog

Same test file, 5,000 products. Discovery runs in pages of at most 50 resources, with exactly one Shopify request per page: 100 pages, 2.3 s in total, 23 ms per page without Shopify latency. Memory use stays bounded because a page is processed and stored before the next one is read. Real throughput is limited by Shopify's API cost limits (handled by the shop rate limiter) and by the AI provider.

## 2a. Many shops at once (`tests/performance/multi-shop.perf.test.ts`)

One worker (concurrency 8), real PostgreSQL with RLS, Redis and BullMQ, the per-shop Shopify rate limiter with production defaults, Shopify answering each call after 15 ms, mock AI provider. Measured in the development container (CI repeats it on every push):

| Scenario | Result |
|---|---|
| 20 shops × 25 products start at the same moment | All 500 items in about 6 s (about 80 items/s). The first shop finished at about 90 % of the total time, the last at 100 %: the shops progress side by side. Every draft belongs to its own shop's catalogue (marker check). |
| A large shop (400 products, no Shopify rate limit, e.g. a Plus shop) has its work queued; then 5 small shops (5 products each) start | The small shops finish about 0.6 s after starting, while the large shop has about 30 of 400 done. |

**Bug found by the second scenario:** the item queue was first in, first out, so a shop starting a job waited behind another shop's whole catalogue (measured: the large shop had 203 of 400 done before the small shops finished). Items now get a queue priority from their position in their own job (`itemPriority`): every shop's first items come before another shop's later items, and a job keeps its own order. The test fails without the change (mutation-checked).

Not measured: real Shopify and DeepL latency and limits, several worker processes, database connection limits of the production host.

## 3. Page response times

`tests/ui/timings.spec.ts`: the production build under `react-router-serve`, full HTML including session token validation. Median of 3 runs after a warm-up; the CI limit is 1,500 ms.

| Page | Server response |
|---|---|
| Overview | 39 ms |
| Products list | 31 ms |
| Product editor | 43 ms |
| Review | 54 ms |
| Jobs | 22 ms |
| Content | 26 ms |
| Plan | 25 ms |
| Settings | 37 ms |

Content checks its 26 content types (products and collections included) in batches of 6, so in a real store its time is dominated by Shopify's API latency: about 5 round trips.

The Content page keeps those checks for 60 seconds per shop and set of granted optional scopes (`loadContentHub`, at most 2,000 entries; a view in which Shopify didn't answer for a type is not kept, and asking for a permission forgets the shop's entry). What each type's state is (has content, needs a permission, not available to apps) is worked out from the kept answers and the granted scopes on every view.

| Content page | Shopify Admin calls | Database |
|---|---|---|
| First view, after 60 s, or with other granted scopes | 28: scopes, locales and the 26 checks (markets for the flags cached 5 minutes, billing cached), about 6 round trips; locales and coverage are read beside the checks | The language's counts, report and segments; one indexed GROUP BY on `CoverageItem` for one language (the tiles' item counts); the language's active jobs |
| Repeat view within 60 s | 2: scopes, locales | The same |
| After the page shows | The language's previews (pictures), 1 `nodes()` read cached 60 s and shared with the language page | — |

It polls only while a count reads the shown language (every 5 s). `tests/performance/coverage-scale.perf.test.ts` checks the item counts and the whole page data for one language of a large shop (under 300 ms and 1,500 ms); `tests/integration/content-hub.test.ts` counts the checks per view.

## 4. Client bundle

`pnpm build` (after phase C): **155 KB gzipped** JavaScript in total (was 122 KB). The increase is the interface texts in English and German (about 520 keys each), which are part of the shared code so pages render without waiting for a text file. The shared part (React, router, entry, texts) is about 116 KB gzipped. Pages are split by route: the largest page chunk is the translation editor at 7 KB gzipped. Polaris and App Bridge load from Shopify's CDN and are usually cached by the admin. With more interface languages, the catalogues should be loaded per language (one chunk each) instead of all at once.

## 5. Next steps

| Item | Why |
|---|---|
| Measure on a development store with 1,000+ products | Real Shopify latency and throttling (E1–E6) |
| Server timing per loader in production logs | Find slow Shopify calls in real stores |
