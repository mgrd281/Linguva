/**
 * Smart Auto-Translate runs (docs/SMART_AUTO_TRANSLATE.md §5): the tick that
 * turns due schedules into runs, starting a run's measurement, planning
 * translation while the measurement reads the store, and finishing the run.
 *
 * A run is one coverage report with `smartRunId`: every page it reads is
 * planned with the same field-level rules as every other job, and the items
 * are written in the page's own transaction, so a repeated page never plans
 * twice and nothing read is left unplanned.
 */
import type { CoverageReport, PrismaClient, SmartAutoConfig, SmartAutoRun } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { allowedTargetLocales } from "../billing/subscription";
import { createCoverageReport, type CoveragePagePayload } from "../coverage/coverage";
import type { CoverageChange } from "../coverage/items";
import { completeIfDone } from "../jobs/bulk-jobs";
import { planResourceWork } from "../jobs/needs-work";
import { logger } from "../lib/logger";
import { currentShopLocales } from "../locales/current-locales";
import { pendingDraftDigests } from "../review/drafts";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { isEditableAttachedField } from "../translation/attached-editor";
import { latestRevisions } from "../translation/revisions";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import type { Entitlements } from "../../lib/plans";
import { SMART_REQUESTED_BY, smartCoverageTypes, type SmartPauseReason } from "../../lib/smart-auto";
import { excludedAmong, lockSmart, nextCheck, smartPaused } from "./config";
import { finishSmartRunIfDone } from "./finish";

type Admin = Pick<AdminApiContext, "graphql">;

export const SMART_ACTIVE_RUN = ["QUEUED", "WAITING", "RUNNING"] as const;
/** A run waiting for a measurement the merchant started is tried again this soon. */
export const WAITING_RECHECK_MS = 60_000;
/** Check now at most this often (double clicks are one run by the form's key). */
export const MANUAL_COOLDOWN_MS = 5 * 60_000;
/** Runs are activity history: older ones are deleted, per shop. */
export const RUN_RETENTION_DAYS = 90;
/** Shops the tick handles per round (the rest follow a minute later). */
export const TICK_SHOPS = 100;

export interface SmartDeps {
  prisma: PrismaClient;
  adminFor(shopDomain: string): Promise<Admin>;
  billingFor?(shopId: string): Promise<{ configured: boolean; entitlements: Entitlements }>;
  /** An AI provider is configured. */
  aiAvailable: boolean;
  /** Queues a coverage page (absent: background jobs aren't configured). */
  enqueueCoveragePage?(payload: CoveragePagePayload): Promise<void>;
}

/** What a tick or Check now needs to know about the shop, read outside any transaction. */
export interface ShopFacts {
  entitled: boolean;
  consent: boolean;
  primary: string | null;
  /** Additional languages now, and those the plan covers. */
  targets: string[];
  allowed: string[];
}

export async function shopFacts(deps: Pick<SmartDeps, "prisma" | "adminFor" | "billingFor">, shop: { id: string; shopDomain: string }): Promise<ShopFacts> {
  const billing = deps.billingFor ? await deps.billingFor(shop.id) : null;
  const settings = await getShopSettings(shop.id, deps.prisma);
  const locales = await currentShopLocales(shop.id, () => deps.adminFor(shop.shopDomain), deps.prisma);
  return {
    // Without billing (development) everything is included, as everywhere else.
    entitled: billing ? billing.entitlements.smartAuto : true,
    consent: hasCurrentAiConsent(settings),
    primary: locales.primary,
    targets: locales.targets,
    allowed: billing ? allowedTargetLocales(billing.entitlements, locales.targets) : locales.targets,
  };
}

/** The run's scope as the config has it now, limited to the shop's and the plan's languages. */
function scopeSnapshot(config: SmartAutoConfig, facts: ShopFacts) {
  return {
    locales: config.locales.filter((l) => facts.allowed.includes(l)),
    resourceTypes: config.resourceTypes,
    fieldGroups: config.fieldGroups,
    includeAttached: config.includeAttached,
    // Automatic publishing only as confirmed by the merchant.
    publishMode: config.publishMode === "AUTO_PUBLISH" && config.publishConfirmedAt ? ("AUTO_PUBLISH" as const) : ("DRAFT" as const),
    replaceOutdatedMachine: config.replaceOutdatedMachine,
  };
}

