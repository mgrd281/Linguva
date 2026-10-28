/**
 * Webhook side of coverage freshness: a saved product or collection is read
 * again (its original may have changed). Only resources of an installed
 * shop are queued; the GID comes from the verified webhook payload and is
 * checked against the topic's types.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { enqueueCoverageRefresh, type Queues } from "../jobs/queues";

const GID = /^gid:\/\/shopify\/(Product|Collection)\/\d{1,20}$/;

export async function queueCoverageRefresh(
  input: { shopDomain: string; payload: unknown },
  deps: { queue: Pick<Queues["coverage"], "add"> | null; prisma?: PrismaClient },
): Promise<"queued" | "ignored"> {
  const gid = (input.payload as { admin_graphql_api_id?: unknown } | null)?.admin_graphql_api_id;
  if (!deps.queue || typeof gid !== "string" || !GID.test(gid)) return "ignored";
  const shop = await (deps.prisma ?? defaultClient).shop.findUnique({ where: { shopDomain: input.shopDomain } });
  if (!shop || shop.status !== "ACTIVE") return "ignored";
  await enqueueCoverageRefresh(deps.queue, { shopId: shop.id, resourceGid: gid });
  return "queued";
}
