/**
 * Read side of the coverage dashboard: counts per language, type, field
 * group and state, the scan state of each language and type, SEO findings,
 * and the items behind any number (paged, filtered on indexed columns).
 */
import type { CoverageSegmentStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { loadCounts, type CountRow } from "./items";
import { FIELD_STATES, type FieldGroup, type FieldState } from "../../lib/coverage-rules";

export interface SegmentInfo {
  locale: string;
  resourceType: string;
  status: CoverageSegmentStatus;
  scannedAt: string | null;
  errorCode: string | null;
}

export interface CoverageSummary {
  report: {
    id: string;
    status: string;
    errorCode: string | null;
    segments: string[];
    segmentIndex: number;
    resourcesScanned: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  segments: SegmentInfo[];
  counts: CountRow[];
  /** Items per language and type (counted items with text to translate). */
  items: Array<{ locale: string; resourceType: string; count: number }>;
  seo: {
    issues: Array<{ locale: string; resourceType: string; count: number }>;
    duplicateTitles: Record<string, number>;
    missingSourceTitle: Array<{ locale: string; resourceType: string; count: number }>;
  };
}

/** Types with an SEO title of their own (search engine listing). */
const SEO_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE"];

export async function loadCoverageSummary(shopId: string, client: PrismaClient = defaultClient): Promise<CoverageSummary> {
  const counts = await loadCounts(shopId, client);
  return withTenant(
    shopId,
    async (tx) => {
      const [report, segments, items, issues, dupes, missingTitle] = await Promise.all([
        tx.coverageReport.findFirst({ where: { shopId }, orderBy: { createdAt: "desc" } }),
        tx.coverageSegment.findMany({ where: { shopId } }),
        tx.coverageItem.groupBy({ by: ["locale", "resourceType"], where: { shopId, NOT: { sourceKeys: { isEmpty: true } } }, _count: { _all: true } }),
        tx.coverageItem.groupBy({ by: ["locale", "resourceType"], where: { shopId, seoIssues: { gt: 0 } }, _sum: { seoIssues: true } }),
        tx.$queryRaw<Array<{ locale: string; count: number }>>`
          SELECT "locale", SUM(n)::integer AS "count" FROM (
            SELECT "locale", "seoTitleHash", count(*) AS n FROM "CoverageItem"
            WHERE "shopId" = ${shopId}::uuid AND "seoTitleHash" IS NOT NULL
            GROUP BY "locale", "seoTitleHash" HAVING count(*) > 1
          ) d GROUP BY "locale"`,
        tx.$queryRaw<Array<{ locale: string; resourceType: string; count: number }>>`
          SELECT "locale", "resourceType", count(*)::integer AS "count" FROM "CoverageItem"
          WHERE "shopId" = ${shopId}::uuid AND "resourceType" = ANY(${SEO_TYPES}::text[])
            AND NOT ('meta_title' = ANY("sourceKeys"))
          GROUP BY "locale", "resourceType"`,
      ]);
      return {
        report: report
          ? {
              id: report.id,
              status: report.status,
              errorCode: report.errorCode,
              segments: report.segments,
              segmentIndex: report.segmentIndex,
              resourcesScanned: report.resourcesScanned,
              createdAt: report.createdAt.toISOString(),
              startedAt: report.startedAt?.toISOString() ?? null,
              finishedAt: report.finishedAt?.toISOString() ?? null,
            }
          : null,
        segments: segments.map((s) => ({
          locale: s.locale,
          resourceType: s.resourceType,
          status: s.status,
          scannedAt: s.scannedAt?.toISOString() ?? null,
          errorCode: s.errorCode,
        })),
        counts,
        items: items.map((i) => ({ locale: i.locale, resourceType: i.resourceType, count: i._count._all })),
        seo: {
          issues: issues.map((i) => ({ locale: i.locale, resourceType: i.resourceType, count: i._sum.seoIssues ?? 0 })),
          duplicateTitles: Object.fromEntries(dupes.map((d) => [d.locale, d.count])),
          missingSourceTitle: missingTitle,
        },
      };
    },
    client,
  );
}

export type ItemStateFilter = FieldState | "incomplete";

export interface ItemFilter {
  locale: string;
  resourceType?: string | null;
  fieldGroup?: FieldGroup | null;
  state?: ItemStateFilter;
  /** Only these resources (search results from Shopify). */
  resourceGids?: readonly string[] | null;
  after?: string | null;
  limit?: number;
}

const STATE_COLUMN: Record<FieldState, keyof Prisma.CoverageItemWhereInput> = {
  complete: "stateComplete",
  review: "stateReview",
  draft: "stateDraft",
  failed: "stateFailed",
  outdated: "stateOutdated",
  missing: "stateMissing",
};

const INCOMPLETE: FieldState[] = FIELD_STATES.filter((s) => s !== "complete");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The items behind a number: keyset-paged by id, at most 100 per page. */
export async function listCoverageItems(shopId: string, filter: ItemFilter, client: PrismaClient = defaultClient) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  const state = filter.state ?? "incomplete";
  const states = state === "incomplete" ? INCOMPLETE : [state];
  const where: Prisma.CoverageItemWhereInput = {
    shopId,
    locale: filter.locale,
    ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
    ...(filter.resourceGids ? { resourceGid: { in: [...filter.resourceGids] } } : {}),
    ...(filter.fieldGroup
      ? { fieldStates: { hasSome: states.map((s) => `${filter.fieldGroup}:${s}`) } }
      : { OR: states.map((s) => ({ [STATE_COLUMN[s]]: { gt: 0 } })) }),
    ...(filter.after && UUID.test(filter.after) ? { id: { gt: filter.after } } : {}),
  };
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.coverageItem.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit + 1,
        select: {
          id: true,
          resourceType: true,
          resourceGid: true,
          parentGid: true,
          fieldStates: true,
          lastAttemptFailed: true,
          failureCode: true,
          stateComplete: true,
          stateReview: true,
          stateDraft: true,
          stateFailed: true,
          stateOutdated: true,
          stateMissing: true,
          syncedAt: true,
        },
      }),
    client,
  );
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      resourceType: r.resourceType,
      resourceGid: r.resourceGid,
      parentGid: r.parentGid,
      lastAttemptFailed: r.lastAttemptFailed,
      failureCode: r.failureCode,
      counts: {
        complete: r.stateComplete,
        review: r.stateReview,
        draft: r.stateDraft,
        failed: r.stateFailed,
        outdated: r.stateOutdated,
        missing: r.stateMissing,
      } satisfies Record<FieldState, number>,
      /** Field groups with their states, for "Title: missing, SEO title: draft". */
      fields: r.fieldStates,
      syncedAt: r.syncedAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}
