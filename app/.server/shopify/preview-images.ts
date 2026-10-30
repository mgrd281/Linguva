/**
 * Pictures and names read live from Shopify for what a page shows (the
 * language pages' examples and lists, Review's cards): Shopify's CDN image
 * at the size shown, and a read the page can do without.
 */
import { logger } from "../lib/logger";
import type { PreviewNode } from "./preview-nodes";

/** A Shopify CDN image at the width shown (Shopify's width parameter); null for anything but an http(s) URL. */
export function sizedImage(image: PreviewNode["image"] | undefined, width: number) {
  if (!image) return null;
  try {
    const url = new URL(image.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.searchParams.set("width", String(width));
    return { url: url.toString(), alt: image.alt };
  } catch {
    return null;
  }
}

/** A read the page can do without (it shows icons or ids instead): null when it failed, never a failed page. */
export async function settle<T>(shopId: string, what: string, read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    // A thrown Response is a Shopify timeout (admin-timeout.ts). Names only: a message may quote merchant data.
    logger.warn({ shopId, err: error instanceof Error ? error.name : "Response" }, `${what}: Shopify could not be read`);
    return null;
  }
}
