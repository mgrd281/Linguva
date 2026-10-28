import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { MAX_ENABLED_LOCALES } from "../lib/locale-limits";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return fetchAndSyncShopLocales(admin, shop.id);
};

export default function Languages() {
  const summary = useLoaderData<typeof loader>();
  const { t, language } = useI18n();
  const hasRtl = summary.locales.some((l) => l.rtl);

  return (
    <s-page heading={t("common.languages")}>
      <s-button
        slot="primary-action"
        href="shopify://admin/settings/languages"
        target="_top"
      >
        {t("languages.manage")}
      </s-button>

      {summary.remainingEnabled === 0 ? (
        <s-banner tone="warning" heading={t("languages.limit.heading")}>
          <s-paragraph>{t("languages.limit.body", { max: MAX_ENABLED_LOCALES })}</s-paragraph>
        </s-banner>
      ) : null}

      {hasRtl ? (
        <s-banner tone="info" heading={t("languages.rtl.heading")}>
          <s-paragraph>{t("languages.rtl.body")}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("common.language")}</s-table-header>
            <s-table-header>{t("languages.table.code")}</s-table-header>
            <s-table-header>{t("languages.table.role")}</s-table-header>
            <s-table-header>{t("languages.table.storefront")}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {summary.locales.map((l) => (
              <s-table-row key={l.locale}>
                <s-table-cell>
                  {language(l.locale, l.name)}
                  {l.rtl ? " (RTL)" : ""}
                </s-table-cell>
                <s-table-cell>{l.locale}</s-table-cell>
                <s-table-cell>
                  {l.primary ? t("languages.role.primary") : t("languages.role.additional")}
                </s-table-cell>
                <s-table-cell>
                  {l.published ? (
                    <s-badge tone="success">{t("common.state.published")}</s-badge>
                  ) : (
                    <s-badge>{t("languages.unpublished")}</s-badge>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading={t("languages.usage.heading")}>
        <s-paragraph>
          {t("languages.usage.count", {
            enabled: summary.enabledCount,
            max: MAX_ENABLED_LOCALES,
            published: summary.publishedCount,
          })}
        </s-paragraph>
        <s-paragraph>{t("languages.usage.source")}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
