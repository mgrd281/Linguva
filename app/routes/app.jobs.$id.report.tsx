import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../.server/shopify/require-shop";
import { getJobForShop, listJobReportItems } from "../.server/jobs/bulk-jobs";
import { toCsv } from "../.server/glossary/csv";
import { resolveLocale, translator } from "../i18n/i18n";
import { hasMessage, itemOutcome } from "../i18n/labels";
import { numericId } from "../lib/resource-kinds";

/**
 * Downloads every item of a job with its outcome as CSV (formula-safe), in
 * the interface language given by `ui`. Only the shop's own job (RLS and an
 * explicit shop filter); 404 otherwise.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const i18n = translator(resolveLocale(new URL(request.url).searchParams.get("ui")));
  const { t } = i18n;
  const items = await listJobReportItems(shop.id, job.id);
  const rows = [
    [
      t("jobs.report.id"),
      t("jobs.report.resource"),
      t("jobs.report.status"),
      t("jobs.report.code"),
      t("jobs.report.reason"),
      t("jobs.report.translated"),
      t("jobs.report.heldBack"),
      t("jobs.report.attempts"),
      t("jobs.report.finished"),
      t("jobs.report.reference"),
    ],
    ...items.map((item) => [
      numericId(item.resourceGid),
      item.resourceGid,
      hasMessage(`jobs.itemStatus.${item.status}`) ? t(`jobs.itemStatus.${item.status}` as Parameters<typeof t>[0]) : item.status,
      item.errorCode ?? "",
      itemOutcome(i18n, item.status, item.errorCode),
      String(item.fieldsTranslated),
      String(item.fieldsRejected),
      String(item.attempts),
      item.finishedAt?.toISOString() ?? "",
      item.id,
    ]),
  ];
  // BOM so spreadsheet apps read UTF-8 (umlauts, other scripts) correctly.
  return new Response(`\uFEFF${toCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="linguva-job-${job.id.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
