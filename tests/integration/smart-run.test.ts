/**
 * A Smart Auto-Translate run from start to finish against PostgreSQL: the
 * tick starts the measurement, every page plans translation in its own
 * transaction (only missing and outdated machine fields of the chosen
 * scope; people's translations, drafts waiting for review and exclusions
 * are left alone), the items are translated as drafts, and the run finishes
 * as completed, failed or stopped at a budget, also after a failed or
 * interrupted measurement. Plus the estimate before turning it on, and the
 * per-state characters it comes from.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { createCoverageReport, failCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { noteCoverageWrite, rebuildCountsTx } from "../../app/.server/coverage/items";
import { createAutoItems } from "../../app/.server/jobs/auto-translate";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { createItemProcessor, requeueStalledDiscovery, type Queues } from "../../app/.server/jobs/queues";
import { forgetCurrentLocales } from "../../app/.server/locales/current-locales";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { saveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { addSmartExclusion, getSmartConfig, pauseSmart, resumeSmart, saveSmartSettings, setSmartEnabled, smartPauseAfterStop } from "../../app/.server/smart/config";
import { loadSmartPanel } from "../../app/.server/smart/panel";
import { repairSmartRuns } from "../../app/.server/smart/plan";
import { smartTick, type SmartDeps } from "../../app/.server/smart/runs";
import type { SmartSettingsValue } from "../../app/.server/smart/validate";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { getOriginUsageSince } from "../../app/.server/usage/usage-ledger";
import { PLANS } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P = (n: number) => `gid://shopify/Product/${n}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let keys = 0;

beforeEach(async () => {
  await resetDatabase();
  forgetCurrentLocales();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const value = (over: Partial<SmartSettingsValue> = {}): SmartSettingsValue => ({
  mode: "daily",
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

/** 12:00 UTC: the first check is due at 23:00 in Berlin (22:00 UTC). */
const NOON = new Date("2026-10-29T12:00:00Z");
const DUE = new Date("2026-10-29T22:01:00Z");

async function setup(products = 4) {
  const { shop } = await upsertInstalledShop({ shopDomain: "smart-run.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(products);
  store.locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "de", name: "German", primary: false, published: true },
    { locale: "fr", name: "French", primary: false, published: true },
  ];
  const pages: CoveragePagePayload[] = [];
  const deps: SmartDeps = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    billingFor: async () => ({ configured: true, entitlements: PLANS.business }),
    aiAvailable: true,
    enqueueCoveragePage: async (payload) => void pages.push(payload),
  };
  const coverage: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:smartrun", pageSize: 2 };
  const jobs: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: new MockTranslationProvider(),
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test:smartrun",
    billingFor: async () => ({ configured: true, entitlements: PLANS.business }),
  };
  return { shop, store, deps, pages, coverage, jobs };
}

async function turnOn(shopId: string, settings = value()) {
  expect(await saveSmartSettings({ shopId, actorId: "7", value: settings, version: 0, primaryLocale: "en", now: NOON }, app)).not.toBeNull();
  expect((await setSmartEnabled({ shopId, actorId: "7", enabled: true, now: NOON }, app)).ok).toBe(true);
}

/** Reads every page of the run's measurement, as the coverage queue would; returns the item ids queued. */
async function measure(coverage: CoverageDeps, first: CoveragePagePayload, until?: (page: CoveragePagePayload) => boolean) {
  const queued: string[] = [];
  let next: CoveragePagePayload | null = first;
  let n = 0;
  while (next && !until?.(next)) {
    next = await runCoveragePage(coverage, next, { enqueueSmartItems: async (_shopId, ids) => void queued.push(...ids) });
    if (++n > 3000) throw new Error("runaway");
  }
  return { queued, next };
}

/** Stops a measurement once it has read this segment ("PRODUCT|de"). */
async function untilAfter(shopId: string, segment: string) {
  const report = await withTenant(shopId, (tx) => tx.coverageReport.findFirstOrThrow({ where: { shopId }, orderBy: { createdAt: "desc" } }), app);
  const index = report.segments.indexOf(segment);
  expect(index).toBeGreaterThanOrEqual(0);
  return (page: CoveragePagePayload) => page.segmentIndex > index;
}

