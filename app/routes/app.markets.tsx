import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { analyzeMarkets, fetchMarkets, MARKETS_SCOPE, MarketsAccessError, type MarketFinding } from "../.server/markets/markets";
import { requireShop } from "../.server/shopify/require-shop";

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

function findingText(f: MarketFinding, name: (locale: string) => string) {
  switch (f.code) {
    case "UNPUBLISHED_LOCALE":
      return `${f.market} offers ${name(f.locale)}, but the language isn't published, so customers see the default language. Publish it under Languages.`;
    case "LOCALE_IN_NO_MARKET":
      return `${name(f.locale)} is published, but no active market offers it, so no storefront address serves it. Add it to a market in Shopify.`;
    case "LOCALE_NOT_IN_PLAN":
      return `${name(f.locale)} is offered in a market, but your plan doesn't include AI translation into it.`;
    case "NO_WEB_PRESENCE":
      return `${f.market} has no domain or subfolder of its own; customers reach it through your primary domain and the country selector.`;
  }
}

export default function Markets() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  if (!data.access) {
    return (
      <s-page heading="Markets">
        <s-section heading="See your languages per market">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Linguva can show which languages each of your markets offers, under which web address, and what
              stops customers from seeing your translations. For this, Linguva needs permission to read your
              markets. It never changes them.
            </s-paragraph>
            <fetcher.Form method="post">
              <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
                Allow reading markets
              </s-button>
            </fetcher.Form>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const name = (locale: string) => data.names[locale] ?? locale;
  return (
    <s-page heading="Markets">
      <s-section heading="Checks">
        {data.findings.length ? (
          <s-stack direction="block" gap="small">
            {data.findings.map((f, i) => (
              <s-banner key={i} tone={f.code === "NO_WEB_PRESENCE" || f.code === "LOCALE_NOT_IN_PLAN" ? "info" : "warning"}>
                <s-paragraph>{findingText(f, name)}</s-paragraph>
              </s-banner>
            ))}
          </s-stack>
        ) : (
          <s-paragraph>
            <s-badge tone="success">No problems found</s-badge> Every published language is offered in a market.
          </s-paragraph>
        )}
        <s-paragraph>
          How complete each language is: see <s-link href="/app/coverage">Coverage</s-link>.
        </s-paragraph>
      </s-section>

      {data.markets.map((market) => (
        <s-section key={market.id} heading={market.name}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {market.status === "ACTIVE" ? <s-badge tone="success">Active</s-badge> : <s-badge>{market.status.toLowerCase()}</s-badge>}
            </s-paragraph>
            {market.webPresences.length === 0 ? (
              <s-paragraph>Uses your primary domain.</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Language</s-table-header>
                  <s-table-header>Address</s-table-header>
                  <s-table-header>Status</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {market.webPresences.flatMap((wp) =>
                    [wp.defaultLocale, ...wp.alternateLocales].map((l) => (
                      <s-table-row key={`${wp.id}:${l.locale}`}>
                        <s-table-cell>
                          {l.name}
                          {l.locale === wp.defaultLocale.locale ? " (default)" : ""}
                        </s-table-cell>
                        <s-table-cell>
                          {wp.rootUrls.find((u) => u.locale === l.locale)?.url ?? (wp.host ?? "—")}
                        </s-table-cell>
                        <s-table-cell>
                          {l.published ? <s-badge tone="success">Published</s-badge> : <s-badge tone="warning">Not published</s-badge>}
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
