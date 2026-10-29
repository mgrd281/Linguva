import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { listPendingDrafts } from "../../app/.server/review/drafts";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { aiTranslateResource } from "../../app/.server/translation/product-translation-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
let n = 0;

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(mode: "DRAFT" | "AUTO_PUBLISH") {
  const { shop } = await upsertInstalledShop({ shopDomain: "seo.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (mode === "AUTO_PUBLISH") {
    await setBulkPublishMode({ shopId: shop.id, mode, confirmed: true, actorId: "1" }, app);
  }
  const store = new FakeShopifyStore(3);
  store.setField(P1, "meta_title", "Warm winter jacket for cold days | Shop");
  store.setField(P1, "meta_description", "A warm, water-resistant winter jacket with two pockets and a hood.", "MULTI_LINE_TEXT_FIELD");
  // Product 3 has no SEO fields of its own.
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider,
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test:seo",
  };
  return { shop, store, provider, deps };
}

async function runJob(deps: JobDependencies, shopId: string, fieldScope: "ALL" | "SEO") {
  const { job } = await createBulkJob(
    { shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: `seo-${++n}`, fieldScope },
    app,
  );
  const page = await runDiscoveryPage(deps, { shopId, jobId: job.id });
  for (const id of page.itemIds) await processItem(deps, { shopId, itemId: id }, 1);
  return withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
}

describe("SEO-only bulk jobs", () => {
  it("translates only SEO titles and descriptions, and only where they exist", async () => {
    const { shop, store, provider, deps } = await setup("AUTO_PUBLISH");
    store.setField(P2, "meta_title", "Light rain jacket for spring walks");
    const job = await runJob(deps, shop.id, "SEO");
    expect(job).toMatchObject({ fieldScope: "SEO", totalItems: 2, succeededItems: 2 });
    expect(store.translationOf(P1, "de", "meta_title")).toBe("[de] Warm winter jacket for cold days | Shop");
    expect(store.translationOf(P1, "de", "meta_description")).toMatch(/^\[de\] A warm, water-resistant/);
    expect(store.translationOf(P2, "de", "meta_title")).toBe("[de] Light rain jacket for spring walks");
    for (const gid of [P1, P2, "gid://shopify/Product/3"]) {
      expect(store.translationOf(gid, "de", "title")).toBeUndefined();
      expect(store.translationOf(gid, "de", "body_html")).toBeUndefined();
    }
    const sent = provider.requests.flatMap((r) => r.segments).join(" ");
    expect(sent).not.toContain("Product 1 jacket");
  });

  it("sends an SEO title that comes out too long to Review instead of publishing it", async () => {
    const { shop, store, deps } = await setup("AUTO_PUBLISH");
    // 57 characters; the translation adds 5 and passes the 60 limit.
    store.setField(P1, "meta_title", "Warm winter jacket for cold days with hood | Our Shop 24h");
    await runJob(deps, shop.id, "SEO");
    expect(store.translationOf(P1, "de", "meta_title")).toBeUndefined();
    expect(store.translationOf(P1, "de", "meta_description")).toBeDefined();
    const [draft] = await listPendingDrafts(shop.id, {}, app);
    expect(draft).toMatchObject({ key: "meta_title" });
    expect(JSON.stringify(draft!.issues)).toContain("SEO_TOO_LONG");
  });

  it("a full job still includes SEO fields", async () => {
    const { shop, store, deps } = await setup("AUTO_PUBLISH");
    await runJob(deps, shop.id, "ALL");
    expect(store.translationOf(P1, "de", "title")).toBe("[de] Product 1 jacket");
    expect(store.translationOf(P1, "de", "meta_title")).toBeDefined();
  });
});

describe("SEO checks in the editor", () => {
  it("reports SEO warnings on AI drafts", async () => {
    const { shop, store, provider } = await setup("DRAFT");
    store.setField(P1, "meta_title", "Warm winter jacket for cold days with hood | Our Shop 24h");
    const result = await aiTranslateResource(
      {
        admin: store.asAdmin(),
        shopId: shop.id,
        resourceId: P1,
        targetLocale: "de",
        keys: ["meta_title", "meta_description"],
        provider,
        monthlyLimit: 1_000_000,
      },
      app,
    );
    const title = result.outcomes.find((o) => o.key === "meta_title")!;
    expect(title).toMatchObject({ status: "translated" });
    expect(title.status === "translated" && title.issues.map((i) => i.code)).toEqual(["SEO_TOO_LONG"]);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
  });
});
