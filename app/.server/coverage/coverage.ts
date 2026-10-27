/**
 * Translation coverage report: scans products and collections page by page
 * for each target language and stores aggregates (counts per field key, SEO
 * findings, duplicate SEO titles as hashes, resources with gaps as ids).
 * It never writes to Shopify, never calls a translation provider and never
 * stores merchant text.
 */
import { createHash } from "node:crypto";
import type { CoverageReport, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { listTranslatableResources, type TranslatableResourceData } from "../shopify/translations-api";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { shopKey } from "../queue/redis";
import { RateLimitedError } from "../jobs/errors";
import type { Admin, Limiter } from "../jobs/processors";
import { checkSeoField, SEO_TITLE_KEY } from "../../lib/seo";
import type { ResourceKind } from "../../lib/resource-kinds";

export const COVERAGE_RESOURCE_TYPES: readonly ResourceKind[] = ["PRODUCT", "COLLECTION"];
export const COVERAGE_PAGE_SIZE = 50;
/** Resources with gaps kept per language (the worst ones). */
export const GAP_LIMIT_PER_LOCALE = 200;
const PAGE_COST = 60;
const ACTIVE: CoverageReport["status"][] = ["QUEUED", "RUNNING"];
/** A report with no progress for this long is treated as lost (for example Redis was down). */
export const STALE_REPORT_MS = 30 * 60 * 1000;

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
  const [resourceType, locale] = value.split("|") as [ResourceKind, string];
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
      }
      const report = await tx.coverageReport.create({
        data: {
          shopId: input.shopId,
          requestedBy: input.requestedBy,
          idempotencyKey: input.idempotencyKey,
          segments: COVERAGE_RESOURCE_TYPES.flatMap((type) => locales.map((l) => `${type}|${l}`)),
        },
      });
      // Keep the latest few reports; older ones are only history.
      const old = await tx.coverageReport.findMany({
        where: { shopId: input.shopId, status: { notIn: ACTIVE } },
        orderBy: { createdAt: "desc" },
        skip: 4,
        select: { id: true },
      });
      if (old.length) await tx.coverageReport.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
      return { report, created: true };
    },
    client,
  );
}

interface KeyCounts {
  withSource: number;
  translated: number;
  outdated: number;
  seoIssues: number;
}

/** Aggregates one page of resources for one language. Pure, for testing. */
export function aggregatePage(resources: readonly TranslatableResourceData[]) {
  const keys = new Map<string, KeyCounts>();
  const gaps: Array<{ resourceGid: string; missing: number; outdated: number }> = [];
  const titleHashes = new Map<string, number>();

  for (const resource of resources) {
    const translations = new Map(resource.translations.map((t) => [t.key, t]));
    let missing = 0;
    let outdated = 0;
    for (const field of resource.content) {
      if (!field.value || !field.value.trim()) continue;
      const counts = keys.get(field.key) ?? { withSource: 0, translated: 0, outdated: 0, seoIssues: 0 };
      counts.withSource++;
      const t = translations.get(field.key);
      const value = t?.value?.trim() ? t.value : null;
      if (value && !t!.outdated) counts.translated++;
      else if (value) {
        counts.outdated++;
        outdated++;
      } else missing++;
      if (value && checkSeoField(field.key, field.value, value).length) counts.seoIssues++;
      if (value && field.key === SEO_TITLE_KEY) {
        const hash = createHash("sha256").update(value.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 32);
        titleHashes.set(hash, (titleHashes.get(hash) ?? 0) + 1);
      }
      keys.set(field.key, counts);
    }
    if (missing || outdated) gaps.push({ resourceGid: resource.resourceId, missing, outdated });
  }
  return { keys, gaps, titleHashes, resources: resources.length };
}

async function throttle(deps: CoverageDeps, shopId: string) {
  if (!deps.shopifyLimiter) return;
  const wait = await deps.shopifyLimiter.take(shopKey(deps.keyPrefix, shopId, "rl", "shopify"), PAGE_COST);
  if (wait > 0) throw new RateLimitedError(wait);
}

