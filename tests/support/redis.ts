import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/** A dedicated key prefix per test file, removed afterwards. */
export function testPrefix(): string {
  return `lv:test:${randomUUID().slice(0, 8)}`;
}

export function testRedis(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}

export async function deletePrefix(redis: Redis, prefix: string) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}:*`, "COUNT", 500);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== "0");
}

/** Polls until `check` returns true or the timeout passes. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor: condition not met in time");
}