/** Why a check can't run now (the run is recorded as SKIPPED with it), or null. */
function blocker(config: SmartAutoConfig, facts: ShopFacts, deps: Pick<SmartDeps, "aiAvailable" | "enqueueCoveragePage">, now: Date): string | null {
  if (smartPaused(config, now)) return "PAUSED";
  if (!deps.aiAvailable) return "AI_NOT_CONFIGURED";
  if (!deps.enqueueCoveragePage) return "QUEUES_UNAVAILABLE";
  if (config.locales.filter((l) => facts.allowed.includes(l)).length === 0) return "NO_LANGUAGE";
  return null;
}

/** A cause that pauses the schedule until it is gone, or null. */
function pauseCause(config: SmartAutoConfig, facts: ShopFacts): SmartPauseReason | null {
  if (!facts.entitled) return "PLAN";
  if (!facts.consent) return "CONSENT";
  if (config.primaryLocale && facts.primary && facts.primary !== config.primaryLocale) return "PRIMARY_LANGUAGE";
  return null;
}

async function setHint(tx: TenantTx, shopId: string, at: Date | null) {
  await tx.shop.update({ where: { id: shopId }, data: { smartNextRunAt: at } });
}

export interface TickSummary {
  shops: number;
  started: number;
  skipped: number;
  failed: number;
}

/**
 * One round of the scheduler (every minute, one job per slot however many
 * workers run). Each due shop is handled on its own: a failure leaves its
 * schedule as it was, so the next round tries again.
 */
export async function smartTick(deps: SmartDeps, now = new Date()): Promise<TickSummary> {
  const summary: TickSummary = { shops: 0, started: 0, skipped: 0, failed: 0 };
  const due = await deps.prisma.shop.findMany({
    where: { status: "ACTIVE", smartNextRunAt: { lte: now } },
    orderBy: { smartNextRunAt: "asc" },
    take: TICK_SHOPS,
    select: { id: true, shopDomain: true },
  });
  for (const shop of due) {
    try {
      const result = await tickShop(deps, shop, now);
      summary.shops++;
      if (result.started) summary.started++;
      if (result.skipped) summary.skipped++;
    } catch (error) {
      summary.failed++;
      logger.warn({ shopId: shop.id, err: (error as Error).name }, "smart auto-translate tick failed");
    }
  }
  return summary;
}

