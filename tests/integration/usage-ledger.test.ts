import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getMonthlyUsage,
  periodKey,
  QuotaExceededError,
  releaseUsage,
  reserveUsage,
  settleUsage,
} from "../../app/.server/usage/usage-ledger";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
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
    await releaseUsage(r, app);
    await releaseUsage(r, app);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(-100);
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

  it("is append-only for the runtime role", async () => {
    const s = await shop();
    await reserveUsage({ shopId: s.id, key: "x", chars: 10, limit: 50, provider: "deepl" }, app);
    await expect(app.$executeRawUnsafe(`DELETE FROM "UsageLedger"`)).rejects.toThrow(/permission denied/);
  });
});
