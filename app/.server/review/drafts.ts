import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import type { SegmentPair } from "../memory/alignment";
import { withTenant } from "../tenancy/with-tenant";
import { saveResourceTranslations } from "../translation/product-translation-service";

type Admin = Pick<AdminApiContext, "graphql">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DRAFTS_PER_ACTION = 100;

export interface DraftInput {
  jobId: string | null;
  resourceGid: string;
  resourceTitle: string | null;
  locale: string;
  key: string;
  sourceDigest: string;
  sourceValue: string;
  value: string;
  segmentPairs: SegmentPair[];
  issues: unknown[];
  provider: string;
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
          resourceTitle: d.resourceTitle,
          sourceDigest: d.sourceDigest,
          sourceValue: d.sourceValue,
          value: d.value,
          segmentPairs: d.segmentPairs as unknown as Prisma.InputJsonValue,
          issues: d.issues as Prisma.InputJsonValue,
          provider: d.provider,
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
    const outcomes = await saveResourceTranslations(
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
          };
        }),
      },
      client,
    );
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
