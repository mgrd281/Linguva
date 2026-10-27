import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { glossaryToCsv, listTerms } from "../.server/glossary/glossary";

/** Downloads the shop's glossary as CSV (formula-safe). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const csv = glossaryToCsv(await listTerms(shop.id));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="linguva-glossary.csv"',
      "Cache-Control": "no-store",
    },
  });
};
