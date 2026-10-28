import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpInternalError, HttpThrottlingError } from "@shopify/shopify-api";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import {
  createQueues,
  createWorkers,
  enqueueDiscovery,
  enqueueItems,
  requeueStalledItems,
  type Queues,
  type WorkerSet,
} from "../../app/.server/jobs/queues";
import type { JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { TokenBucket } from "../../app/.server/queue/rate-limiter";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const DOMAIN = "worker.myshopify.com";
const http = { message: "x", code: 503, statusText: "x", body: {}, headers: {} };

let prefix: string;
let queues: Queues;
let workers: WorkerSet | undefined;

beforeEach(async () => {
  await resetDatabase();
  prefix = testPrefix();
  queues = createQueues(redis, prefix, {
    // Fast retries for tests; production uses 2 s base delay.
    itemJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 20, jitter: 0.5 } },
    discoveryJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 20 } },
  });
});

afterEach(async () => {
  await workers?.close();
  workers = undefined;
  await queues.close();
  await deletePrefix(redis, prefix);
});

afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
  await redis.quit();
});

async function setup(products: number, overrides: Partial<JobDependencies> = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: null }, app);
  const store = new FakeShopifyStore(products);
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    monthlyLimit: 1_000_000,
    keyPrefix: prefix,
    discoveryPageSize: 4,
    ...overrides,
  };
  const { job } = await createBulkJob(
    { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "w-1" },
    app,
  );
  workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 4 });
  return { shop, store, deps, job };
}

const jobRow = (shopId: string, jobId: string) =>
  withTenant(shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: jobId } }), app);

const finished = (shopId: string, jobId: string) => async () =>
  ["COMPLETED", "FAILED", "CANCELLED"].includes((await jobRow(shopId, jobId)).status);

describe("bulk translation worker (BullMQ + Redis)", () => {
  it("discovers across pages and translates every product", async () => {
    const { shop, store, job } = await setup(10);
    await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, null);
    await waitFor(finished(shop.id, job.id));

    expect(await jobRow(shop.id, job.id)).toMatchObject({
      status: "COMPLETED",
      totalItems: 10,
      succeededItems: 10,
      failedItems: 0,
    });
    for (let i = 1; i <= 10; i++) {
      expect(store.translationOf(`gid://shopify/Product/${i}`, "de", "title")).toBe(`[de] Product ${i} jacket`);
    }
  });

  it("retries transient Shopify failures with backoff and still completes", async () => {
    const { shop, store, job } = await setup(3);
    store.failNext = { count: 2, error: () => new HttpInternalError(http) };
    await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, null);
    await waitFor(finished(shop.id, job.id));
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "COMPLETED", succeededItems: 3 });
  });

  it("moves an item to the dead-letter state after the last attempt", async () => {
    const { shop, job } = await setup(2, {
      provider: new MockTranslationProvider({ failNext: { count: 1_000, kind: "retryable" } }),
    });
    await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, null);
    await waitFor(finished(shop.id, job.id));
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "COMPLETED", failedItems: 2, succeededItems: 0 });
    const items = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
    expect(items.map((i) => [i.status, i.errorCode, i.attempts])).toEqual([
      ["DEAD", "PROVIDER_UNAVAILABLE", 3],
      ["DEAD", "PROVIDER_UNAVAILABLE", 3],
    ]);
    // Failed queue jobs are kept for inspection.
    expect(await queues.items.getFailedCount()).toBe(2);
  });

  it("stops the whole job on a provider quota error", async () => {
    const { shop, job } = await setup(3, {
      provider: new MockTranslationProvider({ failNext: { count: 1_000, kind: "quota" } }),
    });
    await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, null);
    await waitFor(finished(shop.id, job.id));
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_QUOTA" });
    await waitFor(async () => {
      const items = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
      return items.every((i) => i.status === "CANCELLED");
    });
  });

  it("delays rate-limited work without spending attempts", async () => {
    const { shop, store, job } = await setup(2, {
      shopifyLimiter: new TokenBucket(redis, { capacity: 60, refillPerSecond: 200 }),
    });
    store.failNext = { count: 1, error: () => new HttpThrottlingError({ ...http, code: 429, retryAfter: 0.05 }) };
    await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, null);
    await waitFor(finished(shop.id, job.id));
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "COMPLETED", succeededItems: 2, failedItems: 0 });
    const items = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
    // Throttling never counted as a failed attempt.
    expect(items.every((i) => i.attempts === 1)).toBe(true);
  });

  it("ignores duplicate enqueues of the same item", async () => {
    const { shop, job, deps } = await setup(1);
    await workers!.close();
    workers = undefined;
    const { runDiscoveryPage } = await import("../../app/.server/jobs/processors");
    const { itemIds } = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    await enqueueItems(queues, shop.id, itemIds, undefined, app);
    await enqueueItems(queues, shop.id, itemIds, undefined, app);
    // Items wait as "prioritized" (fair share between shops, see itemPriority).
    expect(await queues.items.getPrioritizedCount()).toBe(1);
  });
});

describe("stalled-item sweeper", () => {
  it("re-enqueues items whose queue job is gone, and leaves queued items alone", async () => {
    const { shop, job, deps } = await setup(2);
    await workers!.close();
    workers = undefined;
    const { runDiscoveryPage } = await import("../../app/.server/jobs/processors");
    const { itemIds } = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    // Only the first item reaches the queue; the second was "lost".
    await enqueueItems(queues, shop.id, [itemIds[0]!], undefined, app);
    const later = new Date(Date.now() + 60 * 60 * 1000);
    expect(await requeueStalledItems(deps, queues, later)).toBe(1);
    expect(await queues.items.getPrioritizedCount()).toBe(2);
    // Running the sweeper again doesn't duplicate anything.
    expect(await requeueStalledItems(deps, queues, later)).toBe(0);
  });
});
