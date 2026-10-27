import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ZodError } from "zod";
import { requireShop } from "../.server/shopify/require-shop";
import {
  deleteTerm,
  GlossaryLimitError,
  listTerms,
  parseGlossaryCsv,
  upsertTerms,
} from "../.server/glossary/glossary";

const MAX_IMPORT_BYTES = 1024 * 1024;

const RULE_LABELS: Record<string, string> = {
  DO_NOT_TRANSLATE: "Never translate",
  PREFERRED: "Always translate as",
  FORBIDDEN: "Never use",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const terms = await listTerms(shop.id);
  return {
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
  | { kind: "imported"; count: number; errors: Array<{ line: number; message: string }> }
  | { kind: "error"; message: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { shop } = await requireShop(request);
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
        if (file.size > MAX_IMPORT_BYTES) return { kind: "error", message: "The file is larger than 1 MB." };
        text = await file.text();
      }
      if (text.length > MAX_IMPORT_BYTES) return { kind: "error", message: "The CSV is larger than 1 MB." };
      const parsed = parseGlossaryCsv(text);
      // Nothing is imported unless every row is valid.
      if (parsed.errors.length) return { kind: "imported", count: 0, errors: parsed.errors.slice(0, 20) };
      const count = await upsertTerms(shop.id, parsed.terms, { replaceAll: form.get("replaceAll") === "on" });
      return { kind: "imported", count, errors: [] };
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return { kind: "error", message: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    if (error instanceof GlossaryLimitError) return { kind: "error", message: error.message };
    throw error;
  }
  return { kind: "error", message: "Unknown action" };
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
  const { terms } = useLoaderData<typeof loader>();
  const addFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const addResult = addFetcher.data;
  const importResult = importFetcher.data;

  return (
    <s-page heading="Glossary">
      <s-button slot="primary-action" onClick={downloadCsv}>
        Export CSV
      </s-button>

      <s-section heading="Add a term">
        <addFetcher.Form method="post">
          <input type="hidden" name="intent" value="add" />
          <s-stack direction="block" gap="base">
            <s-select name="rule" label="Rule">
              <s-option value="DO_NOT_TRANSLATE">Never translate (brands, product names, SKUs)</s-option>
              <s-option value="PREFERRED">Always translate as…</s-option>
              <s-option value="FORBIDDEN">Never use this wording in translations</s-option>
            </s-select>
            <s-text-field name="term" label="Term" required />
            <s-text-field name="translation" label="Translation (for “Always translate as”)" />
            <s-text-field name="targetLocale" label="Language code (empty = all languages)" placeholder="de" />
            <s-text-field name="market" label="Market id (empty = all markets)" placeholder="gid://shopify/Market/123" />
            <s-checkbox name="caseSensitive" label="Case sensitive" />
            <s-button type="submit" variant="primary" {...(addFetcher.state !== "idle" ? { loading: true } : {})}>
              Add term
            </s-button>
          </s-stack>
        </addFetcher.Form>
        {addResult?.kind === "error" ? (
          <s-banner tone="critical" heading="Term not added">
            <s-paragraph>{addResult.message}</s-paragraph>
          </s-banner>
        ) : null}
      </s-section>

      <s-section heading={`Terms (${terms.length})`} padding="none">
        {terms.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No terms yet. Add your brand and product names so they are never translated.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Term</s-table-header>
              <s-table-header>Rule</s-table-header>
              <s-table-header>Translation</s-table-header>
              <s-table-header>Language</s-table-header>
              <s-table-header>Market</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {terms.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    {t.term}
                    {t.caseSensitive ? " (Aa)" : ""}
                  </s-table-cell>
                  <s-table-cell>{RULE_LABELS[t.rule]}</s-table-cell>
                  <s-table-cell>{t.translation ?? "—"}</s-table-cell>
                  <s-table-cell>{t.targetLocale || "All"}</s-table-cell>
                  <s-table-cell>{t.market ? t.market.replace("gid://shopify/Market/", "#") : "All"}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => deleteFetcher.submit({ intent: "delete", termId: t.id }, { method: "post" })}
                    >
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Import from CSV">
        <importFetcher.Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import" />
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Columns: rule, term, translation, target_locale, market,
              case_sensitive, notes. Rules: DO_NOT_TRANSLATE, PREFERRED,
              FORBIDDEN. Nothing is imported if any row is invalid.
            </s-paragraph>
            <input type="file" name="file" accept=".csv,text/csv" aria-label="CSV file" />
            <s-text-area name="csv" label="…or paste CSV" rows={4} />
            <s-checkbox name="replaceAll" label="Replace all existing terms" />
            <s-button type="submit" {...(importFetcher.state !== "idle" ? { loading: true } : {})}>
              Import
            </s-button>
          </s-stack>
        </importFetcher.Form>
        {importResult?.kind === "imported" ? (
          importResult.errors.length ? (
            <s-banner tone="critical" heading="Import rejected">
              <s-unordered-list>
                {importResult.errors.map((e) => (
                  <s-list-item key={e.line}>
                    Line {e.line}: {e.message}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          ) : (
            <s-banner tone="success" heading="Import complete">
              <s-paragraph>{importResult.count} term(s) imported.</s-paragraph>
            </s-banner>
          )
        ) : null}
        {importResult?.kind === "error" ? (
          <s-banner tone="critical" heading="Import failed">
            <s-paragraph>{importResult.message}</s-paragraph>
          </s-banner>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
