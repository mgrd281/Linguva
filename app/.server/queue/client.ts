import { getConfig } from "../lib/config";
import { createQueues, type Queues } from "../jobs/queues";
import { createRedis, keyPrefix } from "./redis";

let queues: Queues | null | undefined;

/** Producer-side queues for the web process, or null without Redis. */
export function getQueues(): Queues | null {
  if (queues !== undefined) return queues;
  const config = getConfig();
  queues = config.REDIS_URL
    ? createQueues(createRedis(config.REDIS_URL), keyPrefix(config.NODE_ENV))
    : null;
  return queues;
}
