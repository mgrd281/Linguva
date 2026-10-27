import { createHash } from "node:crypto";
import {
  DelayedError,
  Queue,
  UnrecoverableError,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
} from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { withTenant } from "../tenancy/with-tenant";
import { finishItem, stopJob } from "./bulk-jobs";
import { classifyError } from "./errors";
import {
  processItem,
  runDiscoveryPage,
  type DiscoveryPayload,
  type ItemPayload,
  type JobDependencies,
} from "./processors";

export const QUEUE_NAMES = {
  discovery: "translation-discovery",
  items: "translation-items",
} as const;

export const ITEM_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 3_600, count: 5_000 },
  // Failed jobs stay inspectable for two weeks (dead-letter set).
  removeOnFail: { age: 14 * 86_400 },
};

const DISCOVERY_JOB_OPTIONS: JobsOptions = {
  ...ITEM_JOB_OPTIONS,
  attempts: 6,
};

const uuid = z.string().uuid();
const itemPayloadSchema = z.object({ shopId: uuid, itemId: uuid }).strict();
const discoveryPayloadSchema = z.object({ shopId: uuid, jobId: uuid }).strict();

export interface Queues {
  discovery: Queue<DiscoveryPayload>;
  items: Queue<ItemPayload>;
  itemJobOptions: JobsOptions;
  discoveryJobOptions: JobsOptions;
  close(): Promise<void>;
}

export function createQueues(
  connection: ConnectionOptions,
  prefix: string,
  overrides: { itemJobOptions?: JobsOptions; discoveryJobOptions?: JobsOptions } = {},
): Queues {
  const discovery = new Queue<DiscoveryPayload>(QUEUE_NAMES.discovery, { connection, prefix });
  const items = new Queue<ItemPayload>(QUEUE_NAMES.items, { connection, prefix });
  return {
    discovery,
    items,
    itemJobOptions: { ...ITEM_JOB_OPTIONS, ...overrides.itemJobOptions },
    discoveryJobOptions: { ...DISCOVERY_JOB_OPTIONS, ...overrides.discoveryJobOptions },
    async close() {
      await Promise.all([discovery.close(), items.close()]);
    },
  };
}

// BullMQ job ids may not contain ":"; keep them short and deterministic.
function discoveryJobId(jobId: string, cursor: string | null): string {
  const page = createHash("sha256").update(cursor ?? "start").digest("hex").slice(0, 16);
  return `discover_${jobId}_${page}`;
}

export async function enqueueDiscovery(
  queues: Queues,
  payload: DiscoveryPayload,
  cursor: string | null,
  round?: string,
) {
  await queues.discovery.add("discover", payload, {
    ...queues.discoveryJobOptions,
    jobId: round ? `discover_${payload.jobId}_${round}` : discoveryJobId(payload.jobId, cursor),
  });
}

/**
 * Enqueues items. The first round uses the item id as queue job id, so
 * enqueueing the same item twice is a no-op; explicit retries and re-queues
 * use a `round` suffix. The queue job id is stored on the item so the
 * stalled-item sweeper can check whether it is still queued.
 */
export async function enqueueItems(
  queues: Queues,
  shopId: string,
  itemIds: readonly string[],
  round?: string,
  client: PrismaClient = defaultClient,
) {
  if (itemIds.length === 0) return;
  const jobs = itemIds.map((itemId) => ({
    itemId,
    queueJobId: round ? `${itemId}_${round}` : itemId,
  }));
  await withTenant(
    shopId,
    async (tx) => {
      for (const job of jobs) {
        await tx.translationJobItem.updateMany({
          where: { id: job.itemId, shopId },
          data: { queueJobId: job.queueJobId },
        });
      }
    },
    client,
  );
  await queues.items.addBulk(
    jobs.map((job) => ({
      name: "translate",
      data: { shopId, itemId: job.itemId },
      opts: { ...queues.itemJobOptions, jobId: job.queueJobId },
    })),
  );
}

async function delay(job: Job, token: string | undefined, waitMs: number): Promise<never> {
  await job.moveToDelayed(Date.now() + waitMs, token);
  throw new DelayedError();
}

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

