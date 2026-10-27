import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { listJobsForShop } from "../.server/jobs/bulk-jobs";
import { JOB_STATUS_LABELS, jobProgress } from "../lib/job-display";
import { RESOURCE_KINDS } from "../lib/resource-kinds";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const jobs = await listJobsForShop(shop.id, { take: 50 });
  return {
    jobs: jobs.map((j) => ({
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
  const { jobs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Translation jobs">
      <s-section padding="none">
        {jobs.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              No jobs yet. Start a bulk translation from the{" "}
              <s-link href="/app/products">Products</s-link> or{" "}
              <s-link href="/app/collections">Collections</s-link> page.
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
