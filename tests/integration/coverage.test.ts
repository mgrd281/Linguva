import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COVERAGE_TYPES,
  createCoverageReport,
  refreshCoverageResource,
  runCoveragePage,
  STALE_REPORT_MS,
  type CoverageDeps,
  type CoveragePagePayload,
} from "../../app/.server/coverage/coverage";
import { loadCoverageSummary, listCoverageItems } from "../../app/.server/coverage/summary";
import { rebuildCountsTx, syncCoverage } from "../../app/.server/coverage/items";
import { Worker } from "bullmq";
import {
  coveragePageJobId,
  createQueues,
  createWorkers,
  enqueueCoveragePage,
  QUEUE_NAMES,
  REPORT_STALL_MS,
  requeueStalledReports,
  type Queues,
  type WorkerSet,
} from "../../app/.server/jobs/queues";
import type { JobDependencies } from "../../app/.server/jobs/processors";
import { finishItem } from "../../app/.server/jobs/bulk-jobs";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { removeTranslation } from "../../app/.server/translation/history";
import { approveDrafts, rejectDrafts, saveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { headlineByLocale, byType } from "../../app/lib/coverage-view";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
let n = 0;
const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(resetDatabase);
afterAll(async () => {
  await redis.quit();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(products = 6, collections = 3) {
  const { shop } = await upsertInstalledShop({ shopDomain: "coverage.myshopify.com" }, app);
  const store = new FakeShopifyStore(products).addCollections(collections);
  const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:cov", pageSize: 4 };
  return { shop, store, deps };
}

async function runAll(deps: CoverageDeps, shopId: string, locales = ["de", "fr"]) {
  const { report } = await createCoverageReport({ shopId, locales, requestedBy: "1", idempotencyKey: `cov-${++n}` }, app);
  let next: CoveragePagePayload | null = { shopId, reportId: report.id, segmentIndex: 0, cursor: null };
  let pages = 0;
  while (next) {
    next = await runCoveragePage(deps, next);
    if (++pages > 2000) throw new Error("runaway");
  }
  return report;
}

const reportRow = (shopId: string, id: string) => withTenant(shopId, (tx) => tx.coverageReport.findUniqueOrThrow({ where: { id } }), app);

/** Makes the shop's reports look untouched for `ms` (as after a lost queue job). */
async function ageReports(shopId: string, ms: number) {
  await ownerDb.$transaction([
    ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
    ownerDb.$executeRawUnsafe(`UPDATE "CoverageReport" SET "updatedAt" = now() - interval '${Math.ceil(ms / 1000)} seconds'`),
  ]);
}

async function typeCounts(shopId: string, locale: string, type: string) {
  const summary = await loadCoverageSummary(shopId, app);
  return byType(summary.counts, locale).get(type)?.counts;
}

/** The counts kept with every change must equal the counts rebuilt from the items. */
async function expectCountsConsistent(shopId: string) {
  const live = (await loadCoverageSummary(shopId, app)).counts;
  const pairs = await withTenant(shopId, (tx) => tx.coverageItem.findMany({ distinct: ["locale", "resourceType"], select: { locale: true, resourceType: true } }), app);
  await withTenant(shopId, async (tx) => {
    for (const p of pairs) await rebuildCountsTx(tx, shopId, p.locale, p.resourceType);
  }, app);
  const rebuilt = (await loadCoverageSummary(shopId, app)).counts;
  const key = (r: { locale: string; resourceType: string; fieldGroup: string; state: string; count: number }) => `${r.locale}|${r.resourceType}|${r.fieldGroup}|${r.state}|${r.count}`;
  expect(live.map(key).sort()).toEqual(rebuilt.map(key).sort());
}

describe("coverage scan", () => {
  it("counts complete, outdated and missing fields per language and type, leaving out empty originals", async () => {
    const { shop, store, deps } = await setup();
    store.translate(P1, "de", "title", "Jacke 1");
    store.translate(P1, "de", "body_html", "<p>Warme Jacke 1.</p>");
    store.translate(P2, "de", "title", "Jacke 2");
    store.updateSource(P2, "title", "Product 2 jacket (new)");
    store.updateSource("gid://shopify/Product/3", "body_html", "   ");
    store.translate("gid://shopify/Collection/1", "fr", "meta_title", "Collection hiver 1");

    const report = await runAll(deps, shop.id);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "COMPLETED", segmentIndex: COVERAGE_TYPES.length * 2 });

    // 6 products × (title, body_html, handle), minus product 3's empty description.
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toEqual({ complete: 2, review: 0, draft: 0, failed: 0, outdated: 1, missing: 14 });
    expect(await typeCounts(shop.id, "fr", "COLLECTION")).toMatchObject({ complete: 1, missing: 11 });

    const summary = await loadCoverageSummary(shop.id, app);
    // Headline without URLs (optional): 11 product fields + 9 collection fields, 2 complete → 10 %.
    expect(headlineByLocale(summary.counts).get("de")).toMatchObject({ total: 20, complete: 2, percent: 10 });
    // Every type was read in both languages and marked scanned (empty ones too).
    expect(summary.segments).toHaveLength(COVERAGE_TYPES.length * 2);
    expect(summary.segments.every((s) => s.status === "SCANNED")).toBe(true);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");

    const p2 = (await listCoverageItems(shop.id, { locale: "de", resourceType: "PRODUCT", state: "outdated" }, app)).items;
    expect(p2.map((i) => i.resourceGid)).toEqual([P2]);
    expect(p2[0]!.counts).toMatchObject({ outdated: 1, missing: 2 });
    await expectCountsConsistent(shop.id);
  });

  it("counts image alt text and custom fields with their owner", async () => {
    const { shop, store, deps } = await setup(2, 1);
    const img = store.addImage(P1, "Red wool jacket, front view");
    store.addImage("gid://shopify/Collection/1", "Winter collection banner");
    store.translate(img, "de", "alt", "Rote Wolljacke, Vorderansicht");
    const care = store.addMetafield(P1, { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Wash cold" });
    store.addMetafield(P2, { namespace: "custom", key: "sku_code", type: "single_line_text_field", value: "X-1", translatable: false });
    await runAll(deps, shop.id, ["de"]);

    expect(await typeCounts(shop.id, "de", "MEDIA_IMAGE")).toMatchObject({ complete: 1, missing: 0 });
    expect(await typeCounts(shop.id, "de", "COLLECTION_IMAGE")).toMatchObject({ missing: 1 });
    // Only translatable custom fields count.
    expect(await typeCounts(shop.id, "de", "PRODUCT_METAFIELD")).toMatchObject({ missing: 1, complete: 0 });
    const items = (await listCoverageItems(shop.id, { locale: "de", resourceType: "PRODUCT_METAFIELD" }, app)).items;
    expect(items).toEqual([expect.objectContaining({ resourceGid: care, parentGid: P1, fields: ["value:missing"] })]);
  });

  it("marks a type without its optional scope as not available instead of failing the scan", async () => {
    const { shop, store, deps } = await setup(1, 0);
    store.deniedTypes.add("MENU");
    store.addResource("LINK", "1", [{ key: "title", value: "Shop", type: "SINGLE_LINE_TEXT_FIELD" }]);
    const report = await runAll(deps, shop.id, ["de"]);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "COMPLETED" });
    const summary = await loadCoverageSummary(shop.id, app);
    expect(summary.segments.find((s) => s.resourceType === "MENU")).toMatchObject({ status: "DENIED", errorCode: "ACCESS_DENIED" });
    expect(await typeCounts(shop.id, "de", "LINK")).toMatchObject({ missing: 1 });
  });

  it("treats a missing optional scope as 'no access' also when Shopify's library throws it", async () => {
    const { shop, store, deps } = await setup(2, 0);
    // The real library throws GraphQL errors instead of returning them.
    store.throwsLikeLibrary = true;
    store.deniedTypes.add("MENU");
    const report = await runAll(deps, shop.id, ["de"]);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "COMPLETED" });
    const summary = await loadCoverageSummary(shop.id, app);
    expect(summary.segments.find((s) => s.resourceType === "MENU")).toMatchObject({ status: "DENIED" });
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ missing: 6 });
  });

  it("reads theme resources a few at a time (each carries thousands of texts) and still counts them all", async () => {
    const { shop, store } = await setup(1, 0);
    for (let i = 1; i <= 7; i++) {
      store.addResource("ONLINE_STORE_THEME_LOCALE_CONTENT", `${i}`, [{ key: `general.text_${i}`, value: `Theme text ${i}`, type: "STRING" }]);
    }
    const sizes: number[] = [];
    const admin = store.asAdmin();
    const deps: CoverageDeps = {
      prisma: app,
      keyPrefix: "lv:test:cov",
      adminFor: async () => ({
        graphql: (query: string, options?: { variables?: Record<string, unknown> }) => {
          if (options?.variables?.resourceType === "ONLINE_STORE_THEME_LOCALE_CONTENT") sizes.push(Number(options.variables.first));
          return admin.graphql(query, options as never);
        },
      }) as never,
    };
    await runAll(deps, shop.id, ["de"]);
    expect(sizes).toEqual([5, 5]);
    expect(await typeCounts(shop.id, "de", "ONLINE_STORE_THEME_LOCALE_CONTENT")).toMatchObject({ missing: 7 });
  });

  it("removes resources deleted in Shopify at the next scan", async () => {
    const { shop, store, deps } = await setup(3, 0);
    await runAll(deps, shop.id, ["de"]);
    store.products.delete("gid://shopify/Product/3");
    await runAll(deps, shop.id, ["de"]);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ missing: 6 });
    await expectCountsConsistent(shop.id);
  });

  it("finds duplicate SEO titles and SEO titles missing in the original", async () => {
    const { shop, store, deps } = await setup(2, 3);
    for (const i of [1, 2]) store.translate(`gid://shopify/Collection/${i}`, "de", "meta_title", "Winter Auswahl");
    store.translate("gid://shopify/Collection/3", "de", "meta_title", "Andere Auswahl");
    await runAll(deps, shop.id, ["de"]);
    const { seo } = await loadCoverageSummary(shop.id, app);
    expect(seo.duplicateTitles).toEqual({ de: 2 });
    // The fake's products have no SEO title of their own.
    expect(seo.missingSourceTitle).toEqual([{ locale: "de", resourceType: "PRODUCT", count: 2 }]);
  });

  it("counts a page once even when its queue job runs twice", async () => {
    const { shop, deps } = await setup(8, 0);
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "dup" }, app);
    const first: CoveragePagePayload = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    expect(await runCoveragePage(deps, first)).not.toBeNull();
    expect(await runCoveragePage(deps, first)).toBeNull();
    expect(await reportRow(shop.id, report.id)).toMatchObject({ pagesScanned: 1, resourcesScanned: 4 });
    expect(await withTenant(shop.id, (tx) => tx.coverageItem.count(), app)).toBe(4);
  });

  it("runs one report at a time, replaces a stalled one and keeps a short history", async () => {
    const { shop } = await setup(1, 0);
    const a = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "a" }, app);
    const b = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "b" }, app);
    expect(b).toMatchObject({ created: false, report: { id: a.report.id } });
    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRawUnsafe(`UPDATE "CoverageReport" SET "updatedAt" = now() - interval '${Math.ceil(STALE_REPORT_MS / 60000) + 1} minutes'`),
    ]);
    const c = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "c" }, app);
    expect(c.created).toBe(true);
    expect(await reportRow(shop.id, a.report.id)).toMatchObject({ status: "FAILED", errorCode: "STALLED" });
    for (let i = 0; i < 6; i++) {
      await withTenant(shop.id, (tx) => tx.coverageReport.updateMany({ data: { status: "COMPLETED" } }), app);
      await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: `h${i}` }, app);
    }
    expect(await withTenant(shop.id, (tx) => tx.coverageReport.count(), app)).toBe(5);
  });

  it("stops when the app is uninstalled", async () => {
    const { shop, deps } = await setup(8, 0);
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "u" }, app);
    await markShopUninstalled(shop.shopDomain, app);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "FAILED", errorCode: "SHOP_UNINSTALLED" });
    expect(await runCoveragePage(deps, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null })).toBeNull();
  });
});

