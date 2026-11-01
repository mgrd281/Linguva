import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { MAX_ENABLED_LOCALES } from "../lib/locale-limits";
import { languagePath } from "../lib/language-categories";
import { getTranslationProvider } from "../.server/providers";
import { isEngineRouter } from "../.server/providers/engine-router";
import { aiLanguageCoverage } from "../.server/providers/language-support";
import { getShopSettings, textConsentTokens } from "../.server/settings/shop-settings";
import { ENGINE_NAMES, engineOfToken, type EngineId } from "../lib/engines";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const summary = await fetchAndSyncShopLocales(admin, shop.id);
  const provider = getTranslationProvider();
  const router = isEngineRouter(provider);
  // With several engines: what the shop's consent covers (before any consent, every engine in
  // use), so a language only an engine it hasn't allowed serves says so.
  const allowed = router ? textConsentTokens(await getShopSettings(shop.id)).map(engineOfToken) : [];
  // Read from each engine's own list, never assumed.
  const coverage = await aiLanguageCoverage(provider, summary.locales.filter((l) => !l.primary).map((l) => l.locale), allowed);
  const ai = Object.fromEntries(Object.entries(coverage).map(([locale, c]) => [locale, c.state]));
  const aiEngine = Object.fromEntries(Object.entries(coverage).map(([locale, c]) => [locale, c.engine]));
  return { ...summary, ai, aiEngine, showEngine: router, singleEngine: router ? null : (provider?.id ?? null) };
};

/** "Not available …" for the engines in use: today's DeepL text, the one engine, or all of them. */
function unsupportedText(t: ReturnType<typeof useI18n>["t"], showEngine: boolean, singleEngine: string | null): string {
  if (showEngine) return t("languages.ai.unsupportedAny");
  if (singleEngine === "azure" || singleEngine === "google") return t("languages.ai.unsupportedWith", { engine: ENGINE_NAMES[singleEngine] });
  return t("languages.ai.unsupported");
}

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
            <s-table-header>{t("languages.table.ai")}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {summary.locales.map((l) => (
              <s-table-row key={l.locale}>
                <s-table-cell>
                  {/* An additional language opens its own page; the primary one holds the originals. */}
                  {l.primary ? language(l.locale, l.name) : <s-link href={languagePath(l.locale)}>{language(l.locale, l.name)}</s-link>}
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
                <s-table-cell>
                  {l.primary ? (
                    "—"
                  ) : summary.ai[l.locale] === "supported" ? (
                    <>
                      <s-badge tone="success">{t("languages.ai.supported")}</s-badge>
                      {summary.showEngine && summary.aiEngine[l.locale] ? (
                        <s-text color="subdued"> {t("languages.ai.with", { engine: ENGINE_NAMES[summary.aiEngine[l.locale] as EngineId] })}</s-text>
                      ) : null}
                    </>
                  ) : summary.ai[l.locale] === "needsConsent" && summary.aiEngine[l.locale] ? (
                    // Only an engine the shop hasn't allowed serves it: every job item would wait for consent.
                    <s-text color="subdued">
                      {t("languages.ai.needsConsent", { engine: ENGINE_NAMES[summary.aiEngine[l.locale] as EngineId] })}{" "}
                      <s-link href="/app/settings">{t("languages.ai.settingsLink")}</s-link>
                    </s-text>
                  ) : summary.ai[l.locale] === "unsupported" ? (
                    <s-text color="subdued">{unsupportedText(t, summary.showEngine, summary.singleEngine)}</s-text>
                  ) : (
                    <s-text color="subdued">{t(`languages.ai.${summary.ai[l.locale] === "none" ? "none" : "unknown"}`)}</s-text>
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
