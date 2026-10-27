import { afterAll, describe, expect, it } from "vitest";
import { TokenBucket } from "../../app/.server/queue/rate-limiter";
import { deletePrefix, testPrefix, testRedis } from "../support/redis";

const redis = testRedis();
const prefix = testPrefix();

afterAll(async () => {
  await deletePrefix(redis, prefix);
  await redis.quit();
});

describe("TokenBucket (Redis)", () => {
  it("grants up to capacity, then asks to wait for the missing tokens", async () => {
    const bucket = new TokenBucket(redis, { capacity: 100, refillPerSecond: 50 });
    const key = `${prefix}:a`;
    expect(await bucket.take(key, 60)).toBe(0);
    const wait = await bucket.take(key, 60);
    // 40 tokens left, 20 missing at 50/s ≈ 400 ms (a few ms may have refilled).
    expect(wait).toBeGreaterThan(300);
    expect(wait).toBeLessThanOrEqual(400);
  });

  it("refills over time", async () => {
    const bucket = new TokenBucket(redis, { capacity: 10, refillPerSecond: 100 });
    const key = `${prefix}:b`;
    expect(await bucket.take(key, 10)).toBe(0);
    expect(await bucket.take(key, 10)).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 150));
    expect(await bucket.take(key, 10)).toBe(0);
  });

  it("keeps separate budgets per key (per shop)", async () => {
    const bucket = new TokenBucket(redis, { capacity: 10, refillPerSecond: 1 });
    expect(await bucket.take(`${prefix}:shop1`, 10)).toBe(0);
    expect(await bucket.take(`${prefix}:shop1`, 10)).toBeGreaterThan(0);
    expect(await bucket.take(`${prefix}:shop2`, 10)).toBe(0);
  });

  it("is atomic under concurrent callers", async () => {
    const bucket = new TokenBucket(redis, { capacity: 100, refillPerSecond: 0.001 });
    const key = `${prefix}:c`;
    const results = await Promise.all(Array.from({ length: 30 }, () => bucket.take(key, 10)));
    expect(results.filter((w) => w === 0)).toHaveLength(10);
  });

  it("rejects a cost larger than the bucket", async () => {
    const bucket = new TokenBucket(redis, { capacity: 10, refillPerSecond: 1 });
    await expect(bucket.take(`${prefix}:d`, 11)).rejects.toThrow(/capacity/);
  });
});
