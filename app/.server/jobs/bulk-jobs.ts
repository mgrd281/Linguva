import {
  Prisma,
  type PrismaClient,
  type TranslationJob,
  type TranslationJobItemStatus,
} from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { refreshCoverageOverlays } from "../coverage/items";
import { finishSmartRunIfDone } from "../smart/finish";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { displayZone } from "../../i18n/i18n";
import { ITEM_PERMANENT_CODES, NEEDS_YOU_CODES, retryHelps } from "../../lib/job-view";
import { ATTACHED_TYPES } from "../../lib/review-areas";
import { wallClock, zonedInstant } from "../../lib/schedule";
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
      const active = await tx.translationJob.findMany({
        where: {
          shopId: input.shopId,
          resourceType: input.resourceType,
          targetLocale: input.targetLocale,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
        orderBy: { createdAt: "asc" },
      });
      const fieldScope = input.fieldScope ?? "ALL";
      const includeAttached = Boolean(input.includeAttached) && fieldScope === "ALL" && ATTACHED_BULK_TYPES.has(input.resourceType);
      // A merchant's job or a smart check's job is kept, like any other active job.
      const other = active.find((job) => !isAutomaticJob(job));
      if (other) return { job: other, created: false };
      // A narrower job (search listings only) would leave the automatic job's pending items
      // without their other fields: the automatic job finishes first.
      if (active.length && fieldScope !== "ALL") return { job: active[0]!, created: false };
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
      // An automatic job (also the smart schedule's real-time one) hands over what it holds.
      for (const automatic of active) await handOverAutomaticJobTx(tx, automatic, job);
      return { job, created: true };
    },
    client,
  );
}

/** A job of automatic translation (webhooks), also the smart schedule's real-time one (no run). */
export function isAutomaticJob(job: Pick<TranslationJob, "requestedBy" | "smartRunId">): boolean {
  return job.requestedBy === AUTO_REQUESTED_BY || (job.requestedBy === SMART_REQUESTED_BY && !job.smartRunId);
}

/**
 * An automatic job hands over to the job taking its place (a merchant's
 * bulk job or a smart check's): its items that haven't started move there
 * and run once, under that job's rules. What it did before stays its own,
 * so the new job counts only its own work and translates every resource it
 * finds, also one the automatic job finished earlier today. It completes
 * once its running items are done (they keep their resources busy).
 */
export async function handOverAutomaticJobTx(tx: TenantTx, from: TranslationJob, to: TranslationJob) {
  // A resource the new job already holds (another automatic job's item, handed over first) waits
  // there once: this job's item for it is left out rather than moved twice.
  const held = await tx.translationJobItem.findMany({ where: { shopId: to.shopId, jobId: to.id }, select: { resourceGid: true } });
  const holds = { resourceGid: { in: held.map((i) => i.resourceGid) } };
  const moved = await tx.translationJobItem.updateMany({
    where: { shopId: from.shopId, jobId: from.id, status: "PENDING", ...(held.length ? { NOT: holds } : {}) },
    data: { jobId: to.id },
  });
  const twice = held.length
    ? await tx.translationJobItem.updateMany({
        where: { shopId: from.shopId, jobId: from.id, status: "PENDING", ...holds },
        data: { status: "SKIPPED", errorCode: "TAKEN_OVER", finishedAt: new Date() },
      })
    : { count: 0 };
  if (moved.count) await tx.translationJob.update({ where: { id: to.id }, data: { totalItems: { increment: moved.count } } });
  const left = await tx.translationJob.update({
    where: { id: from.id },
    data: { totalItems: { decrement: moved.count }, skippedItems: { increment: twice.count }, discoveryDone: true },
  });
  await maybeComplete(tx, left);
  return moved.count;
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
const DAY_MS = 24 * 60 * 60_000;

/** The Jobs list's tabs (`all` = no status filter) and the legacy `failed` (stopped jobs only). */
export const JOB_LIST_STATUSES = ["all", "active", "history", "problems", "completed", "cancelled", "failed"] as const;
export type JobListStatus = (typeof JOB_LIST_STATUSES)[number];
export const JOB_ORIGINS = ["you", "auto", "smart"] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];
export const JOB_SINCE = ["today", "7d", "30d", "older"] as const;
export type JobSince = (typeof JOB_SINCE)[number];

