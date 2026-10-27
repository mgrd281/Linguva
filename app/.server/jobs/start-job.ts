import { getQueues } from "../queue/client";
import { createBulkJob, retryJobItems, type BulkResourceType } from "./bulk-jobs";
import { enqueueCoveragePage, enqueueDiscovery, enqueueItems } from "./queues";
import { createCoverageReport } from "../coverage/coverage";

export class BackgroundJobsUnavailableError extends Error {
  constructor() {
    super("Background jobs are not configured");
    this.name = "BackgroundJobsUnavailableError";
  }
}

/** Creates (or reuses) a bulk job and enqueues its first discovery page. */
export async function startBulkJob(input: {
  shopId: string;
  resourceType: BulkResourceType;
  targetLocale: string;
  requestedBy: string | null;
  idempotencyKey: string;
  overwriteProtected?: boolean;
  fieldScope?: "ALL" | "SEO";
}) {
  const queues = getQueues();
  if (!queues) throw new BackgroundJobsUnavailableError();
  const { job, created } = await createBulkJob(input);
  if (created) {
    await enqueueDiscovery(queues, { shopId: input.shopId, jobId: job.id }, null);
  }
  return { job, created };
}

/** Retries failed items (and resumes a stopped job). */
export async function retryBulkJob(shopId: string, jobId: string) {
  const queues = getQueues();
  if (!queues) throw new BackgroundJobsUnavailableError();
  const { itemIds, rediscover } = await retryJobItems(shopId, jobId);
  const round = `retry${Date.now()}`;
  await enqueueItems(queues, shopId, itemIds, round);
  // Discovery resumes from the stored cursor under a fresh queue job id.
  if (rediscover) await enqueueDiscovery(queues, { shopId, jobId }, null, round);
  return itemIds.length;
}

/** Starts (or reuses) a coverage report and enqueues its first page. */
export async function startCoverageReport(input: {
  shopId: string;
  locales: readonly string[];
  requestedBy: string | null;
  idempotencyKey: string;
}) {
  const queues = getQueues();
  if (!queues) throw new BackgroundJobsUnavailableError();
  const { report, created } = await createCoverageReport(input);
  if (created) {
    await enqueueCoveragePage(queues, { shopId: input.shopId, reportId: report.id, segmentIndex: 0, cursor: null });
  }
  return { report, created };
}
