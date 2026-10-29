/**
 * Request rate limits for interactive, cost-bearing actions (AI translation,
 * memory suggestions): one token bucket per staff member and one per shop,
 * shared by all app instances through Redis.
 */
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { getConfig } from "../lib/config";
import { createRedis, keyPrefix, shopKey } from "../queue/redis";
import { TokenBucket } from "../queue/rate-limiter";

export type LimitedAction = "ai-translate" | "memory-suggest";

export class RequestRateLimitedError extends Error {
  constructor(
    readonly scope: "user" | "shop",
    readonly retryAfterMs: number,
  ) {
    super(`Too many requests (${scope}); retry in ${retryAfterMs}ms`);
    this.name = "RequestRateLimitedError";
  }
}

interface Bucket {
  take(key: string, cost: number): Promise<number>;
}

/** Same semantics as TokenBucket, for one process (development without Redis). */
export class MemoryBucket implements Bucket {
  private readonly state = new Map<string, { tokens: number; ts: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  async take(key: string, cost: number): Promise<number> {
    const now = this.now();
    const s = this.state.get(key) ?? { tokens: this.capacity, ts: now };
    const tokens = Math.min(this.capacity, s.tokens + ((now - s.ts) / 1000) * this.refillPerSecond);
    if (tokens >= cost) {
      this.state.set(key, { tokens: tokens - cost, ts: now });
      return 0;
    }
    this.state.set(key, { tokens, ts: now });
    return Math.ceil(((cost - tokens) / this.refillPerSecond) * 1000);
  }
}

export interface RequestLimits {
  /** Requests per minute per staff member, by action. */
  userPerMinute: Record<LimitedAction, number>;
  /** Requests per minute per shop, by action. */
  shopPerMinute: Record<LimitedAction, number>;
}

/** Staff ids are hashed so Redis keys don't carry personal identifiers. */
const actorPart = (actorId: string | null) =>
  actorId ? createHash("sha256").update(actorId).digest("hex").slice(0, 32) : "unknown";

export class RequestLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limits: RequestLimits,
    private readonly prefix: string,
    private readonly makeBucket: (capacity: number, refillPerSecond: number) => Bucket,
  ) {}

  private bucket(scope: "user" | "shop", action: LimitedAction): Bucket {
    const perMinute = (scope === "user" ? this.limits.userPerMinute : this.limits.shopPerMinute)[action];
    const id = `${scope}:${action}`;
    let bucket = this.buckets.get(id);
    if (!bucket) {
      bucket = this.makeBucket(perMinute, perMinute / 60);
      this.buckets.set(id, bucket);
    }
    return bucket;
  }

  /**
   * Consumes one request for the staff member and the shop, or throws
   * RequestRateLimitedError with the time to wait. The per-user limit is
   * checked first, so one person can't use up the shop's whole budget.
   */
  async consume(shopId: string, actorId: string | null, action: LimitedAction): Promise<void> {
    const userWait = await this.bucket("user", action).take(
      shopKey(this.prefix, shopId, "rl", action, "user", actorPart(actorId)),
      1,
    );
    if (userWait > 0) throw new RequestRateLimitedError("user", userWait);
    const shopWait = await this.bucket("shop", action).take(shopKey(this.prefix, shopId, "rl", action, "shop"), 1);
    if (shopWait > 0) throw new RequestRateLimitedError("shop", shopWait);
  }
}

export function createRedisRequestLimiter(redis: Redis, prefix: string, limits: RequestLimits) {
  return new RequestLimiter(
    limits,
    prefix,
    (capacity, refillPerSecond) => new TokenBucket(redis, { capacity, refillPerSecond }),
  );
}

let limiter: RequestLimiter | undefined;

/** The app's limiter: Redis when configured (required in production). */
export function getRequestLimiter(): RequestLimiter {
  if (limiter) return limiter;
  const config = getConfig();
  const limits: RequestLimits = {
    userPerMinute: {
      "ai-translate": config.AI_USER_REQUESTS_PER_MINUTE,
      "memory-suggest": config.MEMORY_SUGGESTIONS_PER_MINUTE,
    },
    shopPerMinute: {
      "ai-translate": config.AI_SHOP_REQUESTS_PER_MINUTE,
      "memory-suggest": config.MEMORY_SUGGESTIONS_PER_MINUTE * 3,
    },
  };
  const prefix = keyPrefix(config.NODE_ENV);
  limiter = config.REDIS_URL
    ? createRedisRequestLimiter(createRedis(config.REDIS_URL), prefix, limits)
    : new RequestLimiter(limits, prefix, (capacity, refill) => new MemoryBucket(capacity, refill));
  return limiter;
}