async function tickShop(deps: SmartDeps, shop: { id: string; shopDomain: string }, now: Date) {
  const facts = await shopFacts(deps, shop);
  const decision = await withTenant(
    shop.id,
    async (tx) => {
      await lockSmart(tx, shop.id);
      let config = await tx.smartAutoConfig.findUnique({ where: { shopId: shop.id } });
      if (!config?.enabled) {
        await setHint(tx, shop.id, null);
        return { runId: null, waitingId: null, skipped: null, paused: null };
      }
      // Pauses lift by themselves when their time passed, or when their cause is gone.
      const cause = pauseCause(config, facts);
      const expired = config.pausedAt && config.pausedUntil && config.pausedUntil <= now;
      const causeGone = config.pausedAt && (config.pauseReason === "PLAN" || config.pauseReason === "CONSENT") && config.pauseReason !== cause;
      let newPause: SmartPauseReason | null = null;
      if (cause && !(config.pausedAt && config.pauseReason === cause)) {
        newPause = cause;
        config = await tx.smartAutoConfig.update({ where: { shopId: shop.id }, data: { pausedAt: now, pauseReason: cause, pausedUntil: null } });
      } else if (expired || causeGone) {
        config = await tx.smartAutoConfig.update({ where: { shopId: shop.id }, data: { pausedAt: null, pauseReason: null, pausedUntil: null } });
      }

      let runId: string | null = null;
      let skipped: string | null = null;
      if (config.nextRunAt && config.nextRunAt <= now) {
        const active = await tx.smartAutoRun.findFirst({ where: { shopId: shop.id, status: { in: [...SMART_ACTIVE_RUN] } }, select: { id: true } });
        skipped = blocker(config, facts, deps, now) ?? (active ? "COALESCED" : null);
        // One run per occurrence, however many workers tick (unique occurrence, under the lock).
        const created = await tx.smartAutoRun.createMany({
          data: [
            {
              shopId: shop.id,
              trigger: "SCHEDULED",
              occurrenceAt: config.nextRunAt,
              status: skipped ? "SKIPPED" : "QUEUED",
              errorCode: skipped,
              finishedAt: skipped ? now : null,
              ...scopeSnapshot(config, facts),
            },
          ],
          skipDuplicates: true,
        });
        if (created.count && !skipped) {
          const run = await tx.smartAutoRun.findUnique({ where: { shopId_occurrenceAt: { shopId: shop.id, occurrenceAt: config.nextRunAt } }, select: { id: true } });
          runId = run?.id ?? null;
        }
        // After an outage: one check for the missed occurrence, then on from now.
        config = await tx.smartAutoConfig.update({ where: { shopId: shop.id }, data: { nextRunAt: nextCheck(config, now), lastRunAt: now } });
        await purgeOldRuns(tx, shop.id, now);
      }
      const waiting = runId ? null : await tx.smartAutoRun.findFirst({ where: { shopId: shop.id, status: "WAITING" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const recheck = waiting ? new Date(now.getTime() + WAITING_RECHECK_MS) : null;
      const next = config.nextRunAt && recheck ? (config.nextRunAt < recheck ? config.nextRunAt : recheck) : (config.nextRunAt ?? recheck);
      await setHint(tx, shop.id, next);
      return { runId, waitingId: waiting?.id ?? null, skipped, paused: newPause };
    },
    deps.prisma,
  );
  if (decision.paused) {
    await deps.prisma.auditLog.createMany({ data: [{ shopId: shop.id, actorType: "SYSTEM", actorId: null, action: "smart_auto.paused", metadata: { reason: decision.paused } }] });
  }
  const runId = decision.runId ?? decision.waitingId;
  const started = runId ? await startSmartRun(deps, shop.id, runId, facts, now) : false;
  return { started, skipped: Boolean(decision.skipped) };
}

async function purgeOldRuns(tx: TenantTx, shopId: string, now: Date) {
  const before = new Date(now.getTime() - RUN_RETENTION_DAYS * 86_400_000);
  await tx.smartAutoRun.deleteMany({ where: { shopId, createdAt: { lt: before }, status: { notIn: [...SMART_ACTIVE_RUN] } } });
}

/**
 * Starts a run's measurement: every additional language and type, so the
 * figures stay complete. While a measurement the merchant started is
 * running, the run waits and the tick tries again a minute later.
 */
export async function startSmartRun(deps: SmartDeps, shopId: string, runId: string, facts: ShopFacts, now = new Date()): Promise<boolean> {
  const key = `smart-${runId}`;
  if (!deps.enqueueCoveragePage || facts.targets.length === 0) {
    await withTenant(
      shopId,
      (tx) =>
        tx.smartAutoRun.updateMany({
          where: { id: runId, shopId, status: { in: ["QUEUED", "WAITING"] } },
          data: { status: "FAILED", errorCode: deps.enqueueCoveragePage ? "NO_LANGUAGE" : "QUEUES_UNAVAILABLE", finishedAt: now },
        }),
      deps.prisma,
    );
    return false;
  }
  const { report, created } = await createCoverageReport({ shopId, locales: facts.targets, requestedBy: SMART_REQUESTED_BY, idempotencyKey: key, smartRunId: runId }, deps.prisma);
  const ours = report.idempotencyKey === key;
  const started = await withTenant(
    shopId,
    async (tx) => {
      if (!ours) {
        await tx.smartAutoRun.updateMany({ where: { id: runId, shopId, status: "QUEUED" }, data: { status: "WAITING" } });
        await tx.shop.update({ where: { id: shopId }, data: { smartNextRunAt: new Date(now.getTime() + WAITING_RECHECK_MS) } });
        return false;
      }
      const updated = await tx.smartAutoRun.updateMany({
        where: { id: runId, shopId, status: { in: ["QUEUED", "WAITING"] } },
        data: { status: "RUNNING", startedAt: now, coverageReportId: report.id },
      });
      return updated.count > 0;
    },
    deps.prisma,
  );
  if (started && created) await deps.enqueueCoveragePage({ shopId, reportId: report.id, segmentIndex: 0, cursor: null });
  return started;
}

/**
 * Check now. One run per click (the form's key) and at most one every few
 * minutes; an active run is returned instead of a second one.
 */
export async function requestSmartRun(
  deps: SmartDeps,
  input: { shop: { id: string; shopDomain: string }; actorId: string | null; idempotencyKey: string; now?: Date },
): Promise<{ status: "started" | "waiting" | "active" | "cooldown" | "off" | "blocked"; runId?: string; reason?: string }> {
  const now = input.now ?? new Date();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) return { status: "blocked", reason: "INVALID_KEY" };
  const facts = await shopFacts(deps, input.shop);
  const shopId = input.shop.id;
  const result = await withTenant(
    shopId,
    async (tx) => {
      await lockSmart(tx, shopId);
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId } });
      if (!config?.enabled) return { status: "off" as const };
      const repeated = await tx.smartAutoRun.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } } });
      if (repeated) return { status: "active" as const, runId: repeated.id };
      const cause = pauseCause(config, facts) ?? blocker(config, facts, deps, now);
      if (cause) return { status: "blocked" as const, reason: cause };
      const active = await tx.smartAutoRun.findFirst({ where: { shopId, status: { in: [...SMART_ACTIVE_RUN] } }, select: { id: true } });
      if (active) return { status: "active" as const, runId: active.id };
      const recent = await tx.smartAutoRun.findFirst({
        where: { shopId, trigger: "MANUAL", createdAt: { gt: new Date(now.getTime() - MANUAL_COOLDOWN_MS) } },
        select: { id: true },
      });
      if (recent) return { status: "cooldown" as const };
      const run = await tx.smartAutoRun.create({
        data: { shopId, trigger: "MANUAL", idempotencyKey: input.idempotencyKey, requestedBy: input.actorId, status: "QUEUED", ...scopeSnapshot(config, facts) },
        select: { id: true },
      });
      return { status: "created" as const, runId: run.id };
    },
    deps.prisma,
  );
  if (result.status !== "created") return result;
  await deps.prisma.auditLog.createMany({ data: [{ shopId, actorType: "MERCHANT_USER", actorId: input.actorId, action: "smart_auto.run_now", metadata: { runId: result.runId } }] });
  const started = await startSmartRun(deps, shopId, result.runId, facts, now);
  return { status: started ? "started" : "waiting", runId: result.runId };
}