describe("coverage stays current", () => {
  it("after saving a translation and after removing it", async () => {
    const { shop, store, deps } = await setup(2, 0);
    await runAll(deps, shop.id, ["de"]);
    const outcomes = await saveResourceTranslations(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "1", resourceId: P1, locale: "de", edits: [{ key: "title", value: "Jacke", digest: digest("Product 1 jacket"), origin: "MANUAL", approved: true }] },
      app,
    );
    expect(outcomes[0]).toMatchObject({ status: "saved" });
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 1, missing: 5 });

    expect(await removeTranslation({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", resourceGid: P1, locale: "de", key: "title" }, app)).toEqual({ status: "removed" });
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 0, missing: 6 });
    await expectCountsConsistent(shop.id);
  });

  it("through drafts: waiting drafts are not complete, rejected ones are missing again, approved ones complete", async () => {
    const { shop, store, deps } = await setup(1, 0);
    await runAll(deps, shop.id, ["de"]);
    const draft = (key: string, value: string, source: string, issues: unknown[] = []) => ({
      jobId: null, resourceGid: P1, resourceTitle: null, locale: "de", key, sourceDigest: digest(source), sourceValue: source, value, segmentPairs: [], issues, provider: "test",
    });
    await saveDrafts(shop.id, [draft("title", "Jacke", "Product 1 jacket"), draft("body_html", "<p>Warme <b>Jacke</b> Nummer 2.</p>", "<p>Warm <b>jacket</b> number 1.</p>", [{ code: "NUMBERS_CHANGED" }])], app);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 0, draft: 1, review: 1, missing: 1 });

    const { drafts } = await searchPendingDrafts(shop.id, {}, app);
    const body = drafts.find((d) => d.key === "body_html")!;
    const title = drafts.find((d) => d.key === "title")!;
    await rejectDrafts(shop.id, [body.id], "1", app);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ draft: 1, review: 0, missing: 2 });

    await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: [title.id] }, app);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 1, draft: 0, missing: 2 });
    await expectCountsConsistent(shop.id);
  });

  it("shows a failed attempt until a later attempt succeeds", async () => {
    const { shop, deps } = await setup(1, 0);
    await runAll(deps, shop.id, ["de"]);
    const job = await withTenant(shop.id, (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "f", status: "RUNNING", totalItems: 1 } }), app);
    const item = await withTenant(shop.id, (tx) => tx.translationJobItem.create({ data: { shopId: shop.id, jobId: job.id, resourceGid: P1 } }), app);
    await finishItem(shop.id, item.id, { status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" }, app);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ failed: 3, missing: 0 });
    const failed = (await listCoverageItems(shop.id, { locale: "de", state: "failed" }, app)).items;
    expect(failed).toEqual([expect.objectContaining({ resourceGid: P1, lastAttemptFailed: true, failureCode: "PROVIDER_UNAVAILABLE" })]);

    const retry = await withTenant(shop.id, (tx) => tx.translationJob.create({ data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", idempotencyKey: "g", status: "RUNNING", totalItems: 1 } }), app);
    const again = await withTenant(shop.id, (tx) => tx.translationJobItem.create({ data: { shopId: shop.id, jobId: retry.id, resourceGid: P1 } }), app);
    await finishItem(shop.id, again.id, { status: "SUCCEEDED" }, app);
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ failed: 0, missing: 3 });
  });

  it("never lets an older scan read replace a newer save", async () => {
    const { shop, store, deps } = await setup(1, 0);
    await runAll(deps, shop.id, ["de"]);
    const before = new Date(Date.now() - 1000);
    const staleRead = (await store.asAdmin().graphql(`query LinguvaTranslatableResource { x }`, { variables: { resourceId: P1, locale: "de" } }).then((r) => r.json())) as {
      data: { translatableResource: { resourceId: string; translatableContent: never[]; translations: never[] } };
    };
    await saveResourceTranslations(
      { admin: store.asAdmin(), shopId: shop.id, actorId: "1", resourceId: P1, locale: "de", edits: [{ key: "title", value: "Jacke", digest: digest("Product 1 jacket"), origin: "MANUAL", approved: true }] },
      app,
    );
    const node = staleRead.data.translatableResource;
    await syncCoverage(
      shop.id,
      "de",
      [{ resourceGid: P1, resourceType: "PRODUCT", observed: { data: { content: node.translatableContent, translations: node.translations }, at: before } }],
      { create: true, seen: true },
      app,
    );
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 1 });
  });

  it("reads a product again after its webhook: a changed original makes its translation outdated", async () => {
    const { shop, store, deps } = await setup(2, 0);
    store.translate(P1, "de", "title", "Jacke");
    await runAll(deps, shop.id, ["de"]);
    store.updateSource(P1, "title", "Product 1 jacket, new name");
    expect(await refreshCoverageResource(deps, { shopId: shop.id, resourceGid: P1 })).toEqual({ refreshed: 1 });
    expect(await typeCounts(shop.id, "de", "PRODUCT")).toMatchObject({ complete: 0, outdated: 1 });
    // Deleted in Shopify: removed from coverage.
    store.products.delete(P2);
    await refreshCoverageResource(deps, { shopId: shop.id, resourceGid: P2 });
    expect((await listCoverageItems(shop.id, { locale: "de", resourceType: "PRODUCT", state: "missing" }, app)).items.map((i) => i.resourceGid)).toEqual([P1]);
    await expectCountsConsistent(shop.id);
  });

  it("pages through the items behind a number and filters by field group", async () => {
    const { shop, store, deps } = await setup(7, 0);
    for (const i of [1, 2, 3]) store.translate(`gid://shopify/Product/${i}`, "de", "title", `Jacke ${i}`);
    await runAll(deps, shop.id, ["de"]);
    const first = await listCoverageItems(shop.id, { locale: "de", resourceType: "PRODUCT", fieldGroup: "title", state: "missing", limit: 3 }, app);
    expect(first.items).toHaveLength(3);
    const second = await listCoverageItems(shop.id, { locale: "de", resourceType: "PRODUCT", fieldGroup: "title", state: "missing", limit: 3, after: first.nextCursor }, app);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => i.resourceGid).sort();
    expect(all).toEqual([4, 5, 6, 7].map((i) => `gid://shopify/Product/${i}`));
    // Descriptions are missing everywhere.
    expect((await listCoverageItems(shop.id, { locale: "de", fieldGroup: "description", state: "missing", limit: 100 }, app)).items).toHaveLength(7);
  });
});

