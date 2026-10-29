/**
 * Translation coverage scan: reads every translatable resource type (and
 * custom fields per owner type) page by page for each target language and
 * keeps the live coverage items (items.ts) and the scan state per language
 * and type (CoverageSegment). It never writes to Shopify, never calls a
 * translation provider and never stores merchant text: only keys, states,
 * counts, ids and a hash of the translated SEO title.
 */
import type { CoverageReport, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { AccessDeniedError, getTranslatableResource, listTranslatableResources, type TranslatableResourceData } from "../shopify/translations-api";
import { listOwnerMetafields, METAFIELD_OWNER_TYPES, type MetafieldOwnerType } from "../shopify/metafield-owners";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { shopKey } from "../queue/redis";
import { RateLimitedError } from "../jobs/errors";
import type { Admin, Limiter } from "../jobs/processors";
import { CONTENT_TYPES, IMAGE_COVERAGE_TYPES, kindOfGid, RESOURCE_KINDS, type TranslatableKind } from "../../lib/resource-kinds";
import { dropCoverageItemsTx, finishSegmentTx, syncCoverageTx, type CoverageChange } from "./items";

/** Custom fields of each owner type ("PRODUCT_METAFIELD", …). */
export const METAFIELD_COVERAGE_TYPES = METAFIELD_OWNER_TYPES.map((owner) => `${owner}_METAFIELD` as const);
export type MetafieldCoverageType = (typeof METAFIELD_COVERAGE_TYPES)[number];

/**
 * Every type the scan reads, in this order: the catalog and online store
 * first (what merchants check first), then image alt text, custom fields,
 * and the other Shopify translatable resource types (Admin API 2026-10;
 * the deprecated METAFIELD listing is replaced by the per-owner custom
 * fields).
 */
export const COVERAGE_TYPES: readonly string[] = [
  ...Object.keys(RESOURCE_KINDS),
  ...Object.keys(IMAGE_COVERAGE_TYPES),
  ...METAFIELD_COVERAGE_TYPES,
  ...Object.keys(CONTENT_TYPES),
];
export const COVERAGE_PAGE_SIZE = 50;
/**
 * Theme resources carry thousands of texts each (a theme's language file),
 * so they are read a few at a time to keep each response small and fast.
 */
export const THEME_PAGE_SIZE = 5;

export function pageSizeFor(resourceType: string, pageSize: number): number {
  return resourceType.startsWith("ONLINE_STORE_THEME") ? Math.min(pageSize, THEME_PAGE_SIZE) : pageSize;
}
const PAGE_COST = 60;
const ACTIVE: CoverageReport["status"][] = ["QUEUED", "RUNNING"];
/** A report with no progress for this long is treated as lost (for example Redis was down). */
export const STALE_REPORT_MS = 30 * 60 * 1000;

const ownerOf = (type: string): MetafieldOwnerType | null =>
  type.endsWith("_METAFIELD") ? (type.slice(0, -"_METAFIELD".length) as MetafieldOwnerType) : null;

export interface CoverageDeps {
  prisma: PrismaClient;
  adminFor(shopDomain: string): Promise<Admin>;
  keyPrefix: string;
  shopifyLimiter?: Limiter;
  pageSize?: number;
}

export interface CoveragePagePayload {
  shopId: string;
  reportId: string;
  segmentIndex: number;
  cursor: string | null;
}

export function segmentOf(report: Pick<CoverageReport, "segments">, index: number) {
  const value = report.segments[index];
  if (!value) return null;
  const [resourceType, locale] = value.split("|") as [string, string];
  return { resourceType, locale };
}

/**
 * Starts a report for the given target languages, or returns the running
 * one (one report at a time per shop) or the one this request already made.
 */
export async function createCoverageReport(
  input: { shopId: string; locales: readonly string[]; requestedBy: string | null; idempotencyKey: string },
  client: PrismaClient = defaultClient,
): Promise<{ report: CoverageReport; created: boolean }> {
  const locales = [...new Set(input.locales)].filter((l) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l));
  if (locales.length === 0) throw new Error("No target languages");
  return withTenant(
    input.shopId,
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coverage:${input.shopId}`}, 0))`;
      const repeated = await tx.coverageReport.findUnique({
        where: { shopId_idempotencyKey: { shopId: input.shopId, idempotencyKey: input.idempotencyKey } },
      });
      if (repeated) return { report: repeated, created: false };
      const active = await tx.coverageReport.findFirst({
        where: { shopId: input.shopId, status: { in: ACTIVE } },
      });
      if (active && Date.now() - active.updatedAt.getTime() < STALE_REPORT_MS) return { report: active, created: false };
      if (active) {
        await tx.coverageReport.update({
          where: { id: active.id },
          data: { status: "FAILED", errorCode: "STALLED", finishedAt: new Date() },
        });
        // Its half-read types stay "not fully read" while the new report runs (as failCoverageReport does).
        await tx.coverageSegment.updateMany({
          where: { shopId: input.shopId, reportId: active.id, status: "SCANNING" },
          data: { status: "FAILED", errorCode: "STALLED" },
        });
      }
      const report = await tx.coverageReport.create({
        data: {
          shopId: input.shopId,
          requestedBy: input.requestedBy,
          idempotencyKey: input.idempotencyKey,
          segments: COVERAGE_TYPES.flatMap((type) => locales.map((l) => `${type}|${l}`)),
        },
      });
      // Keep the latest few reports; older ones are only history. The newest
      // completed one always stays: the Overview's percentages come from it,
      // even after several failed measurements in a row.
      const keep = await tx.coverageReport.findFirst({
        where: { shopId: input.shopId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const old = await tx.coverageReport.findMany({
        where: { shopId: input.shopId, status: { notIn: ACTIVE } },
        orderBy: { createdAt: "desc" },
        skip: 4,
        select: { id: true },
      });
      const doomed = old.filter((r) => r.id !== keep?.id).map((r) => r.id);
      if (doomed.length) await tx.coverageReport.deleteMany({ where: { id: { in: doomed } } });
      return { report, created: true };
    },
    client,
  );
}

async function throttle(deps: CoverageDeps, shopId: string) {
  if (!deps.shopifyLimiter) return;
  const wait = await deps.shopifyLimiter.take(shopKey(deps.keyPrefix, shopId, "rl", "shopify"), PAGE_COST);
  if (wait > 0) throw new RateLimitedError(wait);
}

/**
 * Scans one page and returns the next page to scan, or null when the report
 * is finished or this page was already processed (a repeated queue job).
 */
export async function runCoveragePage(deps: CoverageDeps, payload: CoveragePagePayload): Promise<CoveragePagePayload | null> {
  const report = await withTenant(
    payload.shopId,
    (tx) => tx.coverageReport.findFirst({ where: { id: payload.reportId, shopId: payload.shopId } }),
    deps.prisma,
  );
  if (!report || !ACTIVE.includes(report.status)) return null;
  if (report.segmentIndex !== payload.segmentIndex || report.cursor !== payload.cursor) return null;
  const segment = segmentOf(report, payload.segmentIndex);
  if (!segment) return null;

  const shop = await deps.prisma.shop.findUnique({ where: { id: payload.shopId } });
  if (!shop || shop.status !== "ACTIVE") {
    await failCoverageReport(payload.shopId, report.id, "SHOP_INACTIVE", deps.prisma);
    return null;
  }

  await throttle(deps, payload.shopId);
  const admin = await deps.adminFor(shop.shopDomain);
  // Items found by this page are "seen" at the time it was read; a save
  // made after the read stays newer than what the page found.
  const readAt = new Date();
  let page: { changes: CoverageChange[]; scanned: number; hasNextPage: boolean; endCursor: string | null } | "denied";
  try {
    page = await readPage(admin, segment.resourceType, segment.locale, payload.cursor, deps.pageSize ?? COVERAGE_PAGE_SIZE, readAt);
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) throw error;
    page = "denied";
  }

  const more = page !== "denied" && page.hasNextPage && page.endCursor;
  const nextIndex = more ? payload.segmentIndex : payload.segmentIndex + 1;
  const nextCursor = more ? (page as { endCursor: string }).endCursor : null;
  const finished = nextIndex >= report.segments.length;

  return withTenant(
    payload.shopId,
    async (tx) => {
      // Advances only from the position this page was read at, so a repeated
      // job can't count the same page twice.
      const advanced = await tx.coverageReport.updateMany({
        where: {
          id: report.id,
          shopId: payload.shopId,
          status: { in: ACTIVE },
          segmentIndex: payload.segmentIndex,
          cursor: payload.cursor,
        },
        data: {
          status: finished ? "COMPLETED" : "RUNNING",
          segmentIndex: nextIndex,
          cursor: nextCursor,
          pagesScanned: { increment: 1 },
          resourcesScanned: { increment: page === "denied" ? 0 : page.scanned },
          startedAt: report.startedAt ?? new Date(),
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });
      if (advanced.count === 0) return null;
      const key = { shopId_locale_resourceType: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType } };
      if (page === "denied") {
        // Without the scope nothing of the type can be read or translated:
        // earlier results are removed rather than shown as current.
        await tx.coverageItem.deleteMany({ where: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType } });
        await tx.coverageCount.deleteMany({ where: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType } });
        await tx.coverageSegment.upsert({
          where: key,
          create: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType, status: "DENIED", reportId: report.id, scannedAt: readAt, errorCode: "ACCESS_DENIED" },
          update: { status: "DENIED", reportId: report.id, startedAt: null, scannedAt: readAt, errorCode: "ACCESS_DENIED" },
        });
      } else {
        if (payload.cursor === null) {
          await tx.coverageSegment.upsert({
            where: key,
            create: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType, status: "SCANNING", reportId: report.id, startedAt: readAt },
            update: { status: "SCANNING", reportId: report.id, startedAt: readAt, errorCode: null },
          });
        }
        await syncCoverageTx(tx, payload.shopId, segment.locale, page.changes, { create: true, seen: true });
        if (!more) await finishSegment(tx, payload.shopId, segment.locale, segment.resourceType, readAt);
      }
      return finished ? null : { shopId: payload.shopId, reportId: report.id, segmentIndex: nextIndex, cursor: nextCursor };
    },
    deps.prisma,
  );
}

