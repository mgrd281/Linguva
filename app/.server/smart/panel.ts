/**
 * What the Smart Auto-Translate card in Settings and its page show, from
 * real values: the stored settings, the effective state, the next checks,
 * the recent runs with what they found, translated and billed, what is
 * translating now, the estimate from the newest measurement, the budgets'
 * use, and the resources left alone.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { getOriginUsageSince } from "../usage/usage-ledger";
import { upcomingOccurrences } from "../../lib/schedule";
import { budgetWindows, checkSpec, SMART_DEFAULT_TYPES, SMART_FIELD_GROUPS, SMART_REQUESTED_BY, smartCoverageTypes, smartStatus, type SmartStatus } from "../../lib/smart-auto";
import { editorPathFor, kindOfGid } from "../../lib/resource-kinds";
import { listSmartExclusions } from "./config";

export interface SmartPanelContext {
  entitled: boolean;
  consent: boolean;
  /** AI translation and background jobs are set up. */
  available: boolean;
  /** The shop's additional languages within the plan. */
  allowed: readonly string[];
  shopTimeZone: string | null;
  now?: Date;
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
      const measured = await tx.coverageSegment.count({ where: { shopId, status: "SCANNED" } });
      const pending = await tx.coverageCount.aggregate({
        where: {
          shopId,
          locale: { in: scope.locales.filter((l) => context.allowed.includes(l)) },
          resourceType: { in: smartCoverageTypes(scope) },
          // Handles (url) are never machine translated.
          fieldGroup: { in: scope.fieldGroups.length ? scope.fieldGroups : [...SMART_FIELD_GROUPS] },
          state: { in: scope.replaceOutdatedMachine ? ["missing", "failed", "outdated"] : ["missing", "failed"] },
        },
        _sum: { chars: true },
      });
      return { config, runs, jobs, translating, measured: measured > 0, pendingChars: Number(pending._sum.chars ?? 0) };
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
    nextChecks: config?.enabled && spec && status.state !== "off" ? upcomingOccurrences(spec, now.getTime(), 3) : [],
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
    estimate: data.measured ? data.pendingChars : null,
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
