/**
 * What the Smart Auto-Translate card in Settings and its page show, from
 * real values: the stored settings, the effective state, the next checks,
 * the recent runs with what they found, translated and billed, what is
 * translating now, the estimate from the newest measurement, the budgets'
 * use, and the resources left alone.
 */
import type { PrismaClient } from "@prisma/client";
import { allowedTargetLocales } from "../billing/subscription";
import { prisma as defaultClient } from "../lib/db";
import { getTranslationProvider } from "../providers";
import { backgroundJobsRunning, getQueues } from "../queue/client";
import { hasCurrentAiConsent, type getShopSettings } from "../settings/shop-settings";
import { withTenant } from "../tenancy/with-tenant";
import { getOriginUsageSince } from "../usage/usage-ledger";
import type { Entitlements } from "../../lib/plans";
import { upcomingOccurrences } from "../../lib/schedule";
import { budgetWindows, checkSpec, SMART_DEFAULT_TYPES, SMART_FIELD_GROUPS, SMART_REQUESTED_BY, smartCoverageTypes, smartStatus, type SmartStatus } from "../../lib/smart-auto";
import { editorPathFor, kindOfGid } from "../../lib/resource-kinds";
import { listSmartExclusions } from "./config";

/** What the smart schedule's state depends on beyond its own settings: the same for every page that shows it. */
export interface SmartContext {
  entitled: boolean;
  consent: boolean;
  /** AI translation and background jobs are set up. */
  available: boolean;
  /** False when background jobs are known not to run now (no worker heartbeat). */
  worker?: boolean;
  /** The shop's additional languages within the plan. */
  allowed: readonly string[];
}

export interface SmartPanelContext extends SmartContext {
  shopTimeZone: string | null;
  now?: Date;
}

export async function smartContext(
  billing: { entitlements: Entitlements },
  settings: Awaited<ReturnType<typeof getShopSettings>>,
  targets: readonly string[],
): Promise<SmartContext> {
  const available = getTranslationProvider() !== null && getQueues() !== null;
  return {
    entitled: billing.entitlements.smartAuto,
    consent: hasCurrentAiConsent(settings),
    available,
    worker: available ? await backgroundJobsRunning() : true,
    allowed: allowedTargetLocales(billing.entitlements, targets),
  };
}

export const RECENT_RUNS = 20;