/** A job's type: a bulk type, or one of the image and custom-field types a smart check translates on their own. */
export function isJobResourceType(value: string): boolean {
  return isBulkResourceType(value) || ATTACHED_TYPES.includes(value);
}

/** How long a stop or a completed job's failures call for attention (the Problems tab, its count and the attention card). */
export const PROBLEM_WINDOW_DAYS = 14;
/** At most this many ids narrow the list (a name search's jobs). */
export const JOB_IDS_MAX = 500;

/**
 * What the Jobs list shows, every filter optional; unknown values are
 * ignored, never passed to the database.
 */
export interface JobListFilter {
  /** One of JOB_LIST_STATUSES. */
  status?: string | null;
  locale?: string | null;
  /** Legacy: one exact type (a bulk type or an attached one). */
  resourceType?: string | null;
  /** The types of an area (CATEGORIES[area].types), or one exact type; wins over resourceType. */
  types?: readonly string[] | null;
  /** you: the merchant or the team (also legacy jobs without a starter); auto; smart. */
  origin?: string | null;
  /** today, 7d, 30d (since the start of that store-zone day) or older (before the 30 days). */
  since?: string | null;
  /** The store's time zone for `since` (shopTimeZone, the zone the pages show; default UTC). */
  timeZone?: string | null;
  /** Only these jobs (a search's, at most JOB_IDS_MAX); an empty list matches nothing. */
  ids?: readonly string[] | null;
  /** The time `since` and the problem window are counted from (default: now). */
  now?: Date;
}

export interface JobPageFilter extends JobListFilter {
  /** Id of the last job of the previous page (the URL's `after`). */
  cursor?: string | null;
  /** Id of the first job of the next page (the URL's `before`): the page before it. */
  before?: string | null;
  take?: number;
}

export interface JobsPage {
  jobs: TranslationJob[];
  /** The last job's id when older jobs follow (`after`). */
  nextCursor: string | null;
  /** The first job's id when newer jobs come before (`before`). */
  prevCursor: string | null;
}

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);
const uuidOrNull = (value: string | null | undefined) => (isUuid(value) ? value : null);
/** Distinct well-formed ids, at most `max`: anything else can't reach the database. */
const validIds = (ids: readonly string[], max: number) => [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, max);
const clampTake = (take: number | undefined, fallback: number) => (Number.isFinite(take) ? Math.min(Math.max(Math.floor(take!), 1), 100) : fallback);

const ACTIVE_SQL = Prisma.sql`j."status" IN ('PENDING', 'DISCOVERING', 'RUNNING')`;

/**
 * The one problem rule (the Problems tab, its count and the attention card):
 * a stop (not for an uninstalled app) or a completed job with failed items,
 * finished in the last PROBLEM_WINDOW_DAYS days, that no newer active or
 * completed job of the same type and language has superseded. A statement
 * that uses it starts with problemWith(shopId): the newest active or
 * completed job per type and language, read once per statement (a newer
 * such job exists exactly when that newest one is newer), so the rule costs
 * one pass over the shop's jobs instead of one per problem.
 */
function problemSql(now: Date): Prisma.Sql {
  const windowStart = new Date(now.getTime() - PROBLEM_WINDOW_DAYS * DAY_MS).toISOString();
  return Prisma.sql`(
    ((j."status" = 'FAILED' AND j."errorCode" IS DISTINCT FROM 'SHOP_INACTIVE') OR (j."status" = 'COMPLETED' AND j."failedItems" > 0))
    AND COALESCE(j."finishedAt", j."updatedAt") >= ${windowStart}::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM "superseding" n
      WHERE n."resourceType" = j."resourceType" AND n."targetLocale" = j."targetLocale" AND n."newest" > j."createdAt"
    ))`;
}

