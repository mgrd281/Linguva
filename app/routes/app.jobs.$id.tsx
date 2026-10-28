import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { AUTO_REQUESTED_BY, cancelJob, getJobForShop, isBulkResourceType, listProblemItems } from "../.server/jobs/bulk-jobs";
import { BackgroundJobsUnavailableError, retryBulkJob } from "../.server/jobs/start-job";
import { editorPathFor, numericId, type TranslatableKind } from "../lib/resource-kinds";
import { jobProgress } from "../lib/job-display";
import { useI18n } from "../i18n/react";
import { itemErrorMessage, jobErrorMessage, jobStatus, kindLabel, kindPlural } from "../i18n/labels";

/** The content type named on the page (named in the interface language). */
function pageKind(resourceType: string): TranslatableKind {
  return isBulkResourceType(resourceType) ? resourceType : "PRODUCT";
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
      kind: pageKind(job.resourceType),
      fieldScope: job.fieldScope,
      automatic: job.requestedBy === AUTO_REQUESTED_BY,
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
  const i18n = useI18n();
  const { t } = i18n;
  const kind = { label: kindLabel(i18n, job.kind), plural: kindPlural(i18n, job.kind) };
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const active = ACTIVE.has(job.status);
  const label = jobStatus(i18n, job.status);

  // Refresh progress while the job runs.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, revalidator]);

  return (
    <s-page heading={t("jobs.detail.heading", { locale: job.targetLocale })}>
      <s-link slot="breadcrumb-actions" href="/app/jobs">
        {t("jobs.detail.breadcrumb")}
      </s-link>

      {job.status === "FAILED" ? (
        <s-banner tone="critical" heading={t("jobs.detail.stopped.heading")}>
          <s-paragraph>{jobErrorMessage(i18n, job.errorCode ?? "") ?? t("jobs.detail.stopped.unexpected")}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={t("jobs.detail.progress.heading")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={label.tone}>{label.label}</s-badge>
            <s-text>
              {t("jobs.detail.progress.count", { done: job.progress.done, total: job.progress.total, kind: kind.plural })}
              {!job.discoveryDone ? ` ${t("jobs.detail.progress.discovering", { kind: kind.plural })}` : ""}
            </s-text>
          </s-stack>
          <s-box background="subdued" borderRadius="base" padding="none">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress.percent}
              aria-label={t("jobs.detail.progress.label")}
              style={{
                height: 8,
                width: `${job.progress.percent}%`,
                background: "var(--p-color-bg-fill-success, #29845a)",
                borderRadius: 4,
              }}
            />
          </s-box>
          <s-paragraph>
            {[
              t(job.publishMode === "DRAFT" ? "jobs.detail.counts.drafted" : "jobs.detail.counts.translated", { count: job.succeeded }),
              t("jobs.detail.counts.skipped", { count: job.skipped }),
              t("jobs.detail.counts.failed", { count: job.failed }),
            ].join(" · ")}
          </s-paragraph>
          {job.fieldScope === "SEO" ? <s-paragraph>{t("jobs.detail.scopeSeo")}</s-paragraph> : null}
          {job.automatic ? <s-paragraph>{t("jobs.detail.automatic", { kind: kind.plural })}</s-paragraph> : null}
          <s-paragraph>
            {[
              t("jobs.detail.usage.ai", { count: job.charsBilled }),
              t("jobs.detail.usage.memory", { segments: job.memoryHits, saved: job.charsSaved }),
              job.protectedSkipped ? t("jobs.detail.usage.protected", { count: job.protectedSkipped }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </s-paragraph>
          {job.publishMode === "DRAFT" && job.succeeded > 0 ? (
            <s-button href={`/app/review?job=${job.id}`} variant="primary">
              {t("jobs.detail.review")}
            </s-button>
          ) : null}
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        {active ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <s-button type="submit" tone="critical" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              {t("jobs.detail.cancel")}
            </s-button>
          </fetcher.Form>
        ) : null}
        {job.status !== "CANCELLED" && (job.failed > 0 || job.status === "FAILED") ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <s-button type="submit" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              {job.status === "FAILED" ? t("jobs.detail.resume") : t("jobs.detail.retryFailed", { kind: kind.plural })}
            </s-button>
          </fetcher.Form>
        ) : null}
      </s-stack>

      {problems.length ? (
        <s-section heading={t("jobs.detail.failed.heading", { kind: kind.label })} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{kind.label}</s-table-header>
              <s-table-header>{t("jobs.detail.failed.reason")}</s-table-header>
              <s-table-header format="numeric">{t("jobs.detail.failed.attempts")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {problems.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    {p.href ? <s-link href={p.href}>{p.label}</s-link> : p.label}
                  </s-table-cell>
                  <s-table-cell>
                    {itemErrorMessage(i18n, p.errorCode ?? "") ?? p.errorCode ?? t("jobs.detail.failed.unknown")}
                  </s-table-cell>
                  <s-table-cell>{i18n.number(p.attempts)}</s-table-cell>
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
