import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { TranslationProvider } from "../providers/types";
import { shopKey } from "../queue/redis";
import {
  getTranslatableResource,
  listTranslatableResources,
} from "../shopify/translations-api";
import { providerContext, resourceTitle } from "../../lib/resource-kinds";
import { withTenant } from "../tenancy/with-tenant";
import {
  saveResourceTranslations,
  sourceLocaleOf,
} from "../translation/product-translation-service";
import { completeTranslation, prepareTranslation } from "../translation/translate-fields";
import { loadTranslationContext } from "../translation/translation-context";
import { latestRevisions } from "../translation/revisions";
import { recordMemoryUse } from "../memory/translation-memory";
import { pendingDraftDigests, saveDrafts } from "../review/drafts";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { releaseUsage, reserveUsage, settleUsage } from "../usage/usage-ledger";
import { finishItem, isBulkResourceType, stopJob, completeIfDone } from "./bulk-jobs";
import { JobStopError, RateLimitedError } from "./errors";
import { planResourceWork, scopeKeys } from "./needs-work";
import type { Entitlements } from "../../lib/plans";

export type Admin = Pick<AdminApiContext, "graphql">;

export interface Limiter {
  /** Returns 0 when granted, otherwise the milliseconds to wait. */
  take(key: string, cost: number): Promise<number>;
}

export interface JobDependencies {
  prisma: PrismaClient;
  /** Admin API client for a shop's offline session. */
  adminFor(shopDomain: string): Promise<Admin>;
  provider: TranslationProvider | null;
  monthlyLimit: number;
  /** Optional daily caps (shop and platform), see aiUsageLimits. */
  dailyLimit?: number;
  platformDailyLimit?: number;
  /**
   * The shop's billing status (Shopify App Pricing). When billing is on, the
   * plan's monthly allowance replaces `monthlyLimit`, and bulk jobs and
   * automatic publishing need a plan that includes them.
   */
  billingFor?(shopId: string): Promise<{ configured: boolean; entitlements: Entitlements }>;
  keyPrefix: string;
  shopifyLimiter?: Limiter;
  /** Resources per discovery page (default DISCOVERY_PAGE_SIZE). */
  discoveryPageSize?: number;
}

/** Approximate Admin API cost of one item (read + register + re-read). */
export const ITEM_SHOPIFY_COST = 30;
export const DISCOVERY_PAGE_COST = 60;
export const DISCOVERY_PAGE_SIZE = 50;

async function throttle(deps: JobDependencies, shopId: string, cost: number) {
  if (!deps.shopifyLimiter) return;
  const wait = await deps.shopifyLimiter.take(shopKey(deps.keyPrefix, shopId, "rl", "shopify"), cost);
  if (wait > 0) throw new RateLimitedError(wait);
}

async function loadActiveShop(deps: JobDependencies, shopId: string) {
  const shop = await deps.prisma.shop.findUnique({ where: { id: shopId } });
  return shop && shop.status === "ACTIVE" ? shop : null;
}

export interface DiscoveryPayload {
  shopId: string;
  jobId: string;
}

export interface DiscoveryResult {
  itemIds: string[];
  hasMore: boolean;
  cursor: string | null;
}

/**
 * Discovers one page of resources for a job and creates an item for each
 * resource that has untranslated or outdated fields. Safe to repeat: items
 * are unique per job and resource, and the cursor is only advanced after the
 * page's items exist.
 */
export async function runDiscoveryPage(
  deps: JobDependencies,
  payload: DiscoveryPayload,
): Promise<DiscoveryResult> {
  const done: DiscoveryResult = { itemIds: [], hasMore: false, cursor: null };
  const job = await withTenant(
    payload.shopId,
    (tx) => tx.translationJob.findFirst({ where: { id: payload.jobId, shopId: payload.shopId } }),
    deps.prisma,
  );
  // Unknown (or another tenant's) job, or one that no longer runs.
  if (!job || !["PENDING", "DISCOVERING", "RUNNING"].includes(job.status) || job.discoveryDone) {
    return done;
  }
  const shop = await loadActiveShop(deps, payload.shopId);
  if (!shop) {
    await stopJob(payload.shopId, job.id, "SHOP_INACTIVE", deps.prisma);
    return done;
  }

  if (!isBulkResourceType(job.resourceType)) {
    await stopJob(payload.shopId, job.id, "DISCOVERY_FAILED", deps.prisma);
    return done;
  }

  await throttle(deps, payload.shopId, DISCOVERY_PAGE_COST);
  const admin = await deps.adminFor(shop.shopDomain);
  const page = await listTranslatableResources(admin, {
    resourceType: job.resourceType,
    locale: job.targetLocale,
    after: job.discoveryCursor,
    first: deps.discoveryPageSize ?? DISCOVERY_PAGE_SIZE,
  });
  const pageGids = page.resources.map((r) => r.resourceId);
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(payload.shopId, pageGids, job.targetLocale, deps.prisma),
    pendingDraftDigests(payload.shopId, pageGids, job.targetLocale, deps.prisma),
  ]);
  const gids = page.resources
    .filter(
      (r) =>
        planResourceWork(r, {
          latest,
          pendingDrafts,
          overwriteProtected: job.overwriteProtected,
          onlyKeys: scopeKeys(job.fieldScope),
        }).fields.length > 0,
    )
    .map((r) => r.resourceId);

  const itemIds = await withTenant(
    payload.shopId,
    async (tx) => {
      const created = gids.length
        ? await tx.translationJobItem.createMany({
            data: gids.map((resourceGid) => ({ shopId: payload.shopId, jobId: job.id, resourceGid })),
            skipDuplicates: true,
          })
        : { count: 0 };
      await tx.translationJob.update({
        where: { id: job.id },
        data: {
          status: "RUNNING",
          startedAt: job.startedAt ?? new Date(),
          totalItems: { increment: created.count },
          discoveryCursor: page.pageInfo.endCursor,
          discoveryDone: !page.pageInfo.hasNextPage,
        },
      });
      const items = await tx.translationJobItem.findMany({
        where: { jobId: job.id, shopId: payload.shopId, resourceGid: { in: gids }, status: "PENDING" },
        select: { id: true },
      });
      return items.map((i) => i.id);
    },
    deps.prisma,
  );

  if (!page.pageInfo.hasNextPage) await completeIfDone(payload.shopId, job.id, deps.prisma);
  return { itemIds, hasMore: page.pageInfo.hasNextPage, cursor: page.pageInfo.endCursor };
}

