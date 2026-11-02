import { PrismaClient } from "@prisma/client";
import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelJob,
  createBulkJob,
  getJobForShop,
  jobCounts,
  jobPendingDrafts,
  latestJobTitles,
  listActiveJobs,
  listJobsPage,
  listProblemItems,
  retryJobItems,
  rowOutcomesByJob,
} from "../../app/.server/jobs/bulk-jobs";
import { searchJobIds } from "../../app/.server/jobs/job-search";
import {
  createItemProcessor,
  createQueues,
  enqueueItems,
} from "../../app/.server/jobs/queues";
import {
  processItem,
  runDiscoveryPage,
  type JobDependencies,
} from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import type { TranslationProvider } from "../../app/.server/providers/types";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
  await redis.quit();
});

async function tenant(domain: string, products = 1) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: null }, app);
  const store = new FakeShopifyStore(products);
  const { job } = await createBulkJob(
    { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `${domain}-k` },
    app,
  );
  return { shop, store, job };
}

function depsFor(stores: Record<string, FakeShopifyStore>, provider: TranslationProvider = new MockTranslationProvider()): JobDependencies {
  return {
    prisma: app,
    adminFor: async (domain) => stores[domain]!.asAdmin(),
    provider,
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test",
  };
}

describe("tenant isolation of bulk jobs", () => {
  it("discards a payload that pairs one shop with another shop's item", async () => {
    const a = await tenant("a.myshopify.com");
    const b = await tenant("b.myshopify.com");
    const deps = depsFor({ "a.myshopify.com": a.store, "b.myshopify.com": b.store });
    const [itemOfB] = (await runDiscoveryPage(deps, { shopId: b.shop.id, jobId: b.job.id })).itemIds;

    const outcome = await processItem(deps, { shopId: a.shop.id, itemId: itemOfB! }, 1);
    expect(outcome).toEqual({ status: "discarded", reason: "NOT_FOUND" });
    // Nothing was read from or written to either store.
    expect(a.store.calls).toEqual([]);
    expect(b.store.calls).toEqual(["LinguvaTranslatableResources"]);
    const item = await withTenant(b.shop.id, (tx) => tx.translationJobItem.findUniqueOrThrow({ where: { id: itemOfB! } }), app);
    expect(item.status).toBe("PENDING");
  });

  it("ignores a discovery payload for another shop's job", async () => {
    const a = await tenant("a.myshopify.com");
    const b = await tenant("b.myshopify.com");
    const deps = depsFor({ "a.myshopify.com": a.store, "b.myshopify.com": b.store });
    const result = await runDiscoveryPage(deps, { shopId: a.shop.id, jobId: b.job.id });
    expect(result.itemIds).toEqual([]);
    expect(a.store.calls).toEqual([]);
    expect(b.store.calls).toEqual([]);
  });

  it("uses the shop domain from the database, never from the payload", async () => {
    const a = await tenant("a.myshopify.com");
    const seen: string[] = [];
    const deps: JobDependencies = {
      ...depsFor({ "a.myshopify.com": a.store }),
      adminFor: async (domain) => {
        seen.push(domain);
        return a.store.asAdmin();
      },
    };
    const forged = { shopId: a.shop.id, jobId: a.job.id, shopDomain: "victim.myshopify.com" } as never;
    await runDiscoveryPage(deps, forged);
    expect(seen).toEqual(["a.myshopify.com"]);
  });

  it("does not expose, cancel or retry another shop's job", async () => {
    const a = await tenant("a.myshopify.com");
    const b = await tenant("b.myshopify.com");
    expect(await getJobForShop(a.shop.id, b.job.id, app)).toBeNull();
    expect(await listProblemItems(a.shop.id, b.job.id, app)).toEqual([]);
    expect(await cancelJob(a.shop.id, b.job.id, app)).toBe(false);
    expect(await retryJobItems(a.shop.id, b.job.id, app)).toEqual({ itemIds: [], rediscover: false });
    const jobOfB = await getJobForShop(b.shop.id, b.job.id, app);
    expect(jobOfB?.status).toBe("PENDING");
  });

  it("never reads another shop's jobs through ids passed in (the Jobs list, its rows, a job's drafts, the search)", async () => {
    const a = await tenant("a.myshopify.com");
    const b = await tenant("b.myshopify.com");
    const deps = depsFor({ "a.myshopify.com": a.store, "b.myshopify.com": b.store });
    await runDiscoveryPage(deps, { shopId: b.shop.id, jobId: b.job.id });
    await withTenant(
      b.shop.id,
      (tx) =>
        tx.translationDraft.create({
          data: { shopId: b.shop.id, jobId: b.job.id, resourceGid: "gid://shopify/Product/1", locale: "de", key: "title", sourceDigest: "d", sourceValue: "Jacket", value: "Jacke" },
        }),
      app,
    );
    const foreign = [b.job.id];
    expect((await listJobsPage(a.shop.id, { ids: foreign, take: 100 }, app)).jobs).toEqual([]);
    expect((await listJobsPage(a.shop.id, { cursor: b.job.id, take: 100 }, app)).jobs.map((j) => j.shopId)).toEqual([a.shop.id]);
    expect((await jobCounts(a.shop.id, { ids: foreign }, new Date(), app)).all).toBe(0);
    expect(await listActiveJobs(a.shop.id, { ids: foreign }, 21, app)).toEqual([]);
    expect(await rowOutcomesByJob(a.shop.id, foreign, app)).toEqual({ [b.job.id]: { waiting: 0, partial: 0, rejected: 0, sourceChanged: 0, cancelled: 0, retryable: 0 } });
    expect(await jobPendingDrafts(a.shop.id, b.job.id, app)).toEqual({ translations: 0, items: 0 });
    expect(await latestJobTitles(a.shop.id, b.job.id, app)).toEqual([]);
    expect(await searchJobIds(a.store.asAdmin(), a.shop.id, b.job.id.slice(0, 8), app)).toMatchObject({ ids: [] });
    // The other shop sees its own.
    expect(await jobPendingDrafts(b.shop.id, b.job.id, app)).toEqual({ translations: 1, items: 0 });
  });

  it("rejects malformed job ids instead of querying with them", async () => {
    const a = await tenant("a.myshopify.com");
    expect(await getJobForShop(a.shop.id, "' OR 1=1 --", app)).toBeNull();
  });

  it("fails closed: job tables return nothing without a tenant and can't be deleted", async () => {
    await tenant("a.myshopify.com");
    expect(await app.translationJob.count()).toBe(0);
    expect(await app.translationJobItem.count()).toBe(0);
    await expect(app.$executeRawUnsafe(`DELETE FROM "TranslationJob"`)).rejects.toThrow(/permission denied/);
  });
});

