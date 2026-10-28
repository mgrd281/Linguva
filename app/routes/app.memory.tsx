import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import {
  approveMemoryEntry,
  deleteMemoryEntry,
  listMemory,
  memoryStats,
} from "../.server/memory/translation-memory";
import { markupToPlainText } from "../.server/translation/segment-markup";
import { useI18n } from "../i18n/react";

function plain(markup: string): string {
  try {
    return markupToPlainText(markup);
  } catch {
    return markup;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? "";
  const targetLocale = url.searchParams.get("lang") ?? "";
  const [entries, stats, locales] = await Promise.all([
    listMemory(shop.id, { search, targetLocale: targetLocale || undefined, take: 100 }),
    memoryStats(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
  ]);
  return {
    languages: locales.locales.filter((l) => !l.primary).map((l) => ({ locale: l.locale, name: l.name })),
    search,
    targetLocale,
    stats,
    entries: entries.map((e) => ({
      id: e.id,
      pair: `${e.sourceLocale} → ${e.targetLocale}`,
      source: plain(e.sourceText),
      target: plain(e.targetText),
      status: e.status,
      uses: e.useCount,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const id = String(form.get("entryId") ?? "");
  if (form.get("intent") === "delete") return { ok: await deleteMemoryEntry(shop.id, id) };
  if (form.get("intent") === "approve") return { ok: await approveMemoryEntry(shop.id, id) };
  return { ok: false };
};

export default function Memory() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t, number } = useI18n();
  const totalEntries = data.stats.reduce((s, r) => s + r.entries, 0);
  const totalUses = data.stats.reduce((s, r) => s + r.uses, 0);

  return (
    <s-page heading={t("common.nav.memory")}>
      <s-section>
        <s-paragraph>{t("memory.intro")}</s-paragraph>
        <s-paragraph>
          {t("memory.stats.entries", { count: totalEntries })} · {t("memory.stats.reused", { count: totalUses })}
        </s-paragraph>
      </s-section>

      <s-section>
        <Form method="get">
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr auto, 1fr" gap="base" alignItems="end">
              <s-search-field
                name="q"
                label={t("common.action.search")}
                placeholder={t("memory.search.placeholder")}
                value={data.search}
              />
              <s-select name="lang" label={t("common.language")} value={data.targetLocale}>
                <s-option value="">{t("common.allLanguages")}</s-option>
                {data.languages.map((l) => (
                  <s-option key={l.locale} value={l.locale}>
                    {l.name}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit">{t("common.action.search")}</s-button>
            </s-grid>
          </s-query-container>
        </Form>
      </s-section>

      <s-section padding="none">
        {data.entries.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>{t("memory.empty")}</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("memory.column.source")}</s-table-header>
              <s-table-header>{t("memory.column.translation")}</s-table-header>
              <s-table-header>{t("common.languages")}</s-table-header>
              <s-table-header>{t("common.status")}</s-table-header>
              <s-table-header format="numeric">{t("memory.column.uses")}</s-table-header>
              <s-table-header>{t("memory.column.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.entries.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.source}</s-table-cell>
                  <s-table-cell>{e.target}</s-table-cell>
                  <s-table-cell>{e.pair}</s-table-cell>
                  <s-table-cell>
                    {e.status === "APPROVED" ? (
                      <s-badge tone="success">{t("memory.status.approved")}</s-badge>
                    ) : (
                      <s-badge>{t("memory.status.machine")}</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{number(e.uses)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {e.status !== "APPROVED" ? (
                        <s-button
                          variant="tertiary"
                          onClick={() => fetcher.submit({ intent: "approve", entryId: e.id }, { method: "post" })}
                        >
                          {t("memory.action.approve")}
                        </s-button>
                      ) : null}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => fetcher.submit({ intent: "delete", entryId: e.id }, { method: "post" })}
                      >
                        {t("common.action.delete")}
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