const runRows = (shopId: string) => withTenant(shopId, (tx) => tx.smartAutoRun.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } }), app);
const smartJobs = (shopId: string) =>
  withTenant(shopId, (tx) => tx.translationJob.findMany({ where: { shopId, requestedBy: SMART_REQUESTED_BY }, include: { items: true }, orderBy: { targetLocale: "asc" } }), app);

/** The store as the run finds it: one field current, one machine translation outdated, one person's translation outdated, one person's draft waiting. */
async function storeWithHistory(shopId: string, store: FakeShopifyStore) {
  // Product 1: its title is translated and current; its description is missing.
  store.translate(P(1), "de", "title", "Produkt 1 Jacke");
  // Product 2: Linguva's own machine translation of the description, outdated since.
  store.translate(P(2), "de", "body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>");
  await withTenant(
    shopId,
    (tx) =>
      tx.translationRevision.create({
        data: { shopId, resourceGid: P(2), locale: "de", key: "body_html", value: "<p>Warme <b>Jacke</b> Nummer 2.</p>", sourceDigest: sha("<p>Warm <b>jacket</b> number 2.</p>"), origin: "AI", provider: "mock" },
      }),
    app,
  );
  store.updateSource(P(2), "body_html", "<p>Warm <b>jacket</b> number 2, now waterproof.</p>");
  // Product 3: excluded by the merchant.
  await addSmartExclusion({ shopId, resourceGid: P(3), actorId: "7" }, app);
  // Product 4: a person's title (outdated since), and a person's draft of the description.
  await saveResourceTranslations(
    { admin: store.asAdmin(), shopId, actorId: "1", resourceId: P(4), locale: "de", edits: [{ key: "title", value: "Unsere Jacke 4", digest: sha("Product 4 jacket"), origin: "MANUAL", approved: true }] },
    app,
  );
  store.updateSource(P(4), "title", "Product 4 jacket, new name");
  const body = store.products.get(P(4))!.find((f) => f.key === "body_html")!.value;
  await saveDrafts(
    shopId,
    [{ jobId: null, resourceGid: P(4), resourceTitle: "Product 4", locale: "de", key: "body_html", sourceDigest: sha(body), sourceValue: body, value: "<p>Unsere Jacke.</p>", segmentPairs: [], issues: [], provider: "csv" }],
    app,
  );
}

