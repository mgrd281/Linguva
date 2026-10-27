import { randomUUID } from "node:crypto";
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { loadCoverage, segmentOf } from "../.server/coverage/coverage";
import { isBulkResourceType } from "../.server/jobs/bulk-jobs";
import {
  BackgroundJobsUnavailableError,
  startBulkJob,
  startCoverageReport,
} from "../.server/jobs/start-job";
import { getQueues } from "../.server/queue/client";
import { getTranslationProvider } from "../.server/providers";
import { getShopSettings, hasCurrentAiConsent } from "../.server/settings/shop-settings";
import { coverageTypeLabel, editorPath, IMAGE_COVERAGE_TYPES, isImageCoverageType, numericId, RESOURCE_KINDS } from "../lib/resource-kinds";
import { shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const targets = locales.locales.filter((l) => !l.primary);
  const coverage = await loadCoverage(shop.id);
  const settings = await getShopSettings(shop.id);
  const names = new Map(locales.locales.map((l) => [l.locale, l.name]));
  const report = coverage?.report;
  const current = report ? segmentOf(report, report.segmentIndex) : null;

  return {
    targets: targets.map((l) => ({ locale: l.locale, name: l.name, published: l.published })),
    idempotencyKey: randomUUID(),
    jobsAvailable: getQueues() !== null,
    canTranslate: getTranslationProvider() !== null && hasCurrentAiConsent(settings),
    report: report
      ? {
          status: report.status,
          errorCode: report.errorCode,
          createdAt: report.createdAt.toISOString(),
          finishedAt: report.finishedAt?.toISOString() ?? null,
          resourcesScanned: report.resourcesScanned,
          progress: { done: Math.min(report.segmentIndex, report.segments.length), total: report.segments.length },
          scanning: current ? `${coverageTypeLabel(current.resourceType)} · ${names.get(current.locale) ?? current.locale}` : null,
        }
      : null,
    rows: (coverage?.rows ?? []).map((r) => ({ ...r, localeName: names.get(r.locale) ?? r.locale })),
    duplicates: coverage?.duplicateSeoTitles ?? {},
    gaps: (coverage?.gaps ?? []).slice(0, 50).map((g) => ({
      id: g.id,
      locale: names.get(g.locale) ?? g.locale,
      kind: RESOURCE_KINDS[g.resourceType as keyof typeof RESOURCE_KINDS]?.singular ?? g.resourceType,
      label: `${numericId(g.resourceGid)}`,
      href: editorPath(g.resourceGid, g.locale),
      missing: g.missing,
      outdated: g.outdated,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) return { error: "INVALID_REQUEST" };
  const locales = (await fetchAndSyncShopLocales(admin, shop.id)).locales.filter((l) => !l.primary);

  try {
    if (form.get("intent") === "run") {
      if (!locales.length) return { error: "NO_LANGUAGES" };
      await startCoverageReport({
        shopId: shop.id,
        locales: locales.map((l) => l.locale),
        requestedBy: actorId,
        idempotencyKey,
      });
      return { ok: true };
    }
    if (form.get("intent") === "fix") {
      const locale = String(form.get("locale") ?? "");
      const rowType = String(form.get("resourceType") ?? "");
      // Image alt text is translated by its owner's job, with images included.
      const resourceType = isImageCoverageType(rowType) ? IMAGE_COVERAGE_TYPES[rowType].parent : rowType;
      if (!locales.some((l) => l.locale === locale) || !isBulkResourceType(resourceType)) return { error: "INVALID_REQUEST" };
      const billing = await shopBilling(admin, shop);
      if (!billing.entitlements.bulk) return { error: "PLAN_BULK" };
      if (!allowedTargetLocales(billing.entitlements, locales.map((l) => l.locale)).includes(locale)) {
        return { error: "PLAN_LANGUAGE" };
      }
      const { job } = await startBulkJob({
        shopId: shop.id,
        resourceType,
        targetLocale: locale,
        requestedBy: actorId,
        idempotencyKey,
        fieldScope: form.get("fieldScope") === "SEO" ? "SEO" : "ALL",
        includeAttached: isImageCoverageType(rowType),
      });
      return redirect(`/app/jobs/${job.id}`);
    }
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
  return { error: "UNKNOWN_INTENT" };
};

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 100);

const ERRORS: Record<string, string> = {
  JOBS_UNAVAILABLE: "Background processing isn't configured for this app yet.",
  NO_LANGUAGES: "Add a language under Settings → Languages first.",
  SHOP_AUTH: "Shopify rejected the app's access. Open the app again to re-authorise it.",
  STALLED: "The last report stopped making progress. Run it again.",
  PLAN_BULK: "Bulk translation is part of paid plans. See Plan to change your plan.",
  PLAN_LANGUAGE: "Your plan doesn't include this language. See Plan to change your plan.",
  SCAN_FAILED: "Shopify didn't answer reliably. Run the report again later.",
};

export default function Coverage() {
  const data = useLoaderData<typeof loader>();
  const runner = useFetcher<typeof action>();
  const fixer = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const active = data.report?.status === "QUEUED" || data.report?.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, revalidator]);

  const actionError = [runner.data, fixer.data].find((d) => d && "error" in d) as { error: string } | undefined;

  return (
    <s-page heading="Translation coverage">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The report checks every product and collection in each of your languages: what is translated, missing or
            outdated, and how search engine listings look. It only reads from Shopify and doesn&apos;t use AI.
          </s-paragraph>
          {actionError ? (
            <s-banner tone="critical" heading="Couldn't start">
              <s-paragraph>{ERRORS[actionError.error] ?? "Please reload the page and try again."}</s-paragraph>
            </s-banner>
          ) : null}
          {data.report?.status === "FAILED" ? (
            <s-banner tone="warning" heading="The last report didn't finish">
              <s-paragraph>{ERRORS[data.report.errorCode ?? ""] ?? "Run the report again."}</s-paragraph>
            </s-banner>
          ) : null}
          <runner.Form method="post">
            <input type="hidden" name="intent" value="run" />
            <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                type="submit"
                variant="primary"
                disabled={!data.jobsAvailable || active || data.targets.length === 0}
                {...(runner.state !== "idle" ? { loading: true } : {})}
              >
                {data.report ? "Run the report again" : "Run coverage report"}
              </s-button>
              {data.report ? (
                <s-text color="subdued">
                  {active
                    ? `Scanning ${data.report.scanning ?? ""} (${data.report.progress.done} of ${data.report.progress.total} parts, ${data.report.resourcesScanned.toLocaleString()} items so far)`
                    : `Last report: ${new Date(data.report.finishedAt ?? data.report.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
                </s-text>
              ) : null}
            </s-stack>
          </runner.Form>
        </s-stack>
      </s-section>

      {data.rows.length ? (
        <s-section heading="By language" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Language</s-table-header>
              <s-table-header>Content</s-table-header>
              <s-table-header format="numeric">Items</s-table-header>
              <s-table-header format="numeric">Translated</s-table-header>
              <s-table-header format="numeric">Outdated</s-table-header>
              <s-table-header format="numeric">Missing</s-table-header>
              <s-table-header format="numeric">SEO listings</s-table-header>
              <s-table-header>Fix</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r, i) => {
                const c = r.groups.content;
                const seo = r.groups.seo;
                // One key per row and page view: a double click starts one job.
                const fixKey = `${data.idempotencyKey}-${i}`;
                return (
                  <s-table-row key={`${r.locale}|${r.resourceType}`}>
                    <s-table-cell>{r.localeName}</s-table-cell>
                    <s-table-cell>{coverageTypeLabel(r.resourceType)}</s-table-cell>
                    <s-table-cell>{r.resources.toLocaleString()}</s-table-cell>
                    <s-table-cell>
                      {percent(c.translated, c.withSource)}% ({c.translated.toLocaleString()} fields)
                    </s-table-cell>
                    <s-table-cell>{c.outdated.toLocaleString()}</s-table-cell>
                    <s-table-cell>{c.missing.toLocaleString()}</s-table-cell>
                    <s-table-cell>
                      {isImageCoverageType(r.resourceType)
                        ? "—"
                        : seo.withSource
                          ? `${percent(seo.translated, seo.withSource)}% translated${r.seoIssues ? `, ${r.seoIssues} to check` : ""}`
                          : "None set"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        {c.missing + c.outdated > 0 ? (
                          <fixer.Form method="post">
                            <input type="hidden" name="intent" value="fix" />
                            <input type="hidden" name="idempotencyKey" value={`${fixKey}a`} />
                            <input type="hidden" name="locale" value={r.locale} />
                            <input type="hidden" name="resourceType" value={r.resourceType} />
                            <s-button type="submit" variant="tertiary" disabled={!data.canTranslate || !data.jobsAvailable}>
                              Translate gaps
                            </s-button>
                          </fixer.Form>
                        ) : null}
                        {seo.missing + seo.outdated > 0 ? (
                          <fixer.Form method="post">
                            <input type="hidden" name="intent" value="fix" />
                            <input type="hidden" name="idempotencyKey" value={`${fixKey}s`} />
                            <input type="hidden" name="locale" value={r.locale} />
                            <input type="hidden" name="resourceType" value={r.resourceType} />
                            <input type="hidden" name="fieldScope" value="SEO" />
                            <s-button type="submit" variant="tertiary" disabled={!data.canTranslate || !data.jobsAvailable}>
                              SEO only
                            </s-button>
                          </fixer.Form>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}

      {data.rows.length ? (
        <s-section heading="Search engine listings">
          <s-stack direction="block" gap="small">
            {data.rows.map((r) =>
              r.seoTitlesMissingInSource > 0 ? (
                <s-paragraph key={`m-${r.locale}-${r.resourceType}`}>
                  {r.localeName}: {r.seoTitlesMissingInSource.toLocaleString()}{" "}
                  {RESOURCE_KINDS[r.resourceType as keyof typeof RESOURCE_KINDS]?.plural ?? "items"} have no SEO title in
                  the original language, so search engines see the regular title.
                </s-paragraph>
              ) : null,
            )}
            {Object.entries(data.duplicates).map(([locale, count]) =>
              count > 0 ? (
                <s-paragraph key={`d-${locale}`}>
                  {data.targets.find((t) => t.locale === locale)?.name ?? locale}: {count} items share an SEO title with
                  another item. Unique titles help search engines tell pages apart.
                </s-paragraph>
              ) : null,
            )}
            {data.targets
              .filter((t) => !t.published)
              .map((t) => (
                <s-paragraph key={`u-${t.locale}`}>
                  {t.name} isn&apos;t published, so customers and search engines don&apos;t see these translations yet.
                </s-paragraph>
              ))}
          </s-stack>
        </s-section>
      ) : null}

      {data.gaps.length ? (
        <s-section heading="Items with the most gaps" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header>Language</s-table-header>
              <s-table-header format="numeric">Missing fields</s-table-header>
              <s-table-header format="numeric">Outdated fields</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.gaps.map((g) => (
                <s-table-row key={g.id}>
                  <s-table-cell>
                    {g.href ? <s-link href={g.href}>{`${g.kind} ${g.label}`}</s-link> : `${g.kind} ${g.label}`}
                  </s-table-cell>
                  <s-table-cell>{g.locale}</s-table-cell>
                  <s-table-cell>{g.missing}</s-table-cell>
                  <s-table-cell>{g.outdated}</s-table-cell>
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
