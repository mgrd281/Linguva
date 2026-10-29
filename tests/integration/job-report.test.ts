/**
 * Job report data: outcomes grouped by reason, items that need attention
 * (not only failures), every item for the CSV report, and nothing across
 * stores.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createBulkJob, jobOutcomes, listJobReportItems, listProblemItems } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function runJob(domain: string) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(4);
  // Product 2 is fully translated already; product 3 has a hand-written, now outdated title.
  for (const field of store.products.get("gid://shopify/Product/2")!) store.translate("gid://shopify/Product/2", "de", field.key, `DE ${field.value}`);
  for (const field of store.products.get("gid://shopify/Product/3")!) store.translate("gid://shopify/Product/3", "de", field.key, `DE ${field.value}`);
  await saveResourceTranslations(
    {
      admin: store.asAdmin(),
      shopId: shop.id,
      actorId: "1",
      resourceId: "gid://shopify/Product/3",
      locale: "de",
      edits: [{ key: "title", value: "Meine Jacke", digest: createHash("sha256").update("Product 3 jacket").digest("hex"), origin: "MANUAL", approved: true }],
    },
    app,
  );
  store.updateSource("gid://shopify/Product/3", "title", "Product 3 jacket, new");
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider: new MockTranslationProvider(), monthlyLimit: 1_000_000, keyPrefix: "lv:test:report" };
  const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "r-1" }, app);
  const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
  for (const itemId of page.itemIds) await processItem(deps, { shopId: shop.id, itemId }, 1);
  return { shop, job };
}

describe("job report", () => {
  it("groups outcomes by reason and lists every item", async () => {
    const { shop, job } = await runJob("report.myshopify.com");
    const outcomes = await jobOutcomes(shop.id, job.id, app);
    // Discovery leaves out up-to-date products and the one whose only gap is a person's translation.
    expect(outcomes).toEqual([{ status: "SUCCEEDED", code: "DRAFTED", count: 2 }]);
    const items = await listJobReportItems(shop.id, job.id, app);
    expect(items.map((i) => i.resourceGid).sort()).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/4"]);
    expect(items.every((i) => i.status === "SUCCEEDED" && i.attempts === 1 && i.finishedAt)).toBe(true);
    // Nothing needs attention: drafts and kept translations are normal results.
    expect(await listProblemItems(shop.id, job.id, app)).toEqual([]);
  });

  it("stays within its store", async () => {
    const a = await runJob("report-a.myshopify.com");
    const { shop: b } = await upsertInstalledShop({ shopDomain: "report-b.myshopify.com" }, app);
    expect(await jobOutcomes(b.id, a.job.id, app)).toEqual([]);
    expect(await listJobReportItems(b.id, a.job.id, app)).toEqual([]);
    expect(await listProblemItems(b.id, a.job.id, app)).toEqual([]);
  });
});

describe("items that need attention", () => {
  it("include partly translated items and items whose original changed, not only failures", async () => {
    const { shop, job } = await runJob("attention.myshopify.com");
    const [first, second] = await listJobReportItems(shop.id, job.id, app);
    await withTenant(
      shop.id,
      async (tx) => {
        await tx.translationJobItem.update({ where: { id: first!.id }, data: { errorCode: "PARTIAL" } });
        await tx.translationJobItem.update({ where: { id: second!.id }, data: { status: "SKIPPED", errorCode: "SOURCE_CHANGED" } });
      },
      app,
    );
    const problems = await listProblemItems(shop.id, job.id, app);
    expect(problems.map((p) => p.errorCode).sort()).toEqual(["PARTIAL", "SOURCE_CHANGED"]);
  });
});
