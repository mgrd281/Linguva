import type {
  PrismaClient,
  TranslationJob,
  TranslationJobItemStatus,
} from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";

export const ACTIVE_JOB_STATUSES = ["PENDING", "DISCOVERING", "RUNNING"] as const;
const TERMINAL_ITEM_STATUSES: TranslationJobItemStatus[] = [
  "SUCCEEDED",
  "SKIPPED",
  "FAILED",
  "DEAD",
  "CANCELLED",
];

export const SUPPORTED_BULK_RESOURCE_TYPES = ["PRODUCT", "COLLECTION"] as const;
export type BulkResourceType = (typeof SUPPORTED_BULK_RESOURCE_TYPES)[number];

export function isBulkResourceType(value: string): value is BulkResourceType {
  return (SUPPORTED_BULK_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Creates a bulk job, or returns the existing one when the same request is
 * repeated (idempotency key) or a job for the same locale is still running.
 */
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
          fieldScope: input.fieldScope ?? "ALL",
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

export async function listJobsForShop(
  shopId: string,
  options: { take?: number } = {},
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: options.take ?? 25,
      }),
    client,
  );
}

export async function listProblemItems(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJobItem.findMany({
        where: { shopId, jobId, status: { in: ["FAILED", "DEAD"] } },
        orderBy: { updatedAt: "desc" },
        take: 50,
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
  charsBilled?: number;
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
  return withTenant(
    shopId,
    async (tx) => {
      const item = await tx.translationJobItem.findFirst({ where: { id: itemId, shopId } });
      if (!item) return false;
      const updated = await tx.translationJobItem.updateMany({
        where: { id: itemId, shopId, status: { notIn: TERMINAL_ITEM_STATUSES } },
        data: {
          status: result.status,
          errorCode: result.errorCode ?? null,
          fieldsTranslated: result.fieldsTranslated ?? 0,
          fieldsRejected: result.fieldsRejected ?? 0,
          charsBilled: result.charsBilled ?? 0,
          finishedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;

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
          charsBilled: { increment: result.charsBilled ?? 0 },
          memoryHits: { increment: result.memoryHits ?? 0 },
          charsSaved: { increment: result.charsSaved ?? 0 },
          protectedSkipped: { increment: result.protectedSkipped ?? 0 },
        },
      });
      await maybeComplete(tx, job);
      return true;
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
  await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.updateMany({
        where: { id: jobId, shopId, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: "FAILED", errorCode, finishedAt: new Date() },
      }),
    client,
  );
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
      const rediscover = job.status === "FAILED" && !job.discoveryDone;
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
          status: job.discoveryDone ? "RUNNING" : "DISCOVERING",
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
