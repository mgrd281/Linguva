import { Redis } from "ioredis";

/**
 * Redis connection for BullMQ and rate limiting. BullMQ requires
 * `maxRetriesPerRequest: null` for blocking connections.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
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
