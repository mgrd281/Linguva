import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { reliableEta } from "../lib/eta";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { AUTO_REQUESTED_BY, cancelJob, getJobForShop, jobOutcomes, listProblemItems } from "../.server/jobs/bulk-jobs";
import { BackgroundJobsUnavailableError, retryBulkJob } from "../.server/jobs/start-job";
import { editorPathFor, numericId } from "../lib/resource-kinds";
import { SMART_REQUESTED_BY } from "../lib/smart-auto";
import { jobProgress } from "../lib/job-display";
import { ConfirmModal } from "../components/ConfirmModal";
import { useI18n } from "../i18n/react";
import { itemOutcome, jobErrorMessage, jobStatus, kindLabel, kindPlural } from "../i18n/labels";
import type { I18n } from "../i18n/i18n";

const ACTIVE = new Set(["PENDING", "DISCOVERING", "RUNNING"]);

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await getJobForShop(shop.id, params.id ?? "");
  if (!job) throw new Response("Not found", { status: 404 });
  const [problems, outcomes] = await Promise.all([listProblemItems(shop.id, job.id), jobOutcomes(shop.id, job.id)]);
  const progress = jobProgress(job);
  // Remaining time from the pace so far, only once it can be trusted (server clock).
  const now = Date.now();
  const elapsedMs = job.startedAt ? (job.finishedAt ?? new Date(now)).getTime() - job.startedAt.getTime() : null;
  const remainingMs =
    ACTIVE.has(job.status) && job.discoveryDone
      ? reliableEta({ done: progress.done, total: progress.total, startedAt: job.startedAt, now: new Date(now) })
      : null;
  return {
    job: {
      id: job.id,
      status: job.status,
      targetLocale: job.targetLocale,
      // Also a smart check's images or custom fields of an owner type.
      kind: job.resourceType,
      fieldScope: job.fieldScope,
      automatic: job.requestedBy === AUTO_REQUESTED_BY,
      smart: job.requestedBy === SMART_REQUESTED_BY,
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
      progress,
      startedAt: (job.startedAt ?? job.createdAt).toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      elapsedMs: job.finishedAt ? elapsedMs : null,
      remainingMs,
    },
    outcomes,
    problems: problems.map((p) => ({
      id: p.id,
      href: editorPathFor(p.resourceGid, job.targetLocale, job.resourceType),
      label: numericId(p.resourceGid),
      status: p.status,
      errorCode: p.errorCode,
      attempts: p.attempts,
      // Short item reference; the worker logs carry the full item id.
      reference: p.id.slice(0, 8),
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
      const { retried, busy } = await retryBulkJob(shop.id, job.id);
      return { ok: !busy, retried, busy };
    } catch (error) {
      if (error instanceof BackgroundJobsUnavailableError) return { ok: false };
      throw error;
    }
  }
  return { ok: false };
};

/** "3 minutes", "less than a minute". */
function duration(i18n: I18n, ms: number) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? i18n.t("jobs.detail.timing.underMinute") : i18n.t("jobs.detail.timing.minutes", { count: minutes });
}

// fetch() inside the embedded app carries the session token (App Bridge), a plain link wouldn't.
async function downloadReport(jobId: string, locale: string) {
  const response = await fetch(`/app/jobs/${jobId}/report?ui=${encodeURIComponent(locale)}`);
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `linguva-job-${jobId.slice(0, 8)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function JobDetail() {
  const { job, problems, outcomes } = useLoaderData<typeof loader>();
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
    <s-page heading={t("jobs.detail.heading", { locale: i18n.language(job.targetLocale) })}>
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
          <s-paragraph>
            {[
              t("jobs.detail.timing.started", { time: i18n.dateTime(job.startedAt) }),
              job.finishedAt ? t("jobs.detail.timing.finished", { time: i18n.dateTime(job.finishedAt) }) : null,
              job.elapsedMs !== null ? t("jobs.detail.timing.duration", { duration: duration(i18n, job.elapsedMs) }) : null,
              job.remainingMs !== null ? t("jobs.detail.timing.remaining", { duration: duration(i18n, job.remainingMs) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </s-paragraph>
          {job.fieldScope === "SEO" ? <s-paragraph>{t("jobs.detail.scopeSeo")}</s-paragraph> : null}
          {job.automatic ? <s-paragraph>{t("jobs.detail.automatic", { kind: kind.plural })}</s-paragraph> : null}
          {job.smart ? (
            <s-paragraph>
              {t("jobs.detail.smart")} <s-link href="/app/settings/automatic">{t("jobs.detail.smartLink")}</s-link>
            </s-paragraph>
          ) : null}
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

      {fetcher.data && "busy" in fetcher.data && fetcher.data.busy ? <s-banner tone="warning">{t("jobs.detail.retryBusy")}</s-banner> : null}
      <s-stack direction="inline" gap="base">
        {active ? (
          <>
            <s-button tone="critical" commandFor="job-cancel" command="--show" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              {t("jobs.detail.cancel")}
            </s-button>
            <ConfirmModal
              id="job-cancel"
              heading={t("jobs.cancel.heading")}
              body={t("jobs.cancel.body")}
              confirmLabel={t("jobs.detail.cancel")}
              onConfirm={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}
            />
          </>
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

      <s-section heading={t("jobs.detail.outcomes.heading")}>
        <s-stack direction="block" gap="base">
          {outcomes.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("jobs.report.reason")}</s-table-header>
                <s-table-header format="numeric">{kind.label}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {outcomes.map((o) => (
                  <s-table-row key={`${o.status}:${o.code ?? ""}`}>
                    <s-table-cell>{itemOutcome(i18n, o.status, o.code)}</s-table-cell>
                    <s-table-cell>{i18n.number(o.count)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-paragraph>{t("jobs.detail.outcomes.empty")}</s-paragraph>
          )}
          <s-stack direction="inline" gap="base" alignItems="center">
            {outcomes.length ? (
              <s-button onClick={() => void downloadReport(job.id, i18n.locale)}>{t("jobs.detail.outcomes.download")}</s-button>
            ) : null}
            <s-text color="subdued">{t("jobs.detail.reference", { id: job.id })}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {problems.length ? (
        <s-section heading={t("jobs.detail.attention.heading", { kind: kind.label })} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{kind.label}</s-table-header>
              <s-table-header>{t("jobs.detail.failed.reason")}</s-table-header>
              <s-table-header format="numeric">{t("jobs.detail.failed.attempts")}</s-table-header>
              <s-table-header>{t("jobs.detail.attention.reference")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {problems.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    {p.href ? <s-link href={p.href}>{p.label}</s-link> : p.label}
                  </s-table-cell>
                  <s-table-cell>{itemOutcome(i18n, p.status, p.errorCode) || t("jobs.detail.failed.unknown")}</s-table-cell>
                  <s-table-cell>{i18n.number(p.attempts)}</s-table-cell>
                  <s-table-cell>{p.reference}</s-table-cell>
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
