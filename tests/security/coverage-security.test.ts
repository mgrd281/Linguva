import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  COVERAGE_TYPES,
  createCoverageReport,
  runCoveragePage,
  type CoverageDeps,
  type CoveragePagePayload,
} from "../../app/.server/coverage/coverage";
import { listCoverageItems, loadCoverageSummary } from "../../app/.server/coverage/summary";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function shopWithReport(domain: string) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  const store = new FakeShopifyStore(3).addCollections(2);
  store.translate("gid://shopify/Product/1", "de", "title", "Geheime Jacke");
  store.translate("gid://shopify/Collection/1", "de", "meta_title", "Geheime Winterauswahl");
  store.addMetafield("gid://shopify/Product/1", { namespace: "custom", key: "care", type: "single_line_text_field", value: "Geheime Pflege" });
  store.addImage("gid://shopify/Product/2", "Geheimes Bild");
  const deps: CoverageDeps = { prisma: app, adminFor: async () => store.asAdmin(), keyPrefix: "lv:test:covsec" };
  const { report } = await createCoverageReport(
    { shopId: shop.id, locales: ["de"], requestedBy: null, idempotencyKey: `${domain}-k` },
    app,
  );
  let next: CoveragePagePayload | null = { shopId: shop.id, reportId: report.id, segmentIndex: 0, cursor: null };
  while (next) next = await runCoveragePage(deps, next);
  return { shop, report, deps };
}

describe("coverage report isolation", () => {
  it("never shows or advances another shop's report", async () => {
    const a = await shopWithReport("cov-a.myshopify.com");
    const { shop: b } = await upsertInstalledShop({ shopDomain: "cov-b.myshopify.com" }, app);
    const empty = await loadCoverageSummary(b.id, app);
    expect(empty).toMatchObject({ report: null, segments: [], counts: [], items: [] });
    expect((await listCoverageItems(b.id, { locale: "de" }, app)).items).toEqual([]);

    // A queue payload naming shop B with shop A's report id finds nothing.
    await withTenant(a.shop.id, (tx) => tx.coverageReport.update({ where: { id: a.report.id }, data: { status: "RUNNING", segmentIndex: 0, cursor: null } }), app);
    const forged = await runCoveragePage(a.deps, { shopId: b.id, reportId: a.report.id, segmentIndex: 0, cursor: null });
    expect(forged).toBeNull();
    const row = await withTenant(a.shop.id, (tx) => tx.coverageReport.findUniqueOrThrow({ where: { id: a.report.id } }), app);
    // One page per type, none from the forged payload.
    expect(row.pagesScanned).toBe(COVERAGE_TYPES.length);

    // Without a tenant, the runtime role sees no coverage rows at all.
    expect(await app.coverageItem.count()).toBe(0);
    expect(await app.coverageCount.count()).toBe(0);
    expect(await app.coverageSegment.count()).toBe(0);
    // And can't write rows for another shop.
    await expect(
      withTenant(a.shop.id, (tx) => tx.coverageCount.create({ data: { shopId: b.id, locale: "de", resourceType: "PRODUCT", fieldGroup: "title", state: "complete", count: 1 } }), app),
    ).rejects.toThrow();
  });

  it("stores no merchant text, only counts, ids and hashes", async () => {
    const a = await shopWithReport("cov-text.myshopify.com");
    const dump = await withTenant(
      a.shop.id,
      async (tx) =>
        JSON.stringify(
          [await tx.coverageReport.findMany(), await tx.coverageItem.findMany(), await tx.coverageCount.findMany(), await tx.coverageSegment.findMany()],
          // Character counts are numbers too (BIGINT).
          (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        ),
      app,
    );
    expect(dump).toContain("gid://shopify/Product/1");
    for (const text of ["Geheim", "jacket", "winter", "Winter", "Product 1", "Pflege", "Bild"]) expect(dump).not.toContain(text);
  });
});
