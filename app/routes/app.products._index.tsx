import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import {
  listTranslatableProducts,
  numericId,
} from "../.server/shopify/translations-api";
import { summarizeCoverage } from "../lib/coverage";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const targets = locales.locales.filter((l) => !l.primary);

  const requested = url.searchParams.get("locale");
  const target = targets.find((l) => l.locale === requested) ?? targets[0];
  if (!target) {
    return { targets: [], target: null, products: [], nextCursor: null, isFirstPage: true };
  }

  const after = url.searchParams.get("after");
  const { resources, pageInfo } = await listTranslatableProducts(admin, {
    locale: target.locale,
    after,
    first: 25,
  });

  return {
    targets: targets.map((l) => ({ locale: l.locale, name: l.name })),
    target: { locale: target.locale, name: target.name },
    products: resources.map((r) => ({
      id: numericId(r.resourceId),
      title: r.content.find((c) => c.key === "title")?.value ?? "(untitled)",
      ...summarizeCoverage(r.content, r.translations),
    })),
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    isFirstPage: !after,
  };
};

export default function Products() {
  const data = useLoaderData<typeof loader>();

  if (!data.target) {
    return (
      <s-page heading="Products">
        <s-section heading="No languages to translate into">
          <s-paragraph>
            Add a language under Settings → Languages in the Shopify admin to
            start translating your products.
          </s-paragraph>
          <s-button href="shopify://admin/settings/languages" target="_top">
            Open language settings
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const locale = data.target.locale;

  return (
    <s-page heading="Products">
      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text>Translate into:</s-text>
          {data.targets.map((t) =>
            t.locale === locale ? (
              <s-badge key={t.locale} tone="info">
                {t.name}
              </s-badge>
            ) : (
              <s-link key={t.locale} href={`/app/products?locale=${encodeURIComponent(t.locale)}`}>
                {t.name}
              </s-link>
            ),
          )}
        </s-stack>
      </s-section>

      <s-section padding="none">
        {data.products.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No products found.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Translated fields</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.products.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-link href={`/app/products/${p.id}?locale=${encodeURIComponent(locale)}`}>
                      {p.title}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {p.outdated > 0 ? (
                      <s-badge tone="warning">Outdated</s-badge>
                    ) : p.translated === p.total ? (
                      <s-badge tone="success">Translated</s-badge>
                    ) : p.translated > 0 ? (
                      <s-badge tone="info">Partial</s-badge>
                    ) : (
                      <s-badge>Not translated</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {p.translated} / {p.total}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-stack direction="inline" gap="base">
        {!data.isFirstPage ? (
          <s-button href={`/app/products?locale=${encodeURIComponent(locale)}`}>First page</s-button>
        ) : null}
        {data.nextCursor ? (
          <s-button
            href={`/app/products?locale=${encodeURIComponent(locale)}&after=${encodeURIComponent(data.nextCursor)}`}
          >
            Next page
          </s-button>
        ) : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
