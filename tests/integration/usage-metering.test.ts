/**
 * Every provider call of a job item is metered once, under its own key, and
 * checked against the limits: a later check of the same item, a retry after
 * a failure, and DeepL batches billed before a failure. A stale duplicate
 * delivery never translates an item a second time.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
});

import { PrismaClient } from "@prisma/client";
import { createAutoItems, type AutoTranslatePayload } from "../../app/.server/jobs/auto-translate";
import { createBulkJob, retryJobItems } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { TranslationProviderError, type TranslationProvider, type TranslationRequest } from "../../app/.server/providers/types";
import { setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { getMonthlyUsage, QuotaExceededError } from "../../app/.server/usage/usage-ledger";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

/** Bills every character it is sent, and remembers how many. */
class CountingProvider implements TranslationProvider {
  readonly id = "mock";
  billed = 0;
  failNext = 0;
  private readonly inner = new MockTranslationProvider();
  async translate(request: TranslationRequest) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new TranslationProviderError(this.id, "retryable", "simulated failure");
    }
    const result = await this.inner.translate(request);
    this.billed += result.billedCharacters;
    return result;
  }
}

async function setup(monthlyLimit = 1_000_000) {
  const { shop } = await upsertInstalledShop({ shopDomain: "meter.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  await setAutoTranslate({ shopId: shop.id, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: "7" }, app);
  const store = new FakeShopifyStore(2);
  const provider = new CountingProvider();
  const deps: JobDependencies = { prisma: app, adminFor: async () => store.asAdmin(), provider, monthlyLimit, keyPrefix: "lv:test:meter" };
  return { shop, store, provider, deps };
}

async function check(deps: JobDependencies, payload: AutoTranslatePayload) {
  const result = await createAutoItems(app, payload, deps.billingFor);
  const outcomes = [];
  for (const itemId of [...result.itemIds, ...result.reused]) outcomes.push(await processItem(deps, { shopId: payload.shopId, itemId }, 1));
  return outcomes;
}

const ledgerTotal = (shopId: string) => getMonthlyUsage(shopId, undefined, app);
const jobTotal = async (shopId: string) =>
  (await withTenant(shopId, (tx) => tx.translationJob.findMany({ where: { shopId } }), app)).reduce((n, j) => n + j.charsBilled, 0);

describe("usage metering of job items", () => {
  it("meters a later check of the same item again, so the ledger matches what the provider billed", async () => {
    const { shop, store, provider, deps } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    await check(deps, payload);
    const first = provider.billed;
    expect(first).toBeGreaterThan(0);
    store.updateSource(P1, "title", "Product 1 jacket, now waterproof");
    await check(deps, payload);
    expect(provider.billed).toBeGreaterThan(first);
    expect(await ledgerTotal(shop.id)).toBe(provider.billed);
    expect(await jobTotal(shop.id)).toBe(provider.billed);
  });

  it("refuses a later check of the same item over the limit, instead of reusing the first reservation", async () => {
    const { shop, store, provider, deps } = await setup();
    const payload = { shopId: shop.id, resourceGid: P1, resourceType: "PRODUCT" as const };
    await check(deps, payload);
    // The allowance is exactly what the first check used.
    deps.monthlyLimit = provider.billed;
    store.updateSource(P1, "title", "Product 1 jacket, now waterproof");
    await expect(check(deps, payload)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await ledgerTotal(shop.id)).toBe(provider.billed);
  });

  it("meters a retry after a failed provider call, and counts the failed call as nothing", async () => {
    const { shop, store, provider, deps } = await setup();
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "retry-meter" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    const itemId = page.itemIds[0]!;
    provider.failNext = 1;
    await expect(processItem(deps, { shopId: shop.id, itemId }, 1)).rejects.toBeInstanceOf(TranslationProviderError);
    expect(await ledgerTotal(shop.id)).toBe(0);
    await withTenant(shop.id, (tx) => tx.translationJobItem.update({ where: { id: itemId }, data: { status: "FAILED" } }), app);
    await retryJobItems(shop.id, job.id, app);
    // The retry starts again at attempt 1: it is still a new provider call.
    await processItem(deps, { shopId: shop.id, itemId }, 1);
    expect(provider.billed).toBeGreaterThan(0);
    expect(await ledgerTotal(shop.id)).toBe(provider.billed);
    expect(store.products.size).toBe(2);
  });

  it("keeps what earlier DeepL batches billed when a later batch fails", async () => {
    const { shop, deps } = await setup();
    const partial: TranslationProvider = {
      id: "mock",
      async translate() {
        const error = new TranslationProviderError("mock", "retryable", "batch 2 failed");
        error.billedCharacters = 40;
        throw error;
      },
    };
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "partial" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    await expect(processItem({ ...deps, provider: partial }, { shopId: shop.id, itemId: page.itemIds[0]! }, 1)).rejects.toBeInstanceOf(TranslationProviderError);
    expect(await ledgerTotal(shop.id)).toBe(40);
    expect(await jobTotal(shop.id)).toBe(40);
  });

  it("lets only the queue job that carries an item claim it", async () => {
    const { shop, provider, deps } = await setup();
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "claim" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    const itemId = page.itemIds[0]!;
    await withTenant(shop.id, (tx) => tx.translationJobItem.update({ where: { id: itemId }, data: { queueJobId: `${itemId}_requeue2` } }), app);
    // An older round of the same item, still delivered: it does nothing.
    expect(await processItem(deps, { shopId: shop.id, itemId }, 1, `${itemId}_requeue1`)).toEqual({ status: "discarded", reason: "NOT_CLAIMED" });
    expect(provider.billed).toBe(0);
    expect(await processItem(deps, { shopId: shop.id, itemId }, 1, `${itemId}_requeue2`)).toMatchObject({ status: "SUCCEEDED" });
    expect(await ledgerTotal(shop.id)).toBe(provider.billed);
  });

  it("applies the daily cap per shop, never above its monthly allowance", async () => {
    const { shop, provider, deps } = await setup();
    const { job } = await createBulkJob({ shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: "1", idempotencyKey: "daily" }, app);
    const page = await runDiscoveryPage(deps, { shopId: shop.id, jobId: job.id });
    // The environment's daily cap (high) doesn't lift the plan's monthly allowance (low).
    const plan = { configured: true, entitlements: { plan: "starter", monthlyChars: 10, maxTargetLocales: 3, bulk: true, glossary: false, autoPublish: false, smartAuto: false } };
    const limited: JobDependencies = { ...deps, dailyLimit: 1_000_000, billingFor: async () => plan };
    await expect(processItem(limited, { shopId: shop.id, itemId: page.itemIds[0]! }, 1)).rejects.toMatchObject({ name: "QuotaExceededError", limit: 10 });
    // Without an environment cap, the plan's allowance alone applies (no hidden 20,000 a day).
    const generous = { configured: true, entitlements: { ...plan.entitlements, monthlyChars: 1_000_000 } };
    await processItem({ ...deps, dailyLimit: undefined, billingFor: async () => generous }, { shopId: shop.id, itemId: page.itemIds[0]! }, 1);
    expect(await ledgerTotal(shop.id)).toBe(provider.billed);
  });
});