describe("a scheduled run", () => {
  it("plans while it measures: only what is missing or outdated machine output, in the chosen scope", async () => {
    const { shop, store, deps, pages, coverage, jobs } = await setup();
    await storeWithHistory(shop.id, store);
    await turnOn(shop.id);

    expect(await smartTick(deps, DUE)).toMatchObject({ started: 1 });
    expect(pages).toHaveLength(1);
    const { queued } = await measure(coverage, pages[0]!);

    const [run] = await runRows(shop.id);
    expect(run).toMatchObject({ trigger: "SCHEDULED", status: "RUNNING", locales: ["de"], publishMode: "DRAFT" });
    expect(run!.scanFinishedAt).not.toBeNull();
    // German products only: 4 checked, the excluded one left alone, 2 need work (3 fields).
    expect(run).toMatchObject({ resourcesChecked: 4, excludedSkipped: 1, resourcesChanged: 2, fieldsDetected: 3, itemsQueued: 2 });
    const [job, ...others] = await smartJobs(shop.id);
    expect(others).toEqual([]);
    expect(job).toMatchObject({ resourceType: "PRODUCT", targetLocale: "de", smartRunId: run!.id, discoveryDone: true, totalItems: 2, status: "RUNNING" });
    expect(job!.items.map((i) => i.resourceGid).sort()).toEqual([P(1), P(2)]);
    expect(queued.sort()).toEqual(job!.items.map((i) => i.id).sort());

    for (const itemId of queued) expect(await processItem(jobs, { shopId: shop.id, itemId }, 1)).toMatchObject({ status: "SUCCEEDED", errorCode: "DRAFTED" });
    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    const machine = drafts.filter((d) => d.provider === "mock").map((d) => `${d.resourceGid}|${d.key}`).sort();
    // Product 1's current title, product 4's person's title and draft, and the excluded product stay as they are.
    expect(machine).toEqual([`${P(1)}|body_html`, `${P(2)}|body_html`, `${P(2)}|title`]);
    expect(store.translationOf(P(4), "de", "title")).toBe("Unsere Jacke 4");
    // Drafts only: nothing went live.
    expect(store.translationOf(P(1), "de", "body_html")).toBeUndefined();

    const [done] = await runRows(shop.id);
    expect(done).toMatchObject({ status: "COMPLETED", errorCode: null });
    expect((await getSmartConfig(shop.id, app))!.lastSuccessAt).not.toBeNull();
    expect((await smartJobs(shop.id))[0]).toMatchObject({ status: "COMPLETED" });
  });

  it("plans a repeated page only once", async () => {
    const { shop, deps, pages, coverage } = await setup();
    await turnOn(shop.id);
    await smartTick(deps, DUE);
    const first = pages[0]!;
    await measure(coverage, first);
    const before = await smartJobs(shop.id);
    expect(before[0]!.totalItems).toBe(4);
    // The queue delivers the first page again (a retry after a lost acknowledgement).
    expect(await runCoveragePage(coverage, first, { enqueueSmartItems: async () => expect.unreachable() })).toBeNull();
    const after = await smartJobs(shop.id);
    expect(after[0]!.totalItems).toBe(4);
    expect(after[0]!.items).toHaveLength(4);
    expect((await runRows(shop.id))[0]).toMatchObject({ resourcesChecked: 4, itemsQueued: 4 });
  });

  it("ends as failed when its measurement fails; what it planned is still translated and the next check isn't held up", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(4);
    await turnOn(shop.id);
    await smartTick(deps, DUE);
    // German products are read (two pages), then the shop's access fails.
    const { queued, next } = await measure(coverage, pages[0]!, await untilAfter(shop.id, "PRODUCT|de"));
    expect(queued).toHaveLength(4);
    await failCoverageReport(shop.id, next!.reportId, "SHOP_AUTH", app);
    expect((await runRows(shop.id))[0]).toMatchObject({ status: "RUNNING" });
    for (const itemId of queued) await processItem(jobs, { shopId: shop.id, itemId }, 1);
    const [run] = await runRows(shop.id);
    expect(run).toMatchObject({ status: "FAILED", errorCode: "SHOP_AUTH" });
    expect((await getSmartConfig(shop.id, app))!.lastSuccessAt).toBeNull();
    // The next day's check starts a new run.
    expect(await smartTick(deps, new Date(DUE.getTime() + 86_400_000))).toMatchObject({ started: 1 });
    expect((await runRows(shop.id)).map((r) => r.status)).toEqual(["FAILED", "RUNNING"]);
  });

  it("is finished by the repair when its measurement ended without finishing it", async () => {
    const { shop, deps } = await setup(2);
    await turnOn(shop.id);
    await smartTick(deps, DUE);
    const [run] = await runRows(shop.id);
    // Still measuring: left alone.
    expect(await repairSmartRuns(shop.id, app)).toBe(0);
    // The measurement was replaced as stalled (a new one took over).
    await withTenant(shop.id, (tx) => tx.coverageReport.update({ where: { id: run!.coverageReportId! }, data: { status: "FAILED", errorCode: "STALLED" } }), app);
    expect(await repairSmartRuns(shop.id, app)).toBe(1);
    expect((await runRows(shop.id))[0]).toMatchObject({ status: "FAILED", errorCode: "STALLED" });
    expect((await runRows(shop.id))[0]!.scanFinishedAt).not.toBeNull();
  });

  it("stops at the daily budget: the run says so, and the schedule pauses until midnight in its time zone", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(2);
    await turnOn(shop.id, value({ locales: ["de", "fr"] }));
    await smartTick(deps, DUE);
    await measure(coverage, pages[0]!);
    const [de, fr] = await smartJobs(shop.id);
    // One German product is translated; then today's budget leaves less than the next one needs.
    expect(await processItem(jobs, { shopId: shop.id, itemId: de!.items[0]!.id }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const used = await getOriginUsageSince(shop.id, "smart", new Date(Date.now() - 86_400_000), app);
    const config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: value({ locales: ["de", "fr"], dailyBudget: used + 5 }), version: config.version, primaryLocale: "en" }, app);

    const processor = createItemProcessor(jobs);
    const item = fr!.items[0]!;
    await expect(processor({ data: { shopId: shop.id, itemId: item.id }, id: item.id, attemptsMade: 0, opts: { attempts: 5 } } as never)).rejects.toThrow("SMART_BUDGET_DAILY");
    const paused = (await getSmartConfig(shop.id, app))!;
    expect(paused.pauseReason).toBe("BUDGET_DAILY");
    // Midnight in Berlin after now (at most a day ahead).
    expect(paused.pausedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(paused.pausedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    // The other jobs stop at their next item instead of calling the provider.
    expect(await processItem(jobs, { shopId: shop.id, itemId: de!.items[1]!.id }, 1)).toEqual({ status: "CANCELLED", errorCode: "PAUSED" });
    expect(await processItem(jobs, { shopId: shop.id, itemId: fr!.items[1]!.id }, 1)).toMatchObject({ status: "CANCELLED" });

    expect((await runRows(shop.id))[0]).toMatchObject({ status: "COMPLETED", errorCode: "SMART_BUDGET_DAILY" });
    // Not a "complete" check: something it found is still waiting.
    expect((await getSmartConfig(shop.id, app))!.lastSuccessAt).toBeNull();
  });

  it("says so when part of it was read while paused, and isn't then the last complete check", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(4);
    await turnOn(shop.id);
    await smartTick(deps, DUE);
    // The first page of products in German, then a pause while the second is read.
    const report = await withTenant(shop.id, (tx) => tx.coverageReport.findFirstOrThrow({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" } }), app);
    const index = report.segments.indexOf("PRODUCT|de");
    const first = await measure(coverage, pages[0]!, (page) => page.segmentIndex === index && page.cursor !== null);
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    await measure(coverage, first.next!);
    await resumeSmart({ shopId: shop.id, actorId: "7" }, app);
    for (const itemId of first.queued) await processItem(jobs, { shopId: shop.id, itemId }, 1);
    expect(first.queued).toHaveLength(2);
    expect((await runRows(shop.id))[0]).toMatchObject({ status: "COMPLETED", errorCode: "PARTIAL" });
    expect((await getSmartConfig(shop.id, app))!.lastSuccessAt).toBeNull();
  });

  it("leaves a chosen type without access out, says so on its page, and is still complete", async () => {
    const { shop, store, deps, pages, coverage, jobs } = await setup(2);
    store.deniedTypes.add("MENU");
    await turnOn(shop.id, value({ resourceTypes: ["PRODUCT", "MENU"] }));
    await smartTick(deps, DUE);
    const { queued } = await measure(coverage, pages[0]!);
    for (const itemId of queued) await processItem(jobs, { shopId: shop.id, itemId }, 1);
    expect((await runRows(shop.id))[0]).toMatchObject({ status: "COMPLETED", errorCode: null });
    expect((await getSmartConfig(shop.id, app))!.lastSuccessAt).not.toBeNull();
    const panel = await loadSmartPanel(shop.id, { entitled: true, consent: true, available: true, allowed: ["de"], shopTimeZone: "Europe/Berlin" }, app);
    expect(panel.noAccess).toEqual(["MENU"]);
  });

  it("is skipped, not started, when it waited for a measurement and the schedule was paused meanwhile", async () => {
    const { shop, deps } = await setup(2);
    await turnOn(shop.id);
    await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: "1", idempotencyKey: `m-${++keys}` }, app);
    await smartTick(deps, DUE);
    expect((await runRows(shop.id)).map((r) => r.status)).toEqual(["WAITING"]);
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    await smartTick(deps, new Date(DUE.getTime() + 2 * 60_000));
    expect((await runRows(shop.id)).map((r) => [r.status, r.errorCode])).toEqual([["SKIPPED", "PAUSED"]]);
  });

  it("keeps the merchant's own pause when a job stops at a limit", async () => {
    const { shop } = await setup(1);
    await turnOn(shop.id);
    await pauseSmart({ shopId: shop.id, actorId: "7" }, app);
    expect(await smartPauseAfterStop(shop.id, "SMART_BUDGET_DAILY", new Date(), app)).toBeNull();
    expect(await getSmartConfig(shop.id, app)).toMatchObject({ pauseReason: "MANUAL", pausedUntil: null });
  });

  it("is left to its measurement by the stalled-discovery repair", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(2);
    await turnOn(shop.id);
    await smartTick(deps, DUE);
    // Part of the measurement: the job is still open for more items.
    await measure(coverage, pages[0]!, await untilAfter(shop.id, "PRODUCT|de"));
    const old = new Date(Date.now() - 60 * 60_000);
    await withTenant(shop.id, (tx) => tx.translationJob.updateMany({ where: { shopId: shop.id }, data: { updatedAt: old } }), app);
    // A merchant's bulk job whose discovery stalled is continued, for comparison.
    await withTenant(
      shop.id,
      (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "fr", requestedBy: "1", idempotencyKey: `bulk-${++keys}`, status: "DISCOVERING", updatedAt: old } }),
      app,
    );
    const added: string[] = [];
    const queues = { discovery: { getJob: async () => undefined, add: async (_name: string, data: { jobId: string }) => void added.push(data.jobId) }, discoveryJobOptions: {} } as unknown as Queues;
    expect(await requeueStalledDiscovery(jobs, queues)).toBe(1);
    const [smart] = await smartJobs(shop.id);
    expect(added).not.toContain(smart!.id);
  });
});

