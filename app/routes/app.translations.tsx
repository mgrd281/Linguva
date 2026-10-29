import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "../.server/lib/db";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { importTranslations, MAX_IMPORT_BYTES, type ImportResult } from "../.server/translation/csv-transfer";
import { useI18n } from "../i18n/react";
import { kindLabel } from "../i18n/labels";
import { CONTENT_TYPES, IMAGE_COVERAGE_TYPES, RESOURCE_KINDS } from "../lib/resource-kinds";

const EXPORT_TYPES = [...Object.keys(RESOURCE_KINDS), ...Object.keys(IMAGE_COVERAGE_TYPES), ...Object.keys(CONTENT_TYPES)];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  // Published languages first: the default export is one customers see.
  const targets = locales.locales.filter((l) => !l.primary).sort((a, b) => Number(b.published) - Number(a.published));
  return { targets: targets.map((l) => ({ locale: l.locale, name: l.name })), types: EXPORT_TYPES };
};

type ActionResult = { kind: "imported"; result: ImportResult } | { kind: "error"; code: "noFile" | "tooLarge" | "tooMany" };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "error", code: "noFile" };
  if (file.size > MAX_IMPORT_BYTES) return { kind: "error", code: "tooLarge" };
  const targets = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary).map((l) => l.locale);
  const result = await importTranslations({ admin, shopId: shop.id, csv: await file.text(), targetLocales: targets });
  if (result.tooMany) return { kind: "error", code: "tooMany" };
  // No row content in the log: counts only.
  await prisma.auditLog.createMany({
    data: [{
      shopId: shop.id,
      actorType: actorId ? "MERCHANT_USER" : "SYSTEM",
      actorId,
      action: "translations.imported",
      targetType: "Shop",
      targetId: shop.id,
      metadata: { rows: result.rows, drafts: result.drafts, skipped: result.skipped },
    }],
  });
  return { kind: "imported", result };
};

/** fetch() inside the embedded app carries the session token (App Bridge), a plain link wouldn't. */
async function download(params: URLSearchParams): Promise<{ rows: number; next: string | null } | null> {
  const response = await fetch(`/app/translations/export?${params.toString()}`);
  if (!response.ok) return null;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `linguva-${params.get("type")?.toLowerCase()}-${params.get("lang")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return { rows: Number(response.headers.get("X-Linguva-Rows") ?? 0), next: response.headers.get("X-Linguva-Next") };
}

export default function Translations() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const importer = useFetcher<typeof action>();
  const [lang, setLang] = useState(data.targets[0]?.locale ?? "");
  const [type, setType] = useState("PRODUCT");
  const [gaps, setGaps] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ rows: number; next: string | null } | "failed" | null>(null);

  async function exportPart(after: string | null) {
    setExporting(true);
    const params = new URLSearchParams({ lang, type, ...(gaps ? { gaps: "1" } : {}), ...(after ? { after } : {}) });
    setExported((await download(params)) ?? "failed");
    setExporting(false);
  }

  const imported = importer.data?.kind === "imported" ? importer.data.result : null;
  const importError = importer.data?.kind === "error" ? importer.data.code : null;

  if (!data.targets.length) {
    return (
      <s-page heading={t("transfer.page.heading")}>
        <s-section>
          <s-paragraph>{t("transfer.noLanguages")}</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={t("transfer.page.heading")}>
      <s-section>
        <s-paragraph>{t("transfer.intro")}</s-paragraph>
      </s-section>

      <s-section heading={t("transfer.export.heading")}>
        <s-stack direction="block" gap="base">
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 500px) 1fr 1fr, 1fr" gap="base">
              <s-select label={t("common.language")} value={lang} onChange={(e) => setLang(e.currentTarget.value)}>
                {data.targets.map((l) => (
                  <s-option key={l.locale} value={l.locale}>
                    {i18n.language(l.locale, l.name)}
                  </s-option>
                ))}
              </s-select>
              <s-select label={t("coverage.types.type")} value={type} onInput={(e) => setType(e.currentTarget.value)} onChange={(e) => setType(e.currentTarget.value)}>
                {data.types.map((k) => (
                  <s-option key={k} value={k}>
                    {kindLabel(i18n, k)}
                  </s-option>
                ))}
              </s-select>
            </s-grid>
          </s-query-container>
          <s-checkbox
            label={t("transfer.export.onlyGaps")}
            {...(gaps ? { checked: true } : {})}
            // React 18 sends no onChange for a web component; its input event comes through.
            onInput={(e) => setGaps(e.currentTarget.checked)}
            onChange={(e) => setGaps(e.currentTarget.checked)}
          />
          <s-text color="subdued">{t("transfer.export.columns")}</s-text>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button variant="primary" onClick={() => exportPart(null)} {...(exporting ? { loading: true } : {})}>
              {t("transfer.export.download")}
            </s-button>
            {exported && exported !== "failed" && exported.next ? (
              <s-button onClick={() => exportPart(exported.next)} {...(exporting ? { loading: true } : {})}>
                {t("transfer.export.next")}
              </s-button>
            ) : null}
          </s-stack>
          {exported === "failed" ? <s-text tone="critical">{t("transfer.export.failed")}</s-text> : null}
          {exported && exported !== "failed" ? <s-text>{t("transfer.export.done", { count: exported.rows })}</s-text> : null}
          <s-text color="subdued">{t("transfer.export.parts")}</s-text>
        </s-stack>
      </s-section>

      <s-section heading={t("transfer.import.heading")}>
        <importer.Form method="post" encType="multipart/form-data">
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("transfer.import.safety")}</s-paragraph>
            <s-drop-zone name="file" accept=".csv,text/csv" label={t("transfer.import.file")} />
            <s-button type="submit" {...(importer.state !== "idle" ? { loading: true } : {})}>
              {t("transfer.import.submit")}
            </s-button>
            {importError ? (
              <s-banner tone="critical">
                <s-paragraph>{t(`transfer.import.${importError}`)}</s-paragraph>
              </s-banner>
            ) : null}
            {imported ? (
              <s-banner tone={imported.drafts ? "success" : "warning"}>
                <s-stack direction="block" gap="small">
                  <s-paragraph>{t("transfer.import.done", { count: imported.drafts })}</s-paragraph>
                  <s-text color="subdued">
                    {t("transfer.import.summary", { rows: i18n.number(imported.rows), skipped: i18n.number(Object.values(imported.skipped).reduce((n, c) => n + c, 0)) })}
                  </s-text>
                  {imported.drafts ? <s-link href="/app/review">{t("transfer.import.openReview")}</s-link> : null}
                </s-stack>
              </s-banner>
            ) : null}
          </s-stack>
        </importer.Form>
      </s-section>

      {imported && imported.problems.length ? (
        <s-section heading={t("transfer.import.skippedHeading")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("transfer.import.line", { line: "" }).trim()}</s-table-header>
              <s-table-header>{t("transfer.import.reason")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {imported.problems.map((p) => (
                <s-table-row key={`${p.line}-${p.code}`}>
                  <s-table-cell>{t("transfer.import.line", { line: String(p.line) })}</s-table-cell>
                  <s-table-cell>{t(`transfer.problem.${p.code}`)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {imported.problems.length >= 50 ? (
            <s-box padding="base">
              <s-text color="subdued">{t("transfer.import.more")}</s-text>
            </s-box>
          ) : null}
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
