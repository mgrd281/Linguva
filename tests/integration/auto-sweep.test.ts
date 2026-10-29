/**
 * The periodic check for automatic translation: content changed since the
 * last check (pages, blog posts and blogs have no webhooks; product and
 * collection webhooks can be missed) is queued for the same check a webhook
 * queues. It starts when the merchant turns automatic translation on, keeps
 * its position after a failure, skips types without access, and works per
 * store.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { sweepChangedContent } from "../../app/.server/jobs/auto-sweep";
import type { CoverageRefreshQueue } from "../../app/.server/coverage/refresh";
import { createAutoItems, queueAutoTranslate, type AutoTranslatePayload } from "../../app/.server/jobs/auto-translate";
import { processItem, type JobDependencies } from "../../app/.server/jobs/processors";
import { createQueues, createWorkers, type Queues, type WorkerSet } from "../../app/.server/jobs/queues";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { searchPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { changedSince } from "../../app/.server/shopify/recent-changes";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { PLANS } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const minutes = (n: number) => n * 60_000;

let prefix: string;
let queues: Queues | undefined;
let workers: WorkerSet | undefined;

beforeEach(async () => {
  await resetDatabase();
  prefix = testPrefix();
});
afterEach(async () => {
  await workers?.close();
  await queues?.close();
  workers = undefined;
  queues = undefined;
  await deletePrefix(redis, prefix);
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
  await redis.quit();
});

async function shopWithStore(domain: string, options: { enable?: boolean } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (options.enable ?? true) {
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
  }
  return { shop, store: new FakeShopifyStore(2).addCollections(1).addContent(1) };
}

function fakeQueue() {
  const added: Array<{ data: AutoTranslatePayload; jobId: unknown }> = [];
  return { added, queue: { add: async (_: string, data: AutoTranslatePayload, opts: { jobId?: string }) => void added.push({ data, jobId: opts.jobId }) } };
}

const sweptAt = async (shopId: string) =>
  (await withTenant(shopId, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId } }), app)).autoSweptAt;

function depsFor(stores: Record<string, FakeShopifyStore>): Pick<JobDependencies, "prisma" | "adminFor" | "billingFor"> {
  return { prisma: app, adminFor: async (domain) => stores[domain]!.asAdmin() };
}

describe("periodic check for automatic translation", () => {
  it("starts when automatic translation is turned on: earlier changes aren't picked up", async () => {
    const { shop, store } = await shopWithStore("sweep-start.myshopify.com");
    const enabledAt = (await sweptAt(shop.id))!;
    expect(Date.now() - enabledAt.getTime()).toBeLessThan(minutes(1));
    store.touch("gid://shopify/Page/1", new Date(enabledAt.getTime() - minutes(60)));

    const { added, queue } = fakeQueue();
    const now = new Date(enabledAt.getTime() + minutes(30));
    expect(await sweepChangedContent(depsFor({ "sweep-start.myshopify.com": store }), queue, now)).toEqual({ shops: 1, queued: 0, failed: 0, catchingUp: 0 });
    expect(added).toEqual([]);
    // A run that got everything reads its last two minutes again next time (clock differences to Shopify).
    expect(await sweptAt(shop.id)).toEqual(new Date(now.getTime() - minutes(2)));
  });

  it("queues pages, blog posts, blogs, products and collections changed since, with the webhook's job id", async () => {
    const { shop, store } = await shopWithStore("sweep-types.myshopify.com");
    const start = (await sweptAt(shop.id))!;
    const later = new Date(start.getTime() + minutes(5));
    for (const gid of ["gid://shopify/Page/1", "gid://shopify/Article/1", "gid://shopify/Blog/1", "gid://shopify/Product/2", "gid://shopify/Collection/1"]) {
      store.touch(gid, later);
    }
    const { added, queue } = fakeQueue();
    const now = new Date(start.getTime() + minutes(30));
    await sweepChangedContent(depsFor({ "sweep-types.myshopify.com": store }), queue, now);
    expect(added.map((a) => [a.data.resourceType, a.data.resourceGid])).toEqual([
      ["PRODUCT", "gid://shopify/Product/2"],
      ["COLLECTION", "gid://shopify/Collection/1"],
      ["PAGE", "gid://shopify/Page/1"],
      ["ARTICLE", "gid://shopify/Article/1"],
      ["BLOG", "gid://shopify/Blog/1"],
    ]);
    expect(added.every((a) => a.data.shopId === shop.id)).toBe(true);

    // A webhook for the same product uses the same queue job id: one check, not two.
    const viaWebhook = fakeQueue();
    await queueAutoTranslate(
      { shopDomain: "sweep-types.myshopify.com", topic: "products/update", payload: { admin_graphql_api_id: "gid://shopify/Product/2" } },
      { queue: viaWebhook.queue, prisma: app },
    );
    expect(viaWebhook.added[0]!.jobId).toBe(added[0]!.jobId);

    // The next run finds nothing new.
    const again = fakeQueue();
    await sweepChangedContent(depsFor({ "sweep-types.myshopify.com": store }), again.queue, new Date(now.getTime() + minutes(30)));
    expect(again.added).toEqual([]);
  });

  it("reads changed pages, blog posts and blogs again for the coverage report (they have no webhooks)", async () => {
    const { shop, store } = await shopWithStore("sweep-coverage.myshopify.com");
    const start = (await sweptAt(shop.id))!;
    for (const gid of ["gid://shopify/Page/1", "gid://shopify/Article/1", "gid://shopify/Blog/1", "gid://shopify/Product/2", "gid://shopify/Collection/1"]) {
      store.touch(gid, new Date(start.getTime() + minutes(5)));
    }
    const refreshes: Array<{ data: { shopId: string; resourceGid: string }; jobId: unknown }> = [];
    const coverageQueue = { add: async (_: string, data: { shopId: string; resourceGid: string }, opts: { jobId?: string }) => void refreshes.push({ data, jobId: opts.jobId }) };
    const { queue } = fakeQueue();
    await sweepChangedContent({ ...depsFor({ "sweep-coverage.myshopify.com": store }), coverageQueue: coverageQueue as unknown as CoverageRefreshQueue }, queue, new Date(start.getTime() + minutes(30)));
    // Products and collections are read again after their own webhooks.
    expect(refreshes.map((r) => r.data)).toEqual(["Page", "Article", "Blog"].map((type) => ({ shopId: shop.id, resourceGid: `gid://shopify/${type}/1` })));
    // One pending refresh per resource, apart from a product or collection with the same number.
    expect(refreshes.map((r) => r.jobId)).toEqual(["pg", "ar", "bl"].map((type) => `covref_${shop.id}_1_${type}`));
  });

  it.each([false, true])("skips a type the store hasn't granted access to (library throws: %s), and keeps its position after a failure", async (throwsLikeLibrary) => {
    const { shop, store } = await shopWithStore("sweep-errors.myshopify.com");
    store.throwsLikeLibrary = throwsLikeLibrary;
    const start = (await sweptAt(shop.id))!;
    store.touch("gid://shopify/Page/1", new Date(start.getTime() + minutes(5)));
    store.touch("gid://shopify/Article/1", new Date(start.getTime() + minutes(5)));
    store.deniedTypes.add("PAGE");
    const deps = depsFor({ "sweep-errors.myshopify.com": store });

    const first = fakeQueue();
    await sweepChangedContent(deps, first.queue, new Date(start.getTime() + minutes(30)));
    expect(first.added.map((a) => a.data.resourceGid)).toEqual(["gid://shopify/Article/1"]);
    const position = await sweptAt(shop.id);

    // Shopify fails: nothing is lost, the same period is checked next time.
    store.touch("gid://shopify/Blog/1", new Date(start.getTime() + minutes(40)));
    store.failNext = { count: 1, error: () => new Error("Shopify unavailable") };
    const failed = fakeQueue();
    expect(await sweepChangedContent(deps, failed.queue, new Date(start.getTime() + minutes(60)))).toMatchObject({ failed: 1 });
    expect(await sweptAt(shop.id)).toEqual(position);
    const retry = fakeQueue();
    await sweepChangedContent(deps, retry.queue, new Date(start.getTime() + minutes(90)));
    expect(retry.added.map((a) => a.data.resourceGid)).toEqual(["gid://shopify/Blog/1"]);
  });

  it("asks Shopify nothing for stores with it off, without AI consent, or on a plan without bulk translation", async () => {
    const off = await shopWithStore("sweep-off.myshopify.com", { enable: false });
    const noConsent = await shopWithStore("sweep-consent.myshopify.com");
    await setAiConsent({ shopId: noConsent.shop.id, granted: false, actorId: null }, app);
    const free = await shopWithStore("sweep-free.myshopify.com");
    const stores = { "sweep-off.myshopify.com": off.store, "sweep-consent.myshopify.com": noConsent.store, "sweep-free.myshopify.com": free.store };
    const deps = {
      ...depsFor(stores),
      billingFor: async () => ({ configured: true, state: "ACTIVE" as const, entitlements: PLANS.free, subscription: null, stale: false, mustChoosePlan: false }),
    };
    const { added, queue } = fakeQueue();
    expect(await sweepChangedContent(deps, queue)).toEqual({ shops: 0, queued: 0, failed: 0, catchingUp: 0 });
    expect(added).toEqual([]);
    expect([...off.store.calls, ...noConsent.store.calls, ...free.store.calls]).toEqual([]);
  });

  it("reads each store with its own session and queues its changes under its own id", async () => {
    const a = await shopWithStore("sweep-a.myshopify.com");
    const b = await shopWithStore("sweep-b.myshopify.com");
    const at = new Date((await sweptAt(b.shop.id))!.getTime() + minutes(5));
    a.store.touch("gid://shopify/Page/1", at);
    b.store.touch("gid://shopify/Article/1", at);
    const asked: string[] = [];
    const deps = {
      prisma: app,
      adminFor: async (domain: string) => (asked.push(domain), (domain === "sweep-a.myshopify.com" ? a.store : b.store).asAdmin()),
    };
    const { added, queue } = fakeQueue();
    await sweepChangedContent(deps, queue, new Date(at.getTime() + minutes(30)));
    expect(asked.sort()).toEqual(["sweep-a.myshopify.com", "sweep-b.myshopify.com"]);
    expect(added.map((x) => [x.data.shopId, x.data.resourceGid]).sort()).toEqual(
      [
        [a.shop.id, "gid://shopify/Page/1"],
        [b.shop.id, "gid://shopify/Article/1"],
      ].sort(),
    );
  });

  it("reads a set number of changes per type, oldest first, and says up to when it got them all", async () => {
    const store = new FakeShopifyStore(5);
    const since = new Date("2026-10-01T00:00:00Z");
    const at = (i: number) => new Date(since.getTime() + minutes(i));
    for (let i = 1; i <= 5; i++) store.touch(`gid://shopify/Product/${i}`, at(i));
    const first = await changedSince(store.asAdmin(), "PRODUCT", since, 3);
    expect(first.changes.map((c) => c.id)).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/3"]);
    expect(first).toMatchObject({ capped: true, through: at(3) });
    const rest = await changedSince(store.asAdmin(), "PRODUCT", first.through!, 3);
    expect(rest).toMatchObject({ changes: [{ id: "gid://shopify/Product/4" }, { id: "gid://shopify/Product/5" }], capped: false });
  });

  it("never splits a second between two runs", async () => {
    const store = new FakeShopifyStore(5);
    const since = new Date("2026-10-01T00:00:00Z");
    const same = new Date(since.getTime() + minutes(1));
    // A bulk edit: four products in the same second.
    for (let i = 1; i <= 4; i++) store.touch(`gid://shopify/Product/${i}`, same);
    store.touch("gid://shopify/Product/5", new Date(since.getTime() + minutes(2)));
    const first = await changedSince(store.asAdmin(), "PRODUCT", since, 2);
    expect(first.changes).toHaveLength(4);
    expect(first).toMatchObject({ capped: true, through: same });
    expect((await changedSince(store.asAdmin(), "PRODUCT", first.through!, 2)).changes.map((c) => c.id)).toEqual(["gid://shopify/Product/5"]);
  });

  it("finds changed blogs by the updated_at filter (blogs can't be sorted by update time)", async () => {
    const store = new FakeShopifyStore(0).addContent(3);
    const since = new Date("2026-10-01T00:00:00Z");
    store.touch("gid://shopify/Blog/1", new Date(since.getTime() + minutes(5)));
    store.touch("gid://shopify/Blog/3", new Date(since.getTime() + minutes(1)));
    const found = await changedSince(store.asAdmin(), "BLOG", since, 10);
    expect(found).toMatchObject({ capped: false, through: null });
    expect(found.changes.map((c) => c.id)).toEqual(["gid://shopify/Blog/1", "gid://shopify/Blog/3"]);
  });

  it("drops no change beyond its limit: the next runs go on from the last one queued", async () => {
    const { shop } = await shopWithStore("sweep-catchup.myshopify.com");
    const store = new FakeShopifyStore(7);
    const start = (await sweptAt(shop.id))!;
    for (let i = 1; i <= 7; i++) store.touch(`gid://shopify/Product/${i}`, new Date(start.getTime() + minutes(i)));
    const deps = depsFor({ "sweep-catchup.myshopify.com": store });
    const queued: string[] = [];
    for (let run = 1; run <= 3; run++) {
      const { added, queue } = fakeQueue();
      const summary = await sweepChangedContent(deps, queue, new Date(start.getTime() + minutes(30 * run)), 3);
      queued.push(...added.filter((a) => a.data.resourceType === "PRODUCT").map((a) => a.data.resourceGid));
      expect(summary.catchingUp).toBe(run < 3 ? 1 : 0);
    }
    expect(queued).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => `gid://shopify/Product/${i}`));
  });

  it("waits while automatic translation is paused, and then translates what changed meanwhile", async () => {
    const { shop, store } = await shopWithStore("sweep-paused.myshopify.com");
    const start = (await sweptAt(shop.id))!;
    const deps = depsFor({ "sweep-paused.myshopify.com": store });
    await withTenant(
      shop.id,
      (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoPausedUntil: new Date(start.getTime() + minutes(60)), autoPauseReason: "DAILY_LIMIT" } }),
      app,
    );
    store.touch("gid://shopify/Page/1", new Date(start.getTime() + minutes(10)));
    const during = fakeQueue();
    await sweepChangedContent(deps, during.queue, new Date(start.getTime() + minutes(30)));
    expect(during.added).toEqual([]);
    expect(store.calls).toEqual([]);
    expect(await sweptAt(shop.id)).toEqual(start);
    const after = fakeQueue();
    await sweepChangedContent(deps, after.queue, new Date(start.getTime() + minutes(90)));
    expect(after.added.map((a) => a.data.resourceGid)).toEqual(["gid://shopify/Page/1"]);
  });
});

describe("checks of pages, blog posts and blogs", () => {
  it("create drafts in an automatic job for that type", async () => {
    const { shop, store } = await shopWithStore("sweep-page.myshopify.com");
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: prefix };
    const result = await createAutoItems(app, { shopId: shop.id, resourceGid: "gid://shopify/Page/1", resourceType: "PAGE" });
    for (const itemId of result.itemIds) await processItem(deps, { shopId: shop.id, itemId }, 1);
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.find((d) => d.resourceGid === "gid://shopify/Page/1" && d.key === "title")).toMatchObject({ value: "[de] About us 1" });
    const job = await withTenant(shop.id, (tx) => tx.translationJob.findFirstOrThrow({ where: { shopId: shop.id } }), app);
    expect(job).toMatchObject({ resourceType: "PAGE", publishMode: "DRAFT" });
    // Nothing is published without review.
    expect(store.translationOf("gid://shopify/Page/1", "de", "title")).toBeUndefined();
  });

  it("are accepted by the worker; a payload whose id doesn't match its type is refused", async () => {
    const { shop, store } = await shopWithStore("sweep-worker.myshopify.com");
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: prefix };
    queues = createQueues(redis, prefix);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    await queues.auto.add("auto-translate", { shopId: shop.id, resourceGid: "gid://shopify/Article/1", resourceType: "ARTICLE" }, { jobId: "auto_sweep_ok" });
    await waitFor(async () => (await searchPendingDrafts(shop.id, {}, app)).drafts.some((d) => d.resourceGid === "gid://shopify/Article/1"));

    const bad = await queues.auto.add(
      "auto-translate",
      { shopId: shop.id, resourceGid: "gid://shopify/Product/1", resourceType: "BLOG" },
      { jobId: "auto_sweep_bad", attempts: 1 },
    );
    await waitFor(async () => (await bad.getState()) === "failed");
    expect((await queues.auto.getJob("auto_sweep_bad"))?.failedReason).toBe("INVALID_PAYLOAD");
  });
});
