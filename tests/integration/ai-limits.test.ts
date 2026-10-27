import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import {
  createRedisRequestLimiter,
  RequestRateLimitedError,
} from "../../app/.server/usage/request-limits";
import {
  getDailyUsage,
  QuotaExceededError,
  releaseUsage,
  reserveUsage,
  settleUsage,
} from "../../app/.server/usage/usage-ledger";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";
import { deletePrefix, testPrefix, testRedis } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const prefix = testPrefix();

beforeEach(resetDatabase);
afterAll(async () => {
  await deletePrefix(redis, prefix);
  await redis.quit();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const shop = async (domain: string) => (await upsertInstalledShop({ shopDomain: domain }, app)).shop;

async function platformToday(): Promise<number> {
  const rows = await ownerDb.$queryRaw<Array<{ chars: bigint }>>`
    SELECT "chars" FROM "PlatformUsageDay" WHERE "day" = (now() AT TIME ZONE 'UTC')::date`;
  return Number(rows[0]?.chars ?? 0);
}

const reserve = (shopId: string, key: string, chars: number, extra: Partial<Parameters<typeof reserveUsage>[0]> = {}) =>
  reserveUsage({ shopId, key, chars, limit: 1_000_000, provider: "mock", ...extra }, app);

describe("daily and platform AI character caps", () => {
  it("enforces the shop's daily cap separately from the monthly allowance", async () => {
    const s = await shop("daily.myshopify.com");
    await reserve(s.id, "a", 600, { dailyLimit: 1000 });
    const error = await reserve(s.id, "b", 500, { dailyLimit: 1000 }).catch((e) => e);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toMatchObject({ scope: "daily", used: 600, limit: 1000 });
    await reserve(s.id, "c", 400, { dailyLimit: 1000 });
    expect(await getDailyUsage(s.id, app)).toBe(1000);
  });

  it("caps all shops together, and frees capacity on release", async () => {
    const a = await shop("pa.myshopify.com");
    const b = await shop("pb.myshopify.com");
    const ra = await reserve(a.id, "a1", 700, { platformDailyLimit: 1000 });
    await expect(reserve(b.id, "b1", 400, { platformDailyLimit: 1000 })).rejects.toMatchObject({ scope: "platform" });
    await releaseUsage(ra, app);
    await reserve(b.id, "b1", 400, { platformDailyLimit: 1000 });
    expect(await platformToday()).toBe(400);
  });

  it("tracks settlement and counts a repeated reservation once", async () => {
    const s = await shop("settle.myshopify.com");
    const r = await reserve(s.id, "x", 500, { platformDailyLimit: 10_000 });
    await reserve(s.id, "x", 500, { platformDailyLimit: 10_000 });
    expect(await platformToday()).toBe(500);
    await settleUsage(r, 320, app);
    await settleUsage(r, 320, app);
    expect(await platformToday()).toBe(320);
  });

  it("doesn't count a reservation the shop's own limit refused", async () => {
    const s = await shop("refused.myshopify.com");
    await expect(reserve(s.id, "big", 2000, { limit: 1000, platformDailyLimit: 10_000 })).rejects.toMatchObject({
      scope: "monthly",
    });
    expect(await platformToday()).toBe(0);
  });

  it("never overshoots the platform cap under concurrency across shops", async () => {
    const shops = await Promise.all([1, 2, 3, 4, 5].map((i) => shop(`c${i}.myshopify.com`)));
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => reserve(shops[i % 5]!.id, `k${i}`, 100, { platformDailyLimit: 1000 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.scope === "platform")).toBe(true);
    expect(await platformToday()).toBe(1000);
  });

  it("stops a bulk job with DAILY_LIMIT, and it can resume later", async () => {
    const s = await shop("bulk-daily.myshopify.com");
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    await setBulkPublishMode({ shopId: s.id, mode: "AUTO_PUBLISH", confirmed: true, actorId: "1" }, app);
    const store = new FakeShopifyStore(5);
    const deps: JobDependencies = {
      prisma: app,
      adminFor: async () => store.asAdmin(),
      provider: new MockTranslationProvider(),
      monthlyLimit: 1_000_000,
      // About two products' worth of text per day.
      dailyLimit: 80,
      keyPrefix: prefix,
    };
    const { job } = await createBulkJob(
      { shopId: s.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: null, idempotencyKey: "daily-1" },
      app,
    );
    const page = await runDiscoveryPage(deps, { shopId: s.id, jobId: job.id });
    const outcomes = [];
    for (const id of page.itemIds) {
      try {
        outcomes.push(await processItem(deps, { shopId: s.id, itemId: id }, 1));
      } catch (error) {
        outcomes.push({ error: (error as QuotaExceededError).scope });
        break;
      }
    }
    expect(outcomes.at(-1)).toEqual({ error: "daily" });
    expect(await getDailyUsage(s.id, app)).toBeLessThanOrEqual(80);
    const translated = [1, 2, 3, 4, 5].filter((i) => store.translationOf(`gid://shopify/Product/${i}`, "de", "title"));
    expect(translated.length).toBeGreaterThan(0);
    expect(translated.length).toBeLessThan(5);
    const row = await withTenant(s.id, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), app);
    expect(row.status).not.toBe("COMPLETED");
  });
});

describe("per-user and per-shop request limits (Redis)", () => {
  const limits = {
    userPerMinute: { "ai-translate": 3, "memory-suggest": 5 },
    shopPerMinute: { "ai-translate": 5, "memory-suggest": 10 },
  };
  const SHOP_A = "11111111-1111-4111-8111-111111111111";
  const SHOP_B = "22222222-2222-4222-8222-222222222222";

  it("limits one staff member, then the whole shop, and keeps shops apart", async () => {
    const limiter = createRedisRequestLimiter(redis, `${prefix}:a`, limits);
    for (let i = 0; i < 3; i++) await limiter.consume(SHOP_A, "staff-1", "ai-translate");
    const userError = await limiter.consume(SHOP_A, "staff-1", "ai-translate").catch((e) => e);
    expect(userError).toBeInstanceOf(RequestRateLimitedError);
    expect(userError).toMatchObject({ scope: "user" });
    expect(userError.retryAfterMs).toBeGreaterThan(0);
    expect(userError.retryAfterMs).toBeLessThanOrEqual(20_000);

    await limiter.consume(SHOP_A, "staff-2", "ai-translate");
    await limiter.consume(SHOP_A, "staff-2", "ai-translate");
    // A request refused for the user never reaches the shop bucket: 3 + 2 = the shop's 5.
    await expect(limiter.consume(SHOP_A, "staff-3", "ai-translate")).rejects.toMatchObject({ scope: "shop" });

    // Other shops and other actions have their own budgets.
    await limiter.consume(SHOP_B, "staff-1", "ai-translate");
    await limiter.consume(SHOP_A, "staff-1", "memory-suggest");
  });

  it("is shared by all app instances", async () => {
    const one = createRedisRequestLimiter(redis, `${prefix}:b`, limits);
    const two = createRedisRequestLimiter(redis, `${prefix}:b`, limits);
    await one.consume(SHOP_A, "staff-1", "ai-translate");
    await two.consume(SHOP_A, "staff-1", "ai-translate");
    await one.consume(SHOP_A, "staff-1", "ai-translate");
    await expect(two.consume(SHOP_A, "staff-1", "ai-translate")).rejects.toMatchObject({ scope: "user" });
  });

  it("stores no staff identifiers in Redis keys", async () => {
    const limiter = createRedisRequestLimiter(redis, `${prefix}:c`, limits);
    await limiter.consume(SHOP_A, "staff-secret-id-42", "ai-translate");
    const keys = await redis.keys(`${prefix}:c:*`);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join(" ")).not.toContain("staff-secret-id-42");
  });
});
