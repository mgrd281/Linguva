import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { analyzeMarkets, fetchMarkets, MARKETS_SCOPE, MarketsAccessError, type MarketFinding } from "../.server/markets/markets";
import { requireShop } from "../.server/shopify/require-shop";
import type { I18n } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const granted = (await scopes.query()).granted.includes(MARKETS_SCOPE);
  if (!granted) return { access: false as const };
  try {
    const [markets, locales, billing] = await Promise.all([
      fetchMarkets(admin),
      fetchAndSyncShopLocales(admin, shop.id),
      shopBilling(admin, shop),
    ]);
    const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
    const planLocales = billing.configured ? allowedTargetLocales(billing.entitlements, targets) : null;
    return {
      access: true as const,
      markets,
      names: Object.fromEntries(locales.locales.map((l) => [l.locale, l.name])),
      findings: analyzeMarkets(markets, locales.locales, planLocales),
    };
  } catch (error) {
    // The merchant revoked the scope since it was granted.
    if (error instanceof MarketsAccessError) return { access: false as const };
    throw error;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { scopes } = await requireShop(request);
  // Redirects to Shopify's grant screen; returns if already granted.
  await scopes.request([MARKETS_SCOPE]);
  return { ok: true };
};

function findingText(f: MarketFinding, name: (locale: string) => string, t: I18n["t"]) {
  switch (f.code) {
    case "UNPUBLISHED_LOCALE":
      return t("markets.finding.UNPUBLISHED_LOCALE", { market: f.market, language: name(f.locale) });
    case "LOCALE_IN_NO_MARKET":
      return t("markets.finding.LOCALE_IN_NO_MARKET", { language: name(f.locale) });
    case "LOCALE_NOT_IN_PLAN":
      return t("markets.finding.LOCALE_NOT_IN_PLAN", { language: name(f.locale) });
    case "NO_WEB_PRESENCE":
      return t("markets.finding.NO_WEB_PRESENCE", { market: f.market });
  }
}

/** Shopify's market status ("draft"), in the language when known. */
function statusLabel(status: string, t: I18n["t"]) {
  const key = `markets.market.status.${status}`;
  return hasMessage(key) ? t(key) : status.toLowerCase();
}

export default function Markets() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t } = useI18n();

  if (!data.access) {
    return (
      <s-page heading={t("common.nav.markets")}>
        <s-section heading={t("markets.access.heading")}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("markets.access.body")}</s-paragraph>
            <fetcher.Form method="post">
              <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                {t("markets.access.allow")}
              </s-button>
            </fetcher.Form>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const name = (locale: string) => data.names[locale] ?? locale;
  return (
    <s-page heading={t("common.nav.markets")}>
      <s-section heading={t("markets.checks.heading")}>
        {data.findings.length ? (
          <s-stack direction="block" gap="small">
            {data.findings.map((f, i) => (
              <s-banner key={i} tone={f.code === "NO_WEB_PRESENCE" || f.code === "LOCALE_NOT_IN_PLAN" ? "info" : "warning"}>
                <s-paragraph>{findingText(f, name, t)}</s-paragraph>
              </s-banner>
            ))}
          </s-stack>
        ) : (
          <s-paragraph>
            <s-badge tone="success">{t("markets.checks.none")}</s-badge> {t("markets.checks.allOffered")}
          </s-paragraph>
        )}
        <s-paragraph>
          {t("markets.checks.coverageBefore")} <s-link href="/app/coverage">{t("markets.checks.coverageLink")}</s-link>
          {t("markets.checks.coverageAfter")}
        </s-paragraph>
      </s-section>

      {data.markets.map((market) => (
        <s-section key={market.id} heading={market.name}>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              {market.status === "ACTIVE" ? (
                <s-badge tone="success">{t("markets.market.active")}</s-badge>
              ) : (
                <s-badge>{statusLabel(market.status, t)}</s-badge>
              )}
              <s-text color="subdued">{t("markets.market.number", { id: market.id.replace("gid://shopify/Market/", "") })}</s-text>
            </s-stack>
            {market.webPresences.length === 0 ? (
              <s-paragraph>{t("markets.market.primaryDomain")}</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>{t("common.language")}</s-table-header>
                  <s-table-header>{t("markets.market.address")}</s-table-header>
                  <s-table-header>{t("common.status")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {market.webPresences.flatMap((wp) =>
                    [wp.defaultLocale, ...wp.alternateLocales].map((l) => (
                      <s-table-row key={`${wp.id}:${l.locale}`}>
                        <s-table-cell>
                          {l.name}
                          {l.locale === wp.defaultLocale.locale ? ` (${t("markets.market.default")})` : ""}
                        </s-table-cell>
                        <s-table-cell>
                          {wp.rootUrls.find((u) => u.locale === l.locale)?.url ?? (wp.host ?? "—")}
                        </s-table-cell>
                        <s-table-cell>
                          {l.published ? (
                            <s-badge tone="success">{t("common.state.published")}</s-badge>
                          ) : (
                            <s-badge tone="warning">{t("common.state.notPublished")}</s-badge>
                          )}
                        </s-table-cell>
                      </s-table-row>
                    )),
                  )}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
