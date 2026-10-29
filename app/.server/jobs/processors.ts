import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { billedBeforeFailure, type TranslationProvider } from "../providers/types";
import { shopKey } from "../queue/redis";
import {
  getTranslatableResource,
  listTranslatableResources,
  type TranslatableResourceData,
} from "../shopify/translations-api";
import { providerContext, resourceTitle } from "../../lib/resource-kinds";
import { withTenant } from "../tenancy/with-tenant";
import {
  saveResourceTranslations,
  translationDigest,
  sourceLocaleOf,
} from "../translation/product-translation-service";
import { completeTranslation, prepareTranslation } from "../translation/translate-fields";
import { loadTranslationContext } from "../translation/translation-context";
import { latestRevisions } from "../translation/revisions";
import { recordMemoryUse } from "../memory/translation-memory";
import { pendingDraftDigests, saveDrafts } from "../review/drafts";
import { formalityFor, getShopSettings, hasCurrentAiConsent, translationContext } from "../settings/shop-settings";
import { releaseUsage, reserveUsage, settleUsage } from "../usage/usage-ledger";
import { finishItem, isBulkResourceType, recordBilled, stopJob, completeIfDone } from "./bulk-jobs";
import { JobStopError, RateLimitedError } from "./errors";
import { planResourceWork, scopeKeys } from "./needs-work";
import { listAttachedResources } from "../shopify/attached-resources";
import { isEditableAttachedField } from "../translation/attached-editor";
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
  /**
   * Optional daily caps: the shop's (AI_DAILY_CHAR_LIMIT; per shop never above
   * its monthly allowance, as on every page) and the platform's.
   */
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
  /** Items the job had before this page (queue priority of the page's items). */
  position: number;
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
  const done: DiscoveryResult = { itemIds: [], hasMore: false, cursor: null, position: 0 };
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
  // With images and custom fields included, every item is checked: whether
  // they need work is only known after listing them (per item).
  const gids = page.resources
    .filter(
      (r) =>
        job.includeAttached ||
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
  return { itemIds, hasMore: page.pageInfo.hasNextPage, cursor: page.pageInfo.endCursor, position: job.totalItems };
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
  /** The queue job carrying the item; a stale duplicate (an older round) doesn't claim it. */
  queueJobId?: string,
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
  // Images and custom fields need about three times the Admin API calls.
  await throttle(deps, payload.shopId, job.includeAttached ? ITEM_SHOPIFY_COST * 3 : ITEM_SHOPIFY_COST);
  // Only the queue job that currently carries the item claims it, and only while it isn't
  // finished: two deliveries (a re-queue in two workers) never translate it twice.
  const claimed = await withTenant(
    payload.shopId,
    (tx) =>
      tx.translationJobItem.updateMany({
        where: {
          id: item.id,
          shopId: payload.shopId,
          status: { in: ["PENDING", "RUNNING", "FAILED"] },
          ...(queueJobId ? { OR: [{ queueJobId: null }, { queueJobId }] } : {}),
        },
        data: { status: "RUNNING", attempts: { increment: 1 } },
      }),
    deps.prisma,
  );
  if (claimed.count === 0) return { status: "discarded", reason: "NOT_CLAIMED" };

  const settings = await getShopSettings(payload.shopId, deps.prisma);
  if (!hasCurrentAiConsent(settings)) throw new JobStopError("CONSENT_REQUIRED");
  // Plans can change while a job runs: check before every item.
  const billing = deps.billingFor ? await deps.billingFor(payload.shopId) : null;
  if (billing && !billing.entitlements.bulk) throw new JobStopError("PLAN_REQUIRED");
  const monthlyLimit = billing?.configured ? billing.entitlements.monthlyChars : deps.monthlyLimit;
  const dailyLimit = deps.dailyLimit === undefined ? undefined : Math.min(deps.dailyLimit, monthlyLimit);

  const admin = await deps.adminFor(shop.shopDomain);
  const resource = await getTranslatableResource(admin, item.resourceGid, job.targetLocale);
  if (!resource) {
    await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode: "RESOURCE_GONE" }, deps.prisma);
    return { status: "SKIPPED", errorCode: "RESOURCE_GONE" };
  }
  // Publishing needs automatic publishing on the job AND still on in the
  // shop's settings: switching back to review stops running jobs publishing.
  // Even then only results without quality warnings go live; flagged ones
  // wait in Review.
  const autoPublish =
    job.publishMode === "AUTO_PUBLISH" &&
    settings.bulkPublishMode === "AUTO_PUBLISH" &&
    (billing ? billing.entitlements.autoPublish : true);
  // Every run meters its provider calls under its own key: a retry, a re-queue or a later
  // check of the same item is a new call and counts against the limits again.
  const run: RunContext = { deps, payload, attempt, runId: randomUUID(), jobId: job.id, targetLocale: job.targetLocale, overwriteProtected: job.overwriteProtected, settings, monthlyLimit, dailyLimit, autoPublish, admin, itemId: item.id };

  const parentTitle = isBulkResourceType(job.resourceType) ? resourceTitle(job.resourceType, resource.content) : null;
  const results: ResourceRunResult[] = [];
  const own = await translateOneResource(run, {
    resource,
    title: resource.content.find((c) => c.key === "title")?.value ?? null,
    context: providerContext(resource.resourceId, parentTitle, job.resourceType),
    onlyKeys: scopeKeys(job.fieldScope),
  });
  results.push(own);

  // Image alt text and custom fields of the item, when the merchant included
  // them (all fields only), with the same rules: drafts, protection, checks.
  if (job.includeAttached) {
    const attached = await listAttachedResources(admin, item.resourceGid, job.targetLocale);
    for (const a of attached) {
      const editable = { ...a, content: a.content.filter((c) => isEditableAttachedField(c)) };
      const label = a.kind === "IMAGE" ? "Image" : `${a.label} (custom field)`;
      results.push(
        await translateOneResource(run, {
          resource: editable,
          parentGid: item.resourceGid,
          title: parentTitle ? `${parentTitle} · ${label}` : label,
          context: parentTitle
            ? a.kind === "IMAGE"
              ? `Image description (alt text) of: ${parentTitle}`
              : `Custom field "${a.label}" of: ${parentTitle}`
            : undefined,
        }),
      );
    }
  }

  const sum = (pick: (r: ResourceRunResult) => number) => results.reduce((n, r) => n + pick(r), 0);
  const planned = sum((r) => r.planned);
  const protectedSkipped = sum((r) => r.protectedSkipped);
  if (planned === 0) {
    const errorCode = protectedSkipped ? "PROTECTED" : "UP_TO_DATE";
    await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode, protectedSkipped }, deps.prisma);
    return { status: "SKIPPED", errorCode };
  }
  const drafted = sum((r) => r.drafted);
  const savedCount = sum((r) => r.saved);
  const notSaved = sum((r) => r.notSaved);
  const rejected = sum((r) => r.rejected);
  const done = drafted + savedCount;

  const status = done > 0 ? "SUCCEEDED" : "SKIPPED";
  const errorCode =
    done > 0
      ? rejected + notSaved > 0
        ? "PARTIAL"
        : drafted > 0
          ? "DRAFTED"
          : null
      : results.some((r) => r.translationChanged)
        ? "TRANSLATION_CHANGED"
        : results.some((r) => r.conflict)
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
      memoryHits: sum((r) => r.memoryHits),
      charsSaved: sum((r) => r.charsSaved),
      protectedSkipped,
    },
    deps.prisma,
  );
  return { status, ...(errorCode ? { errorCode } : {}) };
}

