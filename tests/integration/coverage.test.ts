import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCoverageReport,
  GAP_LIMIT_PER_LOCALE,
  loadCoverage,
  runCoveragePage,
  STALE_REPORT_MS,
  type CoverageDeps,
  type CoveragePagePayload,
} from "../../app/.server/coverage/coverage";
import {
  createQueues,
  createWorkers,
  enqueueCoveragePage,
  type Queues,
  type WorkerSet,
} from "../../app/.server/jobs/queues";
import type { JobDependencies } from "../../app/.server/jobs/processors";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis, waitFor } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
let n = 0;

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
  const { report } = await createCoverageReport(
    { shopId, locales, requestedBy: "1", idempotencyKey: `cov-${++n}` },
    app,
  );
  let next: CoveragePagePayload | null = { shopId, reportId: report.id, segmentIndex: 0, cursor: null };
  let pages = 0;
  while (next) {
    next = await runCoveragePage(deps, next);
    if (++pages > 1000) throw new Error("runaway");
  }
  return report;
}

const reportRow = (shopId: string, id: string) =>
  withTenant(shopId, (tx) => tx.coverageReport.findUniqueOrThrow({ where: { id } }), app);

describe("coverage report", () => {
  it("counts translated, outdated and missing fields per language and type", async () => {
    const { shop, store, deps } = await setup();
    const P1 = "gid://shopify/Product/1";
    store.translate(P1, "de", "title", "Jacke 1");
    store.translate(P1, "de", "body_html", "<p>Warme Jacke 1.</p>");
    store.translate("gid://shopify/Product/2", "de", "title", "Jacke 2");
    store.updateSource("gid://shopify/Product/2", "title", "Product 2 jacket (new)");
    store.translate("gid://shopify/Collection/1", "fr", "meta_title", "Collection hiver 1");

    const report = await runAll(deps, shop.id);
    // 5 content types × 2 languages, each scanned to the end.
    expect(await reportRow(shop.id, report.id)).toMatchObject({ status: "COMPLETED", resourcesScanned: 18, segmentIndex: 10 });

    const coverage = (await loadCoverage(shop.id, app))!;
    const de = coverage.rows.find((r) => r.locale === "de" && r.resourceType === "PRODUCT")!;
    expect(de.resources).toBe(6);
    // title + body_html per product.
    expect(de.groups.content).toEqual({ withSource: 12, translated: 2, outdated: 1, missing: 9 });
    expect(de.groups.handle).toEqual({ withSource: 6, translated: 0, outdated: 0, missing: 6 });
    expect(de.seoTitlesMissingInSource).toBe(6);

    const frCollections = coverage.rows.find((r) => r.locale === "fr" && r.resourceType === "COLLECTION")!;
    expect(frCollections.groups.seo).toEqual({ withSource: 3, translated: 1, outdated: 0, missing: 2 });
    expect(frCollections.seoTitlesMissingInSource).toBe(0);

    const gap = coverage.gaps.find((g) => g.resourceGid === "gid://shopify/Product/2" && g.locale === "de")!;
    expect(gap).toMatchObject({ missing: 2, outdated: 1 });
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
  });

  it("finds duplicate SEO titles in a language", async () => {
    const { shop, store, deps } = await setup(0, 3);
    for (const i of [1, 2]) store.translate(`gid://shopify/Collection/${i}`, "de", "meta_title", "Winter Auswahl");
    store.translate("gid://shopify/Collection/3", "de", "meta_title", "Andere Auswahl");
    await runAll(deps, shop.id, ["de"]);
    expect((await loadCoverage(shop.id, app))!.duplicateSeoTitles).toEqual({ de: 2 });
  });

  it("counts a page once even when its queue job runs twice", async () => {
    const { shop, deps } = await setup(8, 0);
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "dup" }, app);
    const first: CoveragePagePayload = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    const next = await runCoveragePage(deps, first);
    expect(next).not.toBeNull();
    expect(await runCoveragePage(deps, first)).toBeNull();
    expect(await reportRow(shop.id, report.id)).toMatchObject({ pagesScanned: 1, resourcesScanned: 4 });
  });

  it("keeps the worst gaps only, up to the limit per language", async () => {
    const { shop, deps } = await setup(GAP_LIMIT_PER_LOCALE + 30, 0);
    await runAll(deps, shop.id, ["de"]);
    expect(await withTenant(shop.id, (tx) => tx.coverageGap.count(), app)).toBe(GAP_LIMIT_PER_LOCALE);
  }, 30_000);

  it("runs one report at a time, replaces a stalled one and keeps a short history", async () => {
    const { shop } = await setup(1, 0);
    const a = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "a" }, app);
    const b = await createCoverageReport({ shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: "b" }, app);
    expect(b).toMatchObject({ created: false, report: { id: a.report.id } });

    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRawUnsafe(
        `UPDATE "CoverageReport" SET "updatedAt" = now() - interval '${Math.ceil(STALE_REPORT_MS / 60000) + 1} minutes'`,
      ),
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

describe("coverage report in the worker (BullMQ + Redis)", () => {
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

  it("scans every page and completes, retrying a transient Shopify failure", async () => {
    const { shop, store } = await setup(9, 5);
    store.failNext = { count: 1, error: () => new Error("socket hang up") };
    const deps: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: null,
      monthlyLimit: 0,
      keyPrefix: prefix,
    };
    workers = createWorkers(deps, queues, { connection: redis, prefix, concurrency: 2 });
    const { report } = await createCoverageReport({ shopId: shop.id, locales: ["de", "ar"], requestedBy: null, idempotencyKey: "w" }, app);
    await enqueueCoveragePage(queues, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    await waitFor(async () => (await reportRow(shop.id, report.id)).status === "COMPLETED", 20_000);
    expect(await reportRow(shop.id, report.id)).toMatchObject({ resourcesScanned: 28 });
  }, 30_000);
});
