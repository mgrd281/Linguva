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

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  useAdminLoadingBar();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/languages">Languages</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/collections">Collections</s-link>
        <s-link href="/app/pages">Pages</s-link>
        <s-link href="/app/articles">Blog posts</s-link>
        <s-link href="/app/blogs">Blogs</s-link>
        <s-link href="/app/coverage">Coverage</s-link>
        <s-link href="/app/markets">Markets</s-link>
        <s-link href="/app/jobs">Translation jobs</s-link>
        <s-link href="/app/review">Review</s-link>
        <s-link href="/app/glossary">Glossary</s-link>
        <s-link href="/app/memory">Translation memory</s-link>
        <s-link href="/app/plan">Plan</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// Other errors of the app shell get a clear page (Polaris still loads through AppProvider).
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("routes/app");
  if (isShopifyAuthResponse(error)) return boundary.error(error);
  return (
    <AppProvider apiKey={data && "apiKey" in data ? data.apiKey : ""}>
      <RouteErrorContent error={error} />
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
