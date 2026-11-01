import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { type TranslationProvider } from "../providers/types";
import { isEngineRouter, JOB_DEADLINE_MS } from "../providers/engine-router";
import { plannedEngine, routerSignal } from "../providers/index";
import { chargedChars, chargeForFailure, chargeForResult, type EngineCharge } from "../usage/engine-charge";
import { logger } from "../lib/logger";
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
import { pendingDraftDigests, recordRejectedAttempts, saveDrafts } from "../review/drafts";
import { consentedEngines, formalityFor, getShopSettings, hasCurrentAiConsent, translationContext } from "../settings/shop-settings";
import { releaseUsage, reserveUsage, settleUsage, type UsageBudget } from "../usage/usage-ledger";
import { smartPaused } from "../smart/config";
import { budgetWindows, SMART_REQUESTED_BY, smartCoverageTypes } from "../../lib/smart-auto";
import { allowedTargetLocales } from "../billing/subscription";
import { currentShopLocales, type CurrentLocales } from "../locales/current-locales";
import { ACTIVE_JOB_STATUSES, AUTO_REQUESTED_BY, finishItem, isBulkResourceType, recordBilled, stopJob, completeIfDone } from "./bulk-jobs";
import { JobStopError, RateLimitedError } from "./errors";
import { planResourceWork, scopeKeys } from "./needs-work";
import { listAttachedResources } from "../shopify/attached-resources";
import { isEditableAttachedField } from "../translation/attached-editor";
import { noteCoverageRead, noteResourceGone } from "../coverage/items";
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
   * automatic publishing need a plan that includes them. `trialEndsAt`: a
   * Shopify trial runs until then, with its lower allowance (subscription.ts).
   */
  billingFor?(shopId: string): Promise<{ configured: boolean; entitlements: Entitlements; trialEndsAt?: Date }>;
  keyPrefix: string;
  shopifyLimiter?: Limiter;
  /** Aborted when the worker shuts down: a router stops before its next engine. */
  shutdown?: AbortSignal;
  /** How often a router's call checks whether its job was cancelled (default CANCEL_POLL_MS; tests). */
  cancelPollMs?: number;
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

/** Started by the app itself (automatic translation), not by the merchant. */
function isAutomaticJob(job: { requestedBy: string | null }): boolean {
  return Boolean(job.requestedBy?.startsWith("system:"));
}