/** The WITH clause problemSql reads: materialized, so it is read once and never folded back into a subquery per row. */
function problemWith(shopId: string): Prisma.Sql {
  return Prisma.sql`WITH "superseding" AS MATERIALIZED (
    SELECT "resourceType", "targetLocale", max("createdAt") AS "newest"
    FROM "TranslationJob"
    WHERE "shopId" = ${shopId}::uuid AND "status" IN ('PENDING', 'DISCOVERING', 'RUNNING', 'COMPLETED')
    GROUP BY 1, 2
  )`;
}

function statusSql(status: string | null | undefined, now: Date): Prisma.Sql | null {
  switch (status) {
    case "active":
      return ACTIVE_SQL;
    case "history":
      return Prisma.sql`j."status" IN ('COMPLETED', 'CANCELLED', 'FAILED')`;
    case "problems":
      return problemSql(now);
    case "completed":
      return Prisma.sql`j."status" = 'COMPLETED'`;
    case "cancelled":
      return Prisma.sql`j."status" = 'CANCELLED'`;
    // Old links (?status=failed) and the first Jobs list: stopped jobs only.
    case "failed":
      return Prisma.sql`j."status" = 'FAILED'`;
    default:
      return null;
  }
}

const ORIGIN_SQL: Record<JobOrigin, Prisma.Sql> = {
  // Started in Linguva: the merchant, a team member, or a job from before starters were recorded.
  you: Prisma.sql`(j."requestedBy" IS NULL OR j."requestedBy" NOT LIKE 'system:%')`,
  auto: Prisma.sql`j."requestedBy" = ${AUTO_REQUESTED_BY}`,
  smart: Prisma.sql`j."requestedBy" = ${SMART_REQUESTED_BY}`,
};

/**
 * The zone of `since`, by the pages' rule (displayZone: a missing, unknown
 * or offset zone is UTC), so "today" starts where the list's "Today" group
 * and its heading do.
 */
function validZone(timeZone: string | null | undefined): string {
  return displayZone(timeZone).zone;
}

/** Midnight in the zone that starts the local day `daysBack` days before `now`'s. */
export function localDayStart(now: Date, timeZone: string, daysBack = 0): Date {
  const zone = validZone(timeZone);
  const today = wallClock(now.getTime(), zone);
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day - daysBack));
  return new Date(zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, zone));
}

const SINCE_DAYS: Record<Exclude<JobSince, "older">, number> = { today: 0, "7d": 7, "30d": 30 };

function sinceSql(since: string | null | undefined, now: Date, timeZone: string | null | undefined): Prisma.Sql | null {
  if (since === "older") return Prisma.sql`j."createdAt" < ${localDayStart(now, validZone(timeZone), SINCE_DAYS["30d"]).toISOString()}::timestamptz`;
  if (since !== "today" && since !== "7d" && since !== "30d") return null;
  return Prisma.sql`j."createdAt" >= ${localDayStart(now, validZone(timeZone), SINCE_DAYS[since]).toISOString()}::timestamptz`;
}

/** The types to filter by: an area's (or one exact type), only types a job can have; null: no type filter. */
function typesOf(filter: JobListFilter): string[] | null {
  const asked = filter.types?.length ? filter.types : filter.resourceType ? [filter.resourceType] : [];
  const types = [...new Set(asked.filter(isJobResourceType))];
  return types.length ? types : null;
}

/** Every filter but the status, for a job row `j` of this shop. */
function filterConditions(shopId: string, filter: JobListFilter, now: Date): Prisma.Sql[] {
  const conditions = [Prisma.sql`j."shopId" = ${shopId}::uuid`];
  if (filter.locale) conditions.push(Prisma.sql`j."targetLocale" = ${filter.locale}`);
  const types = typesOf(filter);
  if (types) conditions.push(Prisma.sql`j."resourceType" = ANY(${types}::text[])`);
  if (filter.origin && (JOB_ORIGINS as readonly string[]).includes(filter.origin)) conditions.push(ORIGIN_SQL[filter.origin as JobOrigin]);
  const since = sinceSql(filter.since, now, filter.timeZone);
  if (since) conditions.push(since);
  if (filter.ids) {
    // Ids from a search: another shop's never match (shopId above, and row-level security).
    const ids = validIds(filter.ids, JOB_IDS_MAX);
    conditions.push(ids.length ? Prisma.sql`j."id" = ANY(${ids}::uuid[])` : Prisma.sql`FALSE`);
  }
  return conditions;
}

