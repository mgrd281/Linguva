import { describe, expect, it } from "vitest";
import { MemoryBucket, RequestLimiter, RequestRateLimitedError } from "../../app/.server/usage/request-limits";

const SHOP = "11111111-1111-4111-8111-111111111111";

describe("MemoryBucket", () => {
  it("allows a burst up to capacity, then refills over time", async () => {
    let now = 0;
    const bucket = new MemoryBucket(3, 1, () => now);
    expect([await bucket.take("k", 1), await bucket.take("k", 1), await bucket.take("k", 1)]).toEqual([0, 0, 0]);
    expect(await bucket.take("k", 1)).toBe(1000);
    now += 1000;
    expect(await bucket.take("k", 1)).toBe(0);
    expect(await bucket.take("other", 1)).toBe(0);
  });
});

describe("RequestLimiter", () => {
  it("reports which limit was hit and how long to wait", async () => {
    let now = 0;
    const limiter = new RequestLimiter(
      { userPerMinute: { "ai-translate": 1, "memory-suggest": 1 }, shopPerMinute: { "ai-translate": 2, "memory-suggest": 2 } },
      "lv:unit",
      (capacity, refill) => new MemoryBucket(capacity, refill, () => now),
    );
    await limiter.consume(SHOP, "a", "ai-translate");
    const error = await limiter.consume(SHOP, "a", "ai-translate").catch((e) => e);
    expect(error).toBeInstanceOf(RequestRateLimitedError);
    expect(error).toMatchObject({ scope: "user", retryAfterMs: 60_000 });
    await limiter.consume(SHOP, "b", "ai-translate");
    await expect(limiter.consume(SHOP, "c", "ai-translate")).rejects.toMatchObject({ scope: "shop" });
    now += 60_000;
    await limiter.consume(SHOP, "a", "ai-translate");
  });

  it("refuses keys for anything but a shop UUID", async () => {
    const limiter = new RequestLimiter(
      { userPerMinute: { "ai-translate": 1, "memory-suggest": 1 }, shopPerMinute: { "ai-translate": 1, "memory-suggest": 1 } },
      "lv:unit",
      (capacity, refill) => new MemoryBucket(capacity, refill),
    );
    await expect(limiter.consume("shop:*", "a", "ai-translate")).rejects.toThrow(/UUID/);
  });
});
