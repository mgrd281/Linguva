import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ZodError } from "zod";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import {
  deleteTerm,
  GlossaryLimitError,
  issueMessages,
  listTerms,
  MAX_TERMS_PER_SHOP,
  parseGlossaryCsv,
  upsertTerms,
} from "../.server/glossary/glossary";
import type { I18n, MessageRef } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";
import { useI18n } from "../i18n/react";

const MAX_IMPORT_BYTES = 1024 * 1024;

function ruleLabel(i18n: I18n, rule: string): string {
  const key = `glossary.rule.${rule}`;
  return hasMessage(key) ? i18n.t(key) : rule;
}

/** A row's (or the form's) problems, joined like "translation: …; targetLocale: …". */
function problems(i18n: I18n, messages: MessageRef[]): string {
  return messages.map(i18n.msg).join("; ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const [terms, locales] = await Promise.all([listTerms(shop.id), fetchAndSyncShopLocales(admin, shop.id)]);
  return {
    languages: locales.locales.filter((l) => !l.primary).map((l) => ({ locale: l.locale, name: l.name })),
    terms: terms.map((t) => ({
      id: t.id,
      rule: t.rule,
      term: t.term,
      translation: t.translation,
      targetLocale: t.targetLocale,
      market: t.market,
      caseSensitive: t.caseSensitive,
    })),
  };
};

type Result =
  | { kind: "added" }
  | { kind: "deleted" }
  | { kind: "imported"; count: number; errors: Array<{ line: number; messages: MessageRef[] }> }
  | { kind: "error"; messages: MessageRef[] };

const failure = (ref: MessageRef): Result => ({ kind: "error", messages: [ref] });

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { admin, shop } = await requireShop(request);
  if (!(await shopBilling(admin, shop)).entitlements.glossary) {
    return failure({ key: "glossary.error.notOnPlan" });
  }
  // Refuse oversized uploads before the body is read into memory.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return failure({ key: "glossary.error.uploadTooLarge" });
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "add") {
      await upsertTerms(shop.id, [
        {
          rule: String(form.get("rule")) as "DO_NOT_TRANSLATE",
          term: String(form.get("term") ?? ""),
          translation: String(form.get("translation") ?? "") || null,
          targetLocale: String(form.get("targetLocale") ?? ""),
          market: String(form.get("market") ?? ""),
          caseSensitive: form.get("caseSensitive") === "on",
        },
      ]);
      return { kind: "added" };
    }
    if (intent === "delete") {
      await deleteTerm(shop.id, String(form.get("termId") ?? ""));
      return { kind: "deleted" };
    }
    if (intent === "import") {
      const file = form.get("file");
      const pasted = form.get("csv");
      let text = typeof pasted === "string" ? pasted : "";
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_IMPORT_BYTES) return failure({ key: "glossary.error.fileTooLarge" });
        text = await file.text();
      }
      if (text.length > MAX_IMPORT_BYTES) return failure({ key: "glossary.error.csvTooLarge" });
      const parsed = parseGlossaryCsv(text);
      // Nothing is imported unless every row is valid.
      if (parsed.errors.length) return { kind: "imported", count: 0, errors: parsed.errors.slice(0, 20) };
      const count = await upsertTerms(shop.id, parsed.terms, { replaceAll: form.get("replaceAll") === "on" });
      return { kind: "imported", count, errors: [] };
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return { kind: "error", messages: issueMessages(error.issues) };
    }
    if (error instanceof GlossaryLimitError) return failure({ key: "glossary.error.limit", vars: { max: MAX_TERMS_PER_SHOP } });
    throw error;
  }
  return failure({ key: "glossary.error.unknownAction" });
};