describe("coverage scan in the worker (BullMQ + Redis)", () => {
  let prefix: string;
  let queues: Queues;
  let workers: WorkerSet | undefined;

  beforeEach(() => {
    prefix = testPrefix();
    queues = createQueues(redis, prefix, { discoveryJobOptions: { attempts: 3, backoff: { type: "fixed", delay: 20 } } });
  });
  afterEach(async () => {
    await workers?.close();
    await queues.close();
    await deletePrefix(redis, prefix);
  });

  it("marks a type that keeps failing and still scans every other type", async () => {
    const { shop, store } = await setup(3, 2);
    store.brokenTypes.add("PAGE");
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: null, monthlyLimit: 0, keyPrefix: prefix };
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "broken" }, app);
    await enqueueCoveragePage(queues, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status !== "QUEUED" && (await reportRow(shop.id, report.id)).status !== "RUNNING", 30_000);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "COMPLETED" });
    const summary = await loadCoverageSummary(shop.id, app);
    expect(summary.segments.find((s) => s.resourceType === "PAGE")).toMatchObject({ status: "FAILED", errorCode: "SHOPIFY_QUERY_ERROR" });
    // Types after the broken one were still scanned.
    expect(summary.segments.find((s) => s.resourceType === "ARTICLE")).toMatchObject({ status: "SCANNED" });
    // 2 collections × title, description, URL, SEO title.
    expect(await typeCounts(shop.id, "de", "COLLECTION")).toMatchObject({ missing: 8 });
  }, 40_000);

  it("continues a report whose first page job never ran, once, and leaves a recent one alone", async () => {
    const { shop, store } = await setup(9, 2);
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: null, monthlyLimit: 0, keyPrefix: prefix };
    // Queued in the database, but the job never reached Redis (or Redis lost it).
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "lost" }, app);
    expect(await requeueStalledReports(deps, queues)).toBe(0);
    await ageReports(shop.id, REPORT_STALL_MS + 60_000);
    expect(await requeueStalledReports(deps, queues)).toBe(1);
    // The next sweep sees the job waiting and adds no second one.
    expect(await requeueStalledReports(deps, queues)).toBe(0);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status === "COMPLETED", 30_000);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ resourcesScanned: 11 });
  }, 40_000);

  it("repairs a chain cut between saving a page and queueing the next (a redeploy)", async () => {
    const { shop, store } = await setup(9, 0);
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: null, monthlyLimit: 0, keyPrefix: prefix };
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "cut" }, app);
    // The first page is saved; the process dies before the next page is queued.
    expect(await runCoveragePage(deps, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null })).not.toBeNull();
    await ageReports(shop.id, REPORT_STALL_MS + 60_000);
    expect(await requeueStalledReports(deps, queues)).toBe(1);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status === "COMPLETED", 30_000);
    // Every product once, the first page not counted twice.
    expect(await reportRow(shop.id, report.id)).toMatchObject({ resourcesScanned: 9 });
  }, 40_000);

  it("leaves a report alone while its page job waits, and re-queues under a new id one that ended without moving it", async () => {
    const { shop, store } = await setup(5, 0);
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: null, monthlyLimit: 0, keyPrefix: prefix };
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "live" }, app);
    const payload: CoveragePagePayload = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    await enqueueCoveragePage(queues, payload);
    await ageReports(shop.id, REPORT_STALL_MS + 60_000);
    // Waiting in a long queue is not lost.
    expect(await requeueStalledReports(deps, queues)).toBe(0);
    // A job that ended without doing the page (a stand-in processor here): the same id can't be queued again.
    const standIn = new Worker(QUEUE_NAMES.coverage, async () => "skipped", { connection: redis, prefix });
    await waitFor(async () => (await (await queues.coverage.getJob(coveragePageJobId(payload)))?.getState()) === "completed", 10_000);
    await standIn.close();
    expect(await requeueStalledReports(deps, queues)).toBe(1);
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status === "COMPLETED", 30_000);
  }, 40_000);

  it("scans every page and completes, retrying a transient Shopify failure", async () => {
    const { shop, store } = await setup(9, 5);
    store.failNext = { count: 1, error: () => new Error("socket hang up") };
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: null, monthlyLimit: 0, keyPrefix: prefix };
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de", "ar"], requestedBy: null, idempotencyKey: "w" }, app);
    await enqueueCoveragePage(queues, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status === "COMPLETED", 30_000);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ resourcesScanned: 28 });
    expect(await withTenant(shop.id, (tx) => tx.coverageItem.count(), app)).toBe(28);
  }, 40_000);
});
