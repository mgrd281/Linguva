import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCoverageReport,
  loadCoverage,
  runCoveragePage,
  type CoverageDeps,
  type CoveragePagePayload,
} from "../../app/.server/coverage/coverage";
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
    expect(await loadCoverage(b.id, app)).toBeNull();

    // A queue payload naming shop B with shop A's report id finds nothing.
    await withTenant(a.shop.id, (tx) => tx.coverageReport.update({ where: { id: a.report.id }, data: { status: "RUNNING", segmentIndex: 0, cursor: null } }), app);
    const forged = await runCoveragePage(a.deps, { shopId: b.id, reportId: a.report.id, segmentIndex: 0, cursor: null });
    expect(forged).toBeNull();
    const row = await withTenant(a.shop.id, (tx) => tx.coverageReport.findUniqueOrThrow({ where: { id: a.report.id } }), app);
    // One page per content and image type (5 + 3), none from the forged payload.
    expect(row.pagesScanned).toBe(8);

    // Without a tenant, the runtime role sees no coverage rows at all.
    expect(await app.coverageStat.count()).toBe(0);
    expect(await app.coverageGap.count()).toBe(0);
    expect(await app.coverageTitleHash.count()).toBe(0);
  });

  it("stores no merchant text, only counts, ids and hashes", async () => {
    const a = await shopWithReport("cov-text.myshopify.com");
    const dump = await withTenant(
      a.shop.id,
      async (tx) =>
        JSON.stringify([
          await tx.coverageReport.findMany(),
          await tx.coverageStat.findMany(),
          await tx.coverageGap.findMany(),
          await tx.coverageTitleHash.findMany(),
        ]),
      app,
    );
    for (const text of ["Geheime", "jacket", "winter", "Winter", "Product 1"]) expect(dump).not.toContain(text);
  });
});