describe("beside other jobs: one active job per type and language", () => {
  const activeJobs = (shopId: string, resourceType = "PRODUCT") =>
    withTenant(
      shopId,
      (tx) => tx.translationJob.findMany({ where: { shopId, resourceType, targetLocale: "de", status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } }, include: { items: true } }),
      app,
    );

  it("leaves a type and language to the merchant's bulk job, so nothing is translated twice", async () => {
    const { shop, deps, pages, coverage, jobs } = await setup(3);
    await turnOn(shop.id);
    // "Translate all products into German", its discovery behind the check.
    const { job: bulk } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: `bulk-${++keys}` }, app);
    await smartTick(deps, DUE);
    const { queued } = await measure(coverage, pages[0]!);
    await runDiscoveryPage(jobs, { shopId: shop.id, jobId: bulk.id });

    expect(queued).toEqual([]);
    const active = await activeJobs(shop.id);
    expect(active.map((j) => [j.id, j.items.length])).toEqual([[bulk.id, 3]]);
    // The check says what it translated itself: nothing here, and it is done.
    expect((await runRows(shop.id))[0]).toMatchObject({ status: "COMPLETED", resourcesChecked: 3, resourcesChanged: 0, itemsQueued: 0 });
  });

  it("takes over from the real-time job of the same type and language: its waiting items move to the check's job", async () => {
    const { shop, deps, pages, coverage } = await setup(3);
    await turnOn(shop.id, value({ mode: "realtime" }));
    const change = await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor);
    expect(change.itemIds).toHaveLength(1);
    const [realtime] = await activeJobs(shop.id);
    await smartTick(deps, DUE);
    await measure(coverage, pages[0]!);

    const [job, ...more] = await activeJobs(shop.id);
    expect(more).toHaveLength(0);
    const [run] = await runRows(shop.id);
    expect(job).toMatchObject({ smartRunId: run!.id, requestedBy: SMART_REQUESTED_BY, discoveryDone: true });
    expect(job!.id).not.toBe(realtime!.id);
    // Product 1 once (the real-time item, still waiting, moved over), the other two added by the check.
    expect(job!.items.map((i) => i.resourceGid).sort()).toEqual([P(1), P(2), P(3)]);
    expect(run).toMatchObject({ resourcesChanged: 2, itemsQueued: 2 });
    // The real-time job kept nothing to do and is done.
    const before = await withTenant(shop.id, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: realtime!.id } }), app);
    expect(before).toMatchObject({ status: "COMPLETED", smartRunId: null, totalItems: 0 });
  });

  it("leaves the images to a merchant's job that includes them", async () => {
    const { shop, store, deps, pages, coverage } = await setup(2);
    store.addImage(P(1), "Blue jacket");
    await turnOn(shop.id, value({ includeAttached: true }));
    await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: `bulk-${++keys}`, includeAttached: true }, app);
    await smartTick(deps, DUE);
    await measure(coverage, pages[0]!);
    expect(await activeJobs(shop.id, "MEDIA_IMAGE")).toEqual([]);
  });

  it("plans a resource again that a stopped job left waiting", async () => {
    const { shop, deps, pages, coverage } = await setup(2);
    await turnOn(shop.id);
    // A cancelled bulk job whose item for product 2 never ran (its queue job was lost).
    const { job: bulk } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: `bulk-${++keys}` }, app);
    await withTenant(
      shop.id,
      async (tx) => {
        await tx.translationJobItem.create({ data: { shopId: shop.id, jobId: bulk.id, resourceGid: P(2), status: "PENDING" } });
        await tx.translationJob.update({ where: { id: bulk.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
      },
      app,
    );
    await smartTick(deps, DUE);
    await measure(coverage, pages[0]!);
    const [job] = await activeJobs(shop.id);
    expect(job!.items.map((i) => i.resourceGid).sort()).toEqual([P(1), P(2)]);
  });

  it("a real-time change waits for the merchant's bulk job instead of joining it, and a bulk request takes over a real-time job", async () => {
    const { shop, deps } = await setup(2);
    await turnOn(shop.id, value({ mode: "realtime", fieldGroups: ["title"], dailyBudget: 5 }));
    const { job: bulk } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: `bulk-${++keys}` }, app);
    // Joining would translate it outside the smart budget, fields and publishing.
    expect(await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor)).toEqual({ itemIds: [], reused: [], busy: true });
    expect((await activeJobs(shop.id)).map((j) => [j.id, j.items.length])).toEqual([[bulk.id, 0]]);

    await withTenant(shop.id, (tx) => tx.translationJob.update({ where: { id: bulk.id }, data: { status: "COMPLETED" } }), app);
    await createAutoItems(app, { shopId: shop.id, resourceGid: P(1), resourceType: "PRODUCT" }, deps.billingFor);
    const [realtime] = await activeJobs(shop.id);
    expect(realtime).toMatchObject({ requestedBy: SMART_REQUESTED_BY, fieldGroups: ["title"] });
    const taken = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: `bulk-${++keys}` }, app);
    // A job of its own, with the bulk rules; the real-time item moved over and runs once.
    expect(taken).toMatchObject({ created: true, job: { requestedBy: "1", fieldGroups: [], publishMode: "DRAFT", discoveryDone: false } });
    expect(taken.job.id).not.toBe(realtime!.id);
    expect((await activeJobs(shop.id)).map((j) => [j.id, j.items.map((i) => i.resourceGid)])).toEqual([[taken.job.id, [P(1)]]]);
  });
});

