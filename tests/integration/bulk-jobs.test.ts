import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cancelJob,
  createBulkJob,
  retryJobItems,
} from "../../app/.server/jobs/bulk-jobs";
import { JobStopError, RateLimitedError } from "../../app/.server/jobs/errors";
import {
  processItem,
  runDiscoveryPage,
  type JobDependencies,
} from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { getMonthlyUsage } from "../../app/.server/usage/usage-ledger";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const DOMAIN = "bulk.myshopify.com";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(products = 3, options: { consent?: boolean; mode?: "DRAFT" | "AUTO_PUBLISH" } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: DOMAIN }, app);
  if (options.consent !== false) await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  if (options.mode !== "DRAFT") {
    await setBulkPublishMode({ shopId: shop.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: null }, app);
  }
  const store = new FakeShopifyStore(products);
  const provider = new MockTranslationProvider();
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async (domain) => {
      if (domain !== DOMAIN) throw new Error(`unexpected shop ${domain}`);
      return store.asAdmin();
    },
    provider,
    monthlyLimit: 1_000_000,
    keyPrefix: "lv:test",
    discoveryPageSize: 2,
  };
  const { job } = await createBulkJob(
    { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "key-1" },
    app,
  );
  return { shop, store, provider, deps, job };
}

async function discoverAll(deps: JobDependencies, shopId: string, jobId: string) {
  const ids: string[] = [];
  for (let page = 0; page < 20; page++) {
    const result = await runDiscoveryPage(deps, { shopId, jobId });
    ids.push(...result.itemIds);
    if (!result.hasMore) break;
  }
  return ids;
}

async function jobRow(shopId: string, jobId: string) {
  return withTenant(shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: jobId } }), app);
}

describe("createBulkJob", () => {
  it("returns the same job for a repeated request and for a second active request", async () => {
    const { shop, job } = await setup();
    const again = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "key-1" },
      app,
    );
    const second = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "key-2" },
      app,
    );
    expect(again).toMatchObject({ created: false, job: { id: job.id } });
    expect(second).toMatchObject({ created: false, job: { id: job.id } });
    const other = await createBulkJob(
      { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "fr", requestedBy: null, idempotencyKey: "key-3" },
      app,
    );
    expect(other.created).toBe(true);
  });

  it("never creates two active jobs under concurrent requests", async () => {
    const { shop } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createBulkJob(
          { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "it", requestedBy: null, idempotencyKey: `c-${i}` },
          app,
        ),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
  });
});

describe("discovery", () => {
  it("pages through products and creates items only for resources needing work", async () => {
    const { shop, store, deps, job } = await setup(5);
    // Product 2 is fully translated already: no item for it.
    store.translate("gid://shopify/Product/2", "de", "title", "Fertig");
    store.translate("gid://shopify/Product/2", "de", "body_html", "<p>Fertig</p>");

    const ids = await discoverAll(deps, shop.id, job.id);
    expect(ids).toHaveLength(4);
    const row = await jobRow(shop.id, job.id);
    expect(row).toMatchObject({ status: "RUNNING", totalItems: 4, discoveryDone: true });
  });

  it("is safe to repeat: no duplicate items and no double counting", async () => {
    const { shop, deps, job } = await setup(2);
    // Same page discovered twice (e.g. a retried queue job before the cursor moved).
    await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    await withTenant(shop.id, (tx) => tx.translationJob.update({ where: { id: job.id }, data: { discoveryCursor: null, discoveryDone: false } }), app);
    await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    const row = await jobRow(shop.id, job.id);
    expect(row.totalItems).toBe(2);
    expect(await withTenant(shop.id, (tx) => tx.translationJobItem.count(), app)).toBe(2);
  });

  it("completes immediately when nothing needs translating", async () => {
    const { shop, deps, job } = await setup(0);
    await discoverAll(deps, shop.id, job.id);
    expect((await jobRow(shop.id, job.id)).status).toBe("COMPLETED");
  });

  it("honours the per-shop rate limiter before calling Shopify", async () => {
    const { shop, store, deps, job } = await setup(2);
    const limited: JobDependencies = { ...deps, shopifyLimiter: { take: async () => 750 } };
    await expect(runDiscoveryPage(limited, { shopId: shop.id, jobId: job.id })).rejects.toEqual(new RateLimitedError(750));
    expect(store.calls).toEqual([]);
  });
});

