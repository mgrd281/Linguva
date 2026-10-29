/**
 * Overview: the getting-started checklist follows the merchant's real
 * progress, languages show their coverage, AI usage warns early.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { loadOverview } from "../../app/.server/overview/overview";
import { translator } from "../../app/i18n/i18n";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { approveDrafts, listPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { usageLevel } from "../../app/lib/usage";
import { createCoverageReport, runCoveragePage, type CoverageDeps, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { loadCoverageSummary } from "../../app/.server/coverage/summary";
import { storeWide } from "../../app/lib/coverage-view";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const steps = (o: Awaited<ReturnType<typeof loadOverview>>) => Object.fromEntries(o.checklist.map((s) => [s.id, s.done]));

describe("getting started", () => {
  it("guides a new store step by step and follows its progress", async () => {
    const store = new FakeShopifyStore(2);
    store.locales = [{ locale: "en", name: "English", primary: true, published: true }];
    const { shop } = await upsertInstalledShop({ shopDomain: "new.myshopify.com", name: "New store" }, app);

    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toEqual({ language: false, consent: false, "first-translation": false, review: false, "publish-language": false });
    expect(overview.progress).toEqual([]);

    store.locales = [...store.locales, { locale: "de", name: "German", primary: false, published: false }];
    await setAiConsent({ shopId: shop.id, granted: true, actorId: "1" }, app);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toMatchObject({ language: true, consent: true, "first-translation": false });
    expect(overview.checklist.find((s) => s.id === "first-translation")?.href).toBe("/app/products?lang=de");

    // A bulk job in review mode: drafts to review, nothing published yet.
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: "lv:test:overview" };
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "ov-1" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    for (const id of page.itemIds) await processItem(deps, { shopId: shop.id, itemId: id }, 1);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.pendingDrafts).toBe(4);
    expect(overview.checklist.find((s) => s.id === "review")?.label).toEqual({ key: "overview.checklist.review.labelCount", vars: { count: 4 } });
    expect(translator("en").msg(overview.checklist.find((s) => s.id === "review")!.label)).toBe("Review 4 translations");

    const drafts = await listPendingDrafts(shop.id, {}, app);
    await approveDrafts({ admin: store.asAdmin(), shopId: shop.id, actorId: "1", draftIds: drafts.map((d) => d.id) }, app);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(steps(overview)).toMatchObject({ "first-translation": true, review: true, "publish-language": false });

    store.locales = store.locales.map((l) => (l.locale === "de" ? { ...l, published: true } : l));
    expect(steps(await loadOverview(store.asAdmin(), shop, app))).toMatchObject({ "publish-language": true });
  });
});

describe("without an AI provider", () => {
  it("leaves out the AI steps and asks for a manual first translation", async () => {
    const store = new FakeShopifyStore(1);
    const { shop } = await upsertInstalledShop({ shopDomain: "manual.myshopify.com", name: "Manual store" }, app);
    const overview = await loadOverview(store.asAdmin(), shop, app, { aiAvailable: false });
    expect(overview.checklist.map((s) => s.id)).toEqual(["language", "first-translation", "publish-language"]);
    expect(overview.checklist.find((s) => s.id === "first-translation")?.detail).toEqual({ key: "overview.checklist.firstTranslation.detailManual" });
    expect(overview.aiAvailable).toBe(false);
    // No markets loader given: no countries section.
    expect(overview.countries).toBeNull();
  });
});

describe("AI usage level", () => {
  it("warns from 80 % and stops at the allowance", () => {
    expect(usageLevel(0, 1000)).toBe("ok");
    expect(usageLevel(799, 1000)).toBe("ok");
    expect(usageLevel(800, 1000)).toBe("high");
    expect(usageLevel(1000, 1000)).toBe("exhausted");
    expect(usageLevel(5, 0)).toBe("exhausted");
  });
});

describe("percentages from completed measurements only", () => {
  async function measuredStore() {
    const store = new FakeShopifyStore(6);
    store.locales = [
      { locale: "en", name: "English", primary: true, published: true },
      { locale: "de", name: "German", primary: false, published: true },
    ];
    const { shop } = await upsertInstalledShop({ shopDomain: "measured.myshopify.com", name: "Measured store" }, app);
    const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:overview", pageSize: 4 };
    return { store, shop, deps };
  }
  const start = (shopId: string, key: string) => createCoverageReport({ shopId, locales: ["de"], requestedBy: null, idempotencyKey: key }, app);

  it("shows no share during the first measurement, then the share and the time of the completed one", async () => {
    const { store, shop, deps } = await measuredStore();
    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.measurement.state).toBe("never");
    expect(overview.next).toEqual({ id: "measure" });

    const { report } = await start(shop.id, "first");
    let next: CoveragePagePayload | null = await runCoveragePage(deps, { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null });
    overview = await loadOverview(store.asAdmin(), shop, app);
    // One page read: products only. Not shown as the language's share.
    expect(overview.progress[0]).toMatchObject({ locale: "de", measured: false, percent: null });
    expect(overview.storeShare).toBeNull();
    expect(overview.measurement).toMatchObject({ state: "running", total: report.segments.length });
    expect(overview.next).toEqual({ id: "measure" });

    while (next) next = await runCoveragePage(deps, next);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress[0]).toMatchObject({ locale: "de", measured: true });
    expect(overview.progress[0]!.total).toBeGreaterThan(0);
    expect(overview.measuredAt).not.toBeNull();
    expect(overview.measurement.state).toBe("done");
    // The headline equals the Coverage page's whole-store figure.
    const summary = await loadCoverageSummary(shop.id, app);
    const whole = storeWide(summary.counts, ["de"]);
    expect(overview.storeShare).toEqual({ complete: whole.complete, total: whole.total, languages: 1, published: 1 });
    expect(overview.next?.id).not.toBe("measure");
  });

  it("keeps the last completed share while a new measurement runs, fails or stalls", async () => {
    const { store, shop, deps } = await measuredStore();
    const { report } = await start(shop.id, "one");
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage(deps, next);
    const measured = (await loadOverview(store.asAdmin(), shop, app)).progress[0]!;

    const again = await start(shop.id, "two");
    await runCoveragePage(deps, { shopId: shop.id, reportId: again.report.id, segmentIndex: 0, cursor: null });
    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress[0]).toMatchObject({ measured: true, percent: measured.percent });
    expect(overview.measurement.state).toBe("running");
    expect(overview.next?.id).not.toBe("measure");

    // Five failed measurements in a row: the completed one is kept (history pruning skips it).
    for (let i = 0; i < 5; i++) {
      await withTenant(shop.id, (tx) => tx.coverageReport.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED" } }), app);
      await start(shop.id, `fail-${i}`);
    }
    await withTenant(shop.id, (tx) => tx.coverageReport.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED" } }), app);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress[0]).toMatchObject({ measured: true, percent: measured.percent });
    expect(overview.measurement.state).toBe("failed");
    expect(await withTenant(shop.id, (tx) => tx.coverageReport.count({ where: { status: "COMPLETED" } }), app)).toBe(1);
  });

  it("says how many published languages the store's share covers, and marks content the measurement skipped", async () => {
    const { store, shop, deps } = await measuredStore();
    const { report } = await start(shop.id, "m");
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage(deps, next);
    store.locales = [...store.locales, { locale: "fr", name: "French", primary: false, published: true }];
    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.storeShare).toMatchObject({ languages: 1, published: 2 });
    expect(overview.progress.find((l) => l.locale === "de")).toMatchObject({ measured: true, partial: false });

    // A segment the measurement had to skip (errors): the language stays measured, marked partial.
    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRaw`UPDATE "CoverageSegment" SET "status" = 'FAILED' WHERE "shopId" = ${shop.id}::uuid AND "locale" = 'de' AND "resourceType" = 'PRODUCT'`,
    ]);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress.find((l) => l.locale === "de")).toMatchObject({ measured: true, partial: true });
    expect(overview.progress.find((l) => l.locale === "fr")).toMatchObject({ measured: false, partial: false });

    // Read again; only content the figures don't count (theme texts) fails: not partial.
    const setStatus = (type: string, status: string) =>
      ownerDb.$transaction([
        ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
        ownerDb.$executeRawUnsafe(
          `INSERT INTO "CoverageSegment" ("shopId", "locale", "resourceType", "status", "updatedAt") VALUES ($1::uuid, 'de', $2, $3::"CoverageSegmentStatus", now())
           ON CONFLICT ("shopId", "locale", "resourceType") DO UPDATE SET "status" = EXCLUDED."status"`,
          shop.id,
          type,
          status,
        ),
      ]);
    await setStatus("PRODUCT", "SCANNED");
    await setStatus("ONLINE_STORE_THEME", "FAILED");
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress.find((l) => l.locale === "de")).toMatchObject({ partial: false });
    // A read left unfinished by a measurement that stopped (no measurement under way): partial.
    await setStatus("PRODUCT", "SCANNING");
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress.find((l) => l.locale === "de")).toMatchObject({ partial: true });
  });

  it("counts translations already live in the store (made anywhere) as past the first translation", async () => {
    const { store, shop, deps } = await measuredStore();
    store.translate("gid://shopify/Product/1", "de", "title", "Produkt 1 Jacke");
    const { report } = await start(shop.id, "live");
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage(deps, next);
    const overview = await loadOverview(store.asAdmin(), shop, app, { aiAvailable: false });
    expect(steps(overview)["first-translation"]).toBe(true);
    // The least translated language is the next step, not "publish your first translation".
    expect(overview.next).toMatchObject({ id: "translate", locale: "de" });
  });

  it("asks to measure again for a language published after the measurement, and says when a report stalled", async () => {
    const { store, shop, deps } = await measuredStore();
    const { report } = await start(shop.id, "m");
    let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
    while (next) next = await runCoveragePage(deps, next);
    store.locales = [...store.locales, { locale: "fr", name: "French", primary: false, published: true }];
    let overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.progress.find((l) => l.locale === "fr")).toMatchObject({ measured: false, percent: null });
    expect(overview.next).toEqual({ id: "measure" });

    await createCoverageReport({ shopId: shop.id, locales: ["de", "fr"], requestedBy: null, idempotencyKey: "stuck" }, app);
    await ownerDb.$transaction([
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shop.id}, true)`,
      ownerDb.$executeRawUnsafe(`UPDATE "CoverageReport" SET "updatedAt" = now() - interval '31 minutes' WHERE status = 'QUEUED'`),
    ]);
    overview = await loadOverview(store.asAdmin(), shop, app);
    expect(overview.measurement.state).toBe("stalled");
    expect(overview.measurement.since).not.toBeNull();
    // Without background jobs nothing can be measured here: no measure step.
    overview = await loadOverview(store.asAdmin(), shop, app, { jobsAvailable: false });
    expect(overview.measurement.state).toBe("unavailable");
    expect(overview.next?.id).not.toBe("measure");
  });
});
