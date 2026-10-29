/**
 * An automatic job (the smart schedule's real-time one) handing over to a
 * smart check or a merchant's bulk job: its waiting items move to the new
 * job, what it did earlier stays its own, every resource that needs work is
 * translated (also one the automatic job finished earlier that day), the
 * new job's figures are its own, and a resource is never in two items at
 * once while the automatic job finishes its running ones.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { createAutoItems } from "../../app/.server/jobs/auto-translate";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { forgetCurrentLocales } from "../../app/.server/locales/current-locales";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { pauseSmart, resumeSmart, saveSmartSettings, setSmartEnabled } from "../../app/.server/smart/config";
import { loadSmartPanel } from "../../app/.server/smart/panel";
import { smartTick, type SmartDeps } from "../../app/.server/smart/runs";
import type { SmartSettingsValue } from "../../app/.server/smart/validate";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { getOriginUsageSince } from "../../app/.server/usage/usage-ledger";
import { PLANS } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const NOON = new Date("2026-10-29T12:00:00Z");
const DUE = new Date("2026-10-29T22:01:00Z");
const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(async () => {
  await resetDatabase();
  forgetCurrentLocales();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const realtime = (over: Partial<SmartSettingsValue> = {}): SmartSettingsValue => ({
  mode: "realtime",
  timeZone: "Europe/Berlin",
  times: [23 * 60],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  locales: ["de"],
  resourceTypes: ["PRODUCT"],
  fieldGroups: [],
  includeAttached: false,
  publishMode: "DRAFT",
  replaceOutdatedMachine: true,
  dailyBudget: null,
  monthlyBudget: null,
  ...over,
});

async function setup(products = 3) {
  const { shop } = await upsertInstalledShop({ shopDomain: "takeover.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(products);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "de", name: "German", primary: false, published: true },
  ];
  const pages: CoveragePagePayload[] = [];
  const billingFor = async () => ({ configured: true, entitlements: PLANS.business });
  const deps: SmartDeps = { prisma: app, adminFor: async () => store.asAdmin(), billingFor, aiAvailable: true, enqueueCoveragePage: async (payload) => void pages.push(payload) };
  const coverage: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:takeover", pageSize: 2 };
  const jobs: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: "lv:test:takeover", billingFor };
  expect(await saveSmartSettings({ shopId: shop.id, actorId: "7", value: realtime(), version: 0, primaryLocale: "en", now: NOON }, app)).not.toBeNull();
  expect((await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: true, now: NOON }, app)).ok).toBe(true);
  return { shop, deps, pages, coverage, jobs };
}

/** Reads the whole measurement; returns the items it queued. */
async function measure(coverage: CoverageDeps, first: CoveragePagePayload) {
  const queued: string[] = [];
  let next: CoveragePagePayload | null = first;
  for (let n = 0; next; n++) {
    if (n > 3000) throw new Error("runaway");
    next = await runCoveragePage(coverage, next, { enqueueSmartItems: async (_shopId, ids) => void queued.push(...ids) });
  }
  return queued;
}

const job = (shopId: string, id: string) => withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id } }), app);
const item = (shopId: string, id: string) => withTenant(shopId, (tx) => tx.translationJobItem.findUniqueOrThrow({ where: { id } }), app);
const drafts = (shopId: string, gid: string) => withTenant(shopId, (tx) => tx.translationDraft.count({ where: { shopId, resourceGid: gid, status: "PENDING" } }), app);

