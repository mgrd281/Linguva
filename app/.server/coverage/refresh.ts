/**
 * Webhook side of coverage freshness: a saved product or collection is read
 * again (its original may have changed), and so is a page, blog post or blog
 * the periodic check found changed (they have no webhooks); a deleted
 * product or collection is removed. Only resources of an installed shop are
 * queued or removed; the GID comes from the verified webhook payload or from
 * the shop's own Admin API and is checked against the types concerned.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { COVERAGE_REFRESH_GID, enqueueCoverageRefresh, type Queues } from "../jobs/queues";
import { dropDeletedResource } from "./items";

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

/** The resource type each delete topic is about (topics as "products/delete" or "PRODUCTS_DELETE"). */
const DELETE_TOPICS: Readonly<Record<string, "Product" | "Collection">> = { PRODUCTS_DELETE: "Product", COLLECTIONS_DELETE: "Collection" };

/** The deleted resource's GID: its numeric id (products/delete sends only that) for the topic's type. */
function deletedGid(type: "Product" | "Collection", payload: unknown): string | null {
  const body = payload as { id?: unknown; admin_graphql_api_id?: unknown } | null;
  const given = body?.admin_graphql_api_id;
  if (typeof given === "string" && new RegExp(`^gid://shopify/${type}/\\d{1,20}$`).test(given)) return given;
  const id = body?.id;
  const digits = typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? String(id) : typeof id === "string" && /^\d{1,20}$/.test(id) ? id : null;
  return digits ? `gid://shopify/${type}/${digits}` : null;
}

/**
 * products/delete, collections/delete: the resource leaves coverage at once,
 * in every language, with the custom fields it owns (not only at the next
 * scan of its type). Only for an installed shop; nothing is stored.
 */
export async function dropDeletedFromCoverage(
  input: { shopDomain: string; topic: string; payload: unknown },
  client: PrismaClient = defaultClient,
): Promise<"dropped" | "ignored"> {
  const type = DELETE_TOPICS[input.topic.toUpperCase().replace("/", "_")];
  const gid = type ? deletedGid(type, input.payload) : null;
  if (!gid) return "ignored";
  const shop = await client.shop.findUnique({ where: { shopDomain: input.shopDomain } });
  if (!shop || shop.status !== "ACTIVE") return "ignored";
  await dropDeletedResource(shop.id, gid, client);
  return "dropped";
}

/** Queues the refresh of a resource the periodic check found changed (the shop's id comes from the check). */
export async function queueSweptCoverageRefresh(queue: CoverageRefreshQueue, shopId: string, resourceGid: string): Promise<boolean> {
  if (!COVERAGE_REFRESH_GID.test(resourceGid)) return false;
  await enqueueCoverageRefresh(queue, { shopId, resourceGid });
  return true;
}
