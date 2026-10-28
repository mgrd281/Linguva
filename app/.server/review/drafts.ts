import { Prisma, type PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import type { SegmentPair } from "../memory/alignment";
import { withTenant } from "../tenancy/with-tenant";
import { ResourceNotFoundError, saveResourceTranslations } from "../translation/product-translation-service";
import { RESOURCE_KINDS } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DRAFTS_PER_ACTION = 100;

export interface DraftInput {
  jobId: string | null;
  resourceGid: string;
  /** The product, collection, page or post an image or custom field belongs to. */
  parentGid?: string | null;
  resourceTitle: string | null;
  locale: string;
  key: string;
  sourceDigest: string;
  sourceValue: string;
  value: string;
  segmentPairs: SegmentPair[];
  issues: unknown[];
  provider: string;
  /** translationDigest of the field's translation when the draft was made. */
  currentDigest?: string | null;
  /** Shopify's content type of the field, for display (LINK, RICH_TEXT_FIELD, …). */
  valueType?: string | null;
}

/**
 * Saves machine translations for review. A newer draft for the same field
 * replaces the previous one, whatever its state.
 */
export async function saveDrafts(
  shopId: string,
  drafts: readonly DraftInput[],
  client: PrismaClient = defaultClient,
) {
  if (drafts.length === 0) return 0;
  await withTenant(
    shopId,
    async (tx) => {
      for (const d of drafts) {
        const data = {
          jobId: d.jobId,
          parentGid: d.parentGid ?? null,
          resourceTitle: d.resourceTitle,
          sourceDigest: d.sourceDigest,
          sourceValue: d.sourceValue,
          value: d.value,
          segmentPairs: d.segmentPairs as unknown as Prisma.InputJsonValue,
          issues: d.issues as Prisma.InputJsonValue,
          provider: d.provider,
          currentDigest: d.currentDigest ?? null,
          valueType: d.valueType && /^[A-Z][A-Z_]{0,63}$/.test(d.valueType) ? d.valueType : null,
          status: "PENDING" as const,
          reviewedAt: null,
          reviewedBy: null,
        };
        await tx.translationDraft.upsert({
          where: {
            shopId_resourceGid_locale_key: { shopId, resourceGid: d.resourceGid, locale: d.locale, key: d.key },
          },
          create: { shopId, resourceGid: d.resourceGid, locale: d.locale, key: d.key, ...data },
          update: data,
        });
      }
    },
    client,
  );
  return drafts.length;
}

/**
 * Fields a bulk job must not translate again for the same source digest:
 * a draft is waiting for review, or the merchant rejected it.
 */
export async function pendingDraftDigests(
  shopId: string,
  resourceGids: readonly string[],
  locale: string,
  client: PrismaClient = defaultClient,
): Promise<Map<string, string>> {
  if (resourceGids.length === 0) return new Map();
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.findMany({
        where: {
          shopId,
          locale,
          status: { in: ["PENDING", "REJECTED"] },
          resourceGid: { in: [...new Set(resourceGids)] },
        },
        select: { resourceGid: true, key: true, sourceDigest: true },
      }),
    client,
  );
  return new Map(rows.map((r) => [`${r.resourceGid}|${r.key}`, r.sourceDigest]));
}

export async function listPendingDrafts(
  shopId: string,
  filter: { locale?: string; jobId?: string; take?: number },
  client: PrismaClient = defaultClient,
) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.findMany({
        where: {
          shopId,
          status: "PENDING",
          ...(filter.locale ? { locale: filter.locale } : {}),
          ...(filter.jobId && UUID.test(filter.jobId) ? { jobId: filter.jobId } : {}),
        },
        orderBy: [{ resourceGid: "asc" }, { key: "asc" }],
        take: Math.min(filter.take ?? 50, MAX_DRAFTS_PER_ACTION),
      }),
    client,
  );
}

/** Escapes LIKE wildcards; Prisma's `contains` passes them through. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface DraftPageFilter {
  locale?: string | null;
  jobId?: string | null;
  /** "seo", "handle" or "content". */
  group?: string | null;
  resourceType?: string | null;
  /** Only drafts with quality warnings. */
  flagged?: boolean;
  /** Text in the item title, source or translation (max. 100 characters). */
  search?: string | null;
  /** Id of the last draft of the previous page. */
  cursor?: string | null;
  take?: number;
}