export interface ItemPayload {
  shopId: string;
  itemId: string;
}

export type ItemOutcome =
  | { status: "discarded"; reason: string }
  | { status: "SUCCEEDED" | "SKIPPED" | "CANCELLED"; errorCode?: string };

/**
 * Translates one resource, then saves drafts for review or publishes,
 * depending on the job's publish mode. The payload carries ids only;
 * everything else is reloaded from the database under the payload's tenant,
 * so a forged or stale payload can't act on another shop's data.
 */
export async function processItem(
  deps: JobDependencies,
  payload: ItemPayload,
  attempt: number,
): Promise<ItemOutcome> {
  const item = await withTenant(
    payload.shopId,
    (tx) =>
      tx.translationJobItem.findFirst({
        where: { id: payload.itemId, shopId: payload.shopId },
        include: { job: true },
      }),
    deps.prisma,
  );
  if (!item) return { status: "discarded", reason: "NOT_FOUND" };
  if (["SUCCEEDED", "SKIPPED", "CANCELLED", "DEAD"].includes(item.status)) {
    return { status: "discarded", reason: "ALREADY_FINISHED" };
  }

  const job = item.job;
  if (job.status === "CANCELLED" || job.status === "FAILED" || job.cancelRequestedAt) {
    await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: job.errorCode ?? "JOB_CANCELLED" }, deps.prisma);
    return { status: "CANCELLED", errorCode: job.errorCode ?? "JOB_CANCELLED" };
  }
  const shop = await loadActiveShop(deps, payload.shopId);
  if (!shop) {
    await stopJob(payload.shopId, job.id, "SHOP_INACTIVE", deps.prisma);
    await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: "SHOP_INACTIVE" }, deps.prisma);
    return { status: "CANCELLED", errorCode: "SHOP_INACTIVE" };
  }
  if (!deps.provider) throw new JobStopError("AI_NOT_CONFIGURED");

  // Rate limit before claiming, so a delayed item isn't counted as running.
  await throttle(deps, payload.shopId, ITEM_SHOPIFY_COST);
  await withTenant(
    payload.shopId,
    (tx) =>
      tx.translationJobItem.updateMany({
        where: { id: item.id, shopId: payload.shopId },
        data: { status: "RUNNING", attempts: { increment: 1 } },
      }),
    deps.prisma,
  );

  const settings = await getShopSettings(payload.shopId, deps.prisma);
  if (!hasCurrentAiConsent(settings)) throw new JobStopError("CONSENT_REQUIRED");
  // Plans can change while a job runs: check before every item.
  const billing = deps.billingFor ? await deps.billingFor(payload.shopId) : null;
  if (billing && !billing.entitlements.bulk) throw new JobStopError("PLAN_REQUIRED");
  const monthlyLimit = billing?.configured ? billing.entitlements.monthlyChars : deps.monthlyLimit;

  const admin = await deps.adminFor(shop.shopDomain);
  const resource = await getTranslatableResource(admin, item.resourceGid, job.targetLocale);
  if (!resource) {
    await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode: "RESOURCE_GONE" }, deps.prisma);
    return { status: "SKIPPED", errorCode: "RESOURCE_GONE" };
  }
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(payload.shopId, [item.resourceGid], job.targetLocale, deps.prisma),
    pendingDraftDigests(payload.shopId, [item.resourceGid], job.targetLocale, deps.prisma),
  ]);
  const { fields, protectedKeys } = planResourceWork(resource, {
    latest,
    pendingDrafts,
    overwriteProtected: job.overwriteProtected,
    onlyKeys: scopeKeys(job.fieldScope),
  });
  if (fields.length === 0) {
    const errorCode = protectedKeys.length ? "PROTECTED" : "UP_TO_DATE";
    await finishItem(
      payload.shopId,
      item.id,
      { status: "SKIPPED", errorCode, protectedSkipped: protectedKeys.length },
      deps.prisma,
    );
    return { status: "SKIPPED", errorCode };
  }

  const sourceLocale = sourceLocaleOf(resource);
  const context = await loadTranslationContext(
    {
      shopId: payload.shopId,
      sourceLocale,
      targetLocale: job.targetLocale,
      reuseMachineMemory: settings.reuseMachineMemory,
    },
    deps.prisma,
  );
  const prepared = await prepareTranslation({ fields, protect: context.glossary.protect, memory: context.memory });

  // One reservation per attempt, for what the provider will actually be
  // sent: a retried attempt is billed separately and a failed one released.
  const reservation = prepared.providerChars
    ? await reserveUsage(
        {
          shopId: payload.shopId,
          key: `job-item:${item.id}:${attempt}`,
          chars: prepared.providerChars,
          limit: monthlyLimit,
          dailyLimit: deps.dailyLimit,
          platformDailyLimit: deps.platformDailyLimit,
          provider: deps.provider.id,
        },
        deps.prisma,
      )
    : null;

  let result: Awaited<ReturnType<typeof completeTranslation>>;
  try {
    const title = isBulkResourceType(job.resourceType) ? resourceTitle(job.resourceType, resource.content) : undefined;
    result = await completeTranslation(prepared, {
      provider: deps.provider,
      sourceLocale,
      targetLocale: job.targetLocale,
      glossary: context.glossary.rules,
      context: providerContext(resource.resourceId, title, job.resourceType),
    });
  } catch (error) {
    if (reservation) await releaseUsage(reservation, deps.prisma);
    throw error;
  }
  if (reservation) await settleUsage(reservation, result.billedCharacters, deps.prisma);
  await recordMemoryUse(payload.shopId, result.memoryEntryIds, deps.prisma);

  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const translated = result.outcomes.flatMap((o) => (o.status === "translated" ? [o] : []));
  const rejected = result.outcomes.filter((o) => o.status === "rejected").length;
  const stats = {
    charsBilled: result.billedCharacters,
    memoryHits: result.memoryHits,
    charsSaved: result.charsSaved,
    protectedSkipped: protectedKeys.length,
  };

  // Publishing needs automatic publishing on the job AND still on in the
  // shop's settings: switching back to review stops running jobs publishing.
  // Even then only results without quality warnings go live; flagged ones
  // wait in Review.
  const autoPublish =
    job.publishMode === "AUTO_PUBLISH" &&
    settings.bulkPublishMode === "AUTO_PUBLISH" &&
    (billing ? billing.entitlements.autoPublish : true);
  const toPublish = autoPublish ? translated.filter((o) => o.issues.length === 0) : [];
  const toDraft = autoPublish ? translated.filter((o) => o.issues.length > 0) : translated;

  const title = resource.content.find((c) => c.key === "title")?.value ?? null;
  const drafted = toDraft.length
    ? await saveDrafts(
        payload.shopId,
        toDraft.map((o) => ({
          jobId: job.id,
          resourceGid: item.resourceGid,
          resourceTitle: title,
          locale: job.targetLocale,
          key: o.key,
          sourceDigest: fieldByKey.get(o.key)!.digest!,
          sourceValue: fieldByKey.get(o.key)!.value ?? "",
          value: o.value,
          segmentPairs: o.segmentPairs ?? [],
          issues: o.issues,
          provider: result.provider,
        })),
        deps.prisma,
      )
    : 0;

  // Automatic publishing, explicitly enabled by the merchant. Output stays
  // unreviewed machine translation (not protected, MACHINE memory).
  const saved = toPublish.length
    ? await saveResourceTranslations(
        {
          admin,
          shopId: payload.shopId,
          actorId: null,
          resourceId: item.resourceGid,
          locale: job.targetLocale,
          edits: toPublish.map((o) => ({
            key: o.key,
            value: o.value,
            digest: fieldByKey.get(o.key)!.digest!,
            origin: "AI" as const,
            provider: result.provider,
            approved: false,
            segmentPairs: o.segmentPairs,
          })),
        },
        deps.prisma,
      )
    : [];
  const savedCount = saved.filter((s) => s.status === "saved").length;
  const notSaved = saved.length - savedCount;
  const done = drafted + savedCount;

  const status = done > 0 ? "SUCCEEDED" : "SKIPPED";
  const errorCode =
    done > 0
      ? rejected + notSaved > 0
        ? "PARTIAL"
        : drafted > 0
          ? "DRAFTED"
          : null
      : saved.some((s) => s.status === "conflict")
        ? "SOURCE_CHANGED"
        : "ALL_FIELDS_REJECTED";
  await finishItem(
    payload.shopId,
    item.id,
    {
      status,
      errorCode,
      fieldsTranslated: done,
      fieldsRejected: rejected + notSaved,
      ...stats,
    },
    deps.prisma,
  );
  return { status, ...(errorCode ? { errorCode } : {}) };
}