/** A page's anchor (any job of this shop, whatever the filter says of it now); null when it isn't one. */
async function jobAnchor(tx: TenantTx, shopId: string, id: string) {
  const [row] = await tx.$queryRaw<Array<{ createdAt: Date; id: string }>>`
    SELECT "createdAt", "id" FROM "TranslationJob" WHERE "shopId" = ${shopId}::uuid AND "id" = ${id}::uuid`;
  return row ? { at: row.createdAt.toISOString(), id: row.id } : null;
}

/** Whether a job matching `where` comes after (older) or before (newer) the row in the list's order. */
async function anyBeyond(tx: TenantTx, query: { with: Prisma.Sql; where: Prisma.Sql }, row: Pick<TranslationJob, "createdAt" | "id">, side: "older" | "newer") {
  const anchor = Prisma.sql`(${row.createdAt.toISOString()}::timestamptz, ${row.id}::uuid)`;
  const beyond = side === "older" ? Prisma.sql`(j."createdAt", j."id") < ${anchor}` : Prisma.sql`(j."createdAt", j."id") > ${anchor}`;
  const [found] = await tx.$queryRaw<Array<{ found: boolean }>>`
    ${query.with} SELECT EXISTS (SELECT 1 FROM "TranslationJob" j WHERE ${query.where} AND ${beyond}) AS "found"`;
  return Boolean(found?.found);
}

/**
 * One page of a shop's jobs, newest first (createdAt, then id), with optional
 * filters. Keyset pagination both ways: `cursor` (after) pages to older jobs,
 * `before` to newer ones (read oldest first, then reversed), so pages stay
 * fast and stable while jobs are added, and nothing is skipped or shown twice.
 * A cursor that isn't one of the shop's jobs is ignored (the first page).
 */
export async function listJobsPage(shopId: string, filter: JobPageFilter = {}, client: PrismaClient = defaultClient): Promise<JobsPage> {
  const take = clampTake(filter.take, 25);
  const now = filter.now ?? new Date();
  const after = uuidOrNull(filter.cursor);
  const before = after ? null : uuidOrNull(filter.before);
  return withTenant(
    shopId,
    async (tx) => {
      const conditions = filterConditions(shopId, filter, now);
      const status = statusSql(filter.status, now);
      if (status) conditions.push(status);
      const where = Prisma.join(conditions, " AND ");
      const query = { with: filter.status === "problems" ? problemWith(shopId) : Prisma.empty, where };
      const anchor = after || before ? await jobAnchor(tx, shopId, (after ?? before)!) : null;
      const at = anchor ? Prisma.sql`(${anchor.at}::timestamptz, ${anchor.id}::uuid)` : null;
      if (before && at) {
        const rows = await tx.$queryRaw<TranslationJob[]>`
          ${query.with} SELECT j.* FROM "TranslationJob" j
          WHERE ${where} AND (j."createdAt", j."id") > ${at}
          ORDER BY j."createdAt" ASC, j."id" ASC
          LIMIT ${take + 1}`;
        const jobs = rows.slice(0, take).reverse();
        const last = jobs.at(-1);
        return {
          jobs,
          prevCursor: rows.length > take ? jobs[0]!.id : null,
          nextCursor: last && (await anyBeyond(tx, query, last, "older")) ? last.id : null,
        };
      }
      const rows = await tx.$queryRaw<TranslationJob[]>`
        ${query.with} SELECT j.* FROM "TranslationJob" j
        WHERE ${where} ${at ? Prisma.sql`AND (j."createdAt", j."id") < ${at}` : Prisma.empty}
        ORDER BY j."createdAt" DESC, j."id" DESC
        LIMIT ${take + 1}`;
      const jobs = rows.slice(0, take);
      const first = jobs[0];
      return {
        jobs,
        nextCursor: rows.length > take ? jobs[take - 1]!.id : null,
        prevCursor: at && first && (await anyBeyond(tx, query, first, "newer")) ? first.id : null,
      };
    },
    client,
  );
}

