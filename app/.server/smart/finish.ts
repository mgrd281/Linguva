/**
 * Finishing a Smart Auto-Translate run: once its measurement has read
 * everything and every job it created is done. Called after the last page
 * and whenever one of its jobs completes or stops (kept apart from runs.ts,
 * so the job code can call it without importing the scheduler).
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";

const ACTIVE_JOB = ["PENDING", "DISCOVERING", "RUNNING"] as const;

export async function finishSmartRunIfDone(shopId: string, runId: string, client: PrismaClient = defaultClient, now = new Date()) {
  return withTenant(
    shopId,
    async (tx) => {
      const run = await tx.smartAutoRun.findFirst({ where: { id: runId, shopId, status: "RUNNING" } });
      if (!run?.scanFinishedAt) return null;
      const open = await tx.translationJob.count({ where: { shopId, smartRunId: runId, status: { in: [...ACTIVE_JOB] } } });
      if (open > 0) return null;
      const report = run.coverageReportId ? await tx.coverageReport.findFirst({ where: { id: run.coverageReportId, shopId }, select: { status: true, errorCode: true } }) : null;
      // A measurement that didn't finish can't vouch for everything being checked.
      const failed = report?.status === "FAILED";
      const finished = await tx.smartAutoRun.updateMany({
        where: { id: runId, shopId, status: "RUNNING" },
        data: { status: failed ? "FAILED" : "COMPLETED", errorCode: failed ? (report?.errorCode ?? "SCAN_FAILED") : null, finishedAt: now },
      });
      if (finished.count && !failed) await tx.smartAutoConfig.updateMany({ where: { shopId }, data: { lastSuccessAt: now } });
      return failed ? "FAILED" : "COMPLETED";
    },
    client,
  );
}
