import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Outlet, useLoaderData, useNavigation, useRouteError, useRouteLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { getConfig } from "../.server/lib/config";
import { planSelectionUrl } from "../lib/plans";
import { isShopifyAuthResponse, RouteErrorContent } from "../components/RouteError";
import { I18nProvider, useAppLocale, useI18n } from "../i18n/react";

/** The admin's loading bar while a page loads or a form submits (App Bridge). */
function useAdminLoadingBar() {
  const busy = useNavigation().state !== "idle";
  useEffect(() => {
    window.shopify?.loading?.(busy);
  }, [busy]);
}

// Pages a shop without a subscription may still open.
const PLAN_FREE_PATHS = ["/app/plan", "/app/welcome"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, redirect } = await requireShop(request);
  const billing = await shopBilling(admin, shop);
  const path = new URL(request.url).pathname;
  if (billing.mustChoosePlan && !PLAN_FREE_PATHS.includes(path)) {
    const appHandle = getConfig().SHOPIFY_APP_HANDLE!;
    return redirect(planSelectionUrl(shop.shopDomain, appHandle), { target: "_top" });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function AppNav() {
  const { t } = useI18n();
  return (
    <s-app-nav>
      <s-link href="/app">{t("common.nav.overview")}</s-link>
      <s-link href="/app/products">{t("common.nav.products")}</s-link>
      <s-link href="/app/collections">{t("common.nav.collections")}</s-link>
      <s-link href="/app/content">{t("common.nav.content")}</s-link>
      <s-link href="/app/review">{t("common.nav.review")}</s-link>
      <s-link href="/app/jobs">{t("common.nav.jobs")}</s-link>
      <s-link href="/app/coverage">{t("common.nav.coverage")}</s-link>
      <s-link href="/app/markets">{t("common.nav.markets")}</s-link>
      <s-link href="/app/glossary">{t("common.nav.glossary")}</s-link>
      <s-link href="/app/memory">{t("common.nav.memory")}</s-link>
      <s-link href="/app/plan">{t("common.nav.plan")}</s-link>
      <s-link href="/app/settings">{t("common.nav.settings")}</s-link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const locale = useAppLocale();
  useAdminLoadingBar();

  return (
    <AppProvider apiKey={apiKey}>
      <I18nProvider locale={locale}>
        <AppNav />
        <Outlet />
      </I18nProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// Other errors of the app shell get a clear page (Polaris still loads through AppProvider).
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("routes/app");
  const locale = useAppLocale();
  if (isShopifyAuthResponse(error)) return boundary.error(error);
  return (
    <AppProvider apiKey={data && "apiKey" in data ? data.apiKey : ""}>
      <I18nProvider locale={locale}>
        <RouteErrorContent error={error} />
      </I18nProvider>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