describe("processItem", () => {
  it("translates, publishes, meters usage and completes the job", async () => {
    const { shop, store, deps, job } = await setup(3);
    const ids = await discoverAll(deps, shop.id, job.id);
    for (const id of ids) {
      await expect(processItem(deps, { shopId: shop.id, itemId: id }, 1)).resolves.toEqual({ status: "SUCCEEDED" });
    }
    expect(store.translationOf("gid://shopify/Product/1", "de", "title")).toBe("[de] Product 1 jacket");
    expect(store.translationOf("gid://shopify/Product/1", "de", "body_html")).toBe("<p>[de] Warm <b>jacket</b> number 1.</p>");
    // URL handles are never machine-translated.
    expect(store.translationOf("gid://shopify/Product/1", "de", "handle")).toBeUndefined();

    const row = await jobRow(shop.id, job.id);
    expect(row).toMatchObject({ status: "COMPLETED", succeededItems: 3, failedItems: 0 });
    expect(row.charsBilled).toBeGreaterThan(0);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(row.charsBilled);
    expect(await withTenant(shop.id, (tx) => tx.translationRevision.count({ where: { origin: "AI", provider: "mock" } }), app)).toBe(6);
  });

  it("is idempotent: a finished item is not processed again", async () => {
    const { shop, provider, deps, job } = await setup(1);
    const [id] = await discoverAll(deps, shop.id, job.id);
    await processItem(deps, { shopId: shop.id, itemId: id! }, 1);
    const calls = provider.requests.length;
    await expect(processItem(deps, { shopId: shop.id, itemId: id! }, 2)).resolves.toEqual({
      status: "discarded",
      reason: "ALREADY_FINISHED",
    });
    expect(provider.requests.length).toBe(calls);
    expect((await jobRow(shop.id, job.id)).succeededItems).toBe(1);
  });

  it("skips a resource that became up to date and one that was deleted", async () => {
    const { shop, store, deps, job } = await setup(2);
    const ids = await discoverAll(deps, shop.id, job.id);
    store.translate("gid://shopify/Product/1", "de", "title", "Manuell");
    store.translate("gid://shopify/Product/1", "de", "body_html", "<p>Manuell</p>");
    store.products.delete("gid://shopify/Product/2");
    const outcomes = [];
    for (const id of ids) outcomes.push(await processItem(deps, { shopId: shop.id, itemId: id }, 1));
    expect(outcomes).toEqual([
      { status: "SKIPPED", errorCode: "UP_TO_DATE" },
      { status: "SKIPPED", errorCode: "RESOURCE_GONE" },
    ]);
    // The merchant's manual translation is untouched.
    expect(store.translationOf("gid://shopify/Product/1", "de", "title")).toBe("Manuell");
  });

  it("stops the job when consent is missing", async () => {
    const { shop, deps, job } = await setup(1, { consent: false });
    const [id] = await discoverAll(deps, shop.id, job.id);
    await expect(processItem(deps, { shopId: shop.id, itemId: id! }, 1)).rejects.toEqual(new JobStopError("CONSENT_REQUIRED"));
  });

  it("raises the quota error when the monthly allowance is exhausted", async () => {
    const { shop, deps, job } = await setup(1);
    const [id] = await discoverAll(deps, shop.id, job.id);
    await expect(processItem({ ...deps, monthlyLimit: 5 }, { shopId: shop.id, itemId: id! }, 1)).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
  });

  it("releases reserved usage when the provider fails", async () => {
    const { shop, deps, job } = await setup(1);
    const [id] = await discoverAll(deps, shop.id, job.id);
    const failing = { ...deps, provider: new MockTranslationProvider({ failNext: { count: 1, kind: "retryable" } }) };
    await expect(processItem(failing, { shopId: shop.id, itemId: id! }, 1)).rejects.toMatchObject({ kind: "retryable" });
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
  });

  it("does not translate a source that changed after translation started", async () => {
    const { shop, store, deps, job } = await setup(1);
    const [id] = await discoverAll(deps, shop.id, job.id);
    const original = deps.provider!;
    const racing: JobDependencies = {
      ...deps,
      provider: {
        id: "mock",
        translate: async (request) => {
          const result = await original.translate(request);
          store.updateSource("gid://shopify/Product/1", "title", "Renamed jacket");
          store.updateSource("gid://shopify/Product/1", "body_html", "<p>New text</p>");
          return result;
        },
      },
    };
    await expect(processItem(racing, { shopId: shop.id, itemId: id! }, 1)).resolves.toEqual({
      status: "SKIPPED",
      errorCode: "SOURCE_CHANGED",
    });
    expect(store.translationOf("gid://shopify/Product/1", "de", "title")).toBeUndefined();
  });
});

describe("cancel, uninstall and retry", () => {
  it("cancels remaining items after the merchant cancels", async () => {
    const { shop, store, deps, job } = await setup(2);
    const ids = await discoverAll(deps, shop.id, job.id);
    expect(await cancelJob(shop.id, job.id, app)).toBe(true);
    for (const id of ids) {
      await expect(processItem(deps, { shopId: shop.id, itemId: id }, 1)).resolves.toMatchObject({ status: "CANCELLED" });
    }
    expect(store.calls.filter((c) => c === "LinguvaTranslationsRegister")).toHaveLength(0);
    expect((await jobRow(shop.id, job.id)).status).toBe("CANCELLED");
  });

  it("cancels active jobs when the app is uninstalled", async () => {
    const { shop, deps, job } = await setup(1);
    const [id] = await discoverAll(deps, shop.id, job.id);
    await markShopUninstalled(DOMAIN, app);
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "CANCELLED", errorCode: "SHOP_UNINSTALLED" });
    await expect(processItem(deps, { shopId: shop.id, itemId: id! }, 1)).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("puts failed items back to pending and reopens the job", async () => {
    const { shop, deps, job } = await setup(2);
    const ids = await discoverAll(deps, shop.id, job.id);
    await withTenant(
      shop.id,
      async (tx) => {
        await tx.translationJobItem.update({ where: { id: ids[0]! }, data: { status: "DEAD", errorCode: "SHOPIFY_UNAVAILABLE" } });
        await tx.translationJob.update({ where: { id: job.id }, data: { failedItems: 1 } });
      },
      app,
    );
    const { itemIds } = await retryJobItems(shop.id, job.id, app);
    expect(itemIds).toEqual([ids[0]]);
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "RUNNING", failedItems: 0 });
    for (const id of ids) await processItem(deps, { shopId: shop.id, itemId: id }, 1);
    expect(await jobRow(shop.id, job.id)).toMatchObject({ status: "COMPLETED", succeededItems: 2 });
  });

  it("does not reopen a job the merchant cancelled", async () => {
    const { shop, deps, job } = await setup(1);
    await discoverAll(deps, shop.id, job.id);
    await cancelJob(shop.id, job.id, app);
    expect(await retryJobItems(shop.id, job.id, app)).toEqual({ itemIds: [], rediscover: false });
  });
});
