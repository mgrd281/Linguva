/**
 * Many shops at once: 20 shops start a bulk job at the same moment and
 * share one worker (real PostgreSQL with RLS, Redis, BullMQ, the per-shop
 * Shopify rate limiter). Shopify answers each call after 15 ms. Checks
 * that every job finishes, that no shop sees another shop's content, that
 * the shops progress side by side instead of one after another, and
 * records throughput and finish times (docs/PERFORMANCE.md §1d).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import type { JobDependencies } from "../../app/.server/jobs/processors";
import { createQueues, createWorkers, enqueueDiscovery, type Queues, type WorkerSet } from "../../app/.server/jobs/queues";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { TokenBucket } from "../../app/.server/queue/rate-limiter";
import { searchPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const SHOPS = 20;
const PRODUCTS = 25;
const SHOPIFY_LATENCY_MS = 15;
const CONCURRENCY = 8;

const app = new PrismaClient();
const redis = testRedis();
const prefix = testPrefix();
let queues: Queues;
let workers: WorkerSet;
const shops: Array<{ id: string; marker: string; jobId: string; store: FakeShopifyStore }> = [];

beforeAll(async () => {
  await resetDatabase();
  queues = createQueues(redis, prefix);
  const stores = new Map<string, FakeShopifyStore>();
  for (let s = 0; s < SHOPS; s++) {
    const domain = `load-${s}.myshopify.com`;
    const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
    const store = new FakeShopifyStore(PRODUCTS);
    const marker = `S${s}X`;
    // Every shop's titles carry its marker, so content from another shop would be visible.
    for (let p = 1; p <= PRODUCTS; p++) store.updateSource(`gid://shopify/Product/${p}`, "title", `${marker} product ${p}`);
    stores.set(domain, store);
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `load-${s}` }, app);
    shops.push({ id: shop.id, marker, jobId: job.id, store });
  }
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async (domain) => {
      const store = stores.get(domain)!;
      return {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          await new Promise((r) => setTimeout(r, SHOPIFY_LATENCY_MS));
          return store.graphql(query, options);
        },
      } as never;
    },
    provider: new MockTranslationProvider(),
    monthlyLimit: 10_000_000,
    keyPrefix: prefix,
    discoveryPageSize: 10,
    // Production defaults (SHOPIFY_JOB_BUCKET_SIZE / SHOPIFY_JOB_RESTORE_PER_SECOND), per shop.
    shopifyLimiter: new TokenBucket(redis, { capacity: 800, refillPerSecond: 80 }),
  };
  workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: CONCURRENCY });
}, 120_000);

afterAll(async () => {
  await workers?.close();
  await queues?.close();
  await deletePrefix(redis, prefix);
  await redis.quit();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe(`${SHOPS} shops translating at the same time`, () => {
  it("all finish, side by side, with each shop's content only", async () => {
    const started = Date.now();
    await Promise.all(shops.map((s) => enqueueDiscovery(queues, { shopId: s.id, jobId: s.jobId }, null)));

    const finishedAt = new Map<string, number>();
    await waitFor(
      async () => {
        for (const s of shops) {
          if (finishedAt.has(s.id)) continue;
          const job = await withTenant(s.id, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: s.jobId } }), app);
          if (job.status === "COMPLETED" || job.status === "FAILED") finishedAt.set(s.id, Date.now() - started);
        }
        return finishedAt.size === SHOPS;
      },
      110_000,
      100,
    );
    const totalMs = Date.now() - started;

    const items = SHOPS * PRODUCTS;
    const times = [...finishedAt.values()].sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    console.info(
      `[perf] ${SHOPS} shops x ${PRODUCTS} products: ${totalMs} ms total, ${Math.round((items / totalMs) * 1000)} items/s, ` +
        `first shop done ${times[0]} ms, median ${median} ms, last ${times[times.length - 1]} ms`,
    );

    for (const s of shops) {
      const job = await withTenant(s.id, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: s.jobId } }), app);
      expect(job, s.marker).toMatchObject({ status: "COMPLETED", totalItems: PRODUCTS, succeededItems: PRODUCTS, failedItems: 0 });
      // Every draft belongs to this shop's own catalogue.
      const { drafts } = await searchPendingDrafts(s.id, { take: 200 }, app);
      const titles = drafts.filter((d) => d.key === "title");
      expect(titles.length, s.marker).toBeGreaterThan(0);
      for (const d of titles) expect(d.value, s.marker).toContain(s.marker);
    }
    // Side by side: the first shop isn't done long before the others (FIFO would finish shop 1 at ~1/20 of the total).
    expect(times[0]!).toBeGreaterThan(totalMs * 0.25);
    expect(totalMs).toBeLessThan(100_000);
  });
});

describe("a large shop next to small shops", () => {
  it("small shops that start later don't wait for the large shop's whole catalogue", async () => {
    // Without fair share (plain FIFO), the small shops' items would queue behind all 400.
    await resetDatabase();
    const big = { domain: "load-big.myshopify.com", products: 400 };
    const stores = new Map<string, FakeShopifyStore>();
    const make = async (domain: string, products: number, key: string) => {
      const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
      await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
      stores.set(domain, new FakeShopifyStore(products));
      const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: key }, app);
      return { shopId: shop.id, jobId: job.id };
    };
    const bigJob = await make(big.domain, big.products, "big");
    const small = await Promise.all(Array.from({ length: 5 }, (_, i) => make(`load-small-${i}.myshopify.com`, 5, `small-${i}`)));
    const localPrefix = testPrefix();
    const q = createQueues(redis, localPrefix);
    const w = createWorkers(
      {
        prisma: app,
        adminFor: async (domain) => {
          const store = stores.get(domain)!;
          return {
            graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
              await new Promise((r) => setTimeout(r, SHOPIFY_LATENCY_MS));
              return store.graphql(query, options);
            },
          } as never;
        },
        provider: new MockTranslationProvider(),
        monthlyLimit: 10_000_000,
        keyPrefix: localPrefix,
        discoveryPageSize: 50,
        // No Shopify rate limit here (a shop with high limits, e.g. Shopify Plus): the large
        // shop alone could keep every worker slot busy.
      },
      q,
      { connection: redis, prefix: localPrefix, concurrency: CONCURRENCY },
    );
    try {
      const status = (s: { shopId: string; jobId: string }) =>
        withTenant(s.shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: s.jobId } }), app).then((j) => j.status);
      const started = Date.now();
      await enqueueDiscovery(q, { shopId: bigJob.shopId, jobId: bigJob.jobId }, null);
      // The small shops start once the large shop's work is queued.
      await waitFor(async () => (await q.items.getWaitingCount()) + (await q.items.getPrioritizedCount()) > 100, 30_000, 20);
      const smallStart = Date.now();
      await Promise.all(small.map((s) => enqueueDiscovery(q, { shopId: s.shopId, jobId: s.jobId }, null)));
      await waitFor(async () => (await Promise.all(small.map(status))).every((x) => x === "COMPLETED"), 30_000, 50);
      const smallDone = Date.now() - smallStart;
      const bigRow = await withTenant(bigJob.shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: bigJob.jobId } }), app);
      const bigDoneItems = bigRow.succeededItems + bigRow.skippedItems + bigRow.failedItems;
      console.info(
        `[perf] 5 small shops (5 products each) done ${smallDone} ms after they started, ${Date.now() - started} ms into the run; ` +
          `the large shop (${big.products} products) had ${bigDoneItems} done and was ${bigRow.status}`,
      );
      // The small shops finish while the large shop is still running: they don't wait behind its catalogue.
      expect(bigRow.status).toBe("RUNNING");
      // With fair share about 30 of 400 are done by then; plain FIFO had over 200 (measured).
      expect(bigDoneItems).toBeLessThan(big.products / 4);
      expect(smallDone).toBeLessThan(15_000);
    } finally {
      await w.close();
      await q.close();
      await deletePrefix(redis, localPrefix);
    }
  });
});
