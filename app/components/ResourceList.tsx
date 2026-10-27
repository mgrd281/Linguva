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
  const permission = useFetcher();

  if (data.denied) {
    return (
      <s-page heading={data.kind.label}>
        <s-section heading={`Allow Linguva to read your ${data.kind.plural}`}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {data.denied.scope
                ? `To translate ${data.kind.plural}, Linguva needs permission to read them. It never changes the originals.`
                : `Shopify doesn't allow apps to read ${data.kind.plural} in this store yet.`}
            </s-paragraph>
            {data.denied.scope ? (
              <permission.Form method="post" action="/app/content">
                <input type="hidden" name="intent" value="request-scope" />
                <input type="hidden" name="scope" value={data.denied.scope} />
                <s-button type="submit" variant="primary" {...(permission.state !== "idle" ? { loading: true } : {})}>
                  Allow access
                </s-button>
              </permission.Form>
            ) : null}
            <s-link href="/app/content">Back to all content</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

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
              : bulkError === "PLAN_BULK" || bulkError === "PLAN_LANGUAGE"
                ? "Your plan doesn't include this. See Plan to change it."
                : "Please reload the page and try again."}
          </s-paragraph>
        </s-banner>
      ) : null}
      {!data.bulk.planAllowsBulk || !data.bulk.planAllowsLocale ? (
        <s-banner tone="info" heading={!data.bulk.planAllowsBulk ? "Bulk translation is part of paid plans" : `Your plan doesn't include ${data.target.name}`}>
          <s-paragraph>
            You can still translate {data.kind.plural} one by one in the editor. <s-link href="/app/plan">See plans</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}
      {data.kind.caution ? (
        <s-banner tone="warning" heading={data.kind.caution === "legal" ? "Legal texts" : "Templates with Liquid code"}>
          <s-paragraph>
            {data.kind.caution === "legal"
              ? "Have every translation checked by someone qualified before publishing. They are translated one by one, with review."
              : "Only visible text is translated; Liquid code is kept as is. They are translated one by one, with review."}
          </s-paragraph>
        </s-banner>
      ) : null}
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

      {data.kind.bulk ? (
        <s-section heading={`Translate all ${data.kind.plural}`}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Fills in missing and outdated fields with AI, using your glossary and translation memory. Up-to-date
              translations are never touched; outdated ones that a person wrote or approved are kept unless you
              allow replacing them.{" "}
              {data.bulk.publishMode === "AUTO_PUBLISH"
                ? "Automatic publishing is on: results that pass the quality checks go live immediately; results with warnings wait in Review."
                : "Results wait in Review until you approve them."}
            </s-paragraph>
            <bulk.Form method="post">
              <input type="hidden" name="intent" value="bulk-translate" />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="idempotencyKey" value={data.bulk.idempotencyKey} />
              <s-stack direction="block" gap="base">
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base" alignItems="end">
                    <s-select name="fieldScope" label="What to translate">
                      <s-option value="ALL">All fields</s-option>
                      <s-option value="SEO">Only search engine listings (SEO title and description)</s-option>
                    </s-select>
                    <s-checkbox
                      name="overwriteProtected"
                      label="Also replace outdated translations that a person wrote or approved"
                    />
                  </s-grid>
                </s-query-container>
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!data.bulk.available || !data.bulk.consent || !data.bulk.planAllowsBulk || !data.bulk.planAllowsLocale}
                  {...(bulk.state !== "idle" ? { loading: true } : {})}
                >
                  Translate all into {data.target.name}
                </s-button>
              </s-stack>
            </bulk.Form>
          </s-stack>
        </s-section>
      ) : null}
      <s-section padding="none">
        {data.items.length === 0 ? (
          <s-box padding="large">
            <s-stack direction="block" gap="small" alignItems="center">
              <s-heading>No {data.kind.plural} yet</s-heading>
              <s-paragraph>
                {data.kind.label} you create in Shopify appear here, ready to translate into {data.targets.find((t) => t.locale === locale)?.name ?? "your languages"}.
              </s-paragraph>
            </s-stack>
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

