import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "../.server/lib/db";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { importTranslations, MAX_IMPORT_BYTES, type ImportResult } from "../.server/translation/csv-transfer";
import { Card } from "../components/Card";
import { Disclosure } from "../components/Disclosure";
import { StepNumber } from "../components/LanguageLayout";
import { ToolHeader, ToolsBreadcrumbSlot } from "../components/ToolHeader";
import { useI18n } from "../i18n/react";
import { areaName, contentTypeName, typesByArea } from "../lib/content-type-names";
import { CONTENT_TYPES, IMAGE_COVERAGE_TYPES, RESOURCE_KINDS } from "../lib/resource-kinds";
import { Button } from "../components/Button";

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
  try {
    const response = await fetch(`/app/translations/export?${params.toString()}`);
    if (!response.ok) return null;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `linguva-${params.get("type")?.toLowerCase()}-${params.get("lang")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return { rows: Number(response.headers.get("X-Linguva-Rows") ?? 0), next: response.headers.get("X-Linguva-Next") };
  } catch {
    return null;
  }
}

/** A step's number beside its heading (the three steps: export, fill in, import); the heading names the step's card. */
function StepHeading({ n, children }: { n: number; children: string }) {
  return (
    <div className="lv-tools-step">
      <StepNumber n={n} first={n === 1} />
      <h2 id={stepId(n)} className="lv-h2">
        {children}
      </h2>
    </div>
  );
}

const stepId = (n: number) => `transfer-step-${n}`;

export default function Translations() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const importer = useFetcher<typeof action>();
  const [lang, setLang] = useState(data.targets[0]?.locale ?? "");
  const [type, setType] = useState("PRODUCT");
  const [gaps, setGaps] = useState(true);
  const [exporting, setExporting] = useState(false);
  // A part keeps the choice it was downloaded for (also when that changed while it loaded).
  const [exported, setExported] = useState<{ rows: number; next: string | null; locale: string; type: string; gaps: boolean } | "failed" | null>(null);

  async function exportPart(after: string | null) {
    setExporting(true);
    const params = new URLSearchParams({ lang, type, ...(gaps ? { gaps: "1" } : {}), ...(after ? { after } : {}) });
    const result = await download(params);
    setExported(result ? { ...result, locale: lang, type, gaps } : "failed");
    setExporting(false);
  }
  // The next part only for that same choice: the cursor names no language, so after a change it would
  // quietly start the new choice after the first part's last item.
  const next = exported && exported !== "failed" && exported.locale === lang && exported.type === type && exported.gaps === gaps ? exported.next : null;

  // The file chosen for the import: its name under the zone; the import (the page's one primary button) waits for it.
  const [file, setFile] = useState<string | null>(null);
  // A form sent without a file all the same (the zone emptied): said on the zone at once, not after a trip to
  // the server (its own check stays).
  const [noFile, setNoFile] = useState(false);
  const choose = (zone: { files?: readonly File[] }) => {
    const name = zone.files?.[0]?.name ?? null;
    setFile(name);
    if (name) setNoFile(false);
  };

  const imported = importer.data?.kind === "imported" ? importer.data.result : null;
  const importError = importer.data?.kind === "error" ? importer.data.code : null;
  const languageName = (locale: string) => i18n.language(locale, data.targets.find((l) => l.locale === locale)?.name);
  const header = <ToolHeader tool="transfer" title={t("transfer.page.heading")} lead={t("transfer.intro")} i18n={i18n} />;

  if (!data.targets.length) {
    return (
      <s-page heading={t("transfer.page.heading")}>
        <ToolsBreadcrumbSlot i18n={i18n} />
        <s-stack direction="block" gap="base">
          {header}
          <Card>
            <s-paragraph>{t("transfer.noLanguages")}</s-paragraph>
          </Card>
        </s-stack>
      </s-page>
    );
  }

  return (
    <s-page heading={t("transfer.page.heading")}>
      <ToolsBreadcrumbSlot i18n={i18n} />
      <s-stack direction="block" gap="base">
        {header}

        <Card labelledBy={stepId(1)}>
          <s-stack direction="block" gap="base">
            <StepHeading n={1}>{t("transfer.step.export")}</StepHeading>
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 500px) 1fr 1fr, 1fr" gap="base">
                {/* React 18 sends no onChange for a web component; its input event comes through (so the CSV is in the language shown). */}
                <s-select label={t("common.language")} value={lang} onInput={(e) => setLang(e.currentTarget.value)} onChange={(e) => setLang(e.currentTarget.value)}>
                  {data.targets.map((l) => (
                    <s-option key={l.locale} value={l.locale}>
                      {i18n.language(l.locale, l.name)}
                    </s-option>
                  ))}
                </s-select>
                <s-select label={t("transfer.export.content")} value={type} onInput={(e) => setType(e.currentTarget.value)} onChange={(e) => setType(e.currentTarget.value)}>
                  {/* The language page's areas, each type in the merchant's words. */}
                  {typesByArea(data.types).map((group) =>
                    group.area ? (
                      <s-option-group key={group.area} label={areaName(i18n, group.area)}>
                        {group.types.map((k) => (
                          <s-option key={k} value={k}>
                            {contentTypeName(i18n, k)}
                          </s-option>
                        ))}
                      </s-option-group>
                    ) : (
                      group.types.map((k) => (
                        <s-option key={k} value={k}>
                          {contentTypeName(i18n, k)}
                        </s-option>
                      ))
                    ),
                  )}
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
            <s-stack direction="inline" gap="base" alignItems="center">
              {/* The page's one primary button is the import's: exporting is the way there. */}
              <Button icon="export" onClick={() => exportPart(null)} {...(exporting ? { loading: true } : {})}>
                {t("transfer.export.download")}
              </Button>
              {next ? (
                <Button icon="export" onClick={() => exportPart(next)} {...(exporting ? { loading: true } : {})}>
                  {t("transfer.export.next")}
                </Button>
              ) : null}
            </s-stack>
            {exported === "failed" ? <s-text tone="critical">{t("transfer.export.failed")}</s-text> : null}
            {exported && exported !== "failed" ? <s-text>{t("transfer.export.done", { count: exported.rows, language: languageName(exported.locale) })}</s-text> : null}
            <s-text color="subdued">{t("transfer.export.parts")}</s-text>
          </s-stack>
        </Card>

        <Card labelledBy={stepId(2)}>
          <s-stack direction="block" gap="base">
            <StepHeading n={2}>{t("transfer.step.fill")}</StepHeading>
            <s-text>{t("transfer.fill.body")}</s-text>
            <Disclosure summary={t("transfer.file.heading")}>
              <s-unordered-list>
                <s-list-item>{t("transfer.file.item")}</s-list-item>
                <s-list-item>{t("transfer.file.language")}</s-list-item>
                <s-list-item>{t("transfer.file.digest")}</s-list-item>
                <s-list-item>{t("transfer.file.original")}</s-list-item>
                <s-list-item>{t("transfer.file.translation")}</s-list-item>
                <s-list-item>{t("transfer.file.status")}</s-list-item>
              </s-unordered-list>
            </Disclosure>
          </s-stack>
        </Card>

        <Card labelledBy={stepId(3)}>
          <importer.Form
            method="post"
            encType="multipart/form-data"
            onSubmit={(e) => {
              // Only when the zone says it has no file: otherwise the server decides.
              if (e.currentTarget.querySelector("s-drop-zone")?.files?.length !== 0) return;
              e.preventDefault();
              setNoFile(true);
            }}
          >
            <s-stack direction="block" gap="base">
              <StepHeading n={3}>{t("transfer.step.import")}</StepHeading>
              <s-text color="subdued">{t("transfer.import.safety")}</s-text>
              <s-stack direction="block" gap="small-200">
                <s-drop-zone
                  name="file"
                  accept=".csv,text/csv"
                  label={t("transfer.import.file")}
                  {...(noFile ? { error: t("transfer.import.noFile") } : {})}
                  // React 18 sends no onChange for a web component; its input event comes through.
                  onInput={(e) => choose(e.currentTarget)}
                  onChange={(e) => choose(e.currentTarget)}
                />
                {file ? <s-text color="subdued">{t("transfer.import.chosen", { name: file })}</s-text> : null}
              </s-stack>
              <s-stack direction="inline">
                <Button type="submit" variant="primary" icon="import" disabled={!file} {...(importer.state !== "idle" ? { loading: true } : {})}>
                  {t("transfer.import.submit")}
                </Button>
              </s-stack>
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
        </Card>

        {imported && imported.problems.length ? (
          <Card heading={t("transfer.import.skippedHeading")} padding="none">
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
          </Card>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
