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
import { editorPath, IMAGE_COVERAGE_TYPES, isImageCoverageType, numericId, RESOURCE_KINDS, type ResourceKind } from "../lib/resource-kinds";
import { shopBilling } from "../.server/billing/billing";
import { allowedTargetLocales } from "../.server/billing/subscription";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage, kindLabel, kindPlural, kindSingular } from "../i18n/labels";

const isResourceKind = (type: string): type is ResourceKind => Object.prototype.hasOwnProperty.call(RESOURCE_KINDS, type);

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
          // Shown as "<content type> · <language>", the type named in the interface language.
          scanning: current ? { type: current.resourceType, language: names.get(current.locale) ?? current.locale } : null,
        }
      : null,
    rows: (coverage?.rows ?? []).map((r) => ({ ...r, localeName: names.get(r.locale) ?? r.locale })),
    duplicates: coverage?.duplicateSeoTitles ?? {},
    gaps: (coverage?.gaps ?? []).slice(0, 50).map((g) => ({
      id: g.id,
      locale: names.get(g.locale) ?? g.locale,
      kind: g.resourceType,
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

/** The explanation for an error code, or null for codes without one. */
function errorMessage(i18n: I18n, code: string | null | undefined): string | null {
  if (code === "SHOP_AUTH") return i18n.t("common.jobError.SHOP_AUTH");
  const key = `coverage.error.${code ?? ""}`;
  return code && hasMessage(key) ? i18n.t(key) : null;
}

export default function Coverage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
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
    <s-page heading={t("coverage.page.heading")}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("coverage.intro")}</s-paragraph>
          {actionError ? (
            <s-banner tone="critical" heading={t("coverage.startFailed.heading")}>
              <s-paragraph>{errorMessage(i18n, actionError.error) ?? t("coverage.startFailed.fallback")}</s-paragraph>
            </s-banner>
          ) : null}
          {data.report?.status === "FAILED" ? (
            <s-banner tone="warning" heading={t("coverage.lastFailed.heading")}>
              <s-paragraph>{errorMessage(i18n, data.report.errorCode) ?? t("coverage.lastFailed.fallback")}</s-paragraph>
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
                {data.report ? t("coverage.run.again") : t("coverage.run.first")}
              </s-button>
              {data.report ? (
                <s-text color="subdued">
                  {active
                    ? t("coverage.run.scanning", {
                        scanning: data.report.scanning
                          ? `${kindLabel(i18n, data.report.scanning.type)} · ${data.report.scanning.language}`
                          : "",
                        done: data.report.progress.done,
                        total: data.report.progress.total,
                        items: data.report.resourcesScanned,
                      })
                    : t("coverage.run.last", { date: i18n.dateTime(data.report.finishedAt ?? data.report.createdAt) })}
                </s-text>
              ) : null}
            </s-stack>
          </runner.Form>
        </s-stack>
      </s-section>

      {data.rows.length ? (
        <s-section heading={t("coverage.byLanguage.heading")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("common.language")}</s-table-header>
              <s-table-header>{t("common.contentType")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.byLanguage.items")}</s-table-header>
              <s-table-header format="numeric">{t("common.translationStatus.translated")}</s-table-header>
              <s-table-header format="numeric">{t("common.translationStatus.outdated")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.byLanguage.missing")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.byLanguage.seo")}</s-table-header>
              <s-table-header>{t("coverage.byLanguage.fix")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r, i) => {
                const c = r.groups.content;
                const seo = r.groups.seo;
                // One key per row and page view: a double click starts one job.
                const fixKey = `${data.idempotencyKey}-${i}`;
                return (
                  <s-table-row key={`${r.locale}|${r.resourceType}`}>
                    <s-table-cell>{i18n.language(r.locale, r.localeName)}</s-table-cell>
                    <s-table-cell>{kindLabel(i18n, r.resourceType)}</s-table-cell>
                    <s-table-cell>{i18n.number(r.resources)}</s-table-cell>
                    <s-table-cell>
                      {t("coverage.byLanguage.fields", { percent: percent(c.translated, c.withSource), count: c.translated })}
                    </s-table-cell>
                    <s-table-cell>{i18n.number(c.outdated)}</s-table-cell>
                    <s-table-cell>{i18n.number(c.missing)}</s-table-cell>
                    <s-table-cell>
                      {isImageCoverageType(r.resourceType)
                        ? "—"
                        : seo.withSource
                          ? [
                              t("coverage.byLanguage.seoTranslated", { percent: percent(seo.translated, seo.withSource) }),
                              r.seoIssues ? t("coverage.byLanguage.seoToCheck", { count: r.seoIssues }) : null,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : t("coverage.byLanguage.seoNone")}
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
                              {t("coverage.byLanguage.translateGaps")}
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
                              {t("coverage.byLanguage.seoOnly")}
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
        <s-section heading={t("coverage.seo.heading")}>
          <s-stack direction="block" gap="small">
            {data.rows.map((r) =>
              r.seoTitlesMissingInSource > 0 ? (
                <s-paragraph key={`m-${r.locale}-${r.resourceType}`}>
                  {t("coverage.seo.noSourceTitle", {
                    language: i18n.language(r.locale, r.localeName),
                    count: r.seoTitlesMissingInSource,
                    kind: isResourceKind(r.resourceType) ? kindPlural(i18n, r.resourceType) : t("coverage.seo.items"),
                  })}
                </s-paragraph>
              ) : null,
            )}
            {Object.entries(data.duplicates).map(([locale, count]) =>
              count > 0 ? (
                <s-paragraph key={`d-${locale}`}>
                  {t("coverage.seo.duplicates", {
                    language: i18n.language(locale, data.targets.find((target) => target.locale === locale)?.name),
                    count,
                  })}
                </s-paragraph>
              ) : null,
            )}
            {data.targets
              .filter((target) => !target.published)
              .map((target) => (
                <s-paragraph key={`u-${target.locale}`}>{t("coverage.seo.unpublished", { language: i18n.language(target.locale, target.name) })}</s-paragraph>
              ))}
          </s-stack>
        </s-section>
      ) : null}

      {data.gaps.length ? (
        <s-section heading={t("coverage.gaps.heading")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("coverage.gaps.item")}</s-table-header>
              <s-table-header>{t("common.language")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.gaps.missing")}</s-table-header>
              <s-table-header format="numeric">{t("coverage.gaps.outdated")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.gaps.map((g) => {
                const name = `${isResourceKind(g.kind) ? kindSingular(i18n, g.kind) : g.kind} ${g.label}`;
                return (
                  <s-table-row key={g.id}>
                    <s-table-cell>{g.href ? <s-link href={g.href}>{name}</s-link> : name}</s-table-cell>
                    <s-table-cell>{g.locale}</s-table-cell>
                    <s-table-cell>{i18n.number(g.missing)}</s-table-cell>
                    <s-table-cell>{i18n.number(g.outdated)}</s-table-cell>
                  </s-table-row>
                );
              })}
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
