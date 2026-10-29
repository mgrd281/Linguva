/**
 * Smart Auto-Translate planning (docs/SMART_AUTO_TRANSLATE.md §5.2): a run's
 * measurement plans translation for every page it reads, with the same
 * field-level rules as every job, and the plan is written in the page's own
 * transaction (coverage.ts runCoveragePage), so a repeated page never plans
 * twice and nothing read is left unplanned. Kept apart from runs.ts (the
 * scheduler), so the scan can call it without importing the scheduler.
 */
import type { CoverageReport, PrismaClient, SmartAutoRun, TranslationJob } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import type { CoverageChange } from "../coverage/items";
import { ACTIVE_JOB_STATUSES, AUTO_REQUESTED_BY, completeIfDone } from "../jobs/bulk-jobs";
import { planResourceWork } from "../jobs/needs-work";
import { pendingDraftDigests } from "../review/drafts";
import { isEditableAttachedField } from "../translation/attached-editor";
import { latestRevisions } from "../translation/revisions";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { attachedOwner, SMART_REQUESTED_BY, smartCoverageTypes } from "../../lib/smart-auto";
import { excludedAmong, smartPaused } from "./config";
import { finishSmartRunIfDone } from "./finish";

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
 * removed fields are left alone). Null: not a smart report, a language or
 * type outside the run's scope, or a run that no longer plans (paused,
 * turned off, finished).
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
      if (!run || run.status !== "RUNNING") return null;
      // The measurement reads every language and type; the run plans its own scope only.
      if (!inRunScope(run, input)) return null;
      // Paused or turned off meanwhile: what this page found waits for the next check, and the run says so.
      if (!config?.enabled || smartPaused(config, now)) {
        await noteSmartGapTx(tx, input.shopId, runId);
        return null;
      }
      const parents = input.changes.flatMap((c) => (c.parentGid ? [c.parentGid] : []));
      const excluded = await excludedAmong(tx, input.shopId, [...input.changes.map((c) => c.resourceGid), ...parents]);
      // Items another active job will still translate: the resource itself, or (an image or a
      // custom field) its owner in a job that includes them. Leftovers of a stopped job don't count.
      const busy = await tx.translationJobItem.findMany({
        where: {
          shopId: input.shopId,
          status: { in: ["PENDING", "RUNNING"] },
          job: { targetLocale: input.locale, status: { in: [...ACTIVE_JOB_STATUSES] }, OR: [{ smartRunId: null }, { smartRunId: { not: runId } }] },
          OR: [{ resourceGid: { in: input.changes.map((c) => c.resourceGid) } }, ...(parents.length ? [{ resourceGid: { in: parents }, job: { includeAttached: true } }] : [])],
        },
        select: { resourceGid: true, job: { select: { includeAttached: true } } },
      });
      return {
        run,
        excluded,
        busy: new Set(busy.map((b) => b.resourceGid)),
        busyOwners: new Set(busy.filter((b) => b.job.includeAttached).map((b) => b.resourceGid)),
      };
    },
    client,
  );
  if (!state) return null;
  const { run } = state;
  const plan: SmartPagePlan = { runId, resourceType: input.resourceType, locale: input.locale, checked: input.changes.length, excluded: 0, items: [] };

  const candidates = input.changes.filter((c) => {
    const skip = state.excluded.has(c.resourceGid) || Boolean(c.parentGid && state.excluded.has(c.parentGid));
    if (skip) plan.excluded++;
    // Being translated by another job (a bulk job, a real-time check): left to it.
    const busy = state.busy.has(c.resourceGid) || Boolean(c.parentGid && state.busyOwners.has(c.parentGid));
    return !skip && !busy && c.observed;
  });
  const gids = candidates.map((c) => c.resourceGid);
  const [latest, pendingDrafts] = await Promise.all([
    latestRevisions(input.shopId, gids, input.locale, client),
    // Like every automatic job: a field whose last machine draft the checks refused waits for a person.
    pendingDraftDigests(input.shopId, gids, input.locale, client, { includeRefused: true }),
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

function inRunScope(run: Pick<SmartAutoRun, "locales" | "resourceTypes" | "includeAttached">, segment: { locale: string; resourceType: string }) {
  return run.locales.includes(segment.locale) && smartCoverageTypes(run).includes(segment.resourceType);
}

/**
 * The run leaves part of its scope unplanned (a type it couldn't read, a page
 * read while paused): it finishes saying so, and isn't the last complete
 * check. With a segment: only when that segment is in the run's scope.
 */
export async function noteSmartGapTx(tx: TenantTx, shopId: string, runId: string, segment?: { locale: string; resourceType: string }) {
  if (segment) {
    const run = await tx.smartAutoRun.findFirst({ where: { id: runId, shopId }, select: { locales: true, resourceTypes: true, includeAttached: true } });
    if (!run || !inRunScope(run, segment)) return;
  }
  await tx.smartAutoRun.updateMany({ where: { id: runId, shopId, status: "RUNNING", errorCode: null }, data: { errorCode: "PARTIAL" } });
}

/**
 * Writes a page's plan inside the page's transaction: the run's job for
 * this type and language (created once), an item per resource (unique per
 * job), and the run's counters. Returns the item ids to queue after the
 * commit, with how many items of their job came before them (queue
 * fairness, see itemPriority); one left unqueued by a crash is re-queued by
 * the stall repair.
 */
export async function writeSmartPlanTx(tx: TenantTx, shopId: string, plan: SmartPagePlan, now = new Date()): Promise<{ itemIds: string[]; position: number }> {
  const run = await tx.smartAutoRun.findFirst({ where: { id: plan.runId, shopId, status: "RUNNING" } });
  if (!run) return { itemIds: [], position: 0 };
  let itemIds: string[] = [];
  let position = 0;
  let created = 0;
  const job = plan.items.length ? await runJobTx(tx, shopId, run, plan, now) : null;
  // Another job translates this type and language now: what it holds is left to it.
  const planned = job ? plan.items : [];
  if (job) {
    position = job.totalItems;
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
      resourcesChanged: { increment: planned.length },
      fieldsDetected: { increment: planned.reduce((n, i) => n + i.fields, 0) },
      charsEstimated: { increment: planned.reduce((n, i) => n + i.chars, 0) },
      itemsQueued: { increment: created },
      excludedSkipped: { increment: plan.excluded },
    },
  });
  return { itemIds, position };
}

