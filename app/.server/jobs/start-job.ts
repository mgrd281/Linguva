import { getQueues } from "../queue/client";
import { createBulkJob, retryJobItems, type BulkResourceType } from "./bulk-jobs";
import { enqueueDiscovery, enqueueItems } from "./queues";

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
