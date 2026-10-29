/**
 * Automatic translation of new and changed products and collections
 * (webhooks): off by default, one delayed check per resource, the same
 * rules as bulk jobs (drafts, protected translations, consent, plan), never
 * joining a job with other settings, and nothing across stores.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  AUTO_REQUESTED_BY,
  AUTO_TRANSLATE_DELAY_MS,
  createAutoItems,
  queueAutoTranslate,
  type AutoTranslatePayload,
} from "../../app/.server/jobs/auto-translate";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { createItemProcessor, createQueues, createWorkers, type Queues, type WorkerSet } from "../../app/.server/jobs/queues";
import type { CurrentLocales } from "../../app/.server/locales/current-locales";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { searchPendingDrafts } from "../../app/.server/review/drafts";
import { getShopSettings, setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { reserveUsage } from "../../app/.server/usage/usage-ledger";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { PLANS } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const P1 = "gid://shopify/Product/1";
const C1 = "gid://shopify/Collection/1";

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

async function setup(domain = "auto.myshopify.com", options: { enable?: boolean } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (options.enable ?? true) {
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de", "fr"], actorId: "7" }, app);
  }
  const store = new FakeShopifyStore(2).addCollections(1);
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    monthlyLimit: 1_000_000,
    keyPrefix: prefix,
  };
  return { shop, store, deps };
}

function fakeQueue() {
  const added: Array<{ name: string; data: AutoTranslatePayload; opts: Record<string, unknown> }> = [];
  return {
    added,
    queue: { add: async (name: string, data: AutoTranslatePayload, opts: Record<string, unknown>) => void added.push({ name, data, opts }) },
  };
}

const webhook = (topic: string, gid: string, shopDomain = "auto.myshopify.com") => ({
  shopDomain,
  topic,
  payload: { admin_graphql_api_id: gid, updated_at: "2026-10-27T10:00:00Z" },
});

/** Runs one automatic check the way the worker does, without Redis. */
async function check(deps: JobDependencies, payload: AutoTranslatePayload) {
  const result = await createAutoItems(app, payload, deps.billingFor);
  const outcomes = [];
  for (const itemId of [...result.itemIds, ...result.reused]) outcomes.push(await processItem(deps, { shopId: payload.shopId, itemId }, 1));
  return { ...result, outcomes };
}

const jobs = (shopId: string) =>
  withTenant(shopId, (tx) => tx.translationJob.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } }), app);

const cancel = (shopId: string, jobId: string) =>
  withTenant(shopId, (tx) => tx.translationJob.update({ where: { id: jobId }, data: { status: "CANCELLED" } }), app);

describe("automatic translation settings", () => {
  it("is off by default and keeps only the shop's additional languages", async () => {
    const { shop } = await setup("settings.myshopify.com", { enable: false });
    const settings = await withTenant(shop.id, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    expect(settings).toMatchObject({ autoTranslateNew: false, autoTranslateLocales: [] });

    expect(
      await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de", "xx", "de"], allowedLocales: ["de", "fr"], actorId: "7" }, app),
    ).toEqual({ enabled: true, locales: ["de"] });
    // Turning it on without a language turns it off.
    expect(await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["xx"], allowedLocales: ["de"], actorId: "7" }, app)).toEqual({
      enabled: false,
      locales: [],
    });
    const audit = await ownerDb.auditLog.findMany({ where: { shopId: shop.id, action: { startsWith: "auto_translate." } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorId, a.metadata])).toEqual([
      ["auto_translate.enabled", "7", { locales: ["de"] }],
      ["auto_translate.disabled", "7", { locales: [] }],
    ]);
  });

  it("is refused by the database for too many or malformed languages", async () => {
    const { shop } = await setup("check.myshopify.com", { enable: false });
    await expect(
      withTenant(shop.id, (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoTranslateLocales: ["de; drop"] } }), app),
    ).rejects.toThrow();
    await expect(
      withTenant(
        shop.id,
        (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoTranslateLocales: Array.from({ length: 21 }, (_, i) => `l${String(i).padStart(2, "0")}`) } }),
        app,
      ),
    ).rejects.toThrow();
  });
});