/** The day's real-time job for PRODUCT/de: product 1's item was cancelled during a pause, product 2's waits. */
async function realtimeDay(shopId: string, deps: SmartDeps, jobs: JobDependencies) {
  const first = await createAutoItems(app, { shopId, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor);
  await pauseSmart({ shopId, actorId: "7", now: NOON }, app);
  expect(await processItem(jobs, { shopId, itemId: first.itemIds[0]! }, 1)).toEqual({ status: "CANCELLED", errorCode: "PAUSED" });
  await resumeSmart({ shopId, actorId: "7", now: NOON }, app);
  const second = await createAutoItems(app, { shopId, resourceGid: P(2), resourceType: "PRODUCT" }, deps.billingFor);
  const p1 = await item(shopId, first.itemIds[0]!);
  const p2 = await item(shopId, second.itemIds[0]!);
  expect(p2.jobId).toBe(p1.jobId);
  return { realtimeJobId: p1.jobId, p2Item: p2.id };
}

describe("a smart check taking over the day's real-time job", () => {
  it("gets a job of its own with the waiting items, and translates what the real-time job had finished", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(3);
    const { realtimeJobId, p2Item } = await realtimeDay(shop.id, deps, jobs);
    await smartTick(deps, DUE);
    const queued = await measure(coverage, pages[0]!);
    const run = await withTenant(shop.id, (tx) => tx.smartAutoRun.findFirstOrThrow({ where: { shopId: shop.id } }), app);
    // The waiting item moved to the run's new job; the real-time job keeps its history and is done.
    const moved = await item(shop.id, p2Item);
    expect(moved.jobId).not.toBe(realtimeJobId);
    expect(await job(shop.id, moved.jobId)).toMatchObject({ smartRunId: run.id });
    expect(await job(shop.id, realtimeJobId)).toMatchObject({ status: "COMPLETED", smartRunId: null, totalItems: 1, skippedItems: 1 });
    for (const id of new Set([...queued, p2Item])) await processItem(jobs, { shopId: shop.id, itemId: id }, 1);
    // Product 1's earlier real-time item was cancelled: the check translates it.
    for (const n of [1, 2, 3]) expect(await drafts(shop.id, P(n))).toBeGreaterThan(0);
  });

  it("counts only what it translated itself", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(3);
    // Earlier today, in real time: product 1 translated and billed; then product 2 changes and waits.
    const first = await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor);
    expect(await processItem(jobs, { shopId: shop.id, itemId: first.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const second = await createAutoItems(app, { shopId: shop.id, resourceGid: P(2), resourceType: "PRODUCT" }, deps.billingFor);
    const before = await getOriginUsageSince(shop.id, "smart", EPOCH, app);
    await smartTick(deps, DUE);
    const queued = await measure(coverage, pages[0]!);
    for (const id of new Set([...queued, ...second.itemIds])) await processItem(jobs, { shopId: shop.id, itemId: id }, 1);
    const after = await getOriginUsageSince(shop.id, "smart", EPOCH, app);
    const panel = await loadSmartPanel(shop.id, { entitled: true, consent: true, available: true, allowed: ["de"], shopTimeZone: "Europe/Berlin" }, app);
    expect(after - before).toBeGreaterThan(0);
    expect(panel.runs[0]!.billed).toBe(after - before);
  });

  it("never adds a second item for a resource the real-time job is still translating", async () => {
    const { shop, deps, pages, coverage } = await setup(3);
    const first = await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor);
    // Product 1 is being translated right now (claimed by a worker).
    await withTenant(shop.id, (tx) => tx.translationJobItem.update({ where: { id: first.itemIds[0]! }, data: { status: "RUNNING" } }), app);
    const realtimeJobId = (await item(shop.id, first.itemIds[0]!)).jobId;
    await smartTick(deps, DUE);
    await measure(coverage, pages[0]!);
    const run = await withTenant(shop.id, (tx) => tx.smartAutoRun.findFirstOrThrow({ where: { shopId: shop.id } }), app);
    const runJob = await withTenant(shop.id, (tx) => tx.translationJob.findFirstOrThrow({ where: { shopId: shop.id, smartRunId: run.id } }), app);
    // The real-time job finishes its running item first; the check left product 1 to it.
    expect(await job(shop.id, realtimeJobId)).toMatchObject({ status: "RUNNING" });
    expect(await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor)).toMatchObject({ itemIds: [], busy: true });
    // A change of a product the check already holds waits in its item; another one joins the check's job.
    expect(await createAutoItems(app, { shopId: shop.id, resourceGid: P(2), resourceType: "PRODUCT" }, deps.billingFor)).toMatchObject({ itemIds: [], busy: false });
    const other = await createAutoItems(app, { shopId: shop.id, resourceGid: P(4), resourceType: "PRODUCT" }, deps.billingFor);
    expect(other.itemIds).toHaveLength(1);
    expect((await item(shop.id, other.itemIds[0]!)).jobId).toBe(runJob.id);
  });
});

describe("a merchant's bulk job taking over the real-time job", () => {
  it("is a new job that translates every product that needs it, the waiting one included", async () => {
    const { shop, deps, jobs } = await setup(3);
    const { realtimeJobId, p2Item } = await realtimeDay(shop.id, deps, jobs);
    const taken = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "bulk-0001" }, app);
    expect(taken.created).toBe(true);
    expect(taken.job.id).not.toBe(realtimeJobId);
    expect((await item(shop.id, p2Item)).jobId).toBe(taken.job.id);
    expect(await job(shop.id, realtimeJobId)).toMatchObject({ status: "COMPLETED" });
    const page = await runDiscoveryPage(jobs, { shopId: shop.id, jobId: taken.job.id });
    for (const id of new Set([...page.itemIds, p2Item])) await processItem(jobs, { shopId: shop.id, itemId: id }, 1);
    for (const n of [1, 2, 3]) expect(await drafts(shop.id, P(n))).toBeGreaterThan(0);
    expect(await job(shop.id, taken.job.id)).toMatchObject({ succeededItems: 3, skippedItems: 0 });
  });

});