async function readPage(admin: Admin, resourceType: string, locale: string, cursor: string | null, pageSize: number, readAt: Date) {
  const owner = ownerOf(resourceType);
  const toChange = (r: TranslatableResourceData, parentGid: string | null): CoverageChange => ({
    resourceGid: r.resourceId,
    resourceType,
    parentGid,
    observed: { data: r, at: readAt },
  });
  if (owner) {
    const result = await listOwnerMetafields(admin, { owner, locale, after: cursor });
    return {
      changes: result.resources.map((r) => toChange(r, r.ownerGid)),
      scanned: result.resources.length,
      hasNextPage: result.pageInfo.hasNextPage,
      endCursor: result.pageInfo.endCursor,
    };
  }
  const result = await listTranslatableResources(admin, { resourceType: resourceType as TranslatableKind, locale, after: cursor, first: pageSizeFor(resourceType, pageSize) });
  return {
    changes: result.resources.map((r) => toChange(r, null)),
    scanned: result.resources.length,
    hasNextPage: result.pageInfo.hasNextPage,
    endCursor: result.pageInfo.endCursor,
  };
}

/** Removes what the scan of a segment didn't find, rebuilds its counts and marks it scanned. */
async function finishSegment(tx: TenantTx, shopId: string, locale: string, resourceType: string, now: Date) {
  const segment = await tx.coverageSegment.findUnique({ where: { shopId_locale_resourceType: { shopId, locale, resourceType } } });
  await finishSegmentTx(tx, shopId, locale, resourceType, segment?.startedAt ?? now);
  await tx.coverageSegment.update({
    where: { shopId_locale_resourceType: { shopId, locale, resourceType } },
    data: { status: "SCANNED", scannedAt: now, errorCode: null },
  });
}

