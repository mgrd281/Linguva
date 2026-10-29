import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Fragment, type ReactNode } from "react";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { AUTO_REQUESTED_BY, listJobsPage } from "../.server/jobs/bulk-jobs";
import { SMART_REQUESTED_BY } from "../lib/smart-auto";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { jobProgress } from "../lib/job-display";
import { RESOURCE_KINDS } from "../lib/resource-kinds";
import { useI18n } from "../i18n/react";
import { jobStatus, kindLabel } from "../i18n/labels";
import { ALL, chosen } from "../lib/select-all";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const q = (name: string) => chosen(url.searchParams.get(name));
  const filter = { status: q("status"), locale: q("lang"), resourceType: q("type") };
  const page = await listJobsPage(shop.id, { ...filter, cursor: q("after"), take: 25 });
  const locales = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary);
  return {
    filter,
    locales: locales.map((l) => ({ locale: l.locale, name: l.name })),
    nextCursor: page.nextCursor,
    isFirstPage: !q("after"),
    jobs: page.jobs.map((j) => ({
      id: j.id,
      targetLocale: j.targetLocale,
      // Named in the interface language (also a smart check's images and custom fields).
      type: j.resourceType,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      automatic: j.requestedBy === AUTO_REQUESTED_BY,
      smart: j.requestedBy === SMART_REQUESTED_BY,
      progress: jobProgress(j),
    })),
  };
};

/** A text whose {placeholders} are replaced by elements (e.g. links). */
function withElements(text: string, elements: Record<string, ReactNode>): ReactNode {
  return text.split(/\{(\w+)\}/).map((part, i) => <Fragment key={i}>{i % 2 ? (elements[part] ?? `{${part}}`) : part}</Fragment>);
}

export default function Jobs() {
  const { jobs, filter, locales, nextCursor, isFirstPage } = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const languageName = (code: string) => i18n.language(code, locales.find((l) => l.locale === code)?.name);
  const filtered = Boolean(filter.status || filter.locale || filter.resourceType);
  const pageHref = (after: string | null) => {
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.locale) params.set("lang", filter.locale);
    if (filter.resourceType) params.set("type", filter.resourceType);
    if (after) params.set("after", after);
    const query = params.toString();
    return query ? `/app/jobs?${query}` : "/app/jobs";
  };

  return (
    <s-page heading={t("jobs.list.heading")}>
      <s-section>
        <Form method="get">
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 400px) 1fr 1fr, (inline-size > 640px) 1fr 1fr 1fr auto, 1fr" gap="base" alignItems="end">
              <s-select name="status" label={t("common.status")} value={filter.status ?? ALL}>
                <s-option value={ALL}>{t("common.state.all")}</s-option>
                <s-option value="active">{t("jobs.filter.running")}</s-option>
                <s-option value="completed">{jobStatus(i18n, "COMPLETED").label}</s-option>
                <s-option value="failed">{jobStatus(i18n, "FAILED").label}</s-option>
                <s-option value="cancelled">{jobStatus(i18n, "CANCELLED").label}</s-option>
              </s-select>
              <s-select name="lang" label={t("common.language")} value={filter.locale ?? ALL}>
                <s-option value={ALL}>{t("common.allLanguages")}</s-option>
                {locales.map((l) => (
                  <s-option key={l.locale} value={l.locale}>
                    {i18n.language(l.locale, l.name)}
                  </s-option>
                ))}
              </s-select>
              <s-select name="type" label={t("common.contentType")} value={filter.resourceType ?? ALL}>
                <s-option value={ALL}>{t("common.state.all")}</s-option>
                {Object.keys(RESOURCE_KINDS).map((kind) => (
                  <s-option key={kind} value={kind}>
                    {kindLabel(i18n, kind)}
                  </s-option>
                ))}
              </s-select>
              <s-stack direction="inline" gap="small">
                <s-button type="submit">{t("jobs.filter.apply")}</s-button>
                {filtered ? (
                  <s-button href="/app/jobs" variant="tertiary">
                    {t("jobs.filter.clear")}
                  </s-button>
                ) : null}
              </s-stack>
            </s-grid>
          </s-query-container>
        </Form>
      </s-section>
      <s-section padding="none">
        {jobs.length === 0 && filtered ? (
          <s-box padding="base">
            <s-paragraph>{t("jobs.list.noMatches")}</s-paragraph>
          </s-box>
        ) : jobs.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              {withElements(t("jobs.list.empty"), {
                products: <s-link href="/app/products">{kindLabel(i18n, "PRODUCT")}</s-link>,
                collections: <s-link href="/app/collections">{kindLabel(i18n, "COLLECTION")}</s-link>,
                pages: <s-link href="/app/pages">{kindLabel(i18n, "PAGE")}</s-link>,
              })}
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("jobs.list.started")}</s-table-header>
              <s-table-header>{t("common.contentType")}</s-table-header>
              <s-table-header>{t("common.language")}</s-table-header>
              <s-table-header>{t("common.status")}</s-table-header>
              <s-table-header format="numeric">{t("jobs.list.progress")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((job) => {
                const status = jobStatus(i18n, job.status);
                return (
                  <s-table-row key={job.id}>
                    <s-table-cell>
                      <s-link href={`/app/jobs/${job.id}`}>{i18n.dateTime(job.createdAt)}</s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {kindLabel(i18n, job.type)}
                      {job.automatic ? (
                        <>
                          {" "}
                          <s-badge>{t("common.automatic")}</s-badge>
                        </>
                      ) : null}
                      {job.smart ? (
                        <>
                          {" "}
                          <s-badge tone="info">{t("automatic.name")}</s-badge>
                        </>
                      ) : null}
                    </s-table-cell>
                    <s-table-cell>{languageName(job.targetLocale)}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={status.tone}>{status.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {i18n.number(job.progress.done)} / {i18n.number(job.progress.total)}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-stack direction="inline" gap="base">
        {!isFirstPage ? <s-button href={pageHref(null)}>{t("jobs.pagination.first")}</s-button> : null}
        {nextCursor ? <s-button href={pageHref(nextCursor)}>{t("jobs.pagination.next")}</s-button> : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
