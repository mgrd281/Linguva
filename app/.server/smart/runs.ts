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
import type { PrismaClient, SmartAutoConfig, SmartAutoRun } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { allowedTargetLocales } from "../billing/subscription";
import { createCoverageReport, type CoveragePagePayload } from "../coverage/coverage";
import { logger } from "../lib/logger";
import { currentShopLocales } from "../locales/current-locales";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import type { Entitlements } from "../../lib/plans";
import { SMART_REQUESTED_BY, type SmartPauseReason } from "../../lib/smart-auto";
import { lockSmart, nextCheck, refreshDueHint, smartPaused, WAITING_RECHECK_MS } from "./config";
import { repairSmartRuns } from "./plan";

type Admin = Pick<AdminApiContext, "graphql">;

export const SMART_ACTIVE_RUN = ["QUEUED", "WAITING", "RUNNING"] as const;
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
  const admin = () => deps.adminFor(shop.shopDomain);
  let locales = await currentShopLocales(shop.id, admin, deps.prisma);
  // A changed primary language pauses the schedule: Shopify confirms it, not a copy minutes old
  // (the merchant may have just saved the languages for the new one).
  const recorded = (await withTenant(shop.id, (tx) => tx.smartAutoConfig.findUnique({ where: { shopId: shop.id }, select: { primaryLocale: true } }), deps.prisma))?.primaryLocale;
  if (!locales.fresh && recorded && locales.primary && locales.primary !== recorded) locales = await currentShopLocales(shop.id, admin, deps.prisma, Date.now(), 0);
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

/**
 * Pauses as the facts are now: a cause pauses (never over the merchant's own
 * pause, which would lift with it; it skips every check anyway), and a pause
 * lifts when its time passed or its cause is gone. Returns the config as it is
 * then, and the pause it set, if any.
 */
async function settlePausesTx(tx: TenantTx, config: SmartAutoConfig, facts: ShopFacts, now: Date) {
  const cause = pauseCause(config, facts);
  const merchants = Boolean(config.pausedAt) && config.pauseReason === "MANUAL";
  const expired = config.pausedAt && config.pausedUntil && config.pausedUntil <= now;
  const causeGone = config.pausedAt && (config.pauseReason === "PLAN" || config.pauseReason === "CONSENT") && config.pauseReason !== cause;
  if (cause && !merchants && !(config.pausedAt && config.pauseReason === cause)) {
    const paused = await tx.smartAutoConfig.update({ where: { shopId: config.shopId }, data: { pausedAt: now, pauseReason: cause, pausedUntil: null } });
    return { config: paused, paused: cause };
  }
  if (expired || causeGone) {
    return { config: await tx.smartAutoConfig.update({ where: { shopId: config.shopId }, data: { pausedAt: null, pauseReason: null, pausedUntil: null } }), paused: null };
  }
  return { config, paused: null };
}

/**
 * Settles the pauses with the shop's facts now (a pause whose cause is gone
 * lifts, a new cause pauses) and returns the config, for actions that must
 * agree with the state the pages show (Retry).
 */
export async function settleSmartPause(
  deps: Pick<SmartDeps, "prisma" | "adminFor" | "billingFor">,
  shop: { id: string; shopDomain: string },
  now = new Date(),
): Promise<SmartAutoConfig | null> {
  const facts = await shopFacts(deps, shop);
  const settled = await withTenant(
    shop.id,
    async (tx) => {
      await lockSmart(tx, shop.id);
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId: shop.id } });
      if (!config?.enabled) return { config, paused: null };
      const result = await settlePausesTx(tx, config, facts, now);
      await refreshDueHint(tx, shop.id, now, result.config);
      return result;
    },
    deps.prisma,
  );
  if (settled.paused) {
    await deps.prisma.auditLog.createMany({ data: [{ shopId: shop.id, actorType: "SYSTEM", actorId: null, action: "smart_auto.paused", metadata: { reason: settled.paused } }] });
  }
  return settled.config;
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
  // A run whose measurement ended without finishing it would keep every later check waiting.
  await repairSmartRuns(shop.id, deps.prisma, now);
  const facts = await shopFacts(deps, shop);
  const decision = await withTenant(
    shop.id,
    async (tx) => {
      await lockSmart(tx, shop.id);
      let config = await tx.smartAutoConfig.findUnique({ where: { shopId: shop.id } });
      if (!config?.enabled) {
        await refreshDueHint(tx, shop.id, now, config);
        return { runId: null, waitingId: null, skipped: null, paused: null };
      }
      const settled = await settlePausesTx(tx, config, facts, now);
      config = settled.config;
      const newPause: SmartPauseReason | null = settled.paused;

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
      // A run waiting for the merchant's measurement, or one whose start didn't get through
      // (the process stopped right after creating it; a fresh Check now is left to its request).
      let waiting = runId
        ? null
        : await tx.smartAutoRun.findFirst({
            where: { shopId: shop.id, OR: [{ status: "WAITING" }, { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - WAITING_RECHECK_MS) } }] },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
      // Paused (or otherwise held) since it was created: recorded as skipped, not started.
      const held = waiting ? blocker(config, facts, deps, now) : null;
      if (waiting && held) {
        await tx.smartAutoRun.update({ where: { id: waiting.id }, data: { status: "SKIPPED", errorCode: held, finishedAt: now } });
        waiting = null;
      }
      // A minute while a run waits or hasn't started (also the one created now: its start comes after
      // this commit and may not get through), and soon after a pause for the plan or consent.
      await refreshDueHint(tx, shop.id, now, config);
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
        await refreshDueHint(tx, shopId, now);
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
  // Queued by whoever started the run (a repeated enqueue of the first page is a no-op by its job id;
  // a report that was created but never queued is continued by the stalled-report repair).
  if (started && (created || report.status === "QUEUED")) await deps.enqueueCoveragePage({ shopId, reportId: report.id, segmentIndex: 0, cursor: null });
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
  let newPause: SmartPauseReason | null = null;
  const result = await withTenant(
    shopId,
    async (tx) => {
      await lockSmart(tx, shopId);
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId } });
      if (!config?.enabled) return { status: "off" as const };
      const repeated = await tx.smartAutoRun.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } } });
      if (repeated) return { status: "active" as const, runId: repeated.id };
      // A pause whose cause is gone lifts now (the page already showed it as on); a new cause pauses.
      const settled = await settlePausesTx(tx, config, facts, now);
      newPause = settled.paused;
      // A new pause for the plan or consent is looked at again soon; a lifted one drops that recheck.
      await refreshDueHint(tx, shopId, now, settled.config);
      const cause = pauseCause(settled.config, facts) ?? blocker(settled.config, facts, deps, now);
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
      // Its start comes after this commit: should it not get through, the tick starts it (also in manual mode).
      await refreshDueHint(tx, shopId, now, settled.config);
      return { status: "created" as const, runId: run.id };
    },
    deps.prisma,
  );
  if (newPause) {
    await deps.prisma.auditLog.createMany({ data: [{ shopId, actorType: "SYSTEM", actorId: null, action: "smart_auto.paused", metadata: { reason: newPause } }] });
  }
  if (result.status !== "created") return result;
  await deps.prisma.auditLog.createMany({ data: [{ shopId, actorType: "MERCHANT_USER", actorId: input.actorId, action: "smart_auto.run_now", metadata: { runId: result.runId } }] });
  const started = await startSmartRun(deps, shopId, result.runId, facts, now);
  return { status: started ? "started" : "waiting", runId: result.runId };
}

export type { SmartAutoRun };
