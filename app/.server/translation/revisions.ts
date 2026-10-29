import type { PrismaClient, TranslationRevision } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";

export type LatestRevisions = Map<string, TranslationRevision>;

export const revisionKey = (resourceGid: string, key: string) => `${resourceGid}|${key}`;

/** Latest revision per resource field for one locale. */
export async function latestRevisions(
  shopId: string,
  resourceGids: readonly string[],
  locale: string,
  client: PrismaClient = defaultClient,
): Promise<LatestRevisions> {
  const result: LatestRevisions = new Map();
  if (resourceGids.length === 0) return result;
  // DISTINCT ON reads one row per field instead of the whole history.
  const gids = [...new Set(resourceGids)];
  const rows = await withTenant(
    shopId,
    (tx) => tx.$queryRaw<TranslationRevision[]>`
      SELECT DISTINCT ON ("resourceGid", "key") *
      FROM "TranslationRevision"
      WHERE "shopId" = ${shopId}::uuid AND "locale" = ${locale} AND "resourceGid" = ANY(${gids})
      ORDER BY "resourceGid", "key", "createdAt" DESC, "id" DESC`,
    client,
  );
  for (const row of rows) result.set(revisionKey(row.resourceGid, row.key), row);
  return result;
}

/**
 * Whether an existing translation must not be replaced without the
 * merchant's explicit permission: anything a person wrote or approved, and
 * anything Linguva didn't write (manual edits in Shopify, other apps).
 * Only Linguva's own unreviewed machine output may be refreshed freely.
 */
export function isProtectedTranslation(
  currentValue: string | null | undefined,
  latest: TranslationRevision | undefined,
): boolean {
  if (!currentValue || !currentValue.trim()) return false;
  if (!latest) return true;
  if (latest.value !== currentValue) return true;
  return latest.approved || latest.origin !== "AI";
}

export async function listRevisions(
  shopId: string,
  resourceGid: string,
  locale: string,
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationRevision.findMany({
        where: { shopId, resourceGid, locale },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    client,
  );
}

export async function getRevision(shopId: string, revisionId: string, client: PrismaClient = defaultClient) {
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) return null;
  return withTenant(
    shopId,
    (tx) => tx.translationRevision.findFirst({ where: { id: revisionId, shopId } }),
    client,
  );
}
