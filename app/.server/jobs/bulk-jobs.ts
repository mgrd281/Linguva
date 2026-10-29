import type {
  PrismaClient,
  TranslationJob,
  TranslationJobItemStatus,
} from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { refreshCoverageOverlays } from "../coverage/items";
import { finishSmartRunIfDone } from "../smart/finish";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { SMART_REQUESTED_BY } from "../../lib/smart-auto";

export const ACTIVE_JOB_STATUSES = ["PENDING", "DISCOVERING", "RUNNING"] as const;
/** requestedBy of jobs created by automatic translation (webhooks). */
export const AUTO_REQUESTED_BY = "system:auto";
const TERMINAL_ITEM_STATUSES: TranslationJobItemStatus[] = [
  "SUCCEEDED",
  "SKIPPED",
  "FAILED",
  "DEAD",
  "CANCELLED",
];

/**
 * Resource types bulk jobs translate. Theme content, policies and
 * notification templates are translated one by one with review
 * (CONTENT_TYPES[...].bulk = false).
 */
export const SUPPORTED_BULK_RESOURCE_TYPES = [
  "PRODUCT",
  "COLLECTION",
  "PAGE",
  "ARTICLE",
  "BLOG",
  "SHOP",
  "MENU",
  "LINK",
  "FILTER",
  "PRODUCT_OPTION",
  "PRODUCT_OPTION_VALUE",
  "SELLING_PLAN_GROUP",
  "SELLING_PLAN",
  "METAOBJECT",
  "DELIVERY_METHOD_DEFINITION",
  "PAYMENT_GATEWAY",
] as const;
export type BulkResourceType = (typeof SUPPORTED_BULK_RESOURCE_TYPES)[number];

