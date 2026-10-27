/**
 * List of translatable resources (products, collections) with coverage
 * per language and bulk translation. See .server/translation/resource-list.
 */
import { useFetcher, useLoaderData } from "react-router";
import type { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";

type ListLoader = () => ReturnType<typeof loadResourceList>;
type ListAction = () => ReturnType<typeof runResourceListAction>;

export function ResourceList() {
  const data = useLoaderData<ListLoader>();
  const bulk = useFetcher<ListAction>();

  if (!data.target || !data.bulk) {
    return (
      <s-page heading={data.kind.label}>
        <s-section heading="No languages to translate into">
          <s-paragraph>
            Add a language under Settings → Languages in the Shopify admin to
            start translating your {data.kind.plural}.
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
    <s-page heading={data.kind.label}>
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
              ? "Automatic publishing is on: results that pass the quality checks go live immediately; results with warnings wait in Review."
              : "Results wait in Review until you approve them."}
          </s-paragraph>
          <bulk.Form method="post">
            <input type="hidden" name="intent" value="bulk-translate" />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="idempotencyKey" value={data.bulk.idempotencyKey} />
            <s-stack direction="block" gap="small">
              <s-select name="fieldScope" label="What to translate">
                <s-option value="ALL">All fields</s-option>
                <s-option value="SEO">Only search engine listings (SEO title and description)</s-option>
              </s-select>
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
              <s-link key={t.locale} href={`${data.kind.path}?locale=${encodeURIComponent(t.locale)}`}>
                {t.name}
              </s-link>
            ),
          )}
        </s-stack>
      </s-section>

      <s-section padding="none">
        {data.items.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No {data.kind.plural} found.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{data.kind.label}</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Translated fields</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.items.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-link href={`${data.kind.path}/${p.id}?locale=${encodeURIComponent(locale)}`}>
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
          <s-button href={`${data.kind.path}?locale=${encodeURIComponent(locale)}`}>First page</s-button>
        ) : null}
        {data.nextCursor ? (
          <s-button
            href={`${data.kind.path}?locale=${encodeURIComponent(locale)}&after=${encodeURIComponent(data.nextCursor)}`}
          >
            Next page
          </s-button>
        ) : null}
      </s-stack>
    </s-page>
  );
}