export async function loadSmartPanel(shopId: string, context: SmartPanelContext, client: PrismaClient = defaultClient) {
  const now = context.now ?? new Date();
  const data = await withTenant(
    shopId,
    async (tx) => {
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId } });
      const runs = await tx.smartAutoRun.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: RECENT_RUNS });
      const jobs = runs.length
        ? await tx.translationJob.findMany({
            where: { shopId, smartRunId: { in: runs.map((r) => r.id) } },
            select: { id: true, smartRunId: true, resourceType: true, targetLocale: true, status: true, failedItems: true, charsBilled: true, charsSaved: true },
          })
        : [];
      const translating = await tx.translationJobItem.count({
        where: { shopId, status: { in: ["PENDING", "RUNNING"] }, job: { requestedBy: SMART_REQUESTED_BY, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } } },
      });
      // Up to this many characters wait in the scope (missing, failed and, when replaced, outdated
      // fields of the chosen languages, types and field groups), from the newest measurement and refreshes.
      const scope = config ?? { locales: [...context.allowed], resourceTypes: [...SMART_DEFAULT_TYPES], includeAttached: false, fieldGroups: [], replaceOutdatedMachine: true };
      const locales = scope.locales.filter((l) => context.allowed.includes(l));
      const types = smartCoverageTypes(scope);
      // Read in full for every chosen language and type (a type without access counts: it can't be
      // translated either), or there is no figure: a language added since would otherwise add nothing.
      const segments = await tx.coverageSegment.findMany({
        where: { shopId, locale: { in: locales }, resourceType: { in: types }, status: { in: ["SCANNED", "DENIED"] } },
        select: { locale: true, resourceType: true },
      });
      const read = new Set(segments.map((s) => `${s.locale}|${s.resourceType}`));
      const scopeRead = locales.length > 0 && locales.every((l) => types.every((t) => read.has(`${l}|${t}`)));
      const measured = (await tx.coverageSegment.count({ where: { shopId, status: "SCANNED" } })) > 0;
      const pending = await tx.coverageCount.aggregate({
        where: {
          shopId,
          locale: { in: locales },
          resourceType: { in: types },
          // Handles (url) are never machine translated.
          fieldGroup: { in: scope.fieldGroups.length ? scope.fieldGroups : [...SMART_FIELD_GROUPS] },
          state: { in: scope.replaceOutdatedMachine ? ["missing", "failed", "outdated"] : ["missing", "failed"] },
        },
        _sum: { chars: true },
      });
      // Items read before their characters were recorded (a measurement older than this): their
      // fields count as nothing, so there is no estimate until the next measurement.
      const [older] = await tx.$queryRaw<Array<{ older: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM "CoverageItem"
          WHERE "shopId" = ${shopId}::uuid AND "locale" = ANY(${locales}::text[]) AND "resourceType" = ANY(${types}::text[])
            AND cardinality("sourceChars") < cardinality("sourceKeys")
        ) AS "older"`;
      return { config, runs, jobs, translating, measured, scopeRead, older: Boolean(older?.older), pendingChars: Number(pending._sum.chars ?? 0) };
    },
    client,
  );
  const { config } = data;
  const zone = config?.timeZone ?? context.shopTimeZone ?? "UTC";
  const spec = config ? checkSpec(config) : null;
  const windows = budgetWindows(now.getTime(), zone);
  const [usedToday, usedMonth, exclusions] = await Promise.all([
    getOriginUsageSince(shopId, "smart", new Date(windows.daySince), client),
    getOriginUsageSince(shopId, "smart", new Date(windows.monthSince), client),
    listSmartExclusions(shopId, client, 100),
  ]);
  const status: SmartStatus = smartStatus({
    enabled: config?.enabled ?? false,
    pausedAt: config?.pausedAt?.getTime() ?? null,
    pauseReason: config?.pauseReason ?? null,
    pausedUntil: config?.pausedUntil?.getTime() ?? null,
    entitled: context.entitled,
    consent: context.consent,
    available: context.available,
    ...(context.worker === undefined ? {} : { worker: context.worker }),
    languages: (config?.locales ?? []).filter((l) => context.allowed.includes(l)).length,
    now: now.getTime(),
  });
  const jobsByRun = new Map<string, typeof data.jobs>();
  for (const job of data.jobs) jobsByRun.set(job.smartRunId!, [...(jobsByRun.get(job.smartRunId!) ?? []), job]);
  const lastFinished = data.runs.find((r) => r.status === "COMPLETED" || r.status === "FAILED");
  return {
    config: config
      ? {
          enabled: config.enabled,
          mode: config.mode,
          timeZone: config.timeZone,
          times: config.times,
          weekdays: config.weekdays,
          locales: config.locales,
          resourceTypes: config.resourceTypes,
          fieldGroups: config.fieldGroups,
          includeAttached: config.includeAttached,
          publishMode: config.publishMode,
          replaceOutdatedMachine: config.replaceOutdatedMachine,
          dailyBudget: config.dailyBudget,
          monthlyBudget: config.monthlyBudget,
          version: config.version,
        }
      : null,
    status,
    zone,
    // Only checks that will run: none while paused or waiting.
    nextChecks: spec && status.state === "on" ? upcomingOccurrences(spec, now.getTime(), 3) : [],
    /** How its results go out, as they would now (automatic only as confirmed). */
    publishing: config ? (config.publishMode === "AUTO_PUBLISH" && config.publishConfirmedAt ? ("AUTO_PUBLISH" as const) : ("DRAFT" as const)) : null,
    lastSuccessAt: config?.lastSuccessAt?.toISOString() ?? null,
    lastRun: lastFinished
      ? { resourcesChanged: lastFinished.resourcesChanged, fieldsDetected: lastFinished.fieldsDetected, finishedAt: lastFinished.finishedAt?.toISOString() ?? null }
      : null,
    runs: data.runs.map((r) => {
      const runJobs = jobsByRun.get(r.id) ?? [];
      return {
        id: r.id,
        trigger: r.trigger,
        status: r.status,
        errorCode: r.errorCode,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        resourcesChecked: r.resourcesChecked,
        resourcesChanged: r.resourcesChanged,
        fieldsDetected: r.fieldsDetected,
        charsEstimated: r.charsEstimated,
        excludedSkipped: r.excludedSkipped,
        billed: runJobs.reduce((n, j) => n + j.charsBilled, 0),
        fromMemory: runJobs.reduce((n, j) => n + j.charsSaved, 0),
        failed: runJobs.reduce((n, j) => n + j.failedItems, 0),
        jobs: runJobs.map((j) => ({ id: j.id, resourceType: j.resourceType, locale: j.targetLocale, failed: j.failedItems })),
      };
    }),
    translating: data.translating,
    estimate: data.scopeRead && !data.older ? data.pendingChars : null,
    /** No estimate although something was measured: a chosen language or type wasn't read in full, or only before character counts: measure again. */
    remeasure: data.measured && (!data.scopeRead || data.older),
    usage: { today: usedToday, month: usedMonth },
    exclusions: exclusions.map((e) => ({
      resourceGid: e.resourceGid,
      resourceType: e.resourceType,
      // The editor, in the first language translated into.
      href: kindOfGid(e.resourceGid) ? editorPathFor(e.resourceGid, config?.locales[0] ?? context.allowed[0] ?? "", e.resourceType) : null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export type SmartPanel = Awaited<ReturnType<typeof loadSmartPanel>>;

/**
 * The smart schedule beside coverage, from the same state as Settings and its
 * page (smartStatus): on, paused (why) or waiting, its next check (only while
 * on, never one in the past), what it translates now and what it leaves alone,
 * and its scope (so items that wait for the next check can say so). Null while off.
 */
export async function loadSmartCoverageNote(shopId: string, context: SmartContext, client: PrismaClient = defaultClient, now = new Date()) {
  return withTenant(
    shopId,
    async (tx) => {
      const config = await tx.smartAutoConfig.findUnique({ where: { shopId } });
      if (!config?.enabled) return null;
      const [translating, excluded] = await Promise.all([
        tx.translationJobItem.count({
          where: { shopId, status: { in: ["PENDING", "RUNNING"] }, job: { requestedBy: SMART_REQUESTED_BY, status: { in: ["PENDING", "DISCOVERING", "RUNNING"] } } },
        }),
        tx.smartAutoExclusion.count({ where: { shopId } }),
      ]);
      const locales = config.locales.filter((l) => context.allowed.includes(l));
      const status = smartStatus({
        enabled: true,
        pausedAt: config.pausedAt?.getTime() ?? null,
        pauseReason: config.pauseReason,
        pausedUntil: config.pausedUntil?.getTime() ?? null,
        entitled: context.entitled,
        consent: context.consent,
        available: context.available,
        ...(context.worker === undefined ? {} : { worker: context.worker }),
        languages: locales.length,
        now: now.getTime(),
      });
      const spec = checkSpec(config);
      const next = status.state === "on" && spec ? upcomingOccurrences(spec, now.getTime(), 1)[0] : undefined;
      return {
        status,
        mode: config.mode,
        zone: config.timeZone,
        nextCheck: next === undefined ? null : new Date(next).toISOString(),
        translating,
        excluded,
        scope: {
          locales,
          types: smartCoverageTypes(config),
          // Handles (url) are never machine translated.
          groups: config.fieldGroups.length ? config.fieldGroups : [...SMART_FIELD_GROUPS],
          states: config.replaceOutdatedMachine ? ["missing", "failed", "outdated"] : ["missing", "failed"],
        },
      };
    },
    client,
  );
}

export type SmartCoverageNote = NonNullable<Awaited<ReturnType<typeof loadSmartCoverageNote>>>;

/** Whether an item's fields ("group:state") hold work for the smart schedule's next check. */
export function waitsForSmartCheck(note: Pick<SmartCoverageNote, "scope">, item: { locale: string; resourceType: string; fields: readonly string[] }): boolean {
  if (!note.scope.locales.includes(item.locale) || !note.scope.types.includes(item.resourceType)) return false;
  return item.fields.some((entry) => {
    const [group, state] = entry.split(":") as [string, string];
    return note.scope.groups.includes(group) && note.scope.states.includes(state);
  });
}
