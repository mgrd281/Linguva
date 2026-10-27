import { randomUUID } from "node:crypto";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import {
  listTranslatableProducts,
  numericId,
} from "../.server/shopify/translations-api";
import { summarizeCoverage } from "../lib/coverage";
import { getTranslationProvider } from "../.server/providers";
import { getQueues } from "../.server/queue/client";
import {
  BackgroundJobsUnavailableError,
  startBulkJob,
} from "../.server/jobs/start-job";
import { getShopSettings, hasCurrentAiConsent } from "../.server/settings/shop-settings";

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
    bulk: {
      publishMode: (await getShopSettings(shop.id)).bulkPublishMode,
      // One key per page view: a double submit creates only one job.
      idempotencyKey: randomUUID(),
      available: getTranslationProvider() !== null && getQueues() !== null,
      consent: hasCurrentAiConsent(await getShopSettings(shop.id)),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") !== "bulk-translate") return { error: "UNKNOWN_INTENT" };

  // The target must be one of the shop's own additional languages.
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const locale = String(form.get("locale") ?? "");
  if (!locales.locales.some((l) => !l.primary && l.locale === locale)) {
    return { error: "UNKNOWN_LOCALE" };
  }
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) return { error: "INVALID_REQUEST" };

  try {
    const { job } = await startBulkJob({
      shopId: shop.id,
      resourceType: "PRODUCT",
      targetLocale: locale,
      requestedBy: actorId,
      idempotencyKey,
      overwriteProtected: form.get("overwriteProtected") === "on",
    });
    return redirect(`/app/jobs/${job.id}`);
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
};

export default function Products() {
  const data = useLoaderData<typeof loader>();
  const bulk = useFetcher<typeof action>();

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
  const bulkError = bulk.data && "error" in bulk.data ? bulk.data.error : null;

  return (
    <s-page heading="Products">

      {data.bulk.available && !data.bulk.consent ? (
        <s-banner tone="info" heading="Allow AI processing to translate in bulk">
          <s-paragraph>
            Bulk translation uses AI. Allow it under <s-link href="/app/settings">Settings</s-link> first.
          </s-paragraph>
        </s-banner>
      ) : null}
      {bulkError ? (
        <s-banner tone="critical" heading="Bulk translation couldn't start">
          <s-paragraph>
            {bulkError === "JOBS_UNAVAILABLE"
              ? "Background processing isn't configured for this app yet."
              : "Please reload the page and try again."}
          </s-paragraph>
        </s-banner>
      ) : null}
      <s-section>
        <s-stack direction="block" gap="small">
          <s-paragraph>
            Bulk translation fills in missing and outdated fields only. Your
            glossary and translation memory are applied. Up-to-date
            translations are never touched, and outdated translations that you
            wrote or approved are kept unless you allow replacing them below.
          </s-paragraph>
          <s-paragraph>
            {data.bulk.publishMode === "AUTO_PUBLISH"
              ? "Automatic publishing is on: results that pass the quality checks go live immediately."
              : "Results wait in Review until you approve them."}
          </s-paragraph>
          <bulk.Form method="post">
            <input type="hidden" name="intent" value="bulk-translate" />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="idempotencyKey" value={data.bulk.idempotencyKey} />
            <s-stack direction="block" gap="small">
              <s-checkbox
                name="overwriteProtected"
                label="Also replace outdated translations that were written or approved by a person"
              />
              <s-button
                type="submit"
                variant="primary"
                disabled={!data.bulk.available || !data.bulk.consent}
                {...(bulk.state !== "idle" ? { loading: true } : {})}
              >
                Translate all into {data.target.name}
              </s-button>
            </s-stack>
          </bulk.Form>
        </s-stack>
      </s-section>
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
