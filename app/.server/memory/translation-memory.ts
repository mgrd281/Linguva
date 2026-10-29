import { createHash } from "node:crypto";
import type { MemoryStatus, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import type { SegmentPair } from "./alignment";

export interface MemoryContext {
  shopId: string;
  sourceLocale: string;
  targetLocale: string;
  /** "" for translations valid in every market. */
  market?: string;
}

const MAX_SEGMENT_LENGTH = 10_000;

/** Whitespace-insensitive form used for matching. */
export function normalizeSegment(markup: string): string {
  return markup.replace(/\s+/g, " ").trim();
}

export function segmentHash(markup: string): string {
  return createHash("sha256").update(normalizeSegment(markup)).digest("hex");
}

/**
 * Exact matches for the given source segments. Market-specific entries win
 * over general ones, approved entries over machine ones. Machine entries
 * are only used when `allowMachine` is set.
 */
export async function lookupExact(
  context: MemoryContext,
  sources: readonly string[],
  options: { allowMachine: boolean },
  client: PrismaClient = defaultClient,
): Promise<Map<string, { target: string; id: string; status: MemoryStatus }>> {
  const result = new Map<string, { target: string; id: string; status: MemoryStatus }>();
  if (sources.length === 0) return result;
  const byHash = new Map(sources.map((s) => [segmentHash(s), s]));
  const market = context.market ?? "";
  const rows = await withTenant(
    context.shopId,
    (tx) =>
      tx.translationMemory.findMany({
        where: {
          shopId: context.shopId,
          sourceLocale: context.sourceLocale,
          targetLocale: context.targetLocale,
          market: { in: market ? [market, ""] : [""] },
          sourceHash: { in: [...byHash.keys()] },
          status: options.allowMachine ? { in: ["APPROVED", "MACHINE"] } : "APPROVED",
        },
      }),
    client,
  );
  const rank = (r: (typeof rows)[number]) => (r.market ? 2 : 0) + (r.status === "APPROVED" ? 1 : 0);
  for (const row of rows.sort((a, b) => rank(b) - rank(a))) {
    const source = byHash.get(row.sourceHash)!;
    // Guard against hash collisions: the stored text must match too.
    if (normalizeSegment(row.sourceText) !== normalizeSegment(source)) continue;
    if (!result.has(source)) result.set(source, { target: row.targetText, id: row.id, status: row.status });
  }
  return result;
}

export async function recordMemoryUse(
  shopId: string,
  ids: readonly string[],
  client: PrismaClient = defaultClient,
) {
  if (ids.length === 0) return;
  await withTenant(
    shopId,
    (tx) =>
      tx.translationMemory.updateMany({
        where: { shopId, id: { in: [...new Set(ids)] } },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      }),
    client,
  );
}

/**
 * Stores segment pairs. An approved entry is never downgraded by machine
 * output; a newer approved translation replaces an older one.
 */
export async function storeMemory(
  context: MemoryContext,
  pairs: readonly SegmentPair[],
  status: MemoryStatus,
  client: PrismaClient = defaultClient,
): Promise<number> {
  const usable = pairs.filter(
    (p) => p.source.trim() && p.target.trim() && p.source.length <= MAX_SEGMENT_LENGTH && p.target.length <= MAX_SEGMENT_LENGTH,
  );
  if (usable.length === 0) return 0;
  const market = context.market ?? "";
  await withTenant(
    context.shopId,
    async (tx) => {
      for (const pair of usable) {
        const where = {
          shopId_sourceLocale_targetLocale_market_sourceHash: {
            shopId: context.shopId,
            sourceLocale: context.sourceLocale,
            targetLocale: context.targetLocale,
            market,
            sourceHash: segmentHash(pair.source),
          },
        };
        const existing = await tx.translationMemory.findUnique({ where });
        if (existing && existing.status === "APPROVED" && status === "MACHINE") continue;
        await tx.translationMemory.upsert({
          where,
          create: {
            shopId: context.shopId,
            sourceLocale: context.sourceLocale,
            targetLocale: context.targetLocale,
            market,
            sourceHash: segmentHash(pair.source),
            sourceText: normalizeSegment(pair.source),
            targetText: pair.target,
            status,
          },
          update: { targetText: pair.target, status },
        });
      }
    },
    client,
  );
  return usable.length;
}

export interface FuzzyMatch {
  id: string;
  sourceText: string;
  targetText: string;
  status: MemoryStatus;
  score: number;
}

/**
 * Similar segments (pg_trgm similarity). These are suggestions for a
 * person to review; they are never applied automatically.
 */
export async function fuzzyMatches(
  context: MemoryContext,
  source: string,
  options: { threshold?: number; limit?: number } = {},
  client: PrismaClient = defaultClient,
): Promise<FuzzyMatch[]> {
  const text = normalizeSegment(source);
  if (!text || text.length > MAX_SEGMENT_LENGTH) return [];
  // Below 0.3 matches are noise and the index can't narrow the search.
  const threshold = Math.min(1, Math.max(0.3, options.threshold ?? 0.6));
  const limit = Math.min(options.limit ?? 3, 10);
  const minLength = Math.floor(text.length * 0.5);
  const maxLength = Math.ceil(text.length * 1.5);
  const market = context.market ?? "";
  return withTenant(
    context.shopId,
    // The function applies the tenant from this transaction (see the
    // memory_fuzzy_function migration), so the shop + trigram index is used.
    (tx) => tx.$queryRaw<FuzzyMatch[]>`
      SELECT "id", "sourceText", "targetText", "status", "score"
      FROM linguva_memory_fuzzy(
        ${context.sourceLocale}, ${context.targetLocale}, ${market}, ${text},
        ${minLength}::int, ${maxLength}::int, ${threshold}::real, ${limit}::int
      )`,
    client,
  );
}

export async function listMemory(
  shopId: string,
  filter: { targetLocale?: string; search?: string; take?: number },
  client: PrismaClient = defaultClient,
) {
  const search = filter.search?.trim().slice(0, 200);
  return withTenant(
    shopId,
    (tx) =>
      tx.translationMemory.findMany({
        where: {
          shopId,
          ...(filter.targetLocale ? { targetLocale: filter.targetLocale } : {}),
          ...(search
            ? {
                OR: [
                  { sourceText: { contains: search, mode: "insensitive" } },
                  { targetText: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: Math.min(filter.take ?? 50, 200),
      }),
    client,
  );
}

export async function memoryStats(shopId: string, client: PrismaClient = defaultClient) {
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.translationMemory.groupBy({
        by: ["sourceLocale", "targetLocale", "status"],
        where: { shopId },
        _count: { _all: true },
        _sum: { useCount: true },
      }),
    client,
  );
  return rows.map((r) => ({
    sourceLocale: r.sourceLocale,
    targetLocale: r.targetLocale,
    status: r.status,
    entries: r._count._all,
    uses: r._sum.useCount ?? 0,
  }));
}

export async function deleteMemoryEntry(shopId: string, id: string, client: PrismaClient = defaultClient) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const result = await withTenant(
    shopId,
    (tx) => tx.translationMemory.deleteMany({ where: { shopId, id } }),
    client,
  );
  return result.count === 1;
}

export async function approveMemoryEntry(shopId: string, id: string, client: PrismaClient = defaultClient) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const result = await withTenant(
    shopId,
    (tx) => tx.translationMemory.updateMany({ where: { shopId, id }, data: { status: "APPROVED" } }),
    client,
  );
  return result.count === 1;
}