export function isBulkResourceType(value: string): value is BulkResourceType {
  return (SUPPORTED_BULK_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Creates a bulk job, or returns the existing one when the same request is
 * repeated (idempotency key) or a job for the same locale is still running.
 */
/** Types whose image alt text and custom fields a job can include. */
export const ATTACHED_BULK_TYPES: ReadonlySet<string> = new Set(["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"]);

export async function createBulkJob(
  input: {
    shopId: string;
    resourceType: BulkResourceType;
    targetLocale: string;
    requestedBy: string | null;
    idempotencyKey: string;
    /** Explicit permission to replace manual or approved translations. */
    overwriteProtected?: boolean;
    /** ALL fields (default) or only search engine listings. */
    fieldScope?: "ALL" | "SEO";
    /** Also image alt text and custom fields (all fields only; types that have them). */
    includeAttached?: boolean;
  },
  client: PrismaClient = defaultClient,
): Promise<{ job: TranslationJob; created: boolean }> {
  if (!SUPPORTED_BULK_RESOURCE_TYPES.includes(input.resourceType)) {
    throw new Error("Unsupported resource type");
  }
  return withTenant(
    input.shopId,
    async (tx) => {
      // Serialise job creation per shop + locale + type.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${input.shopId}:${input.resourceType}:${input.targetLocale}`}, 0))`;
      const repeated = await tx.translationJob.findUnique({
        where: { shopId_idempotencyKey: { shopId: input.shopId, idempotencyKey: input.idempotencyKey } },
      });
      if (repeated) return { job: repeated, created: false };
      const active = await tx.translationJob.findFirst({
        where: {
          shopId: input.shopId,
          resourceType: input.resourceType,
          targetLocale: input.targetLocale,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
      });
      const fieldScope = input.fieldScope ?? "ALL";
      const includeAttached = Boolean(input.includeAttached) && fieldScope === "ALL" && ATTACHED_BULK_TYPES.has(input.resourceType);
      const automatic = active && (active.requestedBy === AUTO_REQUESTED_BY || (active.requestedBy === SMART_REQUESTED_BY && !active.smartRunId));
      if (automatic && fieldScope === "ALL") {
        // An automatic job (also the smart schedule's real-time one) holds a few changed
        // resources: it becomes the requested bulk job (its items stay, discovery adds the
        // rest). Not for a narrower job (search listings only): its pending items would
        // lose their other fields; the automatic job finishes first. A smart check's job
        // is kept, like any other active job.
        const settings = await tx.shopSettings.findUnique({ where: { shopId: input.shopId } });
        const job = await tx.translationJob.update({
          where: { id: active.id },
          data: {
            requestedBy: input.requestedBy,
            idempotencyKey: input.idempotencyKey,
            overwriteProtected: input.overwriteProtected ?? false,
            fieldScope,
            includeAttached,
            // A bulk job's own rules from now on (the smart schedule's may differ).
            publishMode: settings?.bulkPublishMode ?? "DRAFT",
            fieldGroups: [],
            replaceOutdatedMachine: true,
            discoveryDone: false,
            discoveryCursor: null,
          },
        });
        return { job, created: true };
      }
      if (active) return { job: active, created: false };
      const settings = await tx.shopSettings.findUnique({ where: { shopId: input.shopId } });
      const job = await tx.translationJob.create({
        data: {
          shopId: input.shopId,
          resourceType: input.resourceType,
          targetLocale: input.targetLocale,
          requestedBy: input.requestedBy,
          idempotencyKey: input.idempotencyKey,
          // Draft unless the merchant explicitly enabled automatic publishing.
          publishMode: settings?.bulkPublishMode ?? "DRAFT",
          overwriteProtected: input.overwriteProtected ?? false,
          fieldScope,
          includeAttached,
        },
      });
      return { job, created: true };
    },
    client,
  );
}

/** Returns the job only if it belongs to the shop (RLS + explicit filter). */
export async function getJobForShop(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return withTenant(
    shopId,
    (tx) => tx.translationJob.findFirst({ where: { id: jobId, shopId } }),
    client,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const JOB_STATUS_FILTERS = {
  active: ["PENDING", "DISCOVERING", "RUNNING"],
  completed: ["COMPLETED"],
  failed: ["FAILED"],
  cancelled: ["CANCELLED"],
} as const satisfies Record<string, readonly TranslationJob["status"][]>;
export type JobStatusFilter = keyof typeof JOB_STATUS_FILTERS;

export interface JobPageFilter {
  status?: string | null;
  locale?: string | null;
  resourceType?: string | null;
  /** Id of the last job of the previous page. */
  cursor?: string | null;
  take?: number;
}

/**
 * One page of a shop's jobs, newest first, with optional filters. Keyset
 * pagination (cursor = last job id), so pages stay fast and stable while
 * new jobs are added.
 */
export async function listJobsPage(shopId: string, filter: JobPageFilter = {}, client: PrismaClient = defaultClient) {
  const take = Math.min(Math.max(filter.take ?? 25, 1), 100);
  const status = filter.status && filter.status in JOB_STATUS_FILTERS ? JOB_STATUS_FILTERS[filter.status as JobStatusFilter] : null;
  const cursor = filter.cursor && UUID_RE.test(filter.cursor) ? filter.cursor : null;
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.findMany({
        where: {
          shopId,
          ...(status ? { status: { in: [...status] } } : {}),
          ...(filter.locale ? { targetLocale: filter.locale } : {}),
          ...(filter.resourceType && isBulkResourceType(filter.resourceType) ? { resourceType: filter.resourceType } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    client,
  );
  return { jobs: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1]!.id : null };
}

/** Item outcomes that need the merchant's attention although the item didn't fail. */
export const ATTENTION_CODES = ["PARTIAL", "ALL_FIELDS_REJECTED", "SOURCE_CHANGED"] as const;

/** Failed items and items that need attention, newest first (at most 50). */
export async function listProblemItems(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJobItem.findMany({
        where: {
          shopId,
          jobId,
          OR: [{ status: { in: ["FAILED", "DEAD"] } }, { errorCode: { in: [...ATTENTION_CODES] } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    client,
  );
}

/** How the job's items ended, by status and reason (for the job report). */
export async function jobOutcomes(shopId: string, jobId: string, client: PrismaClient = defaultClient) {
  const groups = await withTenant(
    shopId,
    (tx) =>
      tx.translationJobItem.groupBy({
        by: ["status", "errorCode"],
        where: { shopId, jobId },
        _count: { _all: true },
      }),
    client,
  );
  return groups
    .map((g) => ({ status: g.status, code: g.errorCode, count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

/** Every item of a job with its outcome, for the downloadable report (at most 50,000). */
export async function listJobReportItems(shopId: string, jobId: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJobItem.findMany({
        where: { shopId, jobId },
        orderBy: { createdAt: "asc" },
        take: 50_000,
        select: {
          id: true,
          resourceGid: true,
          status: true,
          errorCode: true,
          attempts: true,
          fieldsTranslated: true,
          fieldsRejected: true,
          finishedAt: true,
        },
      }),
    client,
  );
}

async function maybeComplete(tx: TenantTx, job: TranslationJob) {
  const done = job.succeededItems + job.skippedItems + job.failedItems;
  if (!job.discoveryDone || done < job.totalItems) return job;
  if (job.status !== "RUNNING" && job.status !== "DISCOVERING") return job;
  return tx.translationJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", finishedAt: new Date() },
  });
}

/** Re-checks completion, e.g. after discovery finished with zero items. */
export async function completeIfDone(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    async (tx) => {
      const job = await tx.translationJob.findFirst({ where: { id: jobId, shopId } });
      return job ? maybeComplete(tx, job) : null;
    },
    client,
  );
}

export interface ItemResult {
  status: Extract<TranslationJobItemStatus, "SUCCEEDED" | "SKIPPED" | "FAILED" | "DEAD" | "CANCELLED">;
  errorCode?: string | null;
  fieldsTranslated?: number;
  fieldsRejected?: number;
  memoryHits?: number;
  charsSaved?: number;
  protectedSkipped?: number;
}

/**
 * Moves an item to a terminal state and updates the job counters in the same
 * transaction. Only a non-terminal item is updated, so a repeated call can't
 * count the same item twice.
 */
export async function finishItem(
  shopId: string,
  itemId: string,
  result: ItemResult,
  client: PrismaClient = defaultClient,
) {
  const finished = await withTenant(
    shopId,
    async (tx) => {
      const item = await tx.translationJobItem.findFirst({ where: { id: itemId, shopId } });
      if (!item) return null;
      const updated = await tx.translationJobItem.updateMany({
        where: { id: itemId, shopId, status: { notIn: TERMINAL_ITEM_STATUSES } },
        data: {
          status: result.status,
          errorCode: result.errorCode ?? null,
          fieldsTranslated: result.fieldsTranslated ?? 0,
          fieldsRejected: result.fieldsRejected ?? 0,
          finishedAt: new Date(),
        },
      });
      if (updated.count === 0) return null;

      const counter =
        result.status === "SUCCEEDED"
          ? { succeededItems: { increment: 1 } }
          : result.status === "SKIPPED" || result.status === "CANCELLED"
            ? { skippedItems: { increment: 1 } }
            : { failedItems: { increment: 1 } };
      const job = await tx.translationJob.update({
        where: { id: item.jobId },
        data: {
          ...counter,
          memoryHits: { increment: result.memoryHits ?? 0 },
          charsSaved: { increment: result.charsSaved ?? 0 },
          protectedSkipped: { increment: result.protectedSkipped ?? 0 },
        },
      });
      const after = await maybeComplete(tx, job);
      return { resourceGid: item.resourceGid, locale: job.targetLocale, smartRunId: after.status === "COMPLETED" ? after.smartRunId : null };
    },
    client,
  );
  if (!finished) return false;
  // Coverage shows the attempt (failed, or drafts made) right away.
  await refreshCoverageOverlays(shopId, [finished], client);
  // The last job of a smart run finished: the run may be done.
  if (finished.smartRunId) await finishSmartRunIfDone(shopId, finished.smartRunId, client);
  return true;
}

/**
 * Adds what a provider call billed to the item and its job as soon as it is
 * billed (recordBilled is called after every settled call, also one that
 * fails later), so both totals equal the usage ledger.
 */
export async function recordBilled(
  shopId: string,
  itemId: string,
  jobId: string,
  chars: number,
  client: PrismaClient = defaultClient,
) {
  if (chars <= 0) return;
  await withTenant(
    shopId,
    async (tx) => {
      await tx.translationJobItem.updateMany({ where: { id: itemId, shopId }, data: { charsBilled: { increment: chars } } });
      await tx.translationJob.updateMany({ where: { id: jobId, shopId }, data: { charsBilled: { increment: chars } } });
    },
    client,
  );
}

/** Stops a job because of a condition that affects all its items. */
export async function stopJob(
  shopId: string,
  jobId: string,
  errorCode: string,
  client: PrismaClient = defaultClient,
) {
  const smartRunId = await withTenant(
    shopId,
    async (tx) => {
      const stopped = await tx.translationJob.updateMany({
        where: { id: jobId, shopId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: "FAILED", errorCode, finishedAt: new Date() },
      });
      if (!stopped.count) return null;
      return (await tx.translationJob.findFirst({ where: { id: jobId, shopId }, select: { smartRunId: true } }))?.smartRunId ?? null;
    },
    client,
  );
  if (smartRunId) await finishSmartRunIfDone(shopId, smartRunId, client);
}

export async function cancelJob(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
) {
  const result = await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.updateMany({
        where: { id: jobId, shopId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date() },
      }),
    client,
  );
  return result.count === 1;
}

/** Cancels every active job of a shop, e.g. on uninstall. */
export async function cancelActiveJobsForShop(shopId: string, client: PrismaClient = defaultClient) {
  await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.updateMany({
        where: { shopId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date() },
      }),
    client,
  );
}

/**
 * Puts failed (and, for a stopped job, cancelled) items back to PENDING and
 * reopens the job. Returns the item ids to enqueue again.
 */
export async function retryJobItems(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
): Promise<{ itemIds: string[]; rediscover: boolean }> {
  return withTenant(
    shopId,
    async (tx) => {
      const job = await tx.translationJob.findFirst({ where: { id: jobId, shopId } });
      // A job the merchant cancelled stays cancelled.
      if (!job || job.status === "CANCELLED") return { itemIds: [], rediscover: false };
      const statuses: TranslationJobItemStatus[] =
        job.status === "FAILED" ? ["FAILED", "DEAD", "CANCELLED"] : ["FAILED", "DEAD"];
      const items = await tx.translationJobItem.findMany({
        where: { jobId, shopId, status: { in: statuses } },
        select: { id: true, status: true },
      });
      // A smart check's job is filled by its run's measurement, never by a discovery of its own.
      const rediscover = job.status === "FAILED" && !job.discoveryDone && !job.smartRunId;
      if (items.length === 0 && !rediscover) return { itemIds: [], rediscover: false };
      const failed = items.filter((i) => i.status !== "CANCELLED").length;
      const cancelled = items.length - failed;
      if (items.length) {
        await tx.translationJobItem.updateMany({
          where: { id: { in: items.map((i) => i.id) }, shopId },
          data: { status: "PENDING", errorCode: null, finishedAt: null },
        });
      }
      await tx.translationJob.update({
        where: { id: jobId },
        data: {
          status: job.discoveryDone || job.smartRunId ? "RUNNING" : "DISCOVERING",
          errorCode: null,
          finishedAt: null,
          failedItems: { decrement: failed },
          skippedItems: { decrement: cancelled },
        },
      });
      return { itemIds: items.map((i) => i.id), rediscover };
    },
    client,
  );
}
