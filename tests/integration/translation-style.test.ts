/**
 * Translation style reaches the AI: form of address per language and the
 * store description, in the editor and in bulk jobs; invalid input dropped.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { listPendingDrafts } from "../../app/.server/review/drafts";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { getShopSettings, setAiConsent, setBulkPublishMode, setTranslationStyle } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { aiTranslateResource } from "../../app/.server/translation/product-translation-service";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "style.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  return shop;
}

describe("translation style", () => {
  it("stores only known languages and valid values, and a trimmed store description", async () => {
    const shop = await setup();
    const saved = await setTranslationStyle(
      {
        shopId: shop.id,
        formality: { de: "less", fr: "more", it: "casual", xx: "more" },
        storeContext: `  Outdoor clothing\\n for families.   ${"x".repeat(400)}`,
        allowedLocales: ["de", "fr", "it"],
      },
      app,
    );
    expect(saved.formalityByLocale).toEqual({ de: "less", fr: "more" });
    expect(saved.storeContext!.startsWith("Outdoor clothing\\n for families. x")).toBe(true);
    expect(saved.storeContext!.length).toBe(300);
    const settings = await getShopSettings(shop.id, app);
    expect(settings.formalityByLocale).toEqual({ de: "less", fr: "more" });
  });

  it("is sent with editor AI translations and bulk jobs", async () => {
    const shop = await setup();
    await setTranslationStyle({ shopId: shop.id, formality: { de: "less" }, storeContext: "Outdoor clothing, friendly tone", allowedLocales: ["de", "fr"] }, app);
    const store = new FakeShopifyStore(2);
    const provider = new MockTranslationProvider();

    await aiTranslateResource(
      { admin: store.asAdmin(), shopId: shop.id, resourceId: "gid://shopify/Product/1", resourceType: "PRODUCT", targetLocale: "de", keys: ["title"], provider, monthlyLimit: 1_000_000 },
      app,
    );
    expect(provider.requests.at(-1)).toMatchObject({ formality: "less", context: "Store: Outdoor clothing, friendly tone. Product: Product 1 jacket" });

    // French has no setting: the provider's default.
    await aiTranslateResource(
      { admin: store.asAdmin(), shopId: shop.id, resourceId: "gid://shopify/Product/1", targetLocale: "fr", keys: ["title"], provider, monthlyLimit: 1_000_000 },
      app,
    );
    expect(provider.requests.at(-1)?.formality).toBeUndefined();

    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:style" };
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "st-1" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    await processItem(deps, { shopId: shop.id, itemId: page.itemIds[1]! }, 1);
    expect(provider.requests.at(-1)).toMatchObject({ formality: "less", context: "Store: Outdoor clothing, friendly tone. Product: Product 2 jacket" });
  });

  it("keeps results in the wrong script in Review even with automatic publishing", async () => {
    const shop = await setup();
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const store = new FakeShopifyStore(1);
    // The mock "translates" into Latin letters: wrong for Arabic.
    const provider = new MockTranslationProvider();
    const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit: 1_000_000, keyPrefix: "lv:test:style-ar" };
    const { job } = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "ar", requestedBy: null, idempotencyKey: "st-ar" },
      app,
    );
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    await processItem(deps, { shopId: shop.id, itemId: page.itemIds[0]! }, 1);
    expect(store.translationOf("gid://shopify/Product/1", "ar", "title")).toBeUndefined();
    const draft = (await listPendingDrafts(shop.id, {}, app)).find((d) => d.key === "title");
    expect(draft?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "WRONG_SCRIPT" })]));
  });
});