/**
 * The figures of the tabs (with the filters, without a status): history = everything not active (tab
 * All's pages); problemsNeedYou = the problems that need the merchant (a completed job's failed items, or
 * a stop whose cause needs them: NEEDS_YOU_CODES), so the Problems tile's dot is critical only then.
 */
export interface JobCounts {
  all: number;
  active: number;
  queued: number;
  history: number;
  problems: number;
  problemsNeedYou: number;
  completed: number;
  cancelled: number;
}

/** Every tab's count in one statement, with the list's filters (status left out). */
export async function jobCounts(shopId: string, filter: JobListFilter = {}, now: Date = filter.now ?? new Date(), client: PrismaClient = defaultClient): Promise<JobCounts> {
  const where = Prisma.join(filterConditions(shopId, filter, now), " AND ");
  const needsYou = Prisma.sql`(j."status" = 'COMPLETED' OR j."errorCode" = ANY(${[...NEEDS_YOU_CODES]}::text[]))`;
  const [row] = await withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<Array<Omit<JobCounts, "history">>>`
        ${problemWith(shopId)}
        SELECT count(*)::int AS "all",
               count(*) FILTER (WHERE ${ACTIVE_SQL})::int AS "active",
               count(*) FILTER (WHERE j."status" = 'PENDING')::int AS "queued",
               count(*) FILTER (WHERE j."status" = 'COMPLETED')::int AS "completed",
               count(*) FILTER (WHERE j."status" = 'CANCELLED')::int AS "cancelled",
               count(*) FILTER (WHERE ${problemSql(now)})::int AS "problems",
               count(*) FILTER (WHERE ${problemSql(now)} AND ${needsYou})::int AS "problemsNeedYou"
        FROM "TranslationJob" j
        WHERE ${where}`,
    client,
  );
  const counts = row ?? { all: 0, active: 0, queued: 0, completed: 0, cancelled: 0, problems: 0, problemsNeedYou: 0 };
  return { ...counts, history: counts.all - counts.active };
}

/** The live group: active jobs with the list's filters, running first, then finding, then queued; newest first within each. */
export async function listActiveJobs(shopId: string, filter: JobListFilter = {}, take = 21, client: PrismaClient = defaultClient): Promise<TranslationJob[]> {
  const limit = clampTake(take, 21);
  const now = filter.now ?? new Date();
  const where = Prisma.join([...filterConditions(shopId, filter, now), ACTIVE_SQL], " AND ");
  return withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<TranslationJob[]>`
        SELECT j.* FROM "TranslationJob" j
        WHERE ${where}
        ORDER BY CASE WHEN j."status" = 'RUNNING' AND j."discoveryDone" THEN 0 WHEN j."status" IN ('DISCOVERING', 'RUNNING') THEN 1 ELSE 2 END,
                 j."createdAt" DESC, j."id" DESC
        LIMIT ${limit}`,
    client,
  );
}

/**
 * What a job row needs beyond its counters: items waiting for approval
 * (succeeded, not partly, with a pending draft of the job: its own fields or
 * its images' and custom fields'), partly translated, refused by the checks,
 * changed originals, cancelled, and failed items a new try can fix
 * (retryHelps).
 */
export interface RowOutcomes {
  waiting: number;
  partial: number;
  rejected: number;
  sourceChanged: number;
  cancelled: number;
  retryable: number;
}

/** At most this many jobs per call (a page of 25 and the live group's 21). */
export const ROW_OUTCOME_JOBS_MAX = 100;

/** A failed item a new try can fix, in SQL (retryHelps): DEAD, or FAILED without a permanent code. */
const RETRYABLE_SQL = Prisma.sql`(i."status" = 'DEAD' OR (i."status" = 'FAILED' AND (i."errorCode" IS NULL OR i."errorCode" <> ALL(${[...ITEM_PERMANENT_CODES]}::text[]))))`;

