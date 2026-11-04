/**
 * The store's languages (`/app/languages`, Settings › Tools): one row per
 * language, as the Content page's chips show them. The main language comes
 * first (the originals); every other language shows its flag, name, whether
 * customers see it (Visible / Hidden, as on its page) and whether the AI
 * translates into it, and the whole row opens its page, which says how far
 * it is (a language's figure is on the Overview, its page and Coverage).
 * Shopify decides which languages are added and published; the page's own
 * button leads there.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { MAX_ENABLED_LOCALES } from "../lib/locale-limits";
import { languagePath } from "../lib/language-categories";
import { shopBilling } from "../.server/billing/billing";
import { openShopTranslation } from "../.server/providers/shop-translation";
import { isEngineRouter } from "../.server/providers/engine-router";
import { aiLanguageCoverage } from "../.server/providers/language-support";
import { getShopSettings, textConsentTokens } from "../.server/settings/shop-settings";
import { ENGINE_NAMES, engineOfToken, type EngineId } from "../lib/engines";
import { chipName, chipOrder } from "../lib/content-language";
import { localeCountry } from "../lib/flags";
import { languageList } from "../lib/name-lists";
import { Flag } from "../components/Flag";
import { PLAIN_LIST, VisibilityBadge } from "../components/LanguageLayout";
import { ToolHeader, TOOLS_HREF } from "../components/ToolHeader";
import { Strong } from "../components/Type";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const summary = await fetchAndSyncShopLocales(admin, shop.id);
  // The operator's engines, or the shop's own keys on the Own key plan (each key's own language
  // list). Only the coverage below goes into the page's data, never the provider.
  const billing = await shopBilling(admin, shop);
  const t = await openShopTranslation(shop.id, billing);
  const provider = t.provider;
  const router = isEngineRouter(provider);
  // With several engines: what the shop's consent covers (before any consent, every engine in
  // use), so a language only an engine it hasn't allowed serves says so.
  const allowed = router ? textConsentTokens(await getShopSettings(shop.id), t.configured, t.payer).map(engineOfToken) : [];
  // Read from each engine's own list, never assumed.
  const coverageByLocale = await aiLanguageCoverage(provider, summary.locales.filter((l) => !l.primary).map((l) => l.locale), allowed);
  const ai = Object.fromEntries(Object.entries(coverageByLocale).map(([locale, c]) => [locale, c.state]));
  const aiEngine = Object.fromEntries(Object.entries(coverageByLocale).map(([locale, c]) => [locale, c.engine]));
  return { ...summary, ai, aiEngine, showEngine: router, singleEngine: router ? null : (provider?.id ?? null) };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Locale = Data["locales"][number];

/** "Not available …" for the engines in use: today's DeepL text, the one engine, or all of them. */
function unsupportedText(t: I18n["t"], showEngine: boolean, singleEngine: string | null): string {
  if (showEngine) return t("languages.ai.unsupportedAny");
  if (singleEngine === "azure" || singleEngine === "google") return t("languages.ai.unsupportedWith", { engine: ENGINE_NAMES[singleEngine] });
  return t("languages.ai.unsupported");
}

/** "AI translation: Available with DeepL" (or why not). */
function aiLine(data: Data, i18n: I18n, locale: string): string {
  const { t } = i18n;
  const state = data.ai[locale];
  const engine = data.aiEngine[locale] as EngineId | undefined;
  const value =
    state === "supported"
      ? [t("languages.ai.supported"), data.showEngine && engine ? t("languages.ai.with", { engine: ENGINE_NAMES[engine] }) : null].filter(Boolean).join(" ")
      : state === "needsConsent" && engine
        ? t("languages.ai.needsConsent", { engine: ENGINE_NAMES[engine] })
        : state === "unsupported"
          ? unsupportedText(t, data.showEngine, data.singleEngine)
          : t(`languages.ai.${state === "none" ? "none" : "unknown"}`);
  return `${t("languages.ai.label")}: ${value}`;
}

/** The row's grid: flag, name and lines, chevron. */
const ROW = "auto minmax(0, 1fr) auto";

