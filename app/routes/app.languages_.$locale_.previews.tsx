/**
 * The examples on a language page's area cards (a resource route, no page):
 * a few items per area with their names, translations and pictures, read
 * from Shopify after the page is shown (language-page.ts, kept a minute).
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { loadLanguagePreviews } from "../.server/languages/language-page";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return loadLanguagePreviews(admin, shop, params.locale ?? "");
};