/**
 * Per job of `ids`: its items with at least one pending draft of the job (the
 * waiting rule of RowOutcomes), through the item's own drafts or those of its
 * images and custom fields (parentGid). Two joins on (jobId, resourceGid), each
 * driven by the jobs' pending drafts: never one join with an OR.
 */
function waitingSql(shopId: string, ids: readonly string[]): Prisma.Sql {
  const drafts = Prisma.sql`d."shopId" = ${shopId}::uuid AND d."jobId" = ANY(${[...ids]}::uuid[]) AND d."status" = 'PENDING'`;
  const items = Prisma.sql`i."shopId" = ${shopId}::uuid AND i."status" = 'SUCCEEDED' AND i."errorCode" IS DISTINCT FROM 'PARTIAL'`;
  return Prisma.sql`
    SELECT x."jobId", count(DISTINCT x."itemId")::int AS "waiting"
    FROM (
      SELECT i."jobId", i."id" AS "itemId" FROM "TranslationDraft" d
      JOIN "TranslationJobItem" i ON i."jobId" = d."jobId" AND i."resourceGid" = d."resourceGid"
      WHERE ${drafts} AND ${items}
      UNION ALL
      SELECT i."jobId", i."id" AS "itemId" FROM "TranslationDraft" d
      JOIN "TranslationJobItem" i ON i."jobId" = d."jobId" AND i."resourceGid" = d."parentGid"
      WHERE ${drafts} AND d."parentGid" IS NOT NULL AND ${items}
    ) x
    GROUP BY 1`;
}

/**
 * RowOutcomes for each of `jobIds` (zeros for a job without such items, and
 * for an id that isn't one of the shop's jobs). One statement; it reads only
 * the items with a problem code, a cancel or a failure, and the pending
 * drafts' items.
 */
export async function rowOutcomesByJob(shopId: string, jobIds: readonly string[], client: PrismaClient = defaultClient): Promise<Record<string, RowOutcomes>> {
  const ids = validIds(jobIds, ROW_OUTCOME_JOBS_MAX);
  if (!ids.length) return {};
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<Array<RowOutcomes & { jobId: string }>>`
        WITH w AS (${waitingSql(shopId, ids)}),
        o AS (
          SELECT i."jobId",
                 count(*) FILTER (WHERE i."status" = 'SUCCEEDED' AND i."errorCode" = 'PARTIAL')::int AS "partial",
                 count(*) FILTER (WHERE i."status" = 'SKIPPED' AND i."errorCode" = 'ALL_FIELDS_REJECTED')::int AS "rejected",
                 count(*) FILTER (WHERE i."status" = 'SKIPPED' AND i."errorCode" = 'SOURCE_CHANGED')::int AS "sourceChanged",
                 count(*) FILTER (WHERE i."status" = 'CANCELLED')::int AS "cancelled",
                 count(*) FILTER (WHERE ${RETRYABLE_SQL})::int AS "retryable"
          FROM "TranslationJobItem" i
          WHERE i."shopId" = ${shopId}::uuid AND i."jobId" = ANY(${ids}::uuid[])
            AND (i."status" IN ('FAILED', 'DEAD', 'CANCELLED') OR i."errorCode" IN ('PARTIAL', 'ALL_FIELDS_REJECTED', 'SOURCE_CHANGED'))
          GROUP BY 1
        )
        SELECT x."id"::text AS "jobId",
               COALESCE(w."waiting", 0)::int AS "waiting",
               COALESCE(o."partial", 0)::int AS "partial",
               COALESCE(o."rejected", 0)::int AS "rejected",
               COALESCE(o."sourceChanged", 0)::int AS "sourceChanged",
               COALESCE(o."cancelled", 0)::int AS "cancelled",
               COALESCE(o."retryable", 0)::int AS "retryable"
        FROM unnest(${ids}::uuid[]) AS x("id")
        LEFT JOIN w ON w."jobId" = x."id"
        LEFT JOIN o ON o."jobId" = x."id"`,
    client,
  );
  return Object.fromEntries(rows.map(({ jobId, ...outcomes }) => [jobId, outcomes]));
}