function PrimaryRow({ language, i18n }: { language: Locale; i18n: I18n }) {
  return (
    <s-box padding="small-200 base" minBlockSize="64px">
      <s-stack direction="block" justifyContent="center" minBlockSize="48px">
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
          <Flag country={localeCountry(language.locale)} fallback={language.locale} size={28} />
          <s-stack direction="block" gap="small-500">
            <Strong>{chipName(i18n, language)}</Strong>
            <s-text color="subdued">{i18n.t("languages.primary.detail")}</s-text>
          </s-stack>
        </s-grid>
      </s-stack>
    </s-box>
  );
}

/** An additional language: the whole row opens its page; its words are its link's name, read in order. */
function LanguageRow({ language, data, i18n }: { language: Locale; data: Data; i18n: I18n }) {
  const { t } = i18n;
  const name = chipName(i18n, language);
  const detail = [aiLine(data, i18n, language.locale), language.rtl ? t("languages.rtl.short") : null].filter(Boolean).join(" · ");
  return (
    <s-clickable href={languagePath(language.locale)} padding="small-200 base" minBlockSize="64px">
      <s-grid gridTemplateColumns={ROW} gap="base" alignItems="center">
        <Flag country={localeCountry(language.locale)} fallback={language.locale} size={28} />
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <Strong>{name}</Strong>
            <VisibilityBadge published={language.published} i18n={i18n} />
          </s-stack>
          <s-text color="subdued">{detail}</s-text>
        </s-stack>
        <s-icon type="chevron-right" color="subdued" />
      </s-grid>
    </s-clickable>
  );
}

export default function Languages() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const hasRtl = data.locales.some((l) => l.rtl);
  const primary = data.locales.find((l) => l.primary) ?? null;
  // Visible ones first, each group by its name in the interface language (as Content's chips).
  const additional = chipOrder(i18n, data.locales.filter((l) => !l.primary));
  // Languages only a translation service the shop hasn't allowed translates: the way to allow it, once.
  const waiting = additional.filter((l) => data.ai[l.locale] === "needsConsent" && data.aiEngine[l.locale]);

  return (
    <s-page heading={t("common.languages")}>
      <s-link slot="breadcrumb-actions" href={TOOLS_HREF}>
        {t("settings.tools.heading")}
      </s-link>
      <s-button slot="primary-action" href="shopify://admin/settings/languages" target="_top">
        {t("languages.manage")}
      </s-button>

      <s-stack direction="block" gap="base">
        {/* A tools page: the trail back to Settings › Tools (a 44 px back row on a phone), its tile's sign. */}
        <ToolHeader tool="languages" title={t("common.languages")} lead={t("languages.subtitle")} i18n={i18n} />

        {data.remainingEnabled === 0 ? (
          <s-banner tone="warning" heading={t("languages.limit.heading")}>
            <s-paragraph>{t("languages.limit.body", { max: MAX_ENABLED_LOCALES })}</s-paragraph>
          </s-banner>
        ) : null}

        {hasRtl ? (
          <s-banner tone="info" heading={t("languages.rtl.heading")}>
            <s-paragraph>{t("languages.rtl.body")}</s-paragraph>
          </s-banner>
        ) : null}

        {waiting.length ? (
          <s-banner tone="info" heading={t("languages.consent.heading")}>
            <s-paragraph>
              {t("languages.consent.body", { languages: languageList(i18n, waiting.map((l) => chipName(i18n, l))) })}{" "}
              <s-link href="/app/settings?section=ai">{t("languages.ai.settingsLink")}</s-link>
            </s-paragraph>
          </s-banner>
        ) : null}

        <s-section padding="none">
          <s-query-container>
            <ul aria-label={t("common.languages")} style={PLAIN_LIST}>
              {primary ? (
                <li>
                  <PrimaryRow language={primary} i18n={i18n} />
                </li>
              ) : null}
              {additional.map((language, i) => (
                <li key={language.locale}>
                  {primary || i > 0 ? <s-divider /> : null}
                  <LanguageRow language={language} data={data} i18n={i18n} />
                </li>
              ))}
            </ul>
          </s-query-container>
        </s-section>
      </s-stack>

      <s-section slot="aside" heading={t("languages.usage.heading")}>
        <s-paragraph>
          {t("languages.usage.count", {
            enabled: data.enabledCount,
            max: MAX_ENABLED_LOCALES,
            published: data.publishedCount,
          })}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
