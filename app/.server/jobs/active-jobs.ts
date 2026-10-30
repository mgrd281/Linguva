/**
 * Translations running into a language, by area: the language page shows
 * their progress, the Content page that an area is being translated.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { ACTIVE_JOB_STATUSES } from "./bulk-jobs";
import { categoryOf, type CategoryId } from "../../lib/language-categories";
import { jobProgress } from "../../lib/job-display";

/** Translation jobs into the language that are queued or running (index (shopId, status)). */
export function activeJobs(shopId: string, locale: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.findMany({
        where: { shopId, targetLocale: locale, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, resourceType: true, totalItems: true, succeededItems: true, skippedItems: true, failedItems: true, discoveryDone: true },
      }),
    client,
  );
}

export type ActiveJob = Awaited<ReturnType<typeof activeJobs>>[number];

/** A category's running translation, in items: its job's page, or the Jobs page when several of its types run. */
export interface CategoryJob {
  href: string;
  done: number;
  total: number;
  /** Every job has found all its items (until then, the total still grows). */
  discoveryDone: boolean;
}

export function categoryJob(jobs: readonly ActiveJob[], category: CategoryId): CategoryJob | null {
  const own = jobs.filter((job) => categoryOf(job.resourceType) === category);
  if (!own.length) return null;
  const progress = own.map((job) => jobProgress(job));
  return {
    href: own.length === 1 ? `/app/jobs/${own[0]!.id}` : "/app/jobs",
    done: progress.reduce((n, p) => n + p.done, 0),
    total: progress.reduce((n, p) => n + p.total, 0),
    discoveryDone: own.every((job) => job.discoveryDone),
  };
}
