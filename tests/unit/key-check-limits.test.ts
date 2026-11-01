/**
 * The Own key plan's key checks (app/.server/usage/request-limits.ts): their
 * own minute buckets per staff member and shop, and the KeyCheckBudget of
 * live checks per shop and UTC day and per deployment and hour.
 */
import { describe, expect, it } from "vitest";
import {
  KEY_CHECKS_PER_DAY,
  KEY_CHECKS_REFUSED_PER_DAY,
  KEY_CHECKS_REFUSED_PER_HOUR,
  KeyCheckBudget,
  MemoryBucket,
  MemoryCounters,
  RequestLimiter,
} from "../../app/.server/usage/request-limits";

const SHOP = "11111111-1111-4111-8111-111111111111";

describe("key checks (Own key plan)", () => {
  const SHOP_B = "22222222-2222-4222-8222-222222222222";

  it("has its own buckets per staff member and shop (3 and 6 a minute unless the limits say otherwise)", async () => {
    let now = 0;
    const limiter = new RequestLimiter(
      { userPerMinute: { "ai-translate": 1, "memory-suggest": 1 }, shopPerMinute: { "ai-translate": 1, "memory-suggest": 1 } },
      "lv:unit",
      (capacity, refill) => new MemoryBucket(capacity, refill, () => now),
    );
    for (let i = 0; i < 3; i++) await limiter.consume(SHOP, "a", "key-check");
    await expect(limiter.consume(SHOP, "a", "key-check")).rejects.toMatchObject({ scope: "user" });
    // AI translation keeps its own budget.
    await limiter.consume(SHOP, "a", "ai-translate");
    for (let i = 0; i < 3; i++) await limiter.consume(SHOP, "b", "key-check");
    await expect(limiter.consume(SHOP, "c", "key-check")).rejects.toMatchObject({ scope: "shop" });
    await limiter.consume(SHOP_B, "c", "key-check");
    now += 60_000;
    await limiter.consume(SHOP, "c", "key-check");
  });

  it("takes the configured numbers when given", async () => {
    const limiter = new RequestLimiter(
      { userPerMinute: { "ai-translate": 1, "memory-suggest": 1, "key-check": 1 }, shopPerMinute: { "ai-translate": 1, "memory-suggest": 1, "key-check": 2 } },
      "lv:unit",
      (capacity, refill) => new MemoryBucket(capacity, refill, () => 0),
    );
    await limiter.consume(SHOP, "a", "key-check");
    await expect(limiter.consume(SHOP, "a", "key-check")).rejects.toMatchObject({ scope: "user", retryAfterMs: 60_000 });
    await limiter.consume(SHOP, "b", "key-check");
    await expect(limiter.consume(SHOP, "c", "key-check")).rejects.toMatchObject({ scope: "shop" });
  });
});

describe("KeyCheckBudget (Own key plan: live checks per day and hour)", () => {
  const SHOPS = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
  const start = new Date("2026-11-01T10:15:00Z");

  function budget(now: { at: Date }) {
    const warnings: Array<{ context: unknown; message: string }> = [];
    const log = { warn: (context: unknown, message: string) => void warnings.push({ context, message }) };
    const counters = new MemoryCounters(() => now.at.getTime());
    return { budget: new KeyCheckBudget(counters, "lv:unit", () => now.at, log as never), warnings };
  }

  it("allows 20 live checks per shop and UTC day, then waits for the next day", async () => {
    const now = { at: start };
    const { budget: b } = budget(now);
    for (let i = 0; i < KEY_CHECKS_PER_DAY; i++) expect(await b.allow(SHOP)).toEqual({ ok: true });
    const refused = await b.allow(SHOP);
    expect(refused).toEqual({ ok: false, retryAfterMs: Date.parse("2026-11-02T00:00:00Z") - start.getTime() });
    // Another shop has its own day.
    expect(await b.allow(SHOPS[0]!)).toEqual({ ok: true });
    now.at = new Date("2026-11-02T00:00:01Z");
    expect(await b.allow(SHOP)).toEqual({ ok: true });
  });

  it("allows at most 10 refused or unreachable checks per shop and day, with one warning naming the shop only", async () => {
    const now = { at: start };
    const { budget: b, warnings } = budget(now);
    for (let i = 0; i < KEY_CHECKS_REFUSED_PER_DAY; i++) {
      expect(await b.allow(SHOP)).toEqual({ ok: true });
      await b.noteRefused(SHOP);
    }
    expect(await b.allow(SHOP)).toMatchObject({ ok: false });
    expect(warnings).toEqual([{ context: { shopId: SHOP }, message: "key checks refused: daily cap reached" }]);
    now.at = new Date("2026-11-02T08:00:00Z");
    expect(await b.allow(SHOP)).toEqual({ ok: true });
  });

  it("stops every live check after 100 refused ones in an hour deployment-wide, with one warning", async () => {
    const now = { at: start };
    const { budget: b, warnings } = budget(now);
    for (let i = 0; i < KEY_CHECKS_REFUSED_PER_HOUR; i++) await b.noteRefused(SHOPS[i % 10]!);
    const waiting = await b.allow(SHOPS[11]!);
    expect(waiting).toEqual({ ok: false, retryAfterMs: Date.parse("2026-11-01T11:00:00Z") - start.getTime() });
    expect(await b.allow(SHOPS[10]!)).toMatchObject({ ok: false });
    const deployment = warnings.filter((w) => w.message === "key checks refused deployment-wide");
    expect(deployment).toEqual([{ context: { refused: KEY_CHECKS_REFUSED_PER_HOUR }, message: "key checks refused deployment-wide" }]);
    // The next hour starts afresh (the shops' daily counts stay).
    now.at = new Date("2026-11-01T11:00:00Z");
    expect(await b.allow(SHOPS[11]!)).toEqual({ ok: true });
  });

  it("counts in memory without Redis, keys expiring on their own", async () => {
    let now = 0;
    const counters = new MemoryCounters(() => now);
    expect(await counters.incr("k", 10)).toBe(1);
    expect(await counters.incr("k", 10)).toBe(2);
    expect(await counters.get("k")).toBe(2);
    expect(await counters.once("w", 10)).toBe(true);
    expect(await counters.once("w", 10)).toBe(false);
    now += 10_000;
    expect(await counters.get("k")).toBe(0);
    expect(await counters.once("w", 10)).toBe(true);
  });

  it("refuses keys for anything but a shop UUID", async () => {
    const { budget: b } = budget({ at: start });
    await expect(b.allow("shop:*")).rejects.toThrow(/UUID/);
    await expect(b.noteRefused("shop:*")).rejects.toThrow(/UUID/);
  });
});