describe("queue payloads", () => {
  it("rejects payloads with unexpected fields or non-UUID ids", async () => {
    const processor = createItemProcessor(depsFor({}));
    const fakeJob = (data: unknown) => ({ data, id: "x", attemptsMade: 0, opts: { attempts: 1 } }) as unknown as Job;
    for (const data of [
      { shopId: "not-a-uuid", itemId: "also-not" },
      { shopId: "0b7d6f0e-6f7a-4f53-9d2b-1f6c2a9e8a11", itemId: "0b7d6f0e-6f7a-4f53-9d2b-1f6c2a9e8a12", accessToken: "shpat_x" },
      null,
    ]) {
      await expect(processor(fakeJob(data))).rejects.toMatchObject({ name: "UnrecoverableError", message: "INVALID_PAYLOAD" });
    }
  });

  it("stores only ids in Redis: no tokens, no merchant content", async () => {
    const prefix = testPrefix();
    const queues = createQueues(redis, prefix);
    try {
      const a = await tenant("a.myshopify.com");
      const deps = depsFor({ "a.myshopify.com": a.store });
      const { itemIds } = await runDiscoveryPage(deps, { shopId: a.shop.id, jobId: a.job.id });
      await enqueueItems(queues, a.shop.id, itemIds, undefined, app);
      const job = await queues.items.getJob(itemIds[0]!);
      expect(Object.keys(job!.data).sort()).toEqual(["itemId", "shopId"]);
      const raw = JSON.stringify(await redis.hgetall(`${prefix}:translation-items:${itemIds[0]}`));
      // Guard against a vacuous pass: the raw record must exist.
      expect(raw).toContain(a.shop.id);
      expect(raw).not.toMatch(/jacket|myshopify|shpat_|accessToken/i);
    } finally {
      await queues.close();
      await deletePrefix(redis, prefix);
    }
  });
});

describe("malicious provider output in bulk jobs", () => {
  it("publishes escaped text, never provider-supplied markup", async () => {
    const a = await tenant("a.myshopify.com");
    const evil: TranslationProvider = {
      id: "evil",
      translate: async (request) => ({
        translations: request.segments.map(
          (s) => s.replace(/^/, '<img src=x onerror="alert(document.cookie)"><script>steal()</script>'),
        ),
        billedCharacters: 1,
        provider: "evil",
      }),
    };
    const deps = depsFor({ "a.myshopify.com": a.store }, evil);
    const [itemId] = (await runDiscoveryPage(deps, { shopId: a.shop.id, jobId: a.job.id })).itemIds;
    await processItem(deps, { shopId: a.shop.id, itemId: itemId! }, 1);

    const body = a.store.translationOf("gid://shopify/Product/1", "de", "body_html")!;
    expect(body).not.toMatch(/<script|<img/i);
    expect(body).toContain("&lt;script&gt;");
    // The source's own structure is kept.
    expect(body.startsWith("<p>")).toBe(true);
    expect(body).toContain("<b>jacket</b>");
  });
});
