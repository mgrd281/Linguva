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
| Review: text search | 207–214 ms | 1,000 ms |
| Jobs: first page, filtered page, next page | 4 ms | 300 ms |

`tests/performance/fuzzy-memory.perf.test.ts`: fuzzy translation memory search at 100,000 entries, median 33–37 ms.

### Known limit: Review text search

The text search scans the shop's pending drafts: about 4 ms per 1,000 drafts, so about 2 s at 500,000. A trigram index does not help. The test with an index showed that Postgres can't use it under row-level security, because `ILIKE` is not leakproof. The tenant check has to run first, so every row of the shop is read.

The translation memory solved the same problem with a reviewed `SECURITY DEFINER` function (SECURITY_MODEL.md §5c). The plan for Review is the same pattern, with its own security review and definition hash: a function that sets the tenant from `app.shop_id` itself and uses the index. It isn't built yet, because a new definer function needs that review. The other filters (language, job, warnings, resource type) don't depend on it.

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
| All content | 26 ms |
| Plan | 25 ms |
| Settings | 37 ms |

All content checks the 30 content types in batches of 6, so in a real store its time is dominated by Shopify's API latency: about 5 round trips.

## 4. Client bundle

`pnpm build`: 45 JavaScript files, 364 KB in total, **122 KB gzipped**. The shared part (React, router, entry) is 86 KB gzipped. Pages are split by route: the largest page chunk is the translation editor at 7 KB gzipped. Polaris and App Bridge load from Shopify's CDN and are usually cached by the admin.

## 5. Next steps

| Item | Why |
|---|---|
| Review text search through a reviewed definer function | Linear scan, see §1 |
| Measure on a development store with 1,000+ products | Real Shopify latency and throttling (E1–E6) |
| Server timing per loader in production logs | Find slow Shopify calls in real stores |
