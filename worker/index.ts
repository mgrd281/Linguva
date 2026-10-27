/**
 * Background worker: bulk translation discovery and item processing.
 * Runs as its own process (`pnpm worker` / `node build/worker/index.js`).
 */
import { unauthenticated } from "../app/shopify.server";
import { aiUsageLimits, getConfig } from "../app/.server/lib/config";
import { prisma } from "../app/.server/lib/db";
import { logger } from "../app/.server/lib/logger";
import { getTranslationProvider } from "../app/.server/providers";
import { createQueues, createWorkers, requeueStalledItems } from "../app/.server/jobs/queues";
import type { JobDependencies } from "../app/.server/jobs/processors";
import { createRedis, keyPrefix } from "../app/.server/queue/redis";
import { TokenBucket } from "../app/.server/queue/rate-limiter";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  const config = getConfig();
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for the worker");

  const connection = createRedis(config.REDIS_URL);
  const prefix = keyPrefix(config.NODE_ENV);
  const queues = createQueues(connection, prefix);
  const limits = aiUsageLimits(config);
  const deps: JobDependencies = {
    prisma,
    adminFor: async (shopDomain) => (await unauthenticated.admin(shopDomain)).admin,
    provider: getTranslationProvider(),
    monthlyLimit: limits.limit,
    dailyLimit: limits.dailyLimit,
    platformDailyLimit: limits.platformDailyLimit,
    keyPrefix: prefix,
    shopifyLimiter: new TokenBucket(connection, {
      capacity: config.SHOPIFY_JOB_BUCKET_SIZE,
      refillPerSecond: config.SHOPIFY_JOB_RESTORE_PER_SECOND,
    }),
  };
  const workers = createWorkers(deps, queues, {
    connection,
    prefix,
    concurrency: config.WORKER_CONCURRENCY,
  });

  const sweep = async () => {
    try {
      const requeued = await requeueStalledItems(deps, queues);
      if (requeued) logger.warn({ requeued }, "re-enqueued stalled items");
    } catch (error) {
      logger.error({ err: (error as Error).name }, "stalled-item sweep failed");
    }
  };
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  void sweep();

  logger.info({ provider: deps.provider?.id ?? "none", concurrency: config.WORKER_CONCURRENCY }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    clearInterval(timer);
    // Lets active jobs finish; unfinished ones are picked up again after restart.
    await workers.close();
    await queues.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: (error as Error).message }, "worker failed to start");
  process.exit(1);
});