/**
 * The run's job for a type and language, under the lock every job creation
 * takes, so smart checks keep the rule too: one active job per shop, type and
 * language (createBulkJob). An automatic job holding a few changed resources
 * becomes the run's job (its items stay, as when a bulk job takes one over).
 * Any other active job keeps them, as does a merchant's job that includes
 * the images and custom fields of their owner: null, and the next check
 * picks up whatever it left. Null as well once the run's job was stopped.
 */
async function runJobTx(tx: TenantTx, shopId: string, run: SmartAutoRun, plan: SmartPagePlan, now: Date): Promise<TranslationJob | null> {
  const owner = attachedOwner(plan.resourceType);
  for (const type of owner ? [owner, plan.resourceType] : [plan.resourceType]) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${shopId}:${type}:${plan.locale}`}, 0))`;
  }
  const idempotencyKey = `smart:${run.id}:${plan.resourceType}:${plan.locale}`;
  const own = await tx.translationJob.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey } } });
  if (own) return (ACTIVE_JOB_STATUSES as readonly string[]).includes(own.status) ? own : null;
  const jobs = await tx.translationJob.findMany({
    where: { shopId, targetLocale: plan.locale, status: { in: [...ACTIVE_JOB_STATUSES] }, resourceType: { in: owner ? [plan.resourceType, owner] : [plan.resourceType] } },
    orderBy: { createdAt: "asc" },
  });
  const automatic = (job: TranslationJob) => job.requestedBy === AUTO_REQUESTED_BY || (job.requestedBy === SMART_REQUESTED_BY && !job.smartRunId);
  const keeps = (job: TranslationJob) =>
    job.resourceType === plan.resourceType ? !(automatic(job) && job.fieldScope === "ALL" && !job.overwriteProtected) : job.includeAttached && !automatic(job);
  if (jobs.some(keeps)) return null;
  const active = jobs.find((j) => j.resourceType === plan.resourceType);
  const data = {
    requestedBy: SMART_REQUESTED_BY,
    idempotencyKey,
    smartRunId: run.id,
    status: "RUNNING" as const,
    publishMode: run.publishMode,
    fieldGroups: run.fieldGroups,
    replaceOutdatedMachine: run.replaceOutdatedMachine,
    // Its images and custom fields have their own jobs in a run.
    includeAttached: false,
    // Done when the run's measurement has read everything (finishSmartScanTx).
    discoveryDone: false,
  };
  if (active) return tx.translationJob.update({ where: { id: active.id }, data: { ...data, finishedAt: null } });
  return tx.translationJob.create({ data: { shopId, resourceType: plan.resourceType, targetLocale: plan.locale, ...data, startedAt: now } });
}

