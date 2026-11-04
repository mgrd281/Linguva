/**
 * The smart page's exclusions by their names and pictures as Shopify has
 * them (Linguva stores no merchant text): one nodes() read per 100 items,
 * kept in memory for a minute per shop and item like the language pages'
 * and Review's pictures. The page reloads every 10 seconds while a check
 * runs, and that check reads the store within the same Shopify limit.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { settle } from "../shopify/preview-images";
import { readPreviewNodes, type PreviewNode } from "../shopify/preview-nodes";

/** How long a read is kept (per process). */
export const EXCLUSION_NAMES_KEEP_MS = 60_000;
const CACHE_LIMIT = 5000;

const kept = new Map<string, { at: number; node: PreviewNode | null }>();

/** Tests only: forget what was read. */
export function clearExclusionNamesCache() {
  kept.clear();
}

/**
 * The given resources' nodes by GID; one Shopify doesn't return (deleted) is
 * missing, and kept as missing. A failed read isn't kept: those are missing
 * until the next try. Only the original's name and picture are shown, so the
 * language of the read doesn't matter.
 */
export async function exclusionNodes(
  admin: Pick<AdminApiContext, "graphql">,
  shopId: string,
  gids: readonly string[],
  locale: string,
  now = Date.now(),
): Promise<Map<string, PreviewNode>> {
  const nodes = new Map<string, PreviewNode>();
  const missing: string[] = [];
  for (const gid of gids) {
    const hit = kept.get(`${shopId}|${gid}`);
    if (!hit || now - hit.at >= EXCLUSION_NAMES_KEEP_MS) missing.push(gid);
    else if (hit.node) nodes.set(gid, hit.node);
  }
  if (!missing.length) return nodes;
  const read = await settle(shopId, "smart exclusions", readPreviewNodes(admin, missing, locale));
  if (!read) return nodes;
  for (const gid of missing) {
    const key = `${shopId}|${gid}`;
    const node = read.get(gid) ?? null;
    if (node) nodes.set(gid, node);
    // Moved to the end of the order, so the one dropped beyond the limit is the oldest read.
    kept.delete(key);
    kept.set(key, { at: now, node });
    if (kept.size > CACHE_LIMIT) kept.delete(kept.keys().next().value!);
  }
  return nodes;
}