interface RunContext {
  deps: JobDependencies;
  payload: ItemPayload;
  attempt: number;
  /** Unique per run of the item: part of every reservation key. */
  runId: string;
  itemId: string;
  jobId: string;
  targetLocale: string;
  overwriteProtected: boolean;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  monthlyLimit: number;
  dailyLimit?: number;
  autoPublish: boolean;
  admin: Admin;
}

interface ResourceRunResult {
  planned: number;
  protectedSkipped: number;
  drafted: number;
  saved: number;
  notSaved: number;
  rejected: number;
  conflict: boolean;
  /** Someone wrote a translation while this one was being made; theirs was kept. */
  translationChanged: boolean;
  charsBilled: number;
  memoryHits: number;
  charsSaved: number;
}

/**
 * Translates what one resource needs (the item itself, or one of its images
 * or custom fields): plan, reserve usage, translate, then drafts or (with
 * automatic publishing) digest-checked publishing.
 */
async function translateOneResource(
  run: RunContext,
  target: {
    resource: TranslatableResourceData;
    parentGid?: string;
    title: string | null;
    context: string | undefined;
    onlyKeys?: readonly string[];
  },
): Promise<ResourceRunResult> {
  const { deps, payload } = run;
  const { resource } = target;
  const empty: ResourceRunResult = { planned: 0, protectedSkipped: 0, drafted: 0, saved: 0, notSaved: 0, rejected: 0, conflict: false, translationChanged: false, charsBilled: 0, memoryHits: 0, charsSaved: 0 };
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(payload.shopId, [resource.resourceId], run.targetLocale, deps.prisma),
    pendingDraftDigests(payload.shopId, [resource.resourceId], run.targetLocale, deps.prisma),
  ]);
  const { fields, protectedKeys } = planResourceWork(resource, {
    latest,
    pendingDrafts,
    overwriteProtected: run.overwriteProtected,
    ...(target.onlyKeys ? { onlyKeys: target.onlyKeys } : {}),
  });
  if (fields.length === 0) return { ...empty, protectedSkipped: protectedKeys.length };

  const sourceLocale = sourceLocaleOf(resource);
  const context = await loadTranslationContext(
    {
      shopId: payload.shopId,
      sourceLocale,
      targetLocale: run.targetLocale,
      reuseMachineMemory: run.settings.reuseMachineMemory,
    },
    deps.prisma,
  );
  const prepared = await prepareTranslation({ fields, protect: context.glossary.protect, memory: context.memory });

  // One reservation per resource and run, for what the provider will
  // actually be sent: every run is billed separately and a failed call
  // released (what earlier DeepL batches billed stays counted).
  const reservation = prepared.providerChars
    ? await reserveUsage(
        {
          shopId: payload.shopId,
          key: target.parentGid
            ? `job-item:${run.itemId}:${run.runId}:${resource.resourceId}`
            : `job-item:${run.itemId}:${run.runId}`,
          chars: prepared.providerChars,
          limit: run.monthlyLimit,
          dailyLimit: run.dailyLimit,
          platformDailyLimit: deps.platformDailyLimit,
          provider: deps.provider!.id,
        },
        deps.prisma,
      )
    : null;

  let result: Awaited<ReturnType<typeof completeTranslation>>;
  try {
    result = await completeTranslation(prepared, {
      provider: deps.provider!,
      sourceLocale,
      targetLocale: run.targetLocale,
      glossary: context.glossary.rules,
      context: translationContext(run.settings.aiStoreContext, target.context),
      formality: formalityFor(run.settings, run.targetLocale),
    });
  } catch (error) {
    if (reservation) {
      const billed = billedBeforeFailure(error);
      if (billed > 0) {
        await settleUsage(reservation, billed, deps.prisma);
        await recordBilled(payload.shopId, run.itemId, run.jobId, billed, deps.prisma);
      } else {
        await releaseUsage(reservation, deps.prisma);
      }
    }
    throw error;
  }
  if (reservation) await settleUsage(reservation, result.billedCharacters, deps.prisma);
  // Counted on the item and job as soon as the provider billed it: their totals match the
  // ledger also when publishing fails afterwards and the item runs again.
  await recordBilled(payload.shopId, run.itemId, run.jobId, result.billedCharacters, deps.prisma);
  await recordMemoryUse(payload.shopId, result.memoryEntryIds, deps.prisma);

  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  // The translations as planned: publishing or approving later replaces only these.
  const currentByKey = new Map(resource.translations.map((t) => [t.key, translationDigest(t.value)]));
  const currentOf = (key: string) => currentByKey.get(key) ?? translationDigest(null);
  const translated = result.outcomes.flatMap((o) => (o.status === "translated" ? [o] : []));
  const rejected = result.outcomes.filter((o) => o.status === "rejected").length;
  const toPublish = run.autoPublish ? translated.filter((o) => o.issues.length === 0) : [];
  const toDraft = run.autoPublish ? translated.filter((o) => o.issues.length > 0) : translated;

  const drafted = toDraft.length
    ? await saveDrafts(
        payload.shopId,
        toDraft.map((o) => ({
          jobId: run.jobId,
          resourceGid: resource.resourceId,
          parentGid: target.parentGid ?? null,
          resourceTitle: target.title,
          locale: run.targetLocale,
          key: o.key,
          sourceDigest: fieldByKey.get(o.key)!.digest!,
          sourceValue: fieldByKey.get(o.key)!.value ?? "",
          value: o.value,
          segmentPairs: o.segmentPairs ?? [],
          issues: o.issues,
          provider: result.provider,
          currentDigest: currentOf(o.key),
          valueType: fieldByKey.get(o.key)!.type,
        })),
        deps.prisma,
      )
    : 0;

  // Automatic publishing, explicitly enabled by the merchant. Output stays
  // unreviewed machine translation (not protected, MACHINE memory).
  const saved = toPublish.length
    ? await saveResourceTranslations(
        {
          admin: run.admin,
          shopId: payload.shopId,
          actorId: null,
          resourceId: resource.resourceId,
          locale: run.targetLocale,
          edits: toPublish.map((o) => ({
            key: o.key,
            value: o.value,
            digest: fieldByKey.get(o.key)!.digest!,
            origin: "AI" as const,
            provider: result.provider,
            approved: false,
            segmentPairs: o.segmentPairs,
            expectedCurrent: currentOf(o.key),
          })),
        },
        deps.prisma,
      )
    : [];
  const savedCount = saved.filter((r) => r.status === "saved").length;
  return {
    planned: fields.length,
    protectedSkipped: protectedKeys.length,
    drafted,
    saved: savedCount,
    notSaved: saved.length - savedCount,
    rejected,
    conflict: saved.some((r) => r.status === "conflict"),
    translationChanged: saved.some((r) => r.status === "conflict" && r.reason === "TRANSLATION_CHANGED"),
    charsBilled: result.billedCharacters,
    memoryHits: result.memoryHits,
    charsSaved: result.charsSaved,
  };
}