/**
 * The run's measurement is over (in the transaction of its last page, or
 * of the repair after it failed): its jobs can complete once their items
 * are done.
 */
export async function finishSmartScanTx(tx: TenantTx, shopId: string, runId: string, now = new Date()) {
  await tx.smartAutoRun.updateMany({ where: { id: runId, shopId, scanFinishedAt: null }, data: { scanFinishedAt: now } });
  await tx.translationJob.updateMany({ where: { shopId, smartRunId: runId, discoveryDone: false }, data: { discoveryDone: true } });
}

/** After the commit of the last page (or a failed measurement): completes what is done; the run's new status, if it finished. */
export async function afterSmartScan(client: PrismaClient, shopId: string, runId: string) {
  const jobs = await withTenant(
    shopId,
    (tx) => tx.translationJob.findMany({ where: { shopId, smartRunId: runId, status: { in: ["RUNNING", "DISCOVERING"] } }, select: { id: true } }),
    client,
  );
  // Jobs whose items all finished during the measurement complete now.
  for (const job of jobs) await completeIfDone(shopId, job.id, client);
  return finishSmartRunIfDone(shopId, runId, client);
}

/**
 * Finishes runs whose measurement ended without its last page finishing
 * them: it failed (access lost, the shop gone), was replaced as stalled, or
 * the process stopped between the last page's commit and finishing the run.
 * Without this, an unfinished run would keep every later check waiting.
 * Safe to repeat; returns how many runs it finished.
 */
export async function repairSmartRuns(shopId: string, client: PrismaClient = defaultClient, now = new Date()) {
  const ended = await withTenant(
    shopId,
    async (tx) => {
      const running = await tx.smartAutoRun.findMany({
        where: { shopId, status: "RUNNING" },
        select: { id: true, coverageReportId: true, scanFinishedAt: true },
      });
      const ids: string[] = [];
      for (const run of running) {
        if (!run.scanFinishedAt) {
          const report = run.coverageReportId
            ? await tx.coverageReport.findFirst({ where: { id: run.coverageReportId, shopId }, select: { status: true } })
            : null;
          // Still measuring (a stalled report is continued by its own repair).
          if (report && (report.status === "QUEUED" || report.status === "RUNNING")) continue;
          await finishSmartScanTx(tx, shopId, run.id, now);
        }
        ids.push(run.id);
      }
      return ids;
    },
    client,
  );
  let finished = 0;
  for (const runId of ended) if (await afterSmartScan(client, shopId, runId)) finished++;
  return finished;
}

/** The repair for every installed shop (the worker's periodic sweep), each in its own tenant context. */
export async function repairAllSmartRuns(client: PrismaClient = defaultClient, now = new Date()) {
  const shops = await client.shop.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let total = 0;
  for (const shop of shops) {
    try {
      total += await repairSmartRuns(shop.id, client, now);
    } catch (error) {
      logger.warn({ shopId: shop.id, err: (error as Error).name }, "smart run repair failed");
    }
  }
  return total;
}