export async function failCoverageReport(shopId: string, reportId: string, errorCode: string, client: PrismaClient = defaultClient) {
  await withTenant(
    shopId,
    async (tx) => {
      await tx.coverageReport.updateMany({
        where: { id: reportId, shopId, status: { in: ACTIVE } },
        data: { status: "FAILED", errorCode, finishedAt: new Date() },
      });
      // The segment being read keeps its earlier items, marked as not fully scanned.
      await tx.coverageSegment.updateMany({ where: { shopId, reportId, status: "SCANNING" }, data: { status: "FAILED", errorCode } });
    },
    client,
  );
}


export interface CoverageRefreshPayload {
  shopId: string;
  resourceGid: string;
}

/**
 * Reads one resource again in every language whose type was scanned (after
 * a products/collections webhook: the original may have changed, which
 * makes translations outdated). A resource Shopify no longer returns is
 * removed from coverage.
 */
export async function refreshCoverageResource(deps: CoverageDeps, payload: CoverageRefreshPayload) {
  const resourceType = kindOfGid(payload.resourceGid);
  if (!resourceType) return { refreshed: 0 };
  const shop = await deps.prisma.shop.findUnique({ where: { id: payload.shopId } });
  if (!shop || shop.status !== "ACTIVE") return { refreshed: 0 };
  const segments = await withTenant(
    payload.shopId,
    (tx) => tx.coverageSegment.findMany({ where: { shopId: payload.shopId, resourceType, status: "SCANNED" } }),
    deps.prisma,
  );
  if (!segments.length) return { refreshed: 0 };
  const admin = await deps.adminFor(shop.shopDomain);
  let refreshed = 0;
  for (const segment of segments) {
    await throttle(deps, payload.shopId);
    const at = new Date();
    const data = await getTranslatableResource(admin, payload.resourceGid, segment.locale);
    await withTenant(
      payload.shopId,
      async (tx) => {
        if (data) {
          refreshed += await syncCoverageTx(
            tx,
            payload.shopId,
            segment.locale,
            [{ resourceGid: payload.resourceGid, resourceType, observed: { data, at } }],
            { create: true, seen: true },
          );
        } else {
          await dropCoverageItemsTx(tx, payload.shopId, segment.locale, [payload.resourceGid]);
        }
      },
      deps.prisma,
    );
  }
  return { refreshed };
}

