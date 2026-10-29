/**
 * Background worker: bulk translation discovery and item processing.
 * Runs as its own process (`pnpm worker` / `node build/worker/index.js`):
 * as a separate service, or as a child of the web process
 * (LINGUVA_WORKER_MODE=embedded, app/.server/jobs/embedded-worker.ts).
 */
import { unauthenticated } from "../app/shopify.server";
import { aiUsageLimits, getConfig } from "../app/.server/lib/config";
import { prisma } from "../app/.server/lib/db";
import { ensureDatabasePosture } from "../app/.server/lib/db-guard";
import { billingDeps } from "../app/.server/billing/billing";
import { getBillingStatus } from "../app/.server/billing/subscription";
import { logger } from "../app/.server/lib/logger";
import { getTranslationProvider } from "../app/.server/providers";
import { createQueues, createWorkers, requeueStalledItems, requeueStalledReports } from "../app/.server/jobs/queues";
import { AUTO_SWEEP_INTERVAL_MS, sweepChangedContent } from "../app/.server/jobs/auto-sweep";
import type { JobDependencies } from "../app/.server/jobs/processors";
import { createRedis, keyPrefix } from "../app/.server/queue/redis";
import { startHeartbeat } from "../app/.server/queue/heartbeat";
import { TokenBucket } from "../app/.server/queue/rate-limiter";
import { withShopifyTimeout } from "../app/.server/shopify/admin-timeout";
import { purgeWebhookLog } from "../app/.server/webhooks/process-webhook";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  const config = getConfig();
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required for the worker");
  // Refuses to process jobs if the database could leak data between shops.
  await ensureDatabasePosture();

  const connection = createRedis(config.REDIS_URL);
  const prefix = keyPrefix(config.NODE_ENV);
  const queues = createQueues(connection, prefix);
  const limits = aiUsageLimits(config);
  const deps: JobDependencies = {
    prisma,
    adminFor: async (shopDomain) =>
      withShopifyTimeout((await unauthenticated.admin(shopDomain)).admin, config.SHOPIFY_TIMEOUT_MS, "worker"),
    provider: getTranslationProvider(),
    monthlyLimit: limits.limit,
    dailyLimit: limits.dailyLimit,
    platformDailyLimit: limits.platformDailyLimit,
    // The plan (cached Partner API state); billing off: unmetered.
    billingFor: async (shopId) => {
      const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      return getBillingStatus(billingDeps(config), shop);
    },
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
      // One worker at a time (a separate worker and an embedded one, or a deploy overlap).
      const lock = await connection.set(`${prefix}:coverage-requeue-lock`, String(process.pid), "PX", SWEEP_INTERVAL_MS - 60_000, "NX");
      if (lock === "OK") {
        const reports = await requeueStalledReports(deps, queues);
        if (reports) logger.warn({ reports }, "continued stalled coverage reports");
      }
      const purged = await purgeWebhookLog(prisma);
      if (purged) logger.info({ purged }, "old webhook log entries deleted");
    } catch (error) {
      logger.error({ err: (error as Error).name }, "stalled-item sweep failed");
    }
  };
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  void sweep();

  // Automatic translation: content changed without a webhook (pages, blog
  // posts, blogs) or whose webhook was missed. One worker per interval.
  const autoSweep = async () => {
    try {
      const lock = await connection.set(`${prefix}:auto-sweep-lock`, String(process.pid), "PX", AUTO_SWEEP_INTERVAL_MS - 60_000, "NX");
      if (lock !== "OK") return;
      const summary = await sweepChangedContent(deps, queues.auto);
      if (summary.queued || summary.failed) logger.info(summary, "automatic translation: changed content checked");
    } catch (error) {
      logger.error({ err: (error as Error).name }, "automatic translation check failed");
    }
  };
  const autoTimer = setInterval(autoSweep, AUTO_SWEEP_INTERVAL_MS);
  void autoSweep();

  const mode = process.env.LINGUVA_WORKER_MODE === "embedded" ? "embedded" : "standalone";
  // Tells the web process (and GET /healthz/worker) that jobs are being processed.
  const heartbeat = startHeartbeat(connection, {
    prefix,
    healthy: () => [workers.discovery, workers.items, workers.coverage, workers.auto].every((w) => w.isRunning()),
    info: {
      startedAt: new Date().toISOString(),
      mode,
      pid: process.pid,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      provider: deps.provider?.id ?? "none",
    },
  });

  logger.info({ provider: deps.provider?.id ?? "none", concurrency: config.WORKER_CONCURRENCY, mode }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    heartbeat.stop();
    clearInterval(timer);
    clearInterval(autoTimer);
    // Lets active jobs finish; unfinished ones are picked up again after restart.
    await workers.close();
    await queues.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // Inside the web process (embedded): stop once it is gone, also after kill -9 or running out of memory.
  if (mode === "embedded") {
    // It may have gone while this process was starting: the channel is closed already (connected false).
    if (process.connected === false) void shutdown("web process gone");
    else if (process.channel) {
      process.channel.unref();
      process.on("disconnect", () => void shutdown("web process gone"));
    }
  }
}

main().catch((error) => {
  logger.fatal({ err: (error as Error).message }, "worker failed to start");
  process.exit(1);
});
