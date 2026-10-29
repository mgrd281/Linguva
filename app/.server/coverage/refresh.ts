/**
 * Webhook side of coverage freshness: a saved product or collection is read
 * again (its original may have changed), and so is a page, blog post or blog
 * the periodic check found changed (they have no webhooks). Only resources
 * of an installed shop are queued; the GID comes from the verified webhook
 * payload or from the shop's own Admin API and is checked against the types
 * that are read again.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { COVERAGE_REFRESH_GID, enqueueCoverageRefresh, type Queues } from "../jobs/queues";

export type CoverageRefreshQueue = Pick<Queues["coverage"], "add">;

export async function queueCoverageRefresh(
  input: { shopDomain: string; payload: unknown },
  deps: { queue: CoverageRefreshQueue | null; prisma?: PrismaClient },
): Promise<"queued" | "ignored"> {
  const gid = (input.payload as { admin_graphql_api_id?: unknown } | null)?.admin_graphql_api_id;
  if (!deps.queue || typeof gid !== "string" || !COVERAGE_REFRESH_GID.test(gid)) return "ignored";
  const shop = await (deps.prisma ?? defaultClient).shop.findUnique({ where: { shopDomain: input.shopDomain } });
  if (!shop || shop.status !== "ACTIVE") return "ignored";
  await enqueueCoverageRefresh(deps.queue, { shopId: shop.id, resourceGid: gid });
  return "queued";
}

/** Queues the refresh of a resource the periodic check found changed (the shop's id comes from the check). */
export async function queueSweptCoverageRefresh(queue: CoverageRefreshQueue, shopId: string, resourceGid: string): Promise<boolean> {
  if (!COVERAGE_REFRESH_GID.test(resourceGid)) return false;
  await enqueueCoverageRefresh(queue, { shopId, resourceGid });
  return true;
}