async function save(tx: TenantTx, report: CoverageReport, locale: string, resourceType: string, page: ReturnType<typeof aggregatePage>) {
  const base = { shopId: report.shopId, reportId: report.id, locale, resourceType };
  const rows = [...page.keys.entries(), ["*", { withSource: page.resources, translated: 0, outdated: 0, seoIssues: 0 }] as const];
  for (const [key, c] of rows) {
    await tx.coverageStat.upsert({
      where: { reportId_locale_resourceType_key: { reportId: report.id, locale, resourceType, key } },
      create: { ...base, key, ...c },
      update: {
        withSource: { increment: c.withSource },
        translated: { increment: c.translated },
        outdated: { increment: c.outdated },
        seoIssues: { increment: c.seoIssues },
      },
    });
  }
  for (const [hash, count] of page.titleHashes) {
    await tx.coverageTitleHash.upsert({
      where: { reportId_locale_hash: { reportId: report.id, locale, hash } },
      create: { shopId: report.shopId, reportId: report.id, locale, hash, count },
      update: { count: { increment: count } },
    });
  }
  if (page.gaps.length) {
    await tx.coverageGap.createMany({ data: page.gaps.map((g) => ({ ...base, ...g })), skipDuplicates: true });
    // Keep only the worst resources per language.
    await tx.$executeRaw`
      DELETE FROM "CoverageGap" WHERE "id" IN (
        SELECT "id" FROM "CoverageGap"
        WHERE "reportId" = ${report.id}::uuid AND "locale" = ${locale}
        ORDER BY "missing" + "outdated" DESC, "id"
        OFFSET ${GAP_LIMIT_PER_LOCALE}
      )`;
  }
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
  const page = await listTranslatableResources(admin, {
    resourceType: segment.resourceType,
    locale: segment.locale,
    after: payload.cursor,
    first: deps.pageSize ?? COVERAGE_PAGE_SIZE,
  });
  const aggregate = aggregatePage(page.resources);

  const more = page.pageInfo.hasNextPage && page.pageInfo.endCursor;
  const nextIndex = more ? payload.segmentIndex : payload.segmentIndex + 1;
  const nextCursor = more ? page.pageInfo.endCursor : null;
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
          resourcesScanned: { increment: aggregate.resources },
          startedAt: report.startedAt ?? new Date(),
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });
      if (advanced.count === 0) return null;
      await save(tx, report, segment.locale, segment.resourceType, aggregate);
      return finished ? null : { shopId: payload.shopId, reportId: report.id, segmentIndex: nextIndex, cursor: nextCursor };
    },
    deps.prisma,
  );
}

export async function failCoverageReport(shopId: string, reportId: string, errorCode: string, client: PrismaClient = defaultClient) {
  await withTenant(
    shopId,
    (tx) =>
      tx.coverageReport.updateMany({
        where: { id: reportId, shopId, status: { in: ACTIVE } },
        data: { status: "FAILED", errorCode, finishedAt: new Date() },
      }),
    client,
  );
}

export interface CoverageSummaryRow {
  locale: string;
  resourceType: string;
  resources: number;
  groups: Record<"content" | "seo" | "handle", { withSource: number; translated: number; outdated: number; missing: number }>;
  seoIssues: number;
  seoTitlesMissingInSource: number;
}

const groupOf = (key: string): "content" | "seo" | "handle" =>
  key === "meta_title" || key === "meta_description" ? "seo" : key === "handle" ? "handle" : "content";

/** The latest report of a shop with its summary per language and resource type. */
export async function loadCoverage(shopId: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    async (tx) => {
      const report = await tx.coverageReport.findFirst({ where: { shopId }, orderBy: { createdAt: "desc" } });
      if (!report) return null;
      const [stats, dupes, gaps] = await Promise.all([
        tx.coverageStat.findMany({ where: { shopId, reportId: report.id } }),
        tx.coverageTitleHash.groupBy({
          by: ["locale"],
          where: { shopId, reportId: report.id, count: { gt: 1 } },
          _sum: { count: true },
        }),
        tx.coverageGap.findMany({
          where: { shopId, reportId: report.id },
          orderBy: [{ missing: "desc" }, { outdated: "desc" }],
          take: 500,
        }),
      ]);
      const rows = new Map<string, CoverageSummaryRow>();
      const empty = () => ({ withSource: 0, translated: 0, outdated: 0, missing: 0 });
      for (const s of stats) {
        const id = `${s.locale}|${s.resourceType}`;
        const row = rows.get(id) ?? {
          locale: s.locale,
          resourceType: s.resourceType,
          resources: 0,
          groups: { content: empty(), seo: empty(), handle: empty() },
          seoIssues: 0,
          seoTitlesMissingInSource: 0,
        };
        if (s.key === "*") row.resources = s.withSource;
        else {
          const g = row.groups[groupOf(s.key)];
          g.withSource += s.withSource;
          g.translated += s.translated;
          g.outdated += s.outdated;
          g.missing += s.withSource - s.translated - s.outdated;
          row.seoIssues += s.seoIssues;
        }
        rows.set(id, row);
      }
      for (const row of rows.values()) {
        const titleStat = stats.find(
          (s) => s.locale === row.locale && s.resourceType === row.resourceType && s.key === SEO_TITLE_KEY,
        );
        row.seoTitlesMissingInSource = Math.max(0, row.resources - (titleStat?.withSource ?? 0));
      }
      // Duplicate SEO titles are counted per language (products and collections together).
      const dupesByLocale = new Map(dupes.map((d) => [d.locale, d._sum.count ?? 0]));
      return {
        report,
        rows: [...rows.values()].sort((a, b) => a.locale.localeCompare(b.locale) || a.resourceType.localeCompare(b.resourceType)),
        duplicateSeoTitles: Object.fromEntries(dupesByLocale),
        gaps,
      };
    },
    client,
  );
}
