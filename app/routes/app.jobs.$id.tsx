import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { cancelJob, getJobForShop, isBulkResourceType, listProblemItems } from "../.server/jobs/bulk-jobs";
import { BackgroundJobsUnavailableError, retryBulkJob } from "../.server/jobs/start-job";
import { editorPathFor, numericId, kindMeta } from "../lib/resource-kinds";
import {
  ITEM_ERROR_MESSAGES,
  JOB_ERROR_MESSAGES,
  JOB_STATUS_LABELS,
  jobProgress,
} from "../lib/job-display";

function kindInfo(resourceType: string) {
  const meta = kindMeta(isBulkResourceType(resourceType) ? resourceType : "PRODUCT");
  return { label: meta.label, plural: meta.plural };
}

const ACTIVE = new Set(["PENDING", "DISCOVERING", "RUNNING"]);

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const problems = await listProblemItems(shop.id, job.id);
  return {
    job: {
      id: job.id,
      status: job.status,
      targetLocale: job.targetLocale,
      kind: kindInfo(job.resourceType),
      fieldScope: job.fieldScope,
      errorCode: job.errorCode,
      charsBilled: job.charsBilled,
      memoryHits: job.memoryHits,
      charsSaved: job.charsSaved,
      protectedSkipped: job.protectedSkipped,
      publishMode: job.publishMode,
      succeeded: job.succeededItems,
      skipped: job.skippedItems,
      failed: job.failedItems,
      discoveryDone: job.discoveryDone,
      progress: jobProgress(job),
    },
    problems: problems.map((p) => ({
      id: p.id,
      href: editorPathFor(p.resourceGid, job.targetLocale, job.resourceType),
      label: numericId(p.resourceGid),
      status: p.status,
      errorCode: p.errorCode,
      attempts: p.attempts,
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const intent = (await request.formData()).get("intent");
  if (intent === "cancel") return { ok: await cancelJob(shop.id, job.id) };
  if (intent === "retry") {
    try {
      return { ok: true, retried: await retryBulkJob(shop.id, job.id) };
    } catch (error) {
      if (error instanceof BackgroundJobsUnavailableError) return { ok: false };
      throw error;
    }
  }
  return { ok: false };
};

export default function JobDetail() {
  const { job, problems } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const active = ACTIVE.has(job.status);
  const label = JOB_STATUS_LABELS[job.status];

  // Refresh progress while the job runs.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, revalidator]);

  return (
    <s-page heading={`Bulk translation into ${job.targetLocale}`}>
      <s-link slot="breadcrumb-actions" href="/app/jobs">
        Jobs
      </s-link>

      {job.status === "FAILED" ? (
        <s-banner tone="critical" heading="The job stopped">
          <s-paragraph>{JOB_ERROR_MESSAGES[job.errorCode ?? ""] ?? "The job stopped unexpectedly."}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Progress">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={label.tone}>{label.label}</s-badge>
            <s-text>
              {job.progress.done} of {job.progress.total} {job.kind.plural}
              {!job.discoveryDone ? ` (still finding ${job.kind.plural})` : ""}
            </s-text>
          </s-stack>
          <s-box background="subdued" borderRadius="base" padding="none">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress.percent}
              aria-label="Job progress"
              style={{
                height: 8,
                width: `${job.progress.percent}%`,
                background: "var(--p-color-bg-fill-success, #29845a)",
                borderRadius: 4,
              }}
            />
          </s-box>
          <s-paragraph>
            {job.publishMode === "DRAFT" ? "Drafted for review" : "Translated"}: {job.succeeded} · Already up to date
            or skipped: {job.skipped} · Failed: {job.failed}
          </s-paragraph>
          {job.fieldScope === "SEO" ? <s-paragraph>Scope: search engine listings only.</s-paragraph> : null}
          <s-paragraph>
            AI characters: {job.charsBilled.toLocaleString()} · Reused from memory: {job.memoryHits.toLocaleString()}{" "}
            segments ({job.charsSaved.toLocaleString()} characters saved)
            {job.protectedSkipped ? ` · Protected translations kept: ${job.protectedSkipped}` : ""}
          </s-paragraph>
          {job.publishMode === "DRAFT" && job.succeeded > 0 ? (
            <s-button href={`/app/review?job=${job.id}`} variant="primary">
              Review translations
            </s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        {active ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <s-button type="submit" tone="critical" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              Cancel job
            </s-button>
          </fetcher.Form>
        ) : null}
        {job.status !== "CANCELLED" && (job.failed > 0 || job.status === "FAILED") ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <s-button type="submit" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              {job.status === "FAILED" ? "Resume job" : `Retry failed ${job.kind.plural}`}
            </s-button>
          </fetcher.Form>
        ) : null}
      </s-stack>

      {problems.length ? (
        <s-section heading={`${job.kind.label} that failed`} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{job.kind.label}</s-table-header>
              <s-table-header>Reason</s-table-header>
              <s-table-header format="numeric">Attempts</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {problems.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    {p.href ? <s-link href={p.href}>{p.label}</s-link> : p.label}
                  </s-table-cell>
                  <s-table-cell>{ITEM_ERROR_MESSAGES[p.errorCode ?? ""] ?? p.errorCode ?? "Unknown"}</s-table-cell>
                  <s-table-cell>{p.attempts}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