export function createItemProcessor(deps: JobDependencies) {
  return async (job: Job<ItemPayload>, token?: string) => {
    const parsed = itemPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("INVALID_PAYLOAD");
    const payload = parsed.data;
    const log = logger.child({ queue: QUEUE_NAMES.items, queueJobId: job.id, shopId: payload.shopId, itemId: payload.itemId });

    try {
      const outcome = await processItem(deps, payload, job.attemptsMade + 1);
      log.info({ outcome: outcome.status }, "item processed");
      return outcome;
    } catch (error) {
      const decision = classifyError(error);
      switch (decision.kind) {
        case "rate-limited":
          log.debug({ waitMs: decision.waitMs }, "item delayed by rate limit");
          return delay(job, token, decision.waitMs);
        case "job-stop": {
          const item = await withTenant(
            payload.shopId,
            (tx) => tx.translationJobItem.findFirst({ where: { id: payload.itemId, shopId: payload.shopId } }),
            deps.prisma,
          );
          if (item) {
            await stopJob(payload.shopId, item.jobId, decision.code, deps.prisma);
            await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: decision.code }, deps.prisma);
          }
          log.warn({ code: decision.code }, "job stopped");
          throw new UnrecoverableError(decision.code);
        }
        case "item-permanent":
          await finishItem(payload.shopId, payload.itemId, { status: "FAILED", errorCode: decision.code }, deps.prisma);
          log.warn({ code: decision.code }, "item failed permanently");
          throw new UnrecoverableError(decision.code);
        case "retryable":
          if (isFinalAttempt(job)) {
            await finishItem(payload.shopId, payload.itemId, { status: "DEAD", errorCode: decision.code }, deps.prisma);
            log.error({ code: decision.code }, "item moved to dead letter");
          } else {
            await withTenant(
              payload.shopId,
              (tx) =>
                tx.translationJobItem.updateMany({
                  where: { id: payload.itemId, shopId: payload.shopId, status: "RUNNING" },
                  data: { status: "PENDING", errorCode: decision.code },
                }),
              deps.prisma,
            );
            log.warn({ code: decision.code, attempt: job.attemptsMade + 1 }, "item will be retried");
          }
          throw error;
      }
    }
  };
}

export function createDiscoveryProcessor(deps: JobDependencies, queues: Queues) {
  return async (job: Job<DiscoveryPayload>, token?: string) => {
    const parsed = discoveryPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("INVALID_PAYLOAD");
    const payload = parsed.data;
    const log = logger.child({ queue: QUEUE_NAMES.discovery, queueJobId: job.id, shopId: payload.shopId, jobId: payload.jobId });

    try {
      const result = await runDiscoveryPage(deps, payload);
      await enqueueItems(queues, payload.shopId, result.itemIds, undefined, deps.prisma);
      if (result.hasMore) await enqueueDiscovery(queues, payload, result.cursor);
      log.info({ items: result.itemIds.length, hasMore: result.hasMore }, "discovery page processed");
      return { items: result.itemIds.length, hasMore: result.hasMore };
    } catch (error) {
      const decision = classifyError(error);
      if (decision.kind === "rate-limited") return delay(job, token, decision.waitMs);
      if (decision.kind === "retryable" && !isFinalAttempt(job)) throw error;
      const code = decision.kind === "retryable" ? "DISCOVERY_FAILED" : decision.code;
      await stopJob(payload.shopId, payload.jobId, code, deps.prisma);
      log.error({ code }, "discovery stopped the job");
      throw new UnrecoverableError(code);
    }
  };
}

export interface WorkerSet {
  discovery: Worker<DiscoveryPayload>;
  items: Worker<ItemPayload>;
  close(): Promise<void>;
}

export function createWorkers(
  deps: JobDependencies,
  queues: Queues,
  options: { connection: ConnectionOptions; prefix: string; concurrency: number },
): WorkerSet {
  const discovery = new Worker<DiscoveryPayload>(QUEUE_NAMES.discovery, createDiscoveryProcessor(deps, queues), {
    connection: options.connection,
    prefix: options.prefix,
    concurrency: Math.max(1, Math.floor(options.concurrency / 2)),
  });
  const items = new Worker<ItemPayload>(QUEUE_NAMES.items, createItemProcessor(deps), {
    connection: options.connection,
    prefix: options.prefix,
    concurrency: options.concurrency,
  });
  for (const worker of [discovery, items]) {
    worker.on("error", (error) => logger.error({ err: error.name }, "worker error"));
  }
  return {
    discovery,
    items,
    async close() {
      await Promise.all([discovery.close(), items.close()]);
    },
  };
}

const STALL_THRESHOLD_MS = 15 * 60 * 1000;
const LIVE_QUEUE_STATES = new Set(["waiting", "delayed", "active", "prioritized", "waiting-children"]);

/**
 * Re-enqueues items that have no live queue job any more (for example after
 * a crash between creating items and enqueueing them, or a lost Redis).
 * Items that are merely waiting in a long queue are left alone. Iterates
 * shops and enters each tenant separately; it never reads across tenants.
 */
export async function requeueStalledItems(deps: JobDependencies, queues: Queues, now = new Date()) {
  const shops = await deps.prisma.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const cutoff = new Date(now.getTime() - STALL_THRESHOLD_MS);
  let total = 0;
  for (const shop of shops) {
    const candidates = await withTenant(
      shop.id,
      (tx) =>
        tx.translationJobItem.findMany({
          where: {
            shopId: shop.id,
            status: { in: ["PENDING", "RUNNING"] },
            updatedAt: { lt: cutoff },
            job: { status: { in: ["RUNNING", "DISCOVERING"] } },
          },
          select: { id: true, queueJobId: true },
          take: 500,
        }),
      deps.prisma,
    );
    const orphaned: string[] = [];
    for (const item of candidates) {
      const queued = item.queueJobId ? await queues.items.getJob(item.queueJobId) : undefined;
      const state = queued ? await queued.getState() : "missing";
      if (!LIVE_QUEUE_STATES.has(state)) orphaned.push(item.id);
    }
    if (orphaned.length) {
      await enqueueItems(queues, shop.id, orphaned, `requeue${now.getTime()}`, deps.prisma);
      total += orphaned.length;
    }
  }
  return total;
}