/**
 * A job's review step: its pending drafts (what Review shows for the job) and
 * the items they belong to (the waiting figure of its legend).
 */
export async function jobPendingDrafts(shopId: string, jobId: string, client: PrismaClient = defaultClient): Promise<{ translations: number; items: number }> {
  if (!isUuid(jobId)) return { translations: 0, items: 0 };
  const [row] = await withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<Array<{ translations: number; items: number }>>`
        SELECT (SELECT count(*)::int FROM "TranslationDraft" d
                WHERE d."shopId" = ${shopId}::uuid AND d."jobId" = ${jobId}::uuid AND d."status" = 'PENDING') AS "translations",
               COALESCE((SELECT w."waiting" FROM (${waitingSql(shopId, [jobId])}) w), 0)::int AS "items"`,
    client,
  );
  return row ?? { translations: 0, items: 0 };
}

export interface LatestTitle {
  resourceGid: string;
  /** The original's title when the job drafted it (null: the page reads names live). */
  title: string | null;
  /** Its translation. */
  translated: string | null;
}

/**
 * What a running job translated last (at most five): its newest title drafts
 * (waiting or published, never a refused attempt) with the original and the
 * translation; without any (automatic publishing, or a kind without titles)
 * its newest finished items, whose names the page reads live.
 */
