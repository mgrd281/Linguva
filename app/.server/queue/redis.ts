import { Redis } from "ioredis";

/**
 * Redis connection for BullMQ and rate limiting. BullMQ requires
 * `maxRetriesPerRequest: null` for blocking connections. `family: 0` looks
 * up IPv4 and IPv6 addresses: hosted private networks (Railway's
 * *.railway.internal) can be IPv6-only, which ioredis' IPv4 default misses.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, family: 0 });
}

/** Namespace for all Linguva keys, separated per environment. */
export function keyPrefix(env: string): string {
  return `lv:${env}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant-scoped key. Refuses anything but a shop UUID as the tenant part. */
export function shopKey(prefix: string, shopId: string, ...parts: string[]): string {
  if (!UUID.test(shopId)) throw new Error("shopKey requires a shop UUID");
  return [prefix, "shop", shopId, ...parts].join(":");
}
