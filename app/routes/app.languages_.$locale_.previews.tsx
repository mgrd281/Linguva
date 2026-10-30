/**
 * The examples on a language page's area cards (a resource route, no page):
 * a few items per area with their names, translations and pictures, read
 * from Shopify after the page is shown (language-page.ts, kept a minute).
 *
 * The examples are extras: when they can't be loaded at all (the request
 * fails, the server errs), every card says so and the page stays as it is,
 * instead of the page's error screen taking over.
 */
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { loadLanguagePreviews, type LanguagePreviews } from "../.server/languages/language-page";
import { CATEGORY_IDS } from "../lib/language-categories";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return loadLanguagePreviews(admin, shop, params.locale ?? "");
};

export const clientLoader = async ({ serverLoader }: ClientLoaderFunctionArgs): Promise<LanguagePreviews> => {
  try {
    return await serverLoader<typeof loader>();
  } catch {
    const failed = {} as LanguagePreviews;
    for (const id of CATEGORY_IDS) failed[id] = { items: [], error: true };
    return failed;
  }
};
