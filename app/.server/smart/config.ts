/**
 * Smart Auto-Translate settings per shop (SmartAutoConfig): saving the
 * validated form with a version check, turning it on and off, pausing and
 * resuming, and the resources it leaves alone. Every change is audited;
 * the schedule's next check is mirrored to Shop.smartNextRunAt, the due
 * index the worker's tick reads.
 */
import type { PrismaClient, SmartAutoConfig } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { getShopSettings, setAutoTranslate } from "../settings/shop-settings";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { nextOccurrence } from "../../lib/schedule";
import { kindOfGid } from "../../lib/resource-kinds";
import { checkSpec, pauseLiftsAt, SMART_REQUESTED_BY, type SmartPauseReason } from "../../lib/smart-auto";
import type { SmartSettingsValue } from "./validate";

export type { SmartAutoConfig };

const ACTIVE_RUN = ["QUEUED", "WAITING", "RUNNING"] as const;
const ACTIVE_JOB = ["PENDING", "DISCOVERING", "RUNNING"] as const;

export async function getSmartConfig(shopId: string, client: PrismaClient = defaultClient): Promise<SmartAutoConfig | null> {
  return withTenant(shopId, (tx) => tx.smartAutoConfig.findUnique({ where: { shopId } }), client);
}

/** Serialises every change of a shop's smart schedule (settings, ticks, runs). */
export async function lockSmart(tx: TenantTx, shopId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`smart:${shopId}`}, 0))`;
}

/** The next scheduled full check after `now`, or null (manual only). */
export function nextCheck(config: Pick<SmartAutoConfig, "mode" | "timeZone" | "times" | "weekdays">, now: Date): Date | null {
  const spec = checkSpec(config);
  const next = spec ? nextOccurrence(spec, now.getTime()) : null;
  return next === null ? null : new Date(next);
}

/** Whether it waits: paused by the merchant, or by a stop until a time that hasn't passed. */
export function smartPaused(config: Pick<SmartAutoConfig, "pausedAt" | "pausedUntil">, now = new Date()): boolean {
  return Boolean(config.pausedAt) && (!config.pausedUntil || config.pausedUntil > now);
}

async function setDueHint(tx: TenantTx, shopId: string, at: Date | null) {
  await tx.shop.update({ where: { id: shopId }, data: { smartNextRunAt: at } });
}

async function audit(client: PrismaClient, shopId: string, actorId: string | null, action: string, metadata: Record<string, unknown> = {}) {
  await client.auditLog.createMany({
    data: [{ shopId, actorType: actorId ? "MERCHANT_USER" : "SYSTEM", actorId, action, metadata: metadata as object }],
  });
}

/**
 * Saves validated settings. `version` is the one the form was opened with:
 * when someone saved in between, nothing is written and null is returned
 * ("changed meanwhile"). A changed schedule moves the next check; saving
 * also records the shop's primary language, which lifts a pause for a
 * changed primary language (the merchant reviewed the languages).
 */
export async function saveSmartSettings(
  input: { shopId: string; actorId: string | null; value: SmartSettingsValue; version: number; primaryLocale: string | null; now?: Date },
  client: PrismaClient = defaultClient,
): Promise<SmartAutoConfig | null> {
  const now = input.now ?? new Date();
  const v = input.value;
  const saved = await withTenant(
    input.shopId,
    async (tx) => {
      await lockSmart(tx, input.shopId);
      const existing = await tx.smartAutoConfig.findUnique({ where: { shopId: input.shopId } });
      if ((existing?.version ?? 0) !== input.version) return null;
      const publishing = v.publishMode === "AUTO_PUBLISH";
      const newlyPublishing = publishing && existing?.publishMode !== "AUTO_PUBLISH";
      const enabled = existing?.enabled ?? false;
      const data = {
        mode: v.mode,
        timeZone: v.timeZone,
        times: v.times,
        weekdays: v.weekdays,
        locales: v.locales,
        resourceTypes: v.resourceTypes,
        fieldGroups: v.fieldGroups,
        includeAttached: v.includeAttached,
        publishMode: v.publishMode,
        // Who confirmed automatic publishing and when; cleared when it goes back to drafts.
        publishConfirmedAt: publishing ? (newlyPublishing ? now : (existing?.publishConfirmedAt ?? now)) : null,
        publishConfirmedBy: publishing ? (newlyPublishing ? input.actorId : (existing?.publishConfirmedBy ?? input.actorId)) : null,
        replaceOutdatedMachine: v.replaceOutdatedMachine,
        dailyBudget: v.dailyBudget,
        monthlyBudget: v.monthlyBudget,
        primaryLocale: input.primaryLocale,
        updatedBy: input.actorId,
        nextRunAt: enabled ? nextCheck(v, now) : null,
        // The languages were reviewed: a pause for a changed primary language lifts.
        ...(existing?.pauseReason === "PRIMARY_LANGUAGE" ? { pausedAt: null, pauseReason: null, pausedUntil: null } : {}),
      };
      const config = existing
        ? await tx.smartAutoConfig.update({ where: { shopId: input.shopId }, data: { ...data, version: { increment: 1 } } })
        : await tx.smartAutoConfig.create({ data: { shopId: input.shopId, ...data, version: 1 } });
      // Also while paused: the tick records the skipped checks.
      await setDueHint(tx, input.shopId, config.enabled ? config.nextRunAt : null);
      // Real time from now on: the periodic check follows changes made after this (earlier ones wait for the next full check).
      if (enabled && v.mode === "realtime" && existing?.mode !== "realtime") await startFollowingChanges(tx, input.shopId, now);
      return config;
    },
    client,
  );
  if (saved) {
    await audit(client, input.shopId, input.actorId, "smart_auto.settings_saved", {
      mode: v.mode,
      locales: v.locales,
      resourceTypes: v.resourceTypes,
      fieldGroups: v.fieldGroups,
      includeAttached: v.includeAttached,
      publishMode: v.publishMode,
      budgets: { daily: v.dailyBudget, monthly: v.monthlyBudget },
    });
  }
  return saved;
}

/**
 * Turns the smart schedule on (it needs saved settings with a language) or
 * off. On turns basic automatic translation off: the two never run for one
 * shop. Off clears the schedule and cancels what is queued or running.
 */
export async function setSmartEnabled(
  input: { shopId: string; actorId: string | null; enabled: boolean; now?: Date },
  client: PrismaClient = defaultClient,
): Promise<{ ok: true; config: SmartAutoConfig } | { ok: false; problem: "NOT_CONFIGURED" }> {
  const now = input.now ?? new Date();
  const result = await withTenant(
    input.shopId,
    async (tx) => {
      await lockSmart(tx, input.shopId);
      const existing = await tx.smartAutoConfig.findUnique({ where: { shopId: input.shopId } });
      if (!existing || (input.enabled && existing.locales.length === 0)) return null;
      const config = await tx.smartAutoConfig.update({
        where: { shopId: input.shopId },
        data: input.enabled
          ? { enabled: true, pausedAt: null, pauseReason: null, pausedUntil: null, nextRunAt: nextCheck(existing, now), updatedBy: input.actorId }
          : { enabled: false, nextRunAt: null, pausedAt: null, pauseReason: null, pausedUntil: null, updatedBy: input.actorId },
      });
      await setDueHint(tx, input.shopId, config.enabled ? config.nextRunAt : null);
      if (!input.enabled) await cancelSmartWork(tx, input.shopId, "SMART_OFF", now);
      return config;
    },
    client,
  );
  if (!result) return { ok: false, problem: "NOT_CONFIGURED" };
  if (input.enabled) {
    const settings = await getShopSettings(input.shopId, client);
    if (settings.autoTranslateNew) {
      await setAutoTranslate({ shopId: input.shopId, enabled: false, locales: [], allowedLocales: [], actorId: input.actorId }, client);
    }
    if (result.mode === "realtime") await withTenant(input.shopId, (tx) => startFollowingChanges(tx, input.shopId, now), client);
  }
  await audit(client, input.shopId, input.actorId, input.enabled ? "smart_auto.enabled" : "smart_auto.disabled");
  return { ok: true, config: result };
}

/** The periodic check's position (ShopSettings.autoSweptAt): changes after this are followed. */
async function startFollowingChanges(tx: TenantTx, shopId: string, now: Date) {
  await tx.shopSettings.updateMany({ where: { shopId }, data: { autoSweptAt: now } });
}

/** Cancels the shop's active smart runs and the smart jobs still queued or running. */
export async function cancelSmartWork(tx: TenantTx, shopId: string, code: string, now: Date) {
  await tx.smartAutoRun.updateMany({
    where: { shopId, status: { in: [...ACTIVE_RUN] } },
    data: { status: "CANCELLED", errorCode: code, finishedAt: now },
  });
  await tx.translationJob.updateMany({
    where: { shopId, requestedBy: SMART_REQUESTED_BY, status: { in: [...ACTIVE_JOB] } },
    data: { status: "CANCELLED", cancelRequestedAt: now, finishedAt: now, errorCode: code },
  });
}

/** Pauses by the merchant's choice: no checks and no translation until resumed. */
export async function pauseSmart(input: { shopId: string; actorId: string | null; now?: Date }, client: PrismaClient = defaultClient) {
  const now = input.now ?? new Date();
  const count = await withTenant(
    input.shopId,
    async (tx) => {
      await lockSmart(tx, input.shopId);
      const updated = await tx.smartAutoConfig.updateMany({
        where: { shopId: input.shopId, enabled: true },
        data: { pausedAt: now, pauseReason: "MANUAL", pausedUntil: null, updatedBy: input.actorId },
      });
      return updated.count;
    },
    client,
  );
  if (count) await audit(client, input.shopId, input.actorId, "smart_auto.paused", { reason: "MANUAL" });
  return count > 0;
}

/** Resumes after any pause; the next scheduled check translates whatever is still missing. */
export async function resumeSmart(input: { shopId: string; actorId: string | null; now?: Date }, client: PrismaClient = defaultClient) {
  const now = input.now ?? new Date();
  const config = await withTenant(
    input.shopId,
    async (tx) => {
      await lockSmart(tx, input.shopId);
      const existing = await tx.smartAutoConfig.findUnique({ where: { shopId: input.shopId } });
      if (!existing?.enabled) return null;
      const next = existing.nextRunAt && existing.nextRunAt > now ? existing.nextRunAt : nextCheck(existing, now);
      const updated = await tx.smartAutoConfig.update({
        where: { shopId: input.shopId },
        data: { pausedAt: null, pauseReason: null, pausedUntil: null, nextRunAt: next, updatedBy: input.actorId },
      });
      await setDueHint(tx, input.shopId, updated.nextRunAt);
      return updated;
    },
    client,
  );
  if (config) await audit(client, input.shopId, input.actorId, "smart_auto.resumed");
  return config;
}

/** Job stops that pause Smart Auto-Translate, and the reason recorded. */
const PAUSE_FOR_STOP: Record<string, SmartPauseReason> = {
  SMART_BUDGET_DAILY: "BUDGET_DAILY",
  SMART_BUDGET_MONTHLY: "BUDGET_MONTHLY",
  QUOTA_EXCEEDED: "PLAN_ALLOWANCE",
  DAILY_LIMIT: "DAILY_CAP",
  PLATFORM_LIMIT: "DAILY_CAP",
  AI_NOT_CONFIGURED: "PROVIDER",
  PROVIDER_AUTH: "PROVIDER",
  PROVIDER_QUOTA: "PROVIDER",
  PLAN_SMART: "PLAN",
  CONSENT_REQUIRED: "CONSENT",
};

/**
 * Pauses after a smart job stopped at a budget, a limit, the provider, the
 * plan or consent, until the cause lifts (pauseLiftsAt). Other stops don't
 * pause. Returns the reason, or null.
 */
export async function smartPauseAfterStop(shopId: string, code: string, now = new Date(), client: PrismaClient = defaultClient) {
  const reason = PAUSE_FOR_STOP[code];
  if (!reason) return null;
  const paused = await withTenant(
    shopId,
    async (tx) => {
      await lockSmart(tx, shopId);
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId } });
      if (!config?.enabled) return false;
      const until = pauseLiftsAt(reason, now.getTime(), config.timeZone);
      // A pause already in place that lasts at least as long stays (the merchant's own pause
      // never turns into one that lifts by itself at midnight).
      if (smartPaused(config, now) && (!config.pausedUntil || (until !== null && config.pausedUntil.getTime() >= until))) return false;
      await tx.smartAutoConfig.update({
        where: { shopId },
        data: { pausedAt: now, pauseReason: reason, pausedUntil: until === null ? null : new Date(until) },
      });
      return true;
    },
    client,
  );
  if (!paused) return null;
  logger.info({ shopId, reason }, "smart auto-translate paused");
  await audit(client, shopId, null, "smart_auto.paused", { reason });
  return reason;
}

export async function listSmartExclusions(shopId: string, client: PrismaClient = defaultClient, take = 200) {
  return withTenant(
    shopId,
    (tx) => tx.smartAutoExclusion.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: Math.min(take, 500) }),
    client,
  );
}

/** Leaves a resource alone (its type comes from the GID, never from the form). */
export async function addSmartExclusion(input: { shopId: string; resourceGid: string; actorId: string | null }, client: PrismaClient = defaultClient) {
  const kind = kindOfGid(input.resourceGid);
  if (!kind || !/^gid:\/\/shopify\/[A-Za-z]+\/[0-9]+$/.test(input.resourceGid)) return false;
  await withTenant(
    input.shopId,
    (tx) =>
      tx.smartAutoExclusion.createMany({
        data: [{ shopId: input.shopId, resourceGid: input.resourceGid, resourceType: kind, createdBy: input.actorId }],
        skipDuplicates: true,
      }),
    client,
  );
  await audit(client, input.shopId, input.actorId, "smart_auto.excluded", { resourceGid: input.resourceGid });
  return true;
}

export async function removeSmartExclusion(input: { shopId: string; resourceGid: string; actorId: string | null }, client: PrismaClient = defaultClient) {
  const removed = await withTenant(
    input.shopId,
    (tx) => tx.smartAutoExclusion.deleteMany({ where: { shopId: input.shopId, resourceGid: input.resourceGid } }),
    client,
  );
  if (removed.count) await audit(client, input.shopId, input.actorId, "smart_auto.included", { resourceGid: input.resourceGid });
  return removed.count > 0;
}

/** Which of these resources are excluded (inside a tenant transaction). */
export async function excludedAmong(tx: TenantTx, shopId: string, gids: readonly string[]): Promise<Set<string>> {
  if (gids.length === 0) return new Set();
  const rows = await tx.smartAutoExclusion.findMany({ where: { shopId, resourceGid: { in: [...new Set(gids)] } }, select: { resourceGid: true } });
  return new Set(rows.map((r) => r.resourceGid));
}
