import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { MAX_ENABLED_LOCALES } from "../lib/locale-limits";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return fetchAndSyncShopLocales(admin, shop.id);
};

export default function Languages() {
  const summary = useLoaderData<typeof loader>();
  const hasRtl = summary.locales.some((l) => l.rtl);

  return (
    <s-page heading="Languages">
      <s-button
        slot="primary-action"
        href="shopify://admin/settings/languages"
        target="_top"
      >
        Manage in Shopify
      </s-button>

      {summary.remainingEnabled === 0 ? (
        <s-banner tone="warning" heading="Language limit reached">
          <s-paragraph>
            Shopify allows up to {MAX_ENABLED_LOCALES} languages per store.
            Remove a language before adding another.
          </s-paragraph>
        </s-banner>
      ) : null}

      {hasRtl ? (
        <s-banner tone="info" heading="Right-to-left language enabled">
          <s-paragraph>
            Check that your theme supports right-to-left layouts before you
            publish these languages.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Language</s-table-header>
            <s-table-header>Code</s-table-header>
            <s-table-header>Role</s-table-header>
            <s-table-header>Storefront</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {summary.locales.map((l) => (
              <s-table-row key={l.locale}>
                <s-table-cell>
                  {l.name}
                  {l.rtl ? " (RTL)" : ""}
                </s-table-cell>
                <s-table-cell>{l.locale}</s-table-cell>
                <s-table-cell>
                  {l.primary ? "Primary" : "Additional"}
                </s-table-cell>
                <s-table-cell>
                  {l.published ? (
                    <s-badge tone="success">Published</s-badge>
                  ) : (
                    <s-badge>Unpublished</s-badge>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="Usage">
        <s-paragraph>
          {summary.enabledCount} of {MAX_ENABLED_LOCALES} languages enabled,{" "}
          {summary.publishedCount} published.
        </s-paragraph>
        <s-paragraph>
          Shopify is the source of truth for which languages are enabled and
          published. This list is read from your store each time you open it.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
