/**
 * The way back to a stopped job from the page that fixes its cause (the
 * Jobs pages' fix step opens it with `?job=<id>`: STOP_FIX_HREF and
 * stopFixHref in app/lib/job-view.ts). The page shows <BackToJob> only for
 * a FAILED job of this shop whose cause is fixed here and is fixed by now
 * (stopFix says true). Anything else, a check that fails included, shows
 * nothing: this only advises, so it never breaks the page.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { STOP_FIX_HREF, stopGroup, type StopGroup } from "../../lib/job-view";
import { getJobForShop } from "./bulk-jobs";
import { stopFix, stopFixContext, type StopFixBilling } from "./stop-fix";

/** What the page needs to name the job, link to it and place the way back (its stop cause). */
export interface BackToJobView {
  id: string;
  targetLocale: string;
  resourceType: string;
  group: StopGroup;
}

export interface BackToJobInput {
  shopId: string;
  /** The shop's billing as the page has it (shopBilling). */
  billing: StopFixBilling;
  /** The `job` search parameter as it came (anything a URL can carry). */
  jobId: string | null;
  /** The page's own fix address, as STOP_FIX_HREF names it without its hash ("/app/settings?section=ai", "/app/plan"). */
  target: string;
  now?: Date;
  client?: PrismaClient;
}

/** The stop causes a page fixes: those whose fix address (without its hash) is the page's. */
export function stopGroupsFixedAt(target: string): StopGroup[] {
  return (Object.entries(STOP_FIX_HREF) as Array<[StopGroup, string]>).filter(([, href]) => href.split("#")[0] === target).map(([group]) => group);
}

export async function backToJob(input: BackToJobInput): Promise<BackToJobView | null> {
  if (!input.jobId) return null;
  const client = input.client ?? defaultClient;
  try {
    // A malformed id or another shop's job: nothing (getJobForShop reads this shop's rows only).
    const job = await getJobForShop(input.shopId, input.jobId, client);
    if (!job || job.status !== "FAILED") return null;
    const group = stopGroup(job.errorCode);
    if (!stopGroupsFixedAt(input.target).includes(group)) return null;
    const fixed = await stopFix(group, stopFixContext({ shopId: input.shopId, billing: input.billing, client, ...(input.now ? { now: input.now } : {}) })(job));
    return fixed === true ? { id: job.id, targetLocale: job.targetLocale, resourceType: job.resourceType, group } : null;
  } catch (error) {
    // Names only: a message may quote merchant data.
    logger.warn({ shopId: input.shopId, err: error instanceof Error ? error.name : "unknown" }, "back to job: couldn't check the stopped job");
    return null;
  }
}