describe("automatic translation webhooks", () => {
  it("queue nothing while automatic translation is off", async () => {
    await setup("auto.myshopify.com", { enable: false });
    const q = fakeQueue();
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1), { queue: q.queue, prisma: app })).toBe("off");
    expect(q.added).toEqual([]);
  });

  it("queue one delayed check per resource, with a job id BullMQ accepts", async () => {
    const { shop } = await setup();
    const q = fakeQueue();
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1), { queue: q.queue, prisma: app })).toBe("queued");
    expect(await queueAutoTranslate(webhook("products/create", P1), { queue: q.queue, prisma: app })).toBe("queued");
    expect(await queueAutoTranslate(webhook("COLLECTIONS_UPDATE", C1), { queue: q.queue, prisma: app })).toBe("queued");
    // The webhook's update time comes along: a check that already read a later state skips it.
    const changedAt = "2026-10-27T10:00:00.000Z";
    expect(q.added.map((a) => a.data)).toEqual([
      { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT", changedAt },
      { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT", changedAt },
      { shopId: shop.id, resourceGid: C1, resourceType: "COLLECTION", changedAt },
    ]);
    // Saves in a row share one queue job id (BullMQ ignores the repeats until it ran).
    expect(q.added[0]!.opts.jobId).toBe(q.added[1]!.opts.jobId);
    expect(q.added[0]!.opts.jobId).not.toBe(q.added[2]!.opts.jobId);
    expect(String(q.added[0]!.opts.jobId)).not.toContain(":");
    // A failed check is removed too: a kept one would make BullMQ drop every later check with its id.
    expect(q.added[0]!.opts).toMatchObject({ delay: AUTO_TRANSLATE_DELAY_MS, removeOnComplete: true, removeOnFail: true });
  });

  it("ignore other topics, ids that don't match the topic, and unknown or uninstalled shops", async () => {
    const { shop } = await setup();
    const q = fakeQueue();
    const deps = { queue: q.queue, prisma: app };
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", C1), deps)).toBe("ignored");
    expect(await queueAutoTranslate(webhook("PRODUCTS_DELETE", P1), deps)).toBe("ignored");
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", "gid://shopify/Product/1 OR 1=1"), deps)).toBe("ignored");
    expect(await queueAutoTranslate({ ...webhook("PRODUCTS_UPDATE", P1), payload: null }, deps)).toBe("ignored");
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1, "unknown.myshopify.com"), deps)).toBe("ignored");
    await ownerDb.shop.update({ where: { id: shop.id }, data: { status: "UNINSTALLED" } });
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1), deps)).toBe("ignored");
    expect(q.added).toEqual([]);
  });
});

