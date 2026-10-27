import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { MAX_ENABLED_LOCALES } from "../lib/locale-limits";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const locales = await fetchAndSyncShopLocales(admin, shop.id);

  return {
    shopName: shop.name ?? shop.shopDomain,
    installedAt: shop.installedAt.toISOString(),
    primary: locales.primary?.name ?? null,
    enabledCount: locales.enabledCount,
    publishedCount: locales.publishedCount,
    unpublished: locales.locales
      .filter((l) => !l.primary && !l.published)
      .map((l) => l.name),
  };
};

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const additional = data.enabledCount - 1;

  return (
    <s-page heading="Overview">
      <s-section heading={data.shopName}>
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Primary language</s-text>
            <s-heading>{data.primary ?? "Unknown"}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Languages enabled</s-text>
            <s-heading>
              {data.enabledCount} / {MAX_ENABLED_LOCALES}
            </s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Published on storefront</s-text>
            <s-heading>{data.publishedCount}</s-heading>
          </s-stack>
        </s-stack>
      </s-section>

      {additional === 0 ? (
        <s-section heading="Add a language to get started">
          <s-paragraph>
            Your store only has its primary language. Add the languages you
            want to sell in under Settings → Languages in the Shopify admin,
            then come back here to translate your content.
          </s-paragraph>
          <s-button href="shopify://admin/settings/languages" target="_top">
            Open language settings
          </s-button>
        </s-section>
      ) : null}

      {data.unpublished.length > 0 ? (
        <s-banner tone="info" heading="Languages not yet published">
          <s-paragraph>
            {data.unpublished.join(", ")}{" "}
            {data.unpublished.length === 1 ? "is" : "are"} enabled but not
            visible to customers yet. Publish them when the translations are
            ready.
          </s-paragraph>
        </s-banner>
      ) : null}

      {additional > 0 ? (
        <s-section heading="How complete are your translations?">
          <s-paragraph>
            The coverage report shows, per language, what is translated, missing or outdated, including search engine
            listings.
          </s-paragraph>
          <s-button href="/app/coverage">Open coverage report</s-button>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Installation">
        <s-paragraph>
          Installed on{" "}
          {new Date(data.installedAt).toLocaleDateString(undefined, {
            dateStyle: "long",
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