export async function latestJobTitles(shopId: string, jobId: string, client: PrismaClient = defaultClient): Promise<LatestTitle[]> {
  if (!isUuid(jobId)) return [];
  return withTenant(
    shopId,
    async (tx) => {
      const job = await tx.translationJob.findFirst({ where: { id: jobId, shopId }, select: { id: true } });
      if (!job) return [];
      const drafts = await tx.translationDraft.findMany({
        where: { shopId, jobId, key: "title", status: { in: ["PENDING", "PUBLISHED"] } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
        select: { resourceGid: true, resourceTitle: true, value: true },
      });
      if (drafts.length) return drafts.map((d) => ({ resourceGid: d.resourceGid, title: d.resourceTitle, translated: d.value }));
      const items = await tx.translationJobItem.findMany({
        where: { shopId, jobId, status: "SUCCEEDED" },
        orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: 5,
        select: { resourceGid: true },
      });
      return items.map((i) => ({ resourceGid: i.resourceGid, title: null, translated: null }));
    },
    client,
  );
}

/** What calls for the merchant on the Jobs list (the attention card), by the one problem rule. */
export interface JobsAttention {
  /** Stops: how many, and the newest (by when they stopped) up to ATTENTION_STOPS. */
  stops: { count: number; jobs: TranslationJob[] };
  /**
   * Failed items of completed jobs only (an active job shows its own on its
   * row and page): their sum, how many of them a new try can fix (over the
   * newest ATTENTION_FAILED_JOBS jobs; fewer than `count` means some can't,
   * or weren't looked at), the number of jobs, the two newest, and whether
   * all of them are of one kind.
   */
  failed: { count: number; retryable: number; jobCount: number; jobs: TranslationJob[]; sameKind: boolean };
}

export const ATTENTION_STOPS = 4;
export const ATTENTION_FAILED_JOBS = 20;

export async function jobsAttention(shopId: string, now: Date = new Date(), client: PrismaClient = defaultClient): Promise<JobsAttention> {
  const where = Prisma.sql`j."shopId" = ${shopId}::uuid AND ${problemSql(now)}`;
  const latest = Prisma.sql`COALESCE(j."finishedAt", j."updatedAt") DESC, j."id" DESC`;
  return withTenant(
    shopId,
    async (tx) => {
      const [totals] = await tx.$queryRaw<Array<{ stops: number; failedJobs: number; failedItems: number; kinds: number }>>`
        ${problemWith(shopId)}
        SELECT count(*) FILTER (WHERE j."status" = 'FAILED')::int AS "stops",
               count(*) FILTER (WHERE j."status" = 'COMPLETED')::int AS "failedJobs",
               COALESCE(sum(j."failedItems") FILTER (WHERE j."status" = 'COMPLETED'), 0)::int AS "failedItems",
               count(DISTINCT j."resourceType") FILTER (WHERE j."status" = 'COMPLETED')::int AS "kinds"
        FROM "TranslationJob" j
        WHERE ${where}`;
      const stops = totals?.stops
        ? await tx.$queryRaw<TranslationJob[]>`
            ${problemWith(shopId)} SELECT j.* FROM "TranslationJob" j WHERE ${where} AND j."status" = 'FAILED' ORDER BY ${latest} LIMIT ${ATTENTION_STOPS}`
        : [];
      const failedJobs = totals?.failedJobs
        ? await tx.$queryRaw<TranslationJob[]>`
            ${problemWith(shopId)} SELECT j.* FROM "TranslationJob" j WHERE ${where} AND j."status" = 'COMPLETED' ORDER BY ${latest} LIMIT ${ATTENTION_FAILED_JOBS}`
        : [];
      let retryable = 0;
      if (failedJobs.length) {
        const [row] = await tx.$queryRaw<Array<{ retryable: number }>>`
          SELECT count(*)::int AS "retryable" FROM "TranslationJobItem" i
          WHERE i."shopId" = ${shopId}::uuid AND i."jobId" = ANY(${failedJobs.map((j) => j.id)}::uuid[])
            AND i."status" IN ('FAILED', 'DEAD') AND ${RETRYABLE_SQL}`;
        retryable = row?.retryable ?? 0;
      }
      return {
        stops: { count: totals?.stops ?? 0, jobs: stops },
        failed: {
          count: totals?.failedItems ?? 0,
          retryable,
          jobCount: totals?.failedJobs ?? 0,
          jobs: failedJobs.slice(0, 2),
          sameKind: totals?.kinds === 1,
        },
      };
    },
    client,
  );
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
 * Puts the failed items a new try can fix (retryHelps: DEAD, and FAILED
 * without a permanent code) and, for a stopped job, its cancelled items back
 * to PENDING and reopens the job. A permanent failure stays failed (and
 * counted): only the editor finishes it. Returns the item ids to enqueue
 * again; busy, with the blocking job's id, while another job of the same type
 * and language is active. The Jobs pages and the smart page's "retry failed"
 * (retrySmartRun) both go through here.
 */
export async function retryJobItems(
  shopId: string,
  jobId: string,
  client: PrismaClient = defaultClient,
): Promise<{ itemIds: string[]; rediscover: boolean; busy?: true; busyJobId?: string }> {
  return withTenant(
    shopId,
    async (tx) => {
      const job = await tx.translationJob.findFirst({ where: { id: jobId, shopId } });
      // A job the merchant cancelled stays cancelled.
      if (!job || job.status === "CANCELLED") return { itemIds: [], rediscover: false };
      // One active job per shop, type and language, under the lock every job creation takes: while
      // another one runs (one that took over from this automatic job, say), this one stays finished.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${shopId}:${job.resourceType}:${job.targetLocale}`}, 0))`;
      const other = await tx.translationJob.findFirst({
        where: { shopId, resourceType: job.resourceType, targetLocale: job.targetLocale, status: { in: [...ACTIVE_JOB_STATUSES] }, id: { not: job.id } },
        select: { id: true },
      });
      if (other) return { itemIds: [], rediscover: false, busy: true as const, busyJobId: other.id };
      const statuses: TranslationJobItemStatus[] =
        job.status === "FAILED" ? ["FAILED", "DEAD", "CANCELLED"] : ["FAILED", "DEAD"];
      const found = await tx.translationJobItem.findMany({
        where: { jobId, shopId, status: { in: statuses } },
        select: { id: true, status: true, errorCode: true },
      });
      // A permanent failure (the service refused the content, Shopify refused the request, too big
      // for the limit) would only fail again: it stays as it is.
      const items = found.filter((i) => i.status === "CANCELLED" || retryHelps(i.status, i.errorCode));
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