/** What one page of a smart measurement plans; written in the page's transaction (writeSmartPlanTx). */
export interface SmartPagePlan {
  runId: string;
  resourceType: string;
  locale: string;
  checked: number;
  excluded: number;
  items: Array<{ resourceGid: string; fields: number; chars: number }>;
}

/**
 * Plans one page a smart measurement read, before its transaction (the
 * reads here may take a moment): which resources need work in the run's
 * scope, with the same rules as every job (current, protected, held and
 * removed fields are left alone). Null: not a smart report, or a run that
 * no longer plans (paused, turned off, finished).
 */
export async function planSmartPage(
  client: PrismaClient,
  input: { shopId: string; report: Pick<CoverageReport, "smartRunId">; resourceType: string; locale: string; changes: readonly CoverageChange[]; now?: Date },
): Promise<SmartPagePlan | null> {
  if (!input.report.smartRunId) return null;
  const runId = input.report.smartRunId;
  const now = input.now ?? new Date();
  const state = await withTenant(
    input.shopId,
    async (tx) => {
      const [run, config] = await Promise.all([
        tx.smartAutoRun.findFirst({ where: { id: runId, shopId: input.shopId } }),
        tx.smartAutoConfig.findUnique({ where: { shopId: input.shopId } }),
      ]);
      if (!run || run.status !== "RUNNING" || !config?.enabled || smartPaused(config, now)) return null;
      const gids = input.changes.flatMap((c) => [c.resourceGid, ...(c.parentGid ? [c.parentGid] : [])]);
      const excluded = await excludedAmong(tx, input.shopId, gids);
      const busy = await tx.translationJobItem.findMany({
        where: {
          shopId: input.shopId,
          resourceGid: { in: input.changes.map((c) => c.resourceGid) },
          status: { in: ["PENDING", "RUNNING"] },
          job: { targetLocale: input.locale, OR: [{ smartRunId: null }, { smartRunId: { not: runId } }] },
        },
        select: { resourceGid: true },
      });
      return { run, excluded, busy: new Set(busy.map((b) => b.resourceGid)) };
    },
    client,
  );
  if (!state) return null;
  const { run } = state;
  const plan: SmartPagePlan = { runId, resourceType: input.resourceType, locale: input.locale, checked: input.changes.length, excluded: 0, items: [] };
  if (!run.locales.includes(input.locale) || !smartCoverageTypes(run).includes(input.resourceType)) return plan;

  const candidates = input.changes.filter((c) => {
    const skip = state.excluded.has(c.resourceGid) || Boolean(c.parentGid && state.excluded.has(c.parentGid));
    if (skip) plan.excluded++;
    // Being translated by another job (a bulk job, or the previous run): left to it.
    return !skip && !state.busy.has(c.resourceGid) && c.observed;
  });
  const gids = candidates.map((c) => c.resourceGid);
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(input.shopId, gids, input.locale, client),
    pendingDraftDigests(input.shopId, gids, input.locale, client),
  ]);
  // A coverage type that isn't one of the chosen content types: their images or custom fields.
  const attached = !run.resourceTypes.includes(input.resourceType);
  for (const change of candidates) {
    const data = change.observed!.data;
    const resource = {
      resourceId: change.resourceGid,
      // Images and custom fields: only the fields their editor translates.
      content: attached ? data.content.filter((c) => isEditableAttachedField(c)) : data.content,
      translations: data.translations,
    };
    const { fields } = planResourceWork(resource, {
      latest,
      pendingDrafts,
      onlyGroups: { groups: run.fieldGroups, resourceType: input.resourceType },
      keepOutdated: !run.replaceOutdatedMachine,
    });
    if (fields.length) {
      plan.items.push({ resourceGid: change.resourceGid, fields: fields.length, chars: fields.reduce((n, f) => n + (f.value?.length ?? 0), 0) });
    }
  }
  return plan;
}

