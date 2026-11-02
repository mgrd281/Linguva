import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chargeForFailure, chargeForResult } from "../../app/.server/usage/engine-charge";
import { TranslationProviderError } from "../../app/.server/providers/types";
import {
  getDailyUsage,
  getMonthlyUsage,
  getMonthlyUsageByProvider,
  getOriginUsageSince,
  getOwnKeyUsage,
  periodKey,
  QuotaExceededError,
  releaseUsage,
  reserveUsage,
  settleUsage,
} from "../../app/.server/usage/usage-ledger";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function shop(domain = "usage.myshopify.com") {
  return (await upsertInstalledShop({ shopDomain: domain }, app)).shop;
}

describe("usage ledger", () => {
  it("formats periods as UTC months", () => {
    expect(periodKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(periodKey(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });

  it("reserves, settles to actual usage and releases on failure", async () => {
    const s = await shop();
    const r1 = await reserveUsage({ shopId: s.id, key: "job-1", chars: 1000, limit: 5000, provider: "deepl" }, app);
    await settleUsage(r1, 800, app);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(800);

    const r2 = await reserveUsage({ shopId: s.id, key: "job-2", chars: 500, limit: 5000, provider: "deepl" }, app);
    await releaseUsage(r2, app);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(800);
  });

  it("is idempotent per key", async () => {
    const s = await shop();
    const input = { shopId: s.id, key: "job-1", chars: 1000, limit: 5000, provider: "deepl" };
    const r = await reserveUsage(input, app);
    await reserveUsage(input, app);
    await settleUsage(r, 900, app);
    await settleUsage(r, 900, app);
    // Once settled, a release (an error after the provider call) doesn't undo billed usage.
    await releaseUsage(r, app);
    await releaseUsage(r, app);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(900);
  });

  it("releases an unsettled reservation once, and keeps a settled one even without a difference", async () => {
    const s = await shop();
    const failed = await reserveUsage({ shopId: s.id, key: "failed", chars: 700, limit: 5000, provider: "deepl" }, app);
    await releaseUsage(failed, app);
    await releaseUsage(failed, app);
    const exact = await reserveUsage({ shopId: s.id, key: "exact", chars: 300, limit: 5000, provider: "deepl" }, app);
    await settleUsage(exact, 300, app);
    await releaseUsage(exact, app);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(300);
  });

  it("rejects reservations over the limit", async () => {
    const s = await shop();
    await reserveUsage({ shopId: s.id, key: "a", chars: 4000, limit: 5000, provider: "deepl" }, app);
    await expect(
      reserveUsage({ shopId: s.id, key: "b", chars: 1001, limit: 5000, provider: "deepl" }, app),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("never overshoots the limit under concurrent reservations", async () => {
    const s = await shop();
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reserveUsage({ shopId: s.id, key: `p-${i}`, chars: 3000, limit: 20000, provider: "deepl" }, app),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(6);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(18000);
  });

  it("keeps usage separate per shop", async () => {
    const a = await shop("a.myshopify.com");
    const b = await shop("b.myshopify.com");
    await reserveUsage({ shopId: a.id, key: "x", chars: 4000, limit: 5000, provider: "deepl" }, app);
    await reserveUsage({ shopId: b.id, key: "x", chars: 4000, limit: 5000, provider: "deepl" }, app);
    expect(await getMonthlyUsage(a.id, undefined, app)).toBe(4000);
    expect(await getMonthlyUsage(b.id, undefined, app)).toBe(4000);
  });

  it("counts a settle or release in the reservation's window, also when it comes after the window ended", async () => {
    const s = await shop();
    const budget = (since: Date) => ({ origin: "smart" as const, daily: { limit: 1_000, since } });
    const before = new Date(Date.now() - 3_600_000);
    // Reserved just before (local) midnight, corrected just after it.
    const late = await reserveUsage({ shopId: s.id, key: "late-1", chars: 800, limit: 1_000_000, provider: "deepl", budget: budget(before) }, app);
    const lower = await reserveUsage({ shopId: s.id, key: "late-2", chars: 150, limit: 1_000_000, provider: "deepl", budget: budget(before) }, app);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const midnight = new Date();
    await releaseUsage(late, app);
    await settleUsage(lower, 50, app);
    expect(await getOriginUsageSince(s.id, "smart", midnight, app)).toBe(0);
    expect(await getOriginUsageSince(s.id, "smart", before, app)).toBe(50);
    // The new day starts at zero: its budget holds.
    await reserveUsage({ shopId: s.id, key: "today-1", chars: 1_000, limit: 1_000_000, provider: "deepl", budget: budget(midnight) }, app);
    await expect(reserveUsage({ shopId: s.id, key: "today-2", chars: 1, limit: 1_000_000, provider: "deepl", budget: budget(midnight) }, app)).rejects.toMatchObject({
      scope: "smartDaily",
    });
  });

  it("is append-only for the runtime role", async () => {
    const s = await shop();
    await reserveUsage({ shopId: s.id, key: "x", chars: 10, limit: 50, provider: "deepl" }, app);
    await expect(app.$executeRawUnsafe(`DELETE FROM "UsageLedger"`)).rejects.toThrow(/permission denied/);
  });
});

describe("usage per engine", () => {
  async function platformToday(): Promise<number> {
    const rows = await ownerDb.$queryRaw<Array<{ chars: bigint }>>`SELECT "chars" FROM "PlatformUsageDay" WHERE "day" = (now() AT TIME ZONE 'UTC')::date`;
    return Number(rows[0]?.chars ?? 0);
  }
  // The ledger is a forced-RLS tenant table: read inside the tenant.
  const rows = (shopId: string) =>
    withTenant(
      shopId,
      (tx) => tx.usageLedger.findMany({ where: { shopId }, orderBy: [{ createdAt: "asc" }, { idempotencyKey: "asc" }], select: { kind: true, chars: true, provider: true, idempotencyKey: true } }),
      app,
    );

  it("writes today's single settle row when the planned engine answered", async () => {
    const s = await shop();
    const r = await reserveUsage({ shopId: s.id, key: "one", chars: 1000, limit: 5000, provider: "deepl" }, app);
    await settleUsage(r, 800, app, chargeForResult({ provider: "deepl", billedCharacters: 800 }));
    expect((await rows(s.id)).map((row) => [row.kind, row.chars, row.provider, row.idempotencyKey])).toEqual([
      ["RESERVE", 1000, "deepl", "one"],
      ["ADJUST", -200, "deepl", "one:settle"],
    ]);
    expect(await platformToday()).toBe(800);
  });

  it("moves the charge to the engine that answered", async () => {
    const s = await shop();
    const r = await reserveUsage({ shopId: s.id, key: "fo", chars: 1000, limit: 5000, provider: "deepl" }, app);
    await settleUsage(r, 900, app, chargeForResult({ provider: "azure", billedCharacters: 900 }));
    expect((await rows(s.id)).map((row) => [row.kind, row.chars, row.provider, row.idempotencyKey])).toEqual([
      ["RESERVE", 1000, "deepl", "fo"],
      ["ADJUST", -1000, "deepl", "fo:settle"],
      ["ADJUST", 900, "azure", "fo:settle:azure"],
    ]);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(900);
    expect(await getMonthlyUsageByProvider(s.id, undefined, app)).toEqual({ deepl: 0, azure: 900 });
    // Settled: a later release changes nothing, and a second settle neither.
    await releaseUsage(r, app);
    await settleUsage(r, 900, app, chargeForResult({ provider: "azure", billedCharacters: 900 }));
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(900);
  });

  it("charges the shop only Azure's count after DeepL's quota ran out mid-request; the platform counts DeepL's partial too", async () => {
    const s = await shop();
    const r = await reserveUsage({ shopId: s.id, key: "mid", chars: 1000, limit: 5000, provider: "deepl" }, app);
    // DeepL billed 400 for its first batch, then its quota was used up; Azure translated everything (950).
    await settleUsage(r, 950, app, chargeForResult({ provider: "azure", billedCharacters: 950, lostByEngine: { deepl: 400 } }));
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(950);
    expect(await platformToday()).toBe(1350);
  });

  it("charges at most the reservation when every engine failed", async () => {
    const s = await shop();
    const r = await reserveUsage({ shopId: s.id, key: "all", chars: 1000, limit: 5000, provider: "deepl" }, app);
    const error = new TranslationProviderError("azure", "retryable", "fake");
    error.billedCharacters = 1500;
    error.billedByEngine = { deepl: 700, azure: 800 };
    const charge = chargeForFailure(error, r.chars, r.provider);
    await settleUsage(r, 1000, app, charge);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(1000);
    expect(await getMonthlyUsageByProvider(s.id, undefined, app)).toEqual({ deepl: 700, azure: 300 });
    expect(await platformToday()).toBe(1500);
  });
});

describe("usage paid by the merchant (Own key plan, payer 'merchant')", () => {
  const platformRows = () => ownerDb.platformUsageDay.findMany();
  const rows = (shopId: string) =>
    withTenant(
      shopId,
      (tx) =>
        tx.usageLedger.findMany({
          where: { shopId },
          orderBy: [{ createdAt: "asc" }, { idempotencyKey: "asc" }],
          select: { kind: true, chars: true, provider: true, idempotencyKey: true, origin: true, payer: true },
        }),
      app,
    );

  it("skips the monthly allowance, the daily cap, the smart budgets and the platform cap", async () => {
    const s = await shop();
    const budget = { origin: "smart" as const, daily: { limit: 1, since: new Date(0) }, monthly: { limit: 1, since: new Date(0) } };
    const r = await reserveUsage(
      { shopId: s.id, key: "own-1", chars: 50_000, limit: 0, provider: "deepl", dailyLimit: 1, platformDailyLimit: 1, budget, payer: "merchant" },
      app,
    );
    expect(r).toMatchObject({ key: "own-1", chars: 50_000, provider: "deepl", payer: "merchant" });
    // Never a smart row: the budget is ignored for the merchant's own keys.
    expect(r).not.toHaveProperty("origin");
    expect(await rows(s.id)).toEqual([{ kind: "RESERVE", chars: 50_000, provider: "deepl", idempotencyKey: "own-1", origin: null, payer: "merchant" }]);
    expect(await platformRows()).toEqual([]);
    // The same request on Linguva's engines is refused at the allowance.
    await expect(reserveUsage({ shopId: s.id, key: "linguva-1", chars: 1, limit: 0, provider: "deepl" }, app)).rejects.toMatchObject({ scope: "monthly" });
  });

  it("writes the payer on reserve, settle, :settle:<engine> and release rows and never touches PlatformUsageDay", async () => {
    const s = await shop();
    const one = await reserveUsage({ shopId: s.id, key: "a", chars: 1000, limit: 0, provider: "deepl", payer: "merchant" }, app);
    await settleUsage(one, 800, app, chargeForResult({ provider: "deepl", billedCharacters: 800 }));
    const moved = await reserveUsage({ shopId: s.id, key: "b", chars: 1000, limit: 0, provider: "deepl", payer: "merchant" }, app);
    // The merchant's DeepL key billed 400 and ran out; its Google key translated everything.
    await settleUsage(moved, 950, app, chargeForResult({ provider: "google", billedCharacters: 950, lostByEngine: { deepl: 400 } }));
    const failed = await reserveUsage({ shopId: s.id, key: "c", chars: 300, limit: 0, provider: "azure", payer: "merchant" }, app);
    await releaseUsage(failed, app);
    // A release after the settlement changes nothing.
    await releaseUsage(one, app);

    const all = await rows(s.id);
    expect(all.map((row) => [row.kind, row.chars, row.provider, row.idempotencyKey])).toEqual([
      ["RESERVE", 1000, "deepl", "a"],
      ["ADJUST", -200, "deepl", "a:settle"],
      ["RESERVE", 1000, "deepl", "b"],
      ["ADJUST", -1000, "deepl", "b:settle"],
      ["ADJUST", 950, "google", "b:settle:google"],
      ["RESERVE", 300, "azure", "c"],
      ["RELEASE", -300, "azure", "c:release"],
    ]);
    expect(all.every((row) => row.payer === "merchant" && row.origin === null)).toBe(true);
    // No platform row at all: neither the reservations, the settlements, the lost partial nor the release.
    expect(await platformRows()).toEqual([]);
    expect(await getOwnKeyUsage(s.id, undefined, app)).toEqual({ total: 1750, byEngine: { deepl: 800, google: 950, azure: 0 } });
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(0);
  });

  it("returns the payer for a repeated reservation and counts it once", async () => {
    const s = await shop();
    const input = { shopId: s.id, key: "again", chars: 700, limit: 0, provider: "deepl", payer: "merchant" as const };
    const first = await reserveUsage(input, app);
    const second = await reserveUsage(input, app);
    expect(second).toEqual(first);
    expect(second.payer).toBe("merchant");
    // A retry after a plan change keeps the original reservation (and its payer), as for every idempotent retry.
    expect(await reserveUsage({ shopId: s.id, key: "again", chars: 700, limit: 5000, provider: "deepl" }, app)).toMatchObject({ key: "again", payer: "merchant" });
    expect(await rows(s.id)).toHaveLength(1);
    expect(await getOwnKeyUsage(s.id, undefined, app)).toEqual({ total: 700, byEngine: { deepl: 700 } });
    // And a Linguva reservation stays Linguva's on retry with the merchant payer.
    await reserveUsage({ shopId: s.id, key: "theirs", chars: 10, limit: 5000, provider: "deepl" }, app);
    expect(await reserveUsage({ shopId: s.id, key: "theirs", chars: 10, limit: 5000, provider: "deepl", payer: "merchant" }, app)).not.toHaveProperty("payer");
  });

  it("leaves Linguva's allowance, daily cap, platform cap and cost sums to Linguva's rows", async () => {
    const s = await shop();
    const own = await reserveUsage({ shopId: s.id, key: "own", chars: 9000, limit: 0, provider: "google", payer: "merchant" }, app);
    await settleUsage(own, 9000, app);
    // 9,000 merchant characters don't use a 5,000 allowance, a 4,500 daily cap or a 5,000 platform cap.
    const linguva = await reserveUsage({ shopId: s.id, key: "lv-1", chars: 4000, limit: 5000, provider: "deepl", dailyLimit: 4500, platformDailyLimit: 5000 }, app);
    await settleUsage(linguva, 4000, app);
    await reserveUsage({ shopId: s.id, key: "lv-2", chars: 400, limit: 5000, provider: "deepl", dailyLimit: 4500, platformDailyLimit: 5000 }, app);
    await expect(
      reserveUsage({ shopId: s.id, key: "lv-3", chars: 101, limit: 1_000_000, provider: "deepl", dailyLimit: 4500 }, app),
    ).rejects.toMatchObject({ scope: "daily", used: 4400 });
    await expect(reserveUsage({ shopId: s.id, key: "lv-4", chars: 601, limit: 5000, provider: "deepl" }, app)).rejects.toMatchObject({
      scope: "monthly",
      used: 4400,
    });

    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(4400);
    expect(await getDailyUsage(s.id, app)).toBe(4400);
    expect(await getMonthlyUsageByProvider(s.id, undefined, app)).toEqual({ deepl: 4400 });
    expect(await getOwnKeyUsage(s.id, undefined, app)).toEqual({ total: 9000, byEngine: { google: 9000 } });
    const [platform] = await platformRows();
    expect(Number(platform!.chars)).toBe(4400);
  });

  it("counts own-key usage per period and per shop, and nothing for a shop on Linguva's engines", async () => {
    const a = await shop("own-a.myshopify.com");
    const b = await shop("own-b.myshopify.com");
    await reserveUsage({ shopId: a.id, key: "x", chars: 120, limit: 0, provider: "azure", payer: "merchant" }, app);
    await reserveUsage({ shopId: b.id, key: "x", chars: 999, limit: 5000, provider: "deepl" }, app);
    expect(await getOwnKeyUsage(a.id, undefined, app)).toEqual({ total: 120, byEngine: { azure: 120 } });
    expect(await getOwnKeyUsage(a.id, "1999-01", app)).toEqual({ total: 0, byEngine: {} });
    expect(await getOwnKeyUsage(b.id, undefined, app)).toEqual({ total: 0, byEngine: {} });
    expect(await getMonthlyUsage(a.id, undefined, app)).toBe(0);
  });

  it("writes NULL as the payer of every row on Linguva's engines (the existing sums match every existing row)", async () => {
    const s = await shop();
    const settled = await reserveUsage({ shopId: s.id, key: "p", chars: 1000, limit: 5000, provider: "deepl" }, app);
    await settleUsage(settled, 900, app, chargeForResult({ provider: "azure", billedCharacters: 900 }));
    const released = await reserveUsage({ shopId: s.id, key: "q", chars: 100, limit: 5000, provider: "deepl" }, app);
    await releaseUsage(released, app);
    expect(settled).not.toHaveProperty("payer");
    const all = await rows(s.id);
    expect(all).toHaveLength(5);
    expect(all.every((row) => row.payer === null)).toBe(true);
  });
});
