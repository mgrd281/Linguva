import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { listJobsPage } from "../.server/jobs/bulk-jobs";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { JOB_STATUS_LABELS, jobProgress } from "../lib/job-display";
import { RESOURCE_KINDS } from "../lib/resource-kinds";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const q = (name: string) => url.searchParams.get(name) || null;
  const filter = { status: q("status"), locale: q("locale"), resourceType: q("type") };
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
      type: j.resourceType in RESOURCE_KINDS ? RESOURCE_KINDS[j.resourceType as keyof typeof RESOURCE_KINDS].label : j.resourceType,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      progress: jobProgress(j),
    })),
  };
};

export default function Jobs() {
  const { jobs, filter, locales, nextCursor, isFirstPage } = useLoaderData<typeof loader>();
  const filtered = Boolean(filter.status || filter.locale || filter.resourceType);
  const pageHref = (after: string | null) => {
    const params = new URLSearchParams();
    if (filter.status) params.set("status", filter.status);
    if (filter.locale) params.set("locale", filter.locale);
    if (filter.resourceType) params.set("type", filter.resourceType);
    if (after) params.set("after", after);
    const query = params.toString();
    return query ? `/app/jobs?${query}` : "/app/jobs";
  };

  return (
    <s-page heading="Translation jobs">
      <s-section>
        <Form method="get">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-select name="status" label="Status" value={filter.status ?? ""}>
              <s-option value="">All</s-option>
              <s-option value="active">Running</s-option>
              <s-option value="completed">Completed</s-option>
              <s-option value="failed">Stopped</s-option>
              <s-option value="cancelled">Cancelled</s-option>
            </s-select>
            <s-select name="locale" label="Language" value={filter.locale ?? ""}>
              <s-option value="">All languages</s-option>
              {locales.map((l) => (
                <s-option key={l.locale} value={l.locale}>
                  {l.name}
                </s-option>
              ))}
            </s-select>
            <s-select name="type" label="Content" value={filter.resourceType ?? ""}>
              <s-option value="">All</s-option>
              {Object.entries(RESOURCE_KINDS).map(([kind, meta]) => (
                <s-option key={kind} value={kind}>
                  {meta.label}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit">Apply</s-button>
            {filtered ? (
              <s-button href="/app/jobs" variant="tertiary">
                Clear
              </s-button>
            ) : null}
          </s-stack>
        </Form>
      </s-section>
      <s-section padding="none">
        {jobs.length === 0 && filtered ? (
          <s-box padding="base">
            <s-paragraph>No jobs match these filters.</s-paragraph>
          </s-box>
        ) : jobs.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              No jobs yet. Start a bulk translation from the{" "}
              <s-link href="/app/products">Products</s-link>, <s-link href="/app/collections">Collections</s-link>{" "}
              or <s-link href="/app/pages">Pages</s-link> page.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Started</s-table-header>
              <s-table-header>Content</s-table-header>
              <s-table-header>Language</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Progress</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((job) => (
                <s-table-row key={job.id}>
                  <s-table-cell>
                    <s-link href={`/app/jobs/${job.id}`}>
                      {new Date(job.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{job.type}</s-table-cell>
                  <s-table-cell>{job.targetLocale}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={JOB_STATUS_LABELS[job.status].tone}>
                      {JOB_STATUS_LABELS[job.status].label}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {job.progress.done} / {job.progress.total}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-stack direction="inline" gap="base">
        {!isFirstPage ? <s-button href={pageHref(null)}>First page</s-button> : null}
        {nextCursor ? <s-button href={pageHref(nextCursor)}>Next page</s-button> : null}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
