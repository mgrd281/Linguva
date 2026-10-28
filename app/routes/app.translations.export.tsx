import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { AccessDeniedError } from "../.server/shopify/translations-api";
import { exportTranslations, isExportType } from "../.server/translation/csv-transfer";

/**
 * Downloads one part of a translation export as CSV (formula-safe). The
 * cursor of the next part comes back in X-Linguva-Next; the shop comes from
 * the session, the language must be one of its target languages.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const locale = url.searchParams.get("lang") ?? "";
  const after = url.searchParams.get("after");
  const targets = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary).map((l) => l.locale);
  if (!isExportType(type) || !targets.includes(locale) || (after !== null && !/^[\w=+/-]{1,1000}$/.test(after))) {
    return new Response("Invalid export", { status: 400 });
  }
  try {
    const result = await exportTranslations(admin, { resourceType: type, locale, onlyGaps: url.searchParams.get("gaps") === "1", after });
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="linguva-${type.toLowerCase()}-${locale}.csv"`,
        "Cache-Control": "no-store",
        "X-Linguva-Rows": String(result.rows),
        ...(result.nextCursor ? { "X-Linguva-Next": result.nextCursor } : {}),
      },
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) return new Response("No access to this content", { status: 403 });
    throw error;
  }
};
