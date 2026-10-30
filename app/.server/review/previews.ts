/**
 * Review's pictures (app/routes/app.review_.previews.tsx), read after the
 * page is shown so its response never waits for Shopify: each card's
 * picture, an image text's own picture, a custom field's live name, and a
 * card's live title where none was stored. The browser sends draft ids
 * only; the resources come from the stored drafts (RLS: another shop's ids
 * find nothing). One nodes() read per 100 items (LinguvaPreviewNodes),
 * kept in memory for a minute per item; nothing is stored.
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { readPreviewNodes, type PreviewNode } from "../shopify/preview-nodes";
import { settle, sizedImage } from "../shopify/preview-images";
import { PREVIEWS_CACHE_MS } from "../languages/language-page";
import { gidPart } from "../../lib/review-order";
import { ownerTitle, RESOURCE_GID_KINDS } from "../../lib/review-areas";
import { draftOwners } from "./page";

type Admin = Pick<AdminApiContext, "graphql">;

export const REVIEW_PREVIEWS_CACHE_MS = PREVIEWS_CACHE_MS;
/** Ids a request may ask for: one page of Review. */
export const REVIEW_PREVIEWS_MAX_IDS = 100;
const CACHE_LIMIT = 5000;
/** Twice the shown size, for sharp screens: 56 px card pictures, 40 px image-text pictures. */
const CARD_IMAGE_WIDTH = 112;
const OWN_IMAGE_WIDTH = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewPreview {
  /** The card's picture (its product, collection or post). */
  card: { url: string; alt: string | null } | null;
  /** An image text's own picture (collection and post images: their owner's). */
  own: { url: string; alt: string | null } | null;
  /** A custom field's name in the store. */
  fieldName: string | null;
  /** The card's title in the store, only where none was stored. */
  title: string | null;
}

export interface ReviewPreviews {
  byDraft: Record<string, ReviewPreview>;
  /** Shopify couldn't be read: the cards show their area icons. */
  error: boolean;
}

const cache = new Map<string, { at: number; node: PreviewNode | null }>();

/** Tests only: forget cached pictures. */
export function clearReviewPreviewsCache() {
  cache.clear();
}

/** The ids of a request: UUIDs only, each once, at most one page. */
export function previewIds(raw: string | null): string[] {
  return [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter((id) => UUID.test(id)))].slice(0, REVIEW_PREVIEWS_MAX_IDS);
}

const NODE_KINDS = new Set([...RESOURCE_GID_KINDS]);

export async function loadReviewPreviews(
  admin: Admin,
  shopId: string,
  ids: readonly string[],
  client: PrismaClient = defaultClient,
  now = Date.now(),
): Promise<ReviewPreviews> {
  const wanted = ids.slice(0, REVIEW_PREVIEWS_MAX_IDS);
  if (!wanted.length) return { byDraft: {}, error: false };
  const { rows, titles } = await withTenant(
    shopId,
    async (tx) => {
      const rows = await draftOwners(tx, shopId, wanted);
      // Stored titles of the cards these drafts belong to (a card's title may come from any of its texts).
      const stored = rows.length
        ? await tx.translationDraft.findMany({ where: { shopId, id: { in: rows.map((r) => r.id) } }, select: { id: true, parentGid: true, resourceTitle: true } })
        : [];
      return { rows, titles: new Map(stored.map((d) => [d.id, d])) };
    },
    client,
  );

  // Cards of the five kinds (pictures and live titles), product images (their own pictures), custom fields (their names).
  const gids = new Set<string>();
  for (const row of rows) {
    if (NODE_KINDS.has(gidPart(row.cardGid, 4))) gids.add(row.cardGid);
    const kind = gidPart(row.resourceGid, 4);
    if (kind === "MediaImage" || kind === "Metafield") gids.add(row.resourceGid);
  }
  const nodes = new Map<string, PreviewNode | null>();
  const missing: string[] = [];
  for (const gid of gids) {
    const hit = cache.get(`${shopId}|${gid}`);
    if (hit && now - hit.at < REVIEW_PREVIEWS_CACHE_MS) nodes.set(gid, hit.node);
    else missing.push(gid);
  }
  let error = false;
  if (missing.length) {
    // translations(locale:) isn't used here: any language of the page will do.
    const read = await settle(shopId, "review previews", readPreviewNodes(admin, missing, rows[0]!.locale));
    if (read === null) error = true;
    else {
      for (const gid of missing) {
        const node = read.get(gid) ?? null;
        nodes.set(gid, node);
        cache.set(`${shopId}|${gid}`, { at: now, node });
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
    }
  }

  // A card's title where no text of it was stored with one.
  const cardTitles = new Map<string, string | null>();
  for (const row of rows) {
    const draft = titles.get(row.id);
    const title = ownerTitle(row.cardGid, [{ resourceGid: row.resourceGid, parentGid: draft?.parentGid ?? null, title: draft?.resourceTitle ?? null }]);
    if (title) cardTitles.set(row.cardGid, title);
    else if (!cardTitles.has(row.cardGid)) cardTitles.set(row.cardGid, null);
  }

  const byDraft: Record<string, ReviewPreview> = {};
  for (const row of rows) {
    const card = nodes.get(row.cardGid) ?? null;
    const own = nodes.get(row.resourceGid) ?? null;
    const kind = gidPart(row.resourceGid, 4);
    // Collection and post images have no picture of their own in the preview read: their owner's is the same.
    const ownImage = kind === "MediaImage" ? own?.image : row.key === "alt" && row.owner ? card?.image : undefined;
    byDraft[row.id] = {
      card: sizedImage(card?.image, CARD_IMAGE_WIDTH),
      own: sizedImage(ownImage, OWN_IMAGE_WIDTH),
      fieldName: kind === "Metafield" ? (own?.label ?? null) : null,
      title: cardTitles.get(row.cardGid) ? null : (card?.text ?? null),
    };
  }
  return { byDraft, error };
}