describe("automatic translation checks", () => {
  it("create drafts for review in a daily automatic job, and check the same item again after the next change", async () => {
    const { shop, store, deps } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    const first = await check(deps, payload);
    expect(first.outcomes).toEqual([{ status: "SUCCEEDED", errorCode: "DRAFTED" }]);
    let { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.filter((d) => d.resourceGid === P1).map((d) => [d.key, d.value]).sort()).toEqual([
      ["body_html", "<p>[de] Warm <b>jacket</b> number 1.</p>"],
      ["title", "[de] Product 1 jacket"],
    ]);
    // Nothing is published while the shop reviews first.
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();

    store.updateSource(P1, "title", "Product 1 jacket, now waterproof");
    const second = await check(deps, payload);
    expect(second.reused).toHaveLength(1);
    ({ drafts } = await searchPendingDrafts(shop.id, {}, app));
    expect(drafts.find((d) => d.resourceGid === P1 && d.key === "title")?.value).toBe("[de] Product 1 jacket, now waterproof");

    // A collection of the same day gets its own job (type), the product changes share one.
    await check(deps, { shopId: shop.id, resourceGid: C1, resourceType: "COLLECTION" });
    const list = await jobs(shop.id);
    expect(list.map((j) => [j.resourceType, j.requestedBy, j.status, j.totalItems, j.succeededItems + j.skippedItems + j.failedItems])).toEqual([
      ["PRODUCT", AUTO_REQUESTED_BY, "COMPLETED", 1, 1],
      ["COLLECTION", AUTO_REQUESTED_BY, "COMPLETED", 1, 1],
    ]);
    expect(list[0]!.publishMode).toBe("DRAFT");
  });

  it("finds nothing to do when only Linguva's own translation changed the product", async () => {
    const { shop, store, deps } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    for (const field of store.products.get(P1)!) store.translate(P1, "de", field.key, `DE ${field.value}`);
    const result = await check(deps, payload);
    expect(result.outcomes).toEqual([{ status: "SKIPPED", errorCode: "UP_TO_DATE" }]);
    expect(await withTenant(shop.id, (tx) => tx.translationJob.findFirstOrThrow({ where: { shopId: shop.id } }), app)).toMatchObject({ charsBilled: 0 });
  });

  it("keep a translation a person wrote, even when its original changed", async () => {
    const { shop, store, deps } = await setup();
    const digest = createHash("sha256").update("Product 1 jacket").digest("hex");
    await saveResourceTranslations(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "1", resourceId: P1, locale: "de", edits: [{ key: "title", value: "Meine Jacke", digest, origin: "MANUAL", approved: true }] },
      app,
    );
    store.updateSource(P1, "title", "Product 1 jacket, new name");
    await check(deps, { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" });
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    expect(drafts.some((d) => d.resourceGid === P1 && d.key === "title")).toBe(false);
    expect(store.translationOf(P1, "de", "title")).toBe("Meine Jacke");
  });

  it("do nothing without AI consent, when turned off since the webhook, or on a plan without bulk translation", async () => {
    const { shop, deps } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    await setAiConsent({ shopId: shop.id, granted: false, actorId: null }, app);
    expect(await createAutoItems(app, payload)).toEqual({ itemIds: [], reused: [], busy: false });
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
    const free = async () => ({ configured: true, entitlements: PLANS.free });
    expect(PLANS.free.bulk).toBe(false);
    expect(await createAutoItems(app, payload, free)).toEqual({ itemIds: [], reused: [], busy: false });
    await setAutoTranslate({ shopId: shop.id, enabled: false, locales: [], allowedLocales: ["de"], actorId: "7" }, app);
    expect(await createAutoItems(app, payload, deps.billingFor)).toEqual({ itemIds: [], reused: [], busy: false });
    expect(await jobs(shop.id)).toEqual([]);
  });

  it("never join a running job that only translates search listings or replaces protected translations", async () => {
    const { shop } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    const { job: seo } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "seo", fieldScope: "SEO" }, app);
    expect(await createAutoItems(app, payload)).toEqual({ itemIds: [], reused: [], busy: true });
    await cancel(shop.id, seo.id);

    const { job: overwrite } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "ow", overwriteProtected: true }, app);
    expect((await createAutoItems(app, payload)).busy).toBe(true);
    await cancel(shop.id, overwrite.id);

    // A plain bulk job for the same type and language takes the item.
    const { job: plain } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "plain" }, app);
    const joined = await createAutoItems(app, payload);
    const item = await withTenant(shop.id, (tx) => tx.translationJobItem.findFirstOrThrow({ where: { id: joined.itemIds[0] } }), app);
    expect(item.jobId).toBe(plain.id);
  });

  it("turn into the requested bulk job when the merchant starts one meanwhile", async () => {
    const { shop } = await setup();
    await createAutoItems(app, { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" });
    const [auto] = await jobs(shop.id);
    const { job, created } = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "user-1", includeAttached: true },
      app,
    );
    // Created: the caller starts discovery for all products; the waiting item stays.
    expect(created).toBe(true);
    expect(job).toMatchObject({ id: auto!.id, requestedBy: "1", discoveryDone: false, includeAttached: true, overwriteProtected: false, totalItems: 1 });
  });

  it("stay within their store", async () => {
    const a = await setup("auto-a.myshopify.com");
    const b = await setup("auto-b.myshopify.com", { enable: false });
    // Store B has automatic translation off: its webhooks queue nothing, whatever store A does.
    const q = fakeQueue();
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1, "auto-b.myshopify.com"), { queue: q.queue, prisma: app })).toBe("off");
    await check(a.deps, { shopId: a.shop.id, resourceGid: P1, resourceType: "PRODUCT" });
    expect(await jobs(b.shop.id)).toEqual([]);
    // Row-level security: B's tenant sees none of A's automatic jobs or items.
    const seen = await withTenant(b.shop.id, async (tx) => [await tx.translationJob.count(), await tx.translationJobItem.count()], app);
    expect(seen).toEqual([0, 0]);
  });
});

