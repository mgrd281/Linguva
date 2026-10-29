import type { Redis } from "ioredis";
import { getConfig } from "../lib/config";
import { createQueues, type Queues } from "../jobs/queues";
import { readWorkerStatus, type WorkerStatus } from "./heartbeat";
import { createRedis, keyPrefix } from "./redis";

let redis: Redis | null | undefined;
let queues: Queues | null | undefined;

/** The web process's Redis connection (queues, worker status), or null without Redis. */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const config = getConfig();
  redis = config.REDIS_URL ? createRedis(config.REDIS_URL) : null;
  return redis;
}

/** Producer-side queues for the web process, or null without Redis. */
export function getQueues(): Queues | null {
  if (queues !== undefined) return queues;
  const connection = getRedis();
  queues = connection ? createQueues(connection, keyPrefix(getConfig().NODE_ENV)) : null;
  return queues;
}

/** Whether a worker is processing the queues right now (its heartbeat in Redis). */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  const connection = getRedis();
  if (!connection) return { state: "unavailable" };
  return readWorkerStatus(connection, keyPrefix(getConfig().NODE_ENV));
}

/** Tests only: close and forget the connection. */
export async function resetQueueClient() {
  await queues?.close();
  if (redis) await redis.quit().catch(() => undefined);
  queues = undefined;
  redis = undefined;
}
