/**
 * Review's pictures (a resource route, no page): each card's picture, image
 * texts' own pictures, custom fields' names and missing titles, read from
 * Shopify after the page is shown (review/previews.ts, kept a minute).
 *
 * The pictures are extras: when they can't be loaded at all (the request
 * fails, the server errs), the cards show their area icons and the page
 * says so once, instead of the page's error screen taking over.
 */
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { loadReviewPreviews, previewIds, type ReviewPreviews } from "../.server/review/previews";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return loadReviewPreviews(admin, shop.id, previewIds(new URL(request.url).searchParams.get("ids")));
};

// Loaded once per page of Review: an approval doesn't read the pictures again.
export const shouldRevalidate = () => false;

export const clientLoader = async ({ serverLoader }: ClientLoaderFunctionArgs): Promise<ReviewPreviews> => {
  try {
    return await serverLoader<typeof loader>();
  } catch {
    return { byDraft: {}, error: true };
  }
};