/**
 * Gives up on the segment a page belongs to (its type keeps earlier items,
 * marked "scan didn't finish") and returns the first page of the next
 * segment, or null when the report is finished or the position moved on.
 * Used when one type keeps failing after every retry, so the other types
 * are still scanned.
 */
export async function skipCoverageSegment(
  client: PrismaClient,
  payload: CoveragePagePayload,
  errorCode: string,
): Promise<CoveragePagePayload | null> {
  return withTenant(
    payload.shopId,
    async (tx) => {
      const report = await tx.coverageReport.findFirst({ where: { id: payload.reportId, shopId: payload.shopId } });
      if (!report) return null;
      const segment = segmentOf(report, payload.segmentIndex);
      const nextIndex = payload.segmentIndex + 1;
      const finished = nextIndex >= report.segments.length;
      const moved = await tx.coverageReport.updateMany({
        where: { id: report.id, shopId: payload.shopId, status: { in: ACTIVE }, segmentIndex: payload.segmentIndex, cursor: payload.cursor },
        data: {
          status: finished ? "COMPLETED" : "RUNNING",
          segmentIndex: nextIndex,
          cursor: null,
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });
      if (moved.count === 0) return null;
      if (segment) {
        const key = { shopId_locale_resourceType: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType } };
        await tx.coverageSegment.upsert({
          where: key,
          create: { shopId: payload.shopId, locale: segment.locale, resourceType: segment.resourceType, status: "FAILED", reportId: report.id, errorCode },
          update: { status: "FAILED", reportId: report.id, errorCode },
        });
      }
      return finished ? null : { shopId: payload.shopId, reportId: report.id, segmentIndex: nextIndex, cursor: null };
    },
    client,
  );
}
