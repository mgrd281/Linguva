/**
 * Smart Auto-Translate planning (docs/SMART_AUTO_TRANSLATE.md §5.2): a run's
 * measurement plans translation for every page it reads, with the same
 * field-level rules as every job, and the plan is written in the page's own
 * transaction (coverage.ts runCoveragePage), so a repeated page never plans
 * twice and nothing read is left unplanned. Kept apart from runs.ts (the
 * scheduler), so the scan can call it without importing the scheduler.
 */
import type { CoverageReport, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import type { CoverageChange } from "../coverage/items";
import { completeIfDone } from "../jobs/bulk-jobs";
import { planResourceWork } from "../jobs/needs-work";
import { pendingDraftDigests } from "../review/drafts";
import { isEditableAttachedField } from "../translation/attached-editor";
import { latestRevisions } from "../translation/revisions";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { SMART_REQUESTED_BY, smartCoverageTypes } from "../../lib/smart-auto";
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
      if (!run || run.status !== "RUNNING" || !config?.enabled || smartPaused(config, now)) return null;
      // The measurement reads every language and type; the run plans its own scope only.
      if (!run.locales.includes(input.locale) || !smartCoverageTypes(run).includes(input.resourceType)) return null;
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

  const candidates = input.changes.filter((c) => {
    const skip = state.excluded.has(c.resourceGid) || Boolean(c.parentGid && state.excluded.has(c.parentGid));
    if (skip) plan.excluded++;
    // Being translated by another job (a bulk job, or the previous run): left to it.
    return !skip && !state.busy.has(c.resourceGid) && c.observed;
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
      resourcesChanged: { increment: plan.items.length },
      fieldsDetected: { increment: plan.items.reduce((n, i) => n + i.fields, 0) },
      charsEstimated: { increment: plan.items.reduce((n, i) => n + i.chars, 0) },
      itemsQueued: { increment: created },
      excludedSkipped: { increment: plan.excluded },
    },
  });
  return { itemIds, position };
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