/** The field groups both the plan and the settings now allow ([]: all), or null when they share none. */
export function narrowGroups(planned: readonly string[], current: readonly string[]): string[] | null {
  if (planned.length === 0) return [...current];
  if (current.length === 0) return [...planned];
  const both = planned.filter((g) => current.includes(g));
  return both.length ? both : null;
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
  // A refusal for markup an engine couldn't keep is tried again once another engine serves the language.
  const engine = isAutomaticJob(job) && isEngineRouter(deps.provider)
    ? await plannedEngine(
        deps.provider,
        job.targetLocale,
        consentedEngines(await getShopSettings(payload.shopId, deps.prisma)),
        page.resources[0] ? sourceLocaleOf(page.resources[0]) : undefined,
      )
    : undefined;
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(payload.shopId, pageGids, job.targetLocale, deps.prisma),
    // As for each item: a translation the merchant starts tries refused fields again.
    pendingDraftDigests(payload.shopId, pageGids, job.targetLocale, deps.prisma, { includeRefused: isAutomaticJob(job), ...(engine ? { engine } : {}) }),
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
      // A resource another active job is still translating (an automatic job finishing its running
      // items after a handover) gets no second item: it would be translated and billed twice.
      const busy = gids.length
        ? await tx.translationJobItem.findMany({
            where: {
              shopId: payload.shopId,
              resourceGid: { in: gids },
              status: { in: ["PENDING", "RUNNING"] },
              jobId: { not: job.id },
              job: { targetLocale: job.targetLocale, status: { in: [...ACTIVE_JOB_STATUSES] } },
            },
            select: { resourceGid: true },
          })
        : [];
      const taken = new Set(busy.map((b) => b.resourceGid));
      const free = gids.filter((gid) => !taken.has(gid));
      const created = free.length
        ? await tx.translationJobItem.createMany({
            data: free.map((resourceGid) => ({ shopId: payload.shopId, jobId: job.id, resourceGid })),
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

  let job = item.job;
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
        data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date() },
      }),
    deps.prisma,
  );
  if (claimed.count === 0) return { status: "discarded", reason: "NOT_CLAIMED" };
  // A handover (handOverAutomaticJobTx) may have moved the waiting item to the job that took over;
  // once it runs it stays put, so its job is read again: it is billed and drafted where it is counted.
  const current = await withTenant(
    payload.shopId,
    (tx) => tx.translationJobItem.findFirst({ where: { id: item.id, shopId: payload.shopId }, select: { job: true } }),
    deps.prisma,
  );
  if (current && current.job.id !== job.id) {
    job = current.job;
    if (job.status === "CANCELLED" || job.status === "FAILED" || job.cancelRequestedAt) {
      await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: job.errorCode ?? "JOB_CANCELLED" }, deps.prisma);
      return { status: "CANCELLED", errorCode: job.errorCode ?? "JOB_CANCELLED" };
    }
  }

  const settings = await getShopSettings(payload.shopId, deps.prisma);
  if (!hasCurrentAiConsent(settings)) throw new JobStopError("CONSENT_REQUIRED");
  // Only the engines the shop's consent covers (the engine planned for the language is read once
  // the resource's own language is known, below).
  const engines = consentedEngines(settings);
  // Plans can change while a job runs: check before every item (the smart schedule's own entitlement
  // first, so its jobs stop with the reason that pauses it).
  const billing = deps.billingFor ? await deps.billingFor(payload.shopId) : null;
  if (billing && job.requestedBy === SMART_REQUESTED_BY && !billing.entitlements.smartAuto) throw new JobStopError("PLAN_SMART");
  if (billing && !billing.entitlements.bulk) throw new JobStopError("PLAN_REQUIRED");
  // An item queued by automatic translation runs only while it is on for this language.
  if (job.requestedBy === AUTO_REQUESTED_BY && (!settings.autoTranslateNew || !settings.autoTranslateLocales.includes(job.targetLocale))) {
    await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: "AUTO_OFF" }, deps.prisma);
    return { status: "CANCELLED", errorCode: "AUTO_OFF" };
  }
  // Smart Auto-Translate: its plan, settings, languages and exclusions are checked again for every item.
  let smart: { budget: UsageBudget; publish: boolean; fieldGroups: string[]; keepOutdated: boolean; includeAttached: boolean; primaryLocale: string | null } | null = null;
  if (job.requestedBy === SMART_REQUESTED_BY) {
    if (billing && !billing.entitlements.smartAuto) throw new JobStopError("PLAN_SMART");
    const state = await withTenant(
      payload.shopId,
      async (tx) => {
        // An image or a custom field of its own: excluding its owner leaves it alone too.
        const owner = isBulkResourceType(job.resourceType)
          ? null
          : ((await tx.coverageItem.findFirst({ where: { shopId: payload.shopId, resourceGid: item.resourceGid, parentGid: { not: null } }, select: { parentGid: true } }))?.parentGid ?? null);
        return {
          config: await tx.smartAutoConfig.findUnique({ where: { shopId: payload.shopId } }),
          excluded: await tx.smartAutoExclusion.findFirst({ where: { shopId: payload.shopId, resourceGid: { in: owner ? [item.resourceGid, owner] : [item.resourceGid] } }, select: { resourceGid: true } }),
        };
      },
      deps.prisma,
    );
    const config = state.config;
    // The settings as they are now: a type, the field groups or real time taken out since it was planned.
    const groups = config ? narrowGroups(job.fieldGroups, config.fieldGroups) : null;
    const outOfScope = config && (!smartCoverageTypes(config).includes(job.resourceType) || groups === null || (!job.smartRunId && config.mode !== "realtime"));
    // A language taken out of its settings is out of scope too (AUTO_OFF names basic automatic translation).
    const stop = !config?.enabled ? "SMART_OFF" : smartPaused(config) ? "PAUSED" : !config.locales.includes(job.targetLocale) || outOfScope ? "OUT_OF_SCOPE" : null;
    if (stop) {
      await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: stop }, deps.prisma);
      return { status: "CANCELLED", errorCode: stop };
    }
    if (state.excluded) {
      await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode: "EXCLUDED" }, deps.prisma);
      return { status: "SKIPPED", errorCode: "EXCLUDED" };
    }
    // Its usage is counted as its own (the activity shows it) and kept within the merchant's budgets.
    const windows = budgetWindows(Date.now(), config!.timeZone);
    smart = {
      budget: {
        origin: "smart",
        ...(config!.dailyBudget ? { daily: { limit: config!.dailyBudget, since: new Date(windows.daySince) } } : {}),
        ...(config!.monthlyBudget ? { monthly: { limit: config!.monthlyBudget, since: new Date(windows.monthSince) } } : {}),
      },
      // Publishing only while the smart settings still say so, as confirmed by the merchant.
      publish: config!.publishMode === "AUTO_PUBLISH" && Boolean(config!.publishConfirmedAt),
      fieldGroups: groups!,
      keepOutdated: !job.replaceOutdatedMachine || !config!.replaceOutdatedMachine,
      includeAttached: config!.includeAttached,
      primaryLocale: config!.primaryLocale,
    };
  }
  const monthlyLimit = billing?.configured ? billing.entitlements.monthlyChars : deps.monthlyLimit;
  const dailyLimit = deps.dailyLimit === undefined ? undefined : Math.min(deps.dailyLimit, monthlyLimit);

  const admin = await deps.adminFor(shop.shopDomain);
  if (smart) {
    // Only into a language the store and the plan still have (as Shopify says now: with only the
    // stored copy, Shopify is having trouble and the read below decides whether the item waits).
    const allowedIn = (current: CurrentLocales) => (billing ? allowedTargetLocales(billing.entitlements, current.targets) : current.targets);
    let locales = await currentShopLocales(payload.shopId, async () => admin, deps.prisma);
    // A copy may be minutes old (a language added a moment ago): Shopify confirms before anything is cancelled.
    if (!locales.fresh && !allowedIn(locales).includes(job.targetLocale)) locales = await currentShopLocales(payload.shopId, async () => admin, deps.prisma, Date.now(), 0);
    if (locales.fresh && !allowedIn(locales).includes(job.targetLocale)) {
      await finishItem(payload.shopId, item.id, { status: "CANCELLED", errorCode: "LANGUAGE_GONE" }, deps.prisma);
      return { status: "CANCELLED", errorCode: "LANGUAGE_GONE" };
    }
  }
  // Coverage takes the read as the state when it started: a save made meanwhile stays newer.
  const readAt = new Date();
  const resource = await getTranslatableResource(admin, item.resourceGid, job.targetLocale);
  if (!resource) {
    await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode: "RESOURCE_GONE" }, deps.prisma);
    // Deleted in Shopify: it leaves coverage in every language, with the custom fields it owns.
    await noteResourceGone(payload.shopId, item.resourceGid, deps.prisma);
    return { status: "SKIPPED", errorCode: "RESOURCE_GONE" };
  }
  // The language became the store's primary language: there is nothing to translate into.
  if (sourceLocaleOf(resource) === job.targetLocale) {
    await finishItem(payload.shopId, item.id, { status: "SKIPPED", errorCode: "SAME_LANGUAGE" }, deps.prisma);
    return { status: "SKIPPED", errorCode: "SAME_LANGUAGE" };
  }
  // The store's primary language changed since the smart settings were saved: nothing is
  // translated from the new one until the merchant reviewed the languages (the schedule pauses).
  // Only from the language Shopify gives the content (a resource without any has none to compare).
  const contentLocale = resource.content[0]?.locale;
  if (smart?.primaryLocale && contentLocale && contentLocale !== smart.primaryLocale) throw new JobStopError("PRIMARY_LANGUAGE");
  // Coverage follows what the job read: an original changed in Shopify (no webhook for pages and
  // blogs, or a refresh that didn't run) shows as outdated, and the job's drafts as drafts.
  await noteCoverageRead(payload.shopId, job.targetLocale, [resource], readAt, deps.prisma);
  // The first engine planned for this pair is what the reservation names and what refused fields
  // are compared with (no I/O unless several engines may be used).
  const firstEngine = await plannedEngine(deps.provider, job.targetLocale, engines, sourceLocaleOf(resource));
  // Publishing needs automatic publishing on the job AND still on in the
  // shop's settings: switching back to review stops running jobs publishing.
  // Even then only results without quality warnings go live; flagged ones
  // wait in Review.
  const autoPublish =
    job.publishMode === "AUTO_PUBLISH" &&
    (smart ? smart.publish : settings.bulkPublishMode === "AUTO_PUBLISH") &&
    (billing ? billing.entitlements.autoPublish : true);
  // Every run meters its provider calls under its own key: a retry, a re-queue or a later
  // check of the same item is a new call and counts against the limits again.
  const run: RunContext = {
    deps,
    payload,
    attempt,
    runId: randomUUID(),
    jobId: job.id,
    targetLocale: job.targetLocale,
    overwriteProtected: job.overwriteProtected,
    automatic: isAutomaticJob(job),
    fieldGroups: smart ? smart.fieldGroups : job.fieldGroups,
    keepOutdated: smart ? smart.keepOutdated : !job.replaceOutdatedMachine,
    ...(smart ? { budget: smart.budget } : {}),
    settings,
    monthlyLimit,
    dailyLimit,
    autoPublish,
    admin,
    itemId: item.id,
    engines,
    planned: firstEngine,
  };

  const parentTitle = isBulkResourceType(job.resourceType) ? resourceTitle(job.resourceType, resource.content) : null;
  const results: ResourceRunResult[] = [];
  // A smart check's items can be an image or a custom field of their own: only the fields their editor translates.
  const ownResource = isBulkResourceType(job.resourceType) ? resource : { ...resource, content: resource.content.filter((c) => isEditableAttachedField(c)) };
  const own = await translateOneResource(run, {
    resource: ownResource,
    coverageType: job.resourceType,
    title: resource.content.find((c) => c.key === "title")?.value ?? null,
    context: providerContext(resource.resourceId, parentTitle, job.resourceType),
    onlyKeys: scopeKeys(job.fieldScope),
  });
  results.push(own);

  // Image alt text and custom fields of the item, when the merchant included
  // them (all fields only), with the same rules: drafts, protection, checks.
  if (job.includeAttached && (smart ? smart.includeAttached : true)) {
    const attachedAt = new Date();
    const attached = await listAttachedResources(admin, item.resourceGid, job.targetLocale);
    await noteCoverageRead(payload.shopId, job.targetLocale, attached, attachedAt, deps.prisma);
    for (const a of attached) {
      const editable = { ...a, content: a.content.filter((c) => isEditableAttachedField(c)) };
      const label = a.kind === "IMAGE" ? "Image" : `${a.label} (custom field)`;
      results.push(
        await translateOneResource(run, {
          resource: editable,
          // Their field groups: alt text, or a custom field's value.
          coverageType: a.kind === "IMAGE" ? "MEDIA_IMAGE" : "PRODUCT_METAFIELD",
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

/** Partials lost to a failover: engine ids and numbers only. */
function logLost(charge: EngineCharge): void {
  for (const [engine, lostChars] of Object.entries(charge.lost)) logger.info({ engine, lostChars }, "translation engine partial lost to failover");
}

const CANCEL_POLL_MS = 10_000;

/**
 * Routers only: a signal aborted when the job is cancelled (polled while the
 * call runs), the worker shuts down, or the job deadline passes, so the
 * router doesn't walk its whole chain for a stopped job. A bare provider
 * gets none and no poll starts (DeepL-only behaves as before).
 */
function stopSignal(run: RunContext): { signal: AbortSignal; dispose(): void } | null {
  const { deps, payload } = run;
  if (!isEngineRouter(deps.provider)) return null;
  const controller = new AbortController();
  const signal = routerSignal(deps.provider, deps.shutdown ? AbortSignal.any([controller.signal, deps.shutdown]) : controller.signal, JOB_DEADLINE_MS)!;
  const timer = setInterval(() => {
    withTenant(
      payload.shopId,
      (tx) => tx.translationJob.findFirst({ where: { id: run.jobId, shopId: payload.shopId }, select: { status: true, cancelRequestedAt: true } }),
      deps.prisma,
    )
      .then((job) => {
        if (!job || job.cancelRequestedAt || job.status === "CANCELLED" || job.status === "FAILED") controller.abort();
      })
      .catch(() => undefined);
  }, deps.cancelPollMs ?? CANCEL_POLL_MS);
  timer.unref?.();
  return { signal, dispose: () => clearInterval(timer) };
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
  automatic: boolean;
  /** Field groups the job translates (empty: all). */
  fieldGroups: readonly string[];
  /** Outdated translations stay as they are (Smart Auto-Translate option). */
  keepOutdated: boolean;
  /** Smart Auto-Translate: its usage origin and budgets. */
  budget?: UsageBudget;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  monthlyLimit: number;
  dailyLimit?: number;
  autoPublish: boolean;
  admin: Admin;
  /** The engines the shop's consent covers (consentedEngines). */
  engines: readonly string[];
  /** The engine the run's requests go to first (the reservations' provider). */
  planned: string;
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
    /** The coverage type its field groups are counted under. */
    coverageType: string;
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
    // Automatic checks don't retry what the checks refused for the same original; a translation
    // the merchant starts does (they may have changed the glossary meanwhile). Markup an engine
    // couldn't keep is tried again once another engine is planned for the language.
    pendingDraftDigests(payload.shopId, [resource.resourceId], run.targetLocale, deps.prisma, {
      includeRefused: run.automatic,
      ...(isEngineRouter(deps.provider) ? { engine: run.planned } : {}),
    }),
  ]);
  const { fields, protectedKeys } = planResourceWork(resource, {
    latest,
    pendingDrafts,
    overwriteProtected: run.overwriteProtected,
    ...(target.onlyKeys ? { onlyKeys: target.onlyKeys } : {}),
    ...(run.fieldGroups.length ? { onlyGroups: { groups: run.fieldGroups, resourceType: target.coverageType } } : {}),
    keepOutdated: run.keepOutdated,
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
  // released (what earlier batches billed stays counted; partials lost to a
  // failover count for the platform only).
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
          provider: run.planned,
          ...(run.budget ? { budget: run.budget } : {}),
        },
        deps.prisma,
      )
    : null;

  let result: Awaited<ReturnType<typeof completeTranslation>>;
  const stop = stopSignal(run);
  try {
    result = await completeTranslation(prepared, {
      provider: deps.provider!,
      engines: run.engines,
      sourceLocale,
      targetLocale: run.targetLocale,
      glossary: context.glossary.rules,
      context: translationContext(run.settings.aiStoreContext, target.context),
      formality: formalityFor(run.settings, run.targetLocale),
      ...(stop ? { signal: stop.signal } : {}),
    });
  } catch (error) {
    if (reservation) {
      const charge = chargeForFailure(error, reservation.chars, reservation.provider);
      const billed = chargedChars(charge);
      logLost(charge);
      if (billed > 0 || Object.keys(charge.lost).length > 0) {
        await settleUsage(reservation, billed, deps.prisma, charge);
        if (billed > 0) await recordBilled(payload.shopId, run.itemId, run.jobId, billed, deps.prisma);
      } else {
        await releaseUsage(reservation, deps.prisma);
      }
    }
    throw error;
  } finally {
    stop?.dispose();
  }
  const charge = chargeForResult(result);
  logLost(charge);
  if (reservation) await settleUsage(reservation, result.billedCharacters, deps.prisma, charge);
  // Counted on the item and job as soon as the provider billed it: their totals match the
  // ledger also when publishing fails afterwards and the item runs again.
  await recordBilled(payload.shopId, run.itemId, run.jobId, chargedChars(charge), deps.prisma);
  await recordMemoryUse(payload.shopId, result.memoryEntryIds, deps.prisma);

  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  // The translations as planned: publishing or approving later replaces only these.
  const currentByKey = new Map(resource.translations.map((t) => [t.key, translationDigest(t.value)]));
  const currentOf = (key: string) => currentByKey.get(key) ?? translationDigest(null);
  const translated = result.outcomes.flatMap((o) => (o.status === "translated" ? [o] : []));
  const refused = result.outcomes.flatMap((o) => (o.status === "rejected" ? [o] : []));
  const rejected = refused.length;
  // Remembered per source, so an unchanged original isn't sent (and billed) again by the next check.
  await recordRejectedAttempts(
    payload.shopId,
    refused.map((o) => ({
      jobId: run.jobId,
      resourceGid: resource.resourceId,
      parentGid: target.parentGid ?? null,
      resourceTitle: target.title,
      locale: run.targetLocale,
      key: o.key,
      sourceDigest: fieldByKey.get(o.key)!.digest!,
      sourceValue: fieldByKey.get(o.key)!.value ?? "",
      issues: o.issues,
      provider: result.provider,
      currentDigest: currentOf(o.key),
      valueType: fieldByKey.get(o.key)!.type,
      reason: o.reason,
    })),
    deps.prisma,
  );
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