describe("the estimate before turning it on", () => {
  /** Characters of the originals, by product and field. */
  const chars = (store: FakeShopifyStore, n: number, key: string) => store.products.get(P(n))!.find((f) => f.key === key)!.value.length;

  async function measured(products = 3) {
    const ctx = await setup(products);
    const { report } = await createCoverageReport({ shopId: ctx.shop.id, locales: ["de", "fr"], requestedBy: "1", idempotencyKey: `m-${++keys}` }, app);
    return { ...ctx, report };
  }
  const panel = (shopId: string) => loadSmartPanel(shopId, { entitled: true, consent: true, available: true, allowed: ["de", "fr"], shopTimeZone: "Europe/Berlin" }, app);

  it("adds up what is missing, failed or outdated in the chosen languages, types and field groups (never handles)", async () => {
    const { shop, store, report, coverage } = await measured(3);
    expect((await panel(shop.id)).estimate).toBeNull();
    store.translate(P(1), "de", "title", "Produkt 1 Jacke");
    store.translate(P(2), "de", "body_html", "<p>Alt</p>");
    store.updateSource(P(2), "body_html", "<p>Warm <b>jacket</b> number 2, now waterproof.</p>");
    await measure(coverage, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });

    const all = (locale: "de" | "fr") =>
      [1, 2, 3].reduce((n, i) => n + chars(store, i, "title") + chars(store, i, "body_html"), 0) - (locale === "de" ? chars(store, 1, "title") : 0);
    // Not set up yet: the plan's languages and the default content types.
    expect((await panel(shop.id)).estimate).toBe(all("de") + all("fr"));

    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: value({ fieldGroups: ["title"] }), version: 0, primaryLocale: "en" }, app);
    expect((await panel(shop.id)).estimate).toBe(chars(store, 2, "title") + chars(store, 3, "title"));

    const config = (await getSmartConfig(shop.id, app))!;
    await saveSmartSettings({ shopId: shop.id, actorId: "7", value: value({ replaceOutdatedMachine: false }), version: config.version, primaryLocale: "en" }, app);
    // Outdated translations stay as they are: product 2's description isn't counted.
    expect((await panel(shop.id)).estimate).toBe(all("de") - chars(store, 2, "body_html"));
  });

  it("comes from counts that follow every change, the same as a rebuild from the items", async () => {
    const { shop, store, report, coverage } = await measured(3);
    await measure(coverage, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    // A translation written for product 3's title moves its characters from missing to complete.
    const resource = { resourceId: P(3), content: store.products.get(P(3))!.map((f) => ({ ...f, digest: sha(f.value), locale: "en" })), translations: [] };
    await noteCoverageWrite({ shopId: shop.id, locale: "de", resource, written: [{ key: "title", value: "Produkt 3 Jacke" }] }, app);
    const counts = () =>
      withTenant(shop.id, (tx) => tx.coverageCount.findMany({ where: { shopId: shop.id, locale: "de", resourceType: "PRODUCT" }, orderBy: [{ fieldGroup: "asc" }, { state: "asc" }] }), app);
    const live = await counts();
    expect(live.find((c) => c.fieldGroup === "title" && c.state === "complete")).toMatchObject({ count: 1, chars: BigInt(chars(store, 3, "title")) });
    expect(live.find((c) => c.fieldGroup === "title" && c.state === "missing")).toMatchObject({ count: 2, chars: BigInt(chars(store, 1, "title") + chars(store, 2, "title")) });
    await withTenant(shop.id, (tx) => rebuildCountsTx(tx, shop.id, "de", "PRODUCT"), app);
    expect(await counts()).toEqual(live);
  });

  it("asks for a new measurement when the newest one is older than its character counts", async () => {
    const { shop, report, coverage } = await measured(3);
    await measure(coverage, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    const fresh = await panel(shop.id);
    expect(fresh).toMatchObject({ remeasure: false });
    expect(fresh.estimate).toBeGreaterThan(0);
    // What rows measured before the counts existed hold (the migration's defaults): "up to 0" would be wrong.
    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRaw`UPDATE "CoverageItem" SET "sourceChars" = '{}' WHERE "shopId" = ${shop.id}::uuid`,
      ownerDb.$executeRaw`UPDATE "CoverageCount" SET "chars" = 0 WHERE "shopId" = ${shop.id}::uuid`,
    ]);
    expect(await panel(shop.id)).toMatchObject({ estimate: null, remeasure: true });
    const { report: again } = await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: "1", idempotencyKey: `m-${++keys}` }, app);
    await measure(coverage, { shopId: shop.id, reportId: again.id, segmentIndex: 0, cursor: null });
    expect(await panel(shop.id)).toMatchObject({ estimate: fresh.estimate, remeasure: false });
  });
});