// fetch() inside the embedded app carries the session token (App Bridge),
// which a plain link to a new tab wouldn't.
async function downloadCsv() {
  const response = await fetch("/app/glossary/export");
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "linguva-glossary.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function GlossaryPage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const { terms } = data;
  const languageNames = Object.fromEntries(data.languages.map((l) => [l.locale, l.name]));
  const addFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const addResult = addFetcher.data;
  const importResult = importFetcher.data;

  return (
    <s-page heading={t("common.nav.glossary")}>
      <s-button slot="primary-action" onClick={downloadCsv}>
        {t("glossary.exportCsv")}
      </s-button>

      <s-section heading={t("glossary.add.heading")}>
        <addFetcher.Form method="post">
          <input type="hidden" name="intent" value="add" />
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr, 1fr" gap="base">
                <s-select name="rule" label={t("glossary.field.rule")}>
                  <s-option value="DO_NOT_TRANSLATE">{t("glossary.option.DO_NOT_TRANSLATE")}</s-option>
                  <s-option value="PREFERRED">{t("glossary.option.PREFERRED")}</s-option>
                  <s-option value="FORBIDDEN">{t("glossary.option.FORBIDDEN")}</s-option>
                </s-select>
                <s-text-field name="term" label={t("glossary.field.term")} required />
                <s-text-field name="translation" label={t("glossary.field.translation")} details={t("glossary.field.translationDetails")} />
                <s-select name="targetLocale" label={t("common.language")}>
                  <s-option value="">{t("common.allLanguages")}</s-option>
                  {data.languages.map((l) => (
                    <s-option key={l.locale} value={l.locale}>
                      {l.name}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  name="market"
                  label={t("glossary.field.market")}
                  details={t("glossary.field.marketDetails")}
                />
                <s-checkbox name="caseSensitive" label={t("glossary.field.caseSensitive")} />
              </s-grid>
            </s-query-container>
            <s-button type="submit" variant="primary" {...(addFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("glossary.add.submit")}
            </s-button>
          </s-stack>
        </addFetcher.Form>
        {addResult?.kind === "error" ? (
          <s-banner tone="critical" heading={t("glossary.add.failed")}>
            <s-paragraph>{problems(i18n, addResult.messages)}</s-paragraph>
          </s-banner>
        ) : null}
      </s-section>

      <s-section heading={t("glossary.terms.heading", { count: terms.length })} padding="none">
        {terms.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>{t("glossary.terms.empty")}</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("glossary.field.term")}</s-table-header>
              <s-table-header>{t("glossary.field.rule")}</s-table-header>
              <s-table-header>{t("glossary.field.translation")}</s-table-header>
              <s-table-header>{t("common.language")}</s-table-header>
              <s-table-header>{t("glossary.terms.market")}</s-table-header>
              <s-table-header>{t("glossary.terms.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {terms.map((term) => (
                <s-table-row key={term.id}>
                  <s-table-cell>
                    {term.term}
                    {term.caseSensitive ? " (Aa)" : ""}
                  </s-table-cell>
                  <s-table-cell>{ruleLabel(i18n, term.rule)}</s-table-cell>
                  <s-table-cell>{term.translation ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {term.targetLocale ? (languageNames[term.targetLocale] ?? term.targetLocale) : t("common.state.all")}
                  </s-table-cell>
                  <s-table-cell>{term.market ? term.market.replace("gid://shopify/Market/", "#") : t("common.state.all")}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => deleteFetcher.submit({ intent: "delete", termId: term.id }, { method: "post" })}
                    >
                      {t("common.action.delete")}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("glossary.import.heading")}>
        <importFetcher.Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import" />
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("glossary.import.columns")}</s-paragraph>
            <input type="file" name="file" accept=".csv,text/csv" aria-label={t("glossary.import.file")} />
            <s-text-area name="csv" label={t("glossary.import.paste")} rows={4} />
            <s-checkbox name="replaceAll" label={t("glossary.import.replaceAll")} />
            <s-button type="submit" {...(importFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("glossary.import.submit")}
            </s-button>
          </s-stack>
        </importFetcher.Form>
        {importResult?.kind === "imported" ? (
          importResult.errors.length ? (
            <s-banner tone="critical" heading={t("glossary.import.rejected")}>
              <s-unordered-list>
                {importResult.errors.map((e) => (
                  <s-list-item key={e.line}>
                    {t("glossary.import.line", { line: e.line, message: problems(i18n, e.messages) })}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          ) : (
            <s-banner tone="success" heading={t("glossary.import.complete")}>
              <s-paragraph>{t("glossary.import.count", { count: importResult.count })}</s-paragraph>
            </s-banner>
          )
        ) : null}
        {importResult?.kind === "error" ? (
          <s-banner tone="critical" heading={t("glossary.import.failed")}>
            <s-paragraph>{problems(i18n, importResult.messages)}</s-paragraph>
          </s-banner>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
