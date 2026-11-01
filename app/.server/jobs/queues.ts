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
import { AUTO_REQUESTED_BY, finishItem, stopJob } from "./bulk-jobs";
import { autoPauseAfterStop } from "../settings/shop-settings";
import { smartPauseAfterStop } from "../smart/config";
import { SMART_REQUESTED_BY } from "../../lib/smart-auto";
import { currentShopLocales } from "../locales/current-locales";
import { classifyError } from "./errors";
import {
  processItem,
  runDiscoveryPage,
  type DiscoveryPayload,
  type ItemPayload,
  type JobDependencies,
} from "./processors";
import { AUTO_GID, createAutoItems, type AutoTranslatePayload } from "./auto-translate";
import { SWEPT_TYPES } from "../shopify/recent-changes";
import {
  failCoverageReport,
  refreshCoverageResource,
  runCoveragePage,
  skipCoverageSegment,
  type CoveragePagePayload,
  type CoverageRefreshPayload,
} from "../coverage/coverage";

export const QUEUE_NAMES = {
  discovery: "translation-discovery",
  items: "translation-items",
  coverage: "translation-coverage",
  auto: "translation-auto",
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
const coveragePayloadSchema = z
  .object({
    shopId: uuid,
    reportId: uuid,
    segmentIndex: z.number().int().min(0).max(1000),
    cursor: z.string().max(1000).nullable(),
  })
  .strict();
/**
 * Resources whose coverage is read again when they change: products and
 * collections (webhooks), pages, blog posts and blogs (the periodic check).
 */
export const COVERAGE_REFRESH_GID = /^gid:\/\/shopify\/(Product|Collection|Page|Article|Blog)\/\d{1,20}$/;
const refreshPayloadSchema = z.object({ shopId: uuid, resourceGid: z.string().regex(COVERAGE_REFRESH_GID) }).strict();
const autoPayloadSchema = z
  .object({
    shopId: uuid,
    resourceGid: z.string().max(100),
    resourceType: z.enum(SWEPT_TYPES),
    changedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((p) => AUTO_GID[p.resourceType].test(p.resourceGid));

/** How long an automatic check waits for a running job with other settings. */
const AUTO_BUSY_WAIT_MS = 5 * 60 * 1000;

export interface Queues {
  discovery: Queue<DiscoveryPayload>;
  items: Queue<ItemPayload>;
  coverage: Queue<CoveragePagePayload | CoverageRefreshPayload>;
  auto: Queue<AutoTranslatePayload>;
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
  const coverage = new Queue<CoveragePagePayload | CoverageRefreshPayload>(QUEUE_NAMES.coverage, { connection, prefix });
  const auto = new Queue<AutoTranslatePayload>(QUEUE_NAMES.auto, { connection, prefix });
  return {
    discovery,
    items,
    coverage,
    auto,
    itemJobOptions: { ...ITEM_JOB_OPTIONS, ...overrides.itemJobOptions },
    discoveryJobOptions: { ...DISCOVERY_JOB_OPTIONS, ...overrides.discoveryJobOptions },
    async close() {
      await Promise.all([discovery.close(), items.close(), coverage.close(), auto.close()]);
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

/** BullMQ's lowest priority (largest number). */
const MAX_PRIORITY = 2_097_152;

/**
 * Fair share between shops: an item's queue priority is its position in
 * its own job (1 = first item). A shop that starts a job while another
 * shop's large job is queued gets its first items translated next, instead
 * of waiting behind the whole catalogue of the other shop. Within a job,
 * items keep their order.
 */
export function itemPriority(position: number) {
  return Math.min(MAX_PRIORITY, Math.max(1, Math.floor(position) + 1));
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
  /** Items of the same job queued before these (see itemPriority). */
  position = 0,
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
    jobs.map((job, index) => ({
      name: "translate",
      data: { shopId, itemId: job.itemId },
      opts: { ...queues.itemJobOptions, jobId: job.queueJobId, priority: itemPriority(position + index) },
    })),
  );
}

/** Queue job id of a coverage page; `round` marks a re-enqueue of the same page. */
export function coveragePageJobId(payload: CoveragePagePayload, round?: string): string {
  const page = createHash("sha256").update(payload.cursor ?? "start").digest("hex").slice(0, 16);
  return `coverage_${payload.reportId}_${payload.segmentIndex}_${page}${round ? `_${round}` : ""}`;
}

/** Enqueues one coverage page; the job id makes a repeated enqueue a no-op. */
export async function enqueueCoveragePage(queues: Queues, payload: CoveragePagePayload, round?: string) {
  await queues.coverage.add("coverage", payload, {
    ...queues.discoveryJobOptions,
    jobId: coveragePageJobId(payload, round),
  });
}

/** How long a refresh waits, so several saves in a row are read once. */
export const COVERAGE_REFRESH_DELAY_MS = 30_000;

/** Part of a refresh's queue job id per resource type (ids are numeric within a type only). */
const REFRESH_ID_TYPE: Record<string, string> = { Product: "p", Collection: "c", Page: "pg", Article: "ar", Blog: "bl" };

/** Queue job id of a resource's coverage refresh: later changes within the delay join it. */
export function coverageRefreshJobId(payload: CoverageRefreshPayload): string {
  const type = /^gid:\/\/shopify\/(\w+)\//.exec(payload.resourceGid)?.[1] ?? "";
  return `covref_${payload.shopId}_${payload.resourceGid.replace(/\D/g, "")}_${REFRESH_ID_TYPE[type] ?? "x"}`;
}

/** Queues a coverage refresh of one resource (after its webhook, or a change the periodic check found). */
export async function enqueueCoverageRefresh(queue: Pick<Queues["coverage"], "add">, payload: CoverageRefreshPayload) {
  await queue.add("coverage-refresh", payload, {
    jobId: coverageRefreshJobId(payload),
    delay: COVERAGE_REFRESH_DELAY_MS,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
    // A kept failed job would make BullMQ drop every later refresh with the same id.
    removeOnComplete: true,
    removeOnFail: true,
  });
}

async function delay(job: Job, token: string | undefined, waitMs: number): Promise<never> {
  await job.moveToDelayed(Date.now() + waitMs, token);
  throw new DelayedError();
}

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/** The end of the shop's running Shopify trial (its lower allowance ends then), or null; never fails a stop. */
async function trialEnd(deps: JobDependencies, shopId: string): Promise<Date | null> {
  if (!deps.billingFor) return null;
  try {
    return (await deps.billingFor(shopId)).trialEndsAt ?? null;
  } catch {
    return null;
  }
}

export function createItemProcessor(deps: JobDependencies) {
  return async (job: Job<ItemPayload>, token?: string) => {
    const parsed = itemPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("INVALID_PAYLOAD");
    const payload = parsed.data;
    const log = logger.child({ queue: QUEUE_NAMES.items, queueJobId: job.id, shopId: payload.shopId, itemId: payload.itemId });

    try {
      const outcome = await processItem(deps, payload, job.attemptsMade + 1, job.id);
      log.info({ outcome: outcome.status }, "item processed");
      return outcome;
    } catch (error) {
      const decision = classifyError(error);
      switch (decision.kind) {
        case "rate-limited":
          // Waiting isn't an attempt: the item shows as waiting, not running, until it runs again.
          await withTenant(
            payload.shopId,
            (tx) =>
              tx.translationJobItem.updateMany({
                where: { id: payload.itemId, shopId: payload.shopId, status: "RUNNING", attempts: { gt: 0 } },
                data: { status: "PENDING", attempts: { decrement: 1 } },
              }),
            deps.prisma,
          );
          log.debug({ waitMs: decision.waitMs }, "item delayed by rate limit");
          return delay(job, token, decision.waitMs);
        case "job-stop": {
          const item = await withTenant(
            payload.shopId,
            (tx) => tx.translationJobItem.findFirst({ where: { id: payload.itemId, shopId: payload.shopId }, include: { job: { select: { requestedBy: true } } } }),
            deps.prisma,
          );
          if (item) {
            await stopJob(payload.shopId, item.jobId, decision.code, deps.prisma);
            await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: decision.code }, deps.prisma);
            const automatic = item.job.requestedBy === AUTO_REQUESTED_BY || item.job.requestedBy === SMART_REQUESTED_BY;
            // A trial's lower allowance ends with the trial, mostly before the month: a pause for it ends then too.
            const allowanceRisesAt = automatic && decision.code === "QUOTA_EXCEEDED" ? await trialEnd(deps, payload.shopId) : null;
            // Automatic translation waits for the limit or the provider instead of failing again on every change.
            // Not when only this language's engines are used up or refused (another engine still serves the
            // shop's other languages): this job stops, the others go on.
            const shopWide = decision.scope !== "language";
            if (shopWide && item.job.requestedBy === AUTO_REQUESTED_BY) await autoPauseAfterStop(payload.shopId, decision.code, new Date(), deps.prisma, allowanceRisesAt);
            // So does the smart schedule: its other jobs stop at their next item, and its page says why.
            if (shopWide && item.job.requestedBy === SMART_REQUESTED_BY) await smartPauseAfterStop(payload.shopId, decision.code, new Date(), deps.prisma, allowanceRisesAt);
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
      await enqueueItems(queues, payload.shopId, result.itemIds, undefined, deps.prisma, result.position);
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

export function createCoverageProcessor(deps: JobDependencies, queues: Queues) {
  return async (job: Job<CoveragePagePayload | CoverageRefreshPayload>, token?: string) => {
    if (job.name === "coverage-refresh") {
      const refresh = refreshPayloadSchema.safeParse(job.data);
      if (!refresh.success) throw new UnrecoverableError("INVALID_PAYLOAD");
      try {
        return await refreshCoverageResource(deps, refresh.data);
      } catch (error) {
        const decision = classifyError(error);
        if (decision.kind === "rate-limited") return delay(job, token, decision.waitMs);
        // The failed job is removed (the next change queues a new one): the log is what remains.
        if (isFinalAttempt(job)) logger.warn({ queue: QUEUE_NAMES.coverage, queueJobId: job.id, shopId: refresh.data.shopId, err: (error as Error).name }, "coverage refresh failed");
        throw error;
      }
    }
    const parsed = coveragePayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("INVALID_PAYLOAD");
    const payload = parsed.data;
    const log = logger.child({ queue: QUEUE_NAMES.coverage, queueJobId: job.id, shopId: payload.shopId, reportId: payload.reportId });
    try {
      const next = await runCoveragePage(deps, payload, {
        // Translation a Smart Auto-Translate run planned on the page.
        enqueueSmartItems: (shopId, itemIds, position) => enqueueItems(queues, shopId, itemIds, undefined, deps.prisma, position),
      });
      if (next) await enqueueCoveragePage(queues, next);
      return { done: !next };
    } catch (error) {
      const decision = classifyError(error);
      if (decision.kind === "rate-limited") return delay(job, token, decision.waitMs);
      if (decision.kind === "retryable" && !isFinalAttempt(job)) throw error;
      const code = decision.kind === "retryable" ? "SCAN_FAILED" : decision.code;
      if (decision.kind === "job-stop") {
        // The shop's access (or the app) is gone: nothing else can be read either.
        await failCoverageReport(payload.shopId, payload.reportId, code, deps.prisma);
        log.error({ code }, "coverage report failed");
        throw new UnrecoverableError(code);
      }
      // One type keeps failing: mark it, scan the others.
      const next = await skipCoverageSegment(deps.prisma, payload, code);
      log.warn({ code, segmentIndex: payload.segmentIndex }, "coverage segment skipped after retries");
      if (next) await enqueueCoveragePage(queues, next);
      return { skipped: true };
    }
  };
}

/**
 * Automatic translation check of one changed resource: creates its items
 * (one per chosen language) and puts them on the item queue.
 */
/** The Admin API client of a shop, by its id (Shop is the tenant root, outside row-level security). */
async function adminForShop(deps: JobDependencies, shopId: string) {
  const shop = await deps.prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { shopDomain: true } });
  return deps.adminFor(shop.shopDomain);
}

export function createAutoProcessor(deps: JobDependencies, queues: Queues) {
  return async (job: Job<AutoTranslatePayload>, token?: string) => {
    const parsed = autoPayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("INVALID_PAYLOAD");
    const payload = parsed.data;
    const log = logger.child({ queue: QUEUE_NAMES.auto, queueJobId: job.id, shopId: payload.shopId });
    const result = await createAutoItems(deps.prisma, payload, deps.billingFor, (shopId) => currentShopLocales(shopId, () => adminForShop(deps, shopId), deps.prisma));
    await enqueueItems(queues, payload.shopId, result.itemIds, undefined, deps.prisma);
    // A finished item checked again needs a fresh queue job id.
    await enqueueItems(queues, payload.shopId, result.reused, `auto${Date.now()}`, deps.prisma);
    log.info({ items: result.itemIds.length + result.reused.length, busy: result.busy }, "automatic translation checked");
    if (result.busy) return delay(job, token, AUTO_BUSY_WAIT_MS);
    return { items: result.itemIds.length + result.reused.length };
  };
}

export interface WorkerSet {
  discovery: Worker<DiscoveryPayload>;
  items: Worker<ItemPayload>;
  coverage: Worker<CoveragePagePayload | CoverageRefreshPayload>;
  auto: Worker<AutoTranslatePayload>;
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
  const coverage = new Worker<CoveragePagePayload | CoverageRefreshPayload>(QUEUE_NAMES.coverage, createCoverageProcessor(deps, queues), {
    connection: options.connection,
    prefix: options.prefix,
    // Pages of one report run one after another; this only spreads shops.
    concurrency: Math.max(1, Math.floor(options.concurrency / 2)),
  });
  const auto = new Worker<AutoTranslatePayload>(QUEUE_NAMES.auto, createAutoProcessor(deps, queues), {
    connection: options.connection,
    prefix: options.prefix,
    concurrency: Math.max(1, Math.floor(options.concurrency / 2)),
  });
  for (const worker of [discovery, items, coverage, auto]) {
    worker.on("error", (error) => logger.error({ err: error.name }, "worker error"));
  }
  return {
    discovery,
    items,
    coverage,
    auto,
    async close() {
      await Promise.all([discovery.close(), items.close(), coverage.close(), auto.close()]);
    },
  };
}

const STALL_THRESHOLD_MS = 15 * 60 * 1000;
const LIVE_QUEUE_STATES = new Set(["waiting", "delayed", "active", "prioritized", "waiting-children"]);
/** A coverage report without progress for this long is checked for a lost queue job. */
export const REPORT_STALL_MS = 10 * 60 * 1000;

async function queueState(queue: Pick<Queues["coverage"] | Queues["discovery"], "getJob">, id: string): Promise<string> {
  const job = await queue.getJob(id);
  return job ? await job.getState() : "missing";
}

/**
 * Continues coverage reports whose chain of page jobs broke: the process was
 * killed between saving a page and queueing the next one (a redeploy), the
 * first job never got queued, or Redis lost it. A report that hasn't moved
 * for REPORT_STALL_MS and has no live job for its current page gets that
 * page queued again. Safe to repeat: a page only counts at the report's
 * current position (runCoveragePage), so a duplicate job does nothing.
 * At most one re-enqueue per page and REPORT_STALL_MS window. Iterates shops
 * and enters each tenant separately.
 */
export async function requeueStalledReports(deps: JobDependencies, queues: Queues, now = new Date()) {
  const shops = await deps.prisma.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const cutoff = new Date(now.getTime() - REPORT_STALL_MS);
  const window = Math.floor(now.getTime() / REPORT_STALL_MS);
  let total = 0;
  for (const shop of shops) {
    const reports = await withTenant(
      shop.id,
      (tx) =>
        tx.coverageReport.findMany({
          where: { shopId: shop.id, status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: cutoff } },
          select: { id: true, segmentIndex: true, cursor: true, segments: true },
        }),
      deps.prisma,
    );
    for (const report of reports) {
      if (report.segmentIndex >= report.segments.length) continue;
      const payload: CoveragePagePayload = { shopId: shop.id, reportId: report.id, segmentIndex: report.segmentIndex, cursor: report.cursor };
      const ids = [coveragePageJobId(payload), coveragePageJobId(payload, `r${window}`), coveragePageJobId(payload, `r${window - 1}`)];
      const states = await Promise.all(ids.map((id) => queueState(queues.coverage, id)));
      if (states.some((state) => LIVE_QUEUE_STATES.has(state))) continue;
      await enqueueCoveragePage(queues, payload, `r${window}`);
      total++;
    }
  }
  return total;
}

/**
 * Continues bulk jobs whose discovery chain broke: queueing the first page
 * failed after the job was created (Redis was down), or a discovery job
 * stalled twice and BullMQ failed it without running it. Such a job would
 * stay active forever and block new jobs for its type and language. A job
 * still discovering that hasn't moved for REPORT_STALL_MS and has no live
 * discovery job gets its current page queued again; a page always starts at
 * the job's stored cursor, so a duplicate only repeats idempotent work.
 * Iterates shops and enters each tenant separately.
 */
export async function requeueStalledDiscovery(deps: JobDependencies, queues: Queues, now = new Date()) {
  const shops = await deps.prisma.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const cutoff = new Date(now.getTime() - REPORT_STALL_MS);
  const window = Math.floor(now.getTime() / REPORT_STALL_MS);
  let total = 0;
  for (const shop of shops) {
    const jobs = await withTenant(
      shop.id,
      (tx) =>
        tx.translationJob.findMany({
          // A smart run's jobs are filled by its measurement, not by discovery (repairSmartRuns finishes them).
          where: { shopId: shop.id, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] }, discoveryDone: false, smartRunId: null, updatedAt: { lt: cutoff } },
          select: { id: true, discoveryCursor: true },
          take: 100,
        }),
      deps.prisma,
    );
    for (const job of jobs) {
      const ids = [discoveryJobId(job.id, job.discoveryCursor), `discover_${job.id}_r${window}`, `discover_${job.id}_r${window - 1}`];
      const states = await Promise.all(ids.map((id) => queueState(queues.discovery, id)));
      if (states.some((state) => LIVE_QUEUE_STATES.has(state))) continue;
      await enqueueDiscovery(queues, { shopId: shop.id, jobId: job.id }, job.discoveryCursor, `r${window}`);
      total++;
    }
  }
  return total;
}

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