const SEO_KEYS_LIST = ["meta_title", "meta_description"];
/** Matches the indexed search hands over; more fall back to scanning. */
const SEARCH_MATCHES = 5000;
const GID_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(RESOURCE_KINDS).map(([kind, meta]) => [kind, `gid://shopify/${meta.gidType}/`]),
);

/** One page of pending drafts with filters and search, plus the matching total. */
export async function searchPendingDrafts(shopId: string, filter: DraftPageFilter = {}, client: PrismaClient = defaultClient) {
  const take = Math.min(Math.max(filter.take ?? 50, 1), MAX_DRAFTS_PER_ACTION);
  const search = filter.search?.trim().slice(0, 100);
  const pattern = search ? escapeLike(search) : null;
  const base: Prisma.TranslationDraftWhereInput = {
    shopId,
    status: "PENDING",
    ...(filter.locale ? { locale: filter.locale } : {}),
    ...(filter.jobId && UUID.test(filter.jobId) ? { jobId: filter.jobId } : {}),
    ...(filter.group === "seo"
      ? { key: { in: SEO_KEYS_LIST } }
      : filter.group === "handle"
        ? { key: "handle" }
        : filter.group === "content"
          ? { key: { notIn: [...SEO_KEYS_LIST, "handle"] } }
          : {}),
    // A type covers its own fields and those of its images and custom fields.
    ...(filter.resourceType && GID_PREFIX[filter.resourceType]
      ? {
          AND: [
            {
              OR: [
                { resourceGid: { startsWith: GID_PREFIX[filter.resourceType] } },
                { parentGid: { startsWith: GID_PREFIX[filter.resourceType] } },
              ],
            },
          ],
        }
      : {}),
    ...(filter.flagged ? { NOT: [{ issues: { equals: Prisma.DbNull } }, { issues: { equals: [] } }] } : {}),
  };
  const scan: Prisma.TranslationDraftWhereInput = pattern
    ? {
        OR: [
          { resourceTitle: { contains: pattern, mode: "insensitive" } },
          { sourceValue: { contains: pattern, mode: "insensitive" } },
          { value: { contains: pattern, mode: "insensitive" } },
        ],
      }
    : {};
  const cursor = filter.cursor && UUID.test(filter.cursor) ? filter.cursor : null;
  const [rows, total, jobTypes] = await withTenant(
    shopId,
    async (tx) => {
      // Three characters or more: the indexed search (SECURITY_MODEL §5l)
      // finds the matching drafts. Text so common that it matches more than
      // SEARCH_MATCHES drafts is scanned instead, as shorter text is.
      let text = scan;
      if (search && [...search].length >= 3) {
        const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM linguva_draft_search(${search}, ${SEARCH_MATCHES + 1}::int)`;
        if (ids.length <= SEARCH_MATCHES) text = { id: { in: ids.map((r) => r.id) } };
      }
      const where = { ...base, ...text };
      const [found, count] = await Promise.all([
        tx.translationDraft.findMany({
          where,
          orderBy: [{ resourceGid: "asc" }, { locale: "asc" }, { key: "asc" }, { id: "asc" }],
          take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        tx.translationDraft.count({ where }),
      ]);
      // The resource type (for editor links) comes from the draft's job.
      const jobIds = [...new Set(found.map((d) => d.jobId).filter((id): id is string => Boolean(id)))];
      const jobs = jobIds.length
        ? await tx.translationJob.findMany({ where: { shopId, id: { in: jobIds } }, select: { id: true, resourceType: true } })
        : [];
      return [found, count, new Map(jobs.map((j) => [j.id, j.resourceType]))] as const;
    },
    client,
  );
  const drafts = rows.slice(0, take).map((d) => ({ ...d, resourceType: d.jobId ? (jobTypes.get(d.jobId) ?? null) : null }));
  return { drafts, nextCursor: rows.length > take ? rows[take - 1]!.id : null, total };
}

/** Languages that have pending drafts, for the review filter. */
export async function listDraftLocales(shopId: string, client: PrismaClient = defaultClient): Promise<string[]> {
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.findMany({
        where: { shopId, status: "PENDING" },
        distinct: ["locale"],
        select: { locale: true },
        orderBy: { locale: "asc" },
        take: 50,
      }),
    client,
  );
  return rows.map((r) => r.locale);
}

export async function countPendingDrafts(shopId: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    (tx) => tx.translationDraft.count({ where: { shopId, status: "PENDING" } }),
    client,
  );
}

export async function rejectDrafts(
  shopId: string,
  draftIds: readonly string[],
  actorId: string | null,
  client: PrismaClient = defaultClient,
) {
  const ids = draftIds.filter((id) => UUID.test(id)).slice(0, MAX_DRAFTS_PER_ACTION);
  if (ids.length === 0) return 0;
  const result = await withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.updateMany({
        where: { shopId, id: { in: ids }, status: "PENDING" },
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: actorId },
      }),
    client,
  );
  return result.count;
}

export interface ApprovalResult {
  published: number;
  stale: number;
  failed: number;
}

/**
 * Publishes approved drafts. The merchant may edit a draft before approving
 * it; edited drafts are saved as manual translations. Drafts whose source
 * changed since translation are marked STALE and not published.
 */
export async function approveDrafts(
  input: {
    admin: Admin;
    shopId: string;
    actorId: string | null;
    draftIds: readonly string[];
    edits?: ReadonlyMap<string, string>;
  },
  client: PrismaClient = defaultClient,
): Promise<ApprovalResult> {
  const ids = input.draftIds.filter((id) => UUID.test(id)).slice(0, MAX_DRAFTS_PER_ACTION);
  const drafts = ids.length
    ? await withTenant(
        input.shopId,
        (tx) => tx.translationDraft.findMany({ where: { shopId: input.shopId, id: { in: ids }, status: "PENDING" } }),
        client,
      )
    : [];
  const result: ApprovalResult = { published: 0, stale: 0, failed: 0 };

  const byResource = new Map<string, typeof drafts>();
  for (const d of drafts) {
    const key = `${d.resourceGid}|${d.locale}`;
    byResource.set(key, [...(byResource.get(key) ?? []), d]);
  }

  for (const group of byResource.values()) {
    const { resourceGid, locale } = group[0]!;
    let outcomes: Awaited<ReturnType<typeof saveResourceTranslations>>;
    try {
      outcomes = await saveResourceTranslations(
        {
          admin: input.admin,
          shopId: input.shopId,
          actorId: input.actorId,
          resourceId: resourceGid,
          locale,
          edits: group.map((d) => {
            const edited = input.edits?.get(d.id);
            const changed = edited !== undefined && edited !== d.value;
            return {
              key: d.key,
              value: changed ? edited : d.value,
              digest: d.sourceDigest,
              origin: changed ? ("MANUAL" as const) : ("AI" as const),
              provider: d.provider,
              approved: true,
              segmentPairs: changed ? undefined : ((d.segmentPairs as unknown as SegmentPair[] | null) ?? undefined),
              // Never replace a translation someone wrote after the draft was made.
              ...(d.currentDigest ? { expectedCurrent: d.currentDigest } : {}),
            };
          }),
        },
        client,
      );
    } catch (error) {
      // Deleted in Shopify since it was translated: outdated, like a changed source.
      if (!(error instanceof ResourceNotFoundError)) throw error;
      outcomes = group.map((d) => ({ key: d.key, status: "conflict" as const, reason: "SOURCE_CHANGED" as const }));
    }
    const byKey = new Map(outcomes.map((o) => [o.key, o]));
    await withTenant(
      input.shopId,
      async (tx) => {
        for (const d of group) {
          const outcome = byKey.get(d.key);
          const status = outcome?.status === "saved" ? "PUBLISHED" : outcome?.status === "conflict" ? "STALE" : null;
          if (status === "PUBLISHED") result.published++;
          else if (status === "STALE") result.stale++;
          else result.failed++;
          if (status) {
            await tx.translationDraft.update({
              where: { id: d.id },
              data: { status, reviewedAt: new Date(), reviewedBy: input.actorId },
            });
          }
        }
      },
      client,
    );
  }
  return result;
}