/**
 * Writes a page's plan inside the page's transaction: the run's job for
 * this type and language (created once), an item per resource (unique per
 * job), and the run's counters. Returns the item ids to queue after the
 * commit; one left unqueued by a crash is re-queued by the stall repair.
 */
export async function writeSmartPlanTx(tx: TenantTx, shopId: string, plan: SmartPagePlan, now = new Date()): Promise<string[]> {
  const run = await tx.smartAutoRun.findFirst({ where: { id: plan.runId, shopId, status: "RUNNING" } });
  if (!run) return [];
  let itemIds: string[] = [];
  let created = 0;
  if (plan.items.length) {
    const idempotencyKey = `smart:${run.id}:${plan.resourceType}:${plan.locale}`;
    await tx.translationJob.createMany({
      data: [
        {
          shopId,
          resourceType: plan.resourceType,
          targetLocale: plan.locale,
          status: "RUNNING",
          requestedBy: SMART_REQUESTED_BY,
          idempotencyKey,
          smartRunId: run.id,
          publishMode: run.publishMode,
          fieldGroups: run.fieldGroups,
          replaceOutdatedMachine: run.replaceOutdatedMachine,
          // Done when the run's measurement has read everything (finishSmartScanTx).
          discoveryDone: false,
          startedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const job = await tx.translationJob.findUniqueOrThrow({ where: { shopId_idempotencyKey: { shopId, idempotencyKey } } });
    const gids = plan.items.map((i) => i.resourceGid);
    const inserted = await tx.translationJobItem.createMany({
      data: gids.map((resourceGid) => ({ shopId, jobId: job.id, resourceGid })),
      skipDuplicates: true,
    });
    created = inserted.count;
    if (created) await tx.translationJob.update({ where: { id: job.id }, data: { totalItems: { increment: created } } });
    const items = await tx.translationJobItem.findMany({
      where: { shopId, jobId: job.id, resourceGid: { in: gids }, status: "PENDING", queueJobId: null },
      select: { id: true },
    });
    itemIds = items.map((i) => i.id);
  }
  await tx.smartAutoRun.update({
    where: { id: run.id },
    data: {
      resourcesChecked: { increment: plan.checked },
      resourcesChanged: { increment: plan.items.length },
      fieldsDetected: { increment: plan.items.reduce((n, i) => n + i.fields, 0) },
      charsEstimated: { increment: plan.items.reduce((n, i) => n + i.chars, 0) },
      itemsQueued: { increment: created },
      excludedSkipped: { increment: plan.excluded },
    },
  });
  return itemIds;
}

/**
 * The run's measurement has read everything (in the last page's
 * transaction): its jobs can complete once their items are done.
 */
export async function finishSmartScanTx(tx: TenantTx, shopId: string, runId: string, now = new Date()) {
  await tx.smartAutoRun.updateMany({ where: { id: runId, shopId, scanFinishedAt: null }, data: { scanFinishedAt: now } });
  await tx.translationJob.updateMany({ where: { shopId, smartRunId: runId, discoveryDone: false }, data: { discoveryDone: true } });
}

/** After the commit of the last page (or a failed measurement): completes what is done. */
export async function afterSmartScan(client: PrismaClient, shopId: string, runId: string) {
  const jobs = await withTenant(
    shopId,
    (tx) => tx.translationJob.findMany({ where: { shopId, smartRunId: runId, status: { in: ["RUNNING", "DISCOVERING"] } }, select: { id: true } }),
    client,
  );
  // Jobs whose items all finished during the measurement complete now.
  for (const job of jobs) await completeIfDone(shopId, job.id, client);
  await finishSmartRunIfDone(shopId, runId, client);
}

export type { SmartAutoRun };
