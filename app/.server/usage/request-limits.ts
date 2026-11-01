/**
 * Request rate limits for interactive, cost-bearing actions (AI translation,
 * memory suggestions, the Own key plan's key checks): one token bucket per
 * staff member and one per shop, shared by all app instances through Redis.
 * Key checks also have a daily and an hourly budget (KeyCheckBudget).
 */
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { getConfig } from "../lib/config";
import { logger } from "../lib/logger";
import { createRedis, keyPrefix, shopKey } from "../queue/redis";
import { TokenBucket } from "../queue/rate-limiter";

export type LimitedAction = "ai-translate" | "memory-suggest" | "key-check";

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

/** Per action; key checks may be left out (then KEY_CHECKS_PER_MINUTE: 3 per staff member, 6 per shop). */
type PerMinute = Record<Exclude<LimitedAction, "key-check">, number> & { "key-check"?: number };

export interface RequestLimits {
  /** Requests per minute per staff member, by action. */
  userPerMinute: PerMinute;
  /** Requests per minute per shop, by action. */
  shopPerMinute: PerMinute;
}

/** Key checks a minute when a limits object doesn't name them: per staff member, and the shop gets twice as many. */
export const KEY_CHECKS_PER_MINUTE = 3;

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
    const perMinute =
      (scope === "user" ? this.limits.userPerMinute : this.limits.shopPerMinute)[action] ??
      (scope === "user" ? KEY_CHECKS_PER_MINUTE : KEY_CHECKS_PER_MINUTE * 2);
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
      "key-check": config.OWN_KEY_CHECKS_PER_MINUTE,
    },
    shopPerMinute: {
      "ai-translate": config.AI_SHOP_REQUESTS_PER_MINUTE,
      "memory-suggest": config.MEMORY_SUGGESTIONS_PER_MINUTE * 3,
      "key-check": config.OWN_KEY_CHECKS_PER_MINUTE * 2,
    },
  };
  const prefix = keyPrefix(config.NODE_ENV);
  limiter = config.REDIS_URL
    ? createRedisRequestLimiter(createRedis(config.REDIS_URL), prefix, limits)
    : new RequestLimiter(limits, prefix, (capacity, refill) => new MemoryBucket(capacity, refill));
  return limiter;
}

/** Live key checks per shop and UTC day (Own key plan, docs/SECURITY_MODEL.md §2). */
export const KEY_CHECKS_PER_DAY = 20;
/** Of a shop's live checks per UTC day, at most this many may be refused or unreachable. */
export const KEY_CHECKS_REFUSED_PER_DAY = 10;
/** Refused or unreachable live checks per deployment and UTC hour; above that every live check waits. */
export const KEY_CHECKS_REFUSED_PER_HOUR = 100;

const DAY_TTL_SECONDS = 2 * 24 * 3600;
const HOUR_TTL_SECONDS = 2 * 3600;

/** Counters that expire on their own: Redis (INCR + EXPIRE) or one process's memory. */
export interface Counters {
  get(key: string): Promise<number>;
  /** Adds one and returns the new count; the key expires `ttlSeconds` after its last increment. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** True only for the first call with this key until it expires. */
  once(key: string, ttlSeconds: number): Promise<boolean>;
}

export class RedisCounters implements Counters {
  constructor(private readonly redis: Pick<Redis, "get" | "multi" | "set">) {}

  async get(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds).exec();
    const [error, value] = results?.[0] ?? [new Error("no reply"), null];
    if (error) throw error;
    return Number(value);
  }

  async once(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK";
  }
}

/** The same counters for one process (development without Redis). */
export class MemoryCounters implements Counters {
  private readonly state = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private current(key: string) {
    const entry = this.state.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.state.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<number> {
    return this.current(key)?.count ?? 0;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = (this.current(key)?.count ?? 0) + 1;
    this.state.set(key, { count, expiresAt: this.now() + ttlSeconds * 1000 });
    return count;
  }

  async once(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.current(key)) return false;
    this.state.set(key, { count: 1, expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }
}

export type KeyCheckAllowance = { ok: true } | { ok: false; retryAfterMs: number };

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const utcHour = (now: Date) => now.toISOString().slice(0, 13);
const toNextUtcDay = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
const toNextUtcHour = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1) - now.getTime();

/**
 * The Own key plan's budget of live key checks, next to the minute buckets (which alone would
 * allow thousands of checks a day): per shop and UTC day at most KEY_CHECKS_PER_DAY, of which at
 * most KEY_CHECKS_REFUSED_PER_DAY refused or unreachable; per deployment and UTC hour at most
 * KEY_CHECKS_REFUSED_PER_HOUR refused or unreachable, then every live check waits for the next
 * hour. Mock mode never asks (no outbound call). Logs carry the shop id and counts only.
 */
export class KeyCheckBudget {
  constructor(
    private readonly counters: Counters,
    private readonly prefix: string,
    private readonly now: () => Date = () => new Date(),
    private readonly log: Pick<typeof logger, "warn"> = logger,
  ) {}

  private refusedHourKey(now: Date) {
    return `${this.prefix}:key-checks:refused:${utcHour(now)}`;
  }

  /** Before a live check: counts it, or says how long to wait (to the next UTC hour or day). */
  async allow(shopId: string): Promise<KeyCheckAllowance> {
    const now = this.now();
    const refusedThisHour = await this.counters.get(this.refusedHourKey(now));
    if (refusedThisHour >= KEY_CHECKS_REFUSED_PER_HOUR) {
      if (await this.counters.once(`${this.prefix}:key-checks:warned:${utcHour(now)}`, HOUR_TTL_SECONDS)) {
        this.log.warn({ refused: refusedThisHour }, "key checks refused deployment-wide");
      }
      return { ok: false, retryAfterMs: toNextUtcHour(now) };
    }
    const day = utcDay(now);
    if ((await this.counters.get(shopKey(this.prefix, shopId, "kc", "refused", day))) >= KEY_CHECKS_REFUSED_PER_DAY) {
      return { ok: false, retryAfterMs: toNextUtcDay(now) };
    }
    const checks = await this.counters.incr(shopKey(this.prefix, shopId, "kc", "checks", day), DAY_TTL_SECONDS);
    if (checks > KEY_CHECKS_PER_DAY) return { ok: false, retryAfterMs: toNextUtcDay(now) };
    return { ok: true };
  }

  /** After a live check the engine refused, or that didn't reach it. */
  async noteRefused(shopId: string): Promise<void> {
    const now = this.now();
    const refused = await this.counters.incr(shopKey(this.prefix, shopId, "kc", "refused", utcDay(now)), DAY_TTL_SECONDS);
    if (refused === KEY_CHECKS_REFUSED_PER_DAY) this.log.warn({ shopId }, "key checks refused: daily cap reached");
    await this.counters.incr(this.refusedHourKey(now), HOUR_TTL_SECONDS);
  }
}

let budget: KeyCheckBudget | undefined;

/** The app's key-check budget: Redis when configured (required in production), else this process's memory. */
export function getKeyCheckBudget(): KeyCheckBudget {
  if (budget) return budget;
  const config = getConfig();
  const prefix = keyPrefix(config.NODE_ENV);
  budget = new KeyCheckBudget(config.REDIS_URL ? new RedisCounters(createRedis(config.REDIS_URL)) : new MemoryCounters(), prefix);
  return budget;
}
