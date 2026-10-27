import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { getConfig } from "../.server/lib/config";
import { planSelectionUrl } from "../lib/plans";

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
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