describe("automatic translation follows the shop and its plan", () => {
  const P = { resourceGid: P1, resourceType: "PRODUCT" as const };
  const languages = (targets: string[], primary = "en"): (() => Promise<CurrentLocales>) => async () => ({ primary, targets, fresh: true });
  const plan = (maxTargetLocales: number) => async () => ({ configured: true, entitlements: { ...PLANS.business, maxTargetLocales } });
  const itemLocales = async (shopId: string, ids: string[]) =>
    (await withTenant(shopId, (tx) => tx.translationJobItem.findMany({ where: { id: { in: ids } }, include: { job: true } }), app)).map((i) => i.job.targetLocale).sort();

  it("translates only the languages the plan includes, in Shopify's order", async () => {
    const { shop } = await setup();
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de", "fr", "it"], allowedLocales: ["de", "fr", "it"], actorId: "7" }, app);
    const result = await createAutoItems(app, { shopId: shop.id, ...P }, plan(1), languages(["de", "fr", "it"]));
    expect(await itemLocales(shop.id, result.itemIds)).toEqual(["de"]);
  });

  it("skips a language deleted in Shopify or now the primary one", async () => {
    const { shop } = await setup();
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de", "fr"], allowedLocales: ["de", "fr"], actorId: "7" }, app);
    // German became the primary language: only French is still a target.
    const result = await createAutoItems(app, { shopId: shop.id, ...P }, plan(20), languages(["fr"], "de"));
    expect(await itemLocales(shop.id, result.itemIds)).toEqual(["fr"]);
  });

  it("never translates into the resource's own language", async () => {
    const { shop, deps } = await setup();
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "en", requestedBy: "1", idempotencyKey: "same" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    expect(await processItem(deps, { shopId: shop.id, itemId: page.itemIds[0]! }, 1)).toEqual({ status: "SKIPPED", errorCode: "SAME_LANGUAGE" });
  });

  it("stops what is already queued when it is turned off, or for a language no longer chosen", async () => {
    const { shop, deps } = await setup();
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de", "fr"], allowedLocales: ["de", "fr"], actorId: "7" }, app);
    const queued = await createAutoItems(app, { shopId: shop.id, ...P });
    expect(queued.itemIds).toHaveLength(2);
    // French dropped: its job stops, German's stays.
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de", "fr"], actorId: "7" }, app);
    const byLocale = Object.fromEntries((await jobs(shop.id)).map((j) => [j.targetLocale, j]));
    expect(byLocale.fr).toMatchObject({ status: "CANCELLED", errorCode: "AUTO_OFF" });
    expect(byLocale.de!.status).toBe("RUNNING");
    // Off: nothing queued is translated any more.
    await setAutoTranslate({ shopId: shop.id, enabled: false, locales: [], allowedLocales: ["de"], actorId: "7" }, app);
    for (const itemId of queued.itemIds) expect(await processItem(deps, { shopId: shop.id, itemId }, 1)).toMatchObject({ status: "CANCELLED", errorCode: "AUTO_OFF" });
    expect(await searchPendingDrafts(shop.id, {}, app)).toMatchObject({ drafts: [] });
  });

  it("pauses at a limit instead of failing a job for every change, and continues when turned on again", async () => {
    const { shop, store, deps } = await setup();
    const first = await createAutoItems(app, { shopId: shop.id, ...P });
    // The month's allowance is all but used up (the item alone would fit): the queue's job-stop path.
    await reserveUsage({ shopId: shop.id, key: "earlier-work", chars: 990, limit: 1000, provider: "mock" }, app);
    const processor = createItemProcessor({ ...deps, monthlyLimit: 1000 });
    const job = { data: { shopId: shop.id, itemId: first.itemIds[0]! }, id: first.itemIds[0]!, attemptsMade: 0, opts: { attempts: 5 } };
    await expect(processor(job as never)).rejects.toThrow("QUOTA_EXCEEDED");
    const settings = await getShopSettings(shop.id, app);
    expect(settings.autoPauseReason).toBe("QUOTA_EXCEEDED");
    expect(settings.autoPausedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Further changes create no new failing job meanwhile.
    store.updateSource(P1, "title", "Changed while paused");
    const q = fakeQueue();
    expect(await queueAutoTranslate(webhook("PRODUCTS_UPDATE", P1), { queue: q.queue, prisma: app })).toBe("paused");
    expect(await createAutoItems(app, { shopId: shop.id, ...P })).toEqual({ itemIds: [], reused: [], busy: false });
    expect(await jobs(shop.id)).toHaveLength(1);
    // A new choice by the merchant lifts the pause.
    await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
    expect((await getShopSettings(shop.id, app)).autoPausedUntil).toBeNull();
  });

  it("doesn't check a change again that a later check already read", async () => {
    const { shop, deps } = await setup();
    const before = new Date(Date.now() - 60_000).toISOString();
    await check(deps, { shopId: shop.id, ...P, changedAt: before });
    // The sweep reports the same change after the webhook's check ran: nothing to do, the outcome stays.
    expect(await createAutoItems(app, { shopId: shop.id, ...P, changedAt: before })).toEqual({ itemIds: [], reused: [], busy: false });
    const [item] = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
    expect(item).toMatchObject({ status: "SUCCEEDED", errorCode: "DRAFTED" });
    // Shopify's times have whole seconds and clocks differ a little: a change just before the check started is checked again.
    const close = new Date(item!.startedAt!.getTime() - 1_000).toISOString();
    await check(deps, { shopId: shop.id, ...P, changedAt: close });
    const [again] = await withTenant(shop.id, (tx) => tx.translationJobItem.findMany(), app);
    expect(again!.startedAt!.getTime()).toBeGreaterThan(item!.startedAt!.getTime());
    // A later change is checked again.
    const later = new Date(Date.now() + 60_000).toISOString();
    expect((await createAutoItems(app, { shopId: shop.id, ...P, changedAt: later })).reused).toHaveLength(1);
  });

  it("isn't taken over by a narrower bulk job, which would drop its other fields", async () => {
    const { shop } = await setup();
    await createAutoItems(app, { shopId: shop.id, ...P });
    const [auto] = await jobs(shop.id);
    const seo = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "seo-only", fieldScope: "SEO" }, app);
    expect(seo).toMatchObject({ created: false, job: { id: auto!.id, fieldScope: "ALL", requestedBy: AUTO_REQUESTED_BY } });
  });
});

describe("automatic translation worker", () => {
  it("runs a queued check through the item queue and leaves a draft", async () => {
    const { shop, deps } = await setup();
    queues = createQueues(redis, prefix);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    await queues.auto.add("auto-translate", { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" }, { jobId: "auto_test_1" });
    await waitFor(async () => (await searchPendingDrafts(shop.id, {}, app)).drafts.some((d) => d.resourceGid === P1));
    await waitFor(async () => (await jobs(shop.id))[0]?.status === "COMPLETED");
  });

  it("refuses payloads that don't match the schema", async () => {
    const { shop, deps } = await setup();
    queues = createQueues(redis, prefix);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    const job = await queues.auto.add(
      "auto-translate",
      { shopId: shop.id, resourceGid: C1, resourceType: "PRODUCT" },
      { jobId: "auto_test_bad", attempts: 1 },
    );
    await waitFor(async () => (await job.getState()) === "failed");
    expect((await queues.auto.getJob("auto_test_bad"))?.failedReason).toBe("INVALID_PAYLOAD");
    expect(await jobs(shop.id)).toEqual([]);
  });
});
