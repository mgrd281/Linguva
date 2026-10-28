import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadOverview } from "../.server/overview/overview";
import { ProgressBar } from "../components/ProgressBar";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return loadOverview(admin, shop);
};

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const { t, msg, date, dateTime } = useI18n();
  const done = data.checklist.filter((s) => s.done).length;
  const next = data.checklist.find((s) => !s.done);
  const usagePercent = data.usage.limit ? (data.usage.used / data.usage.limit) * 100 : 100;

  return (
    <s-page heading={t("common.nav.overview")}>
      {data.usage.level === "exhausted" ? (
        <s-banner tone="critical" heading={t("overview.banner.exhausted.heading")}>
          <s-paragraph>
            {t("overview.banner.exhausted.body")}{" "}
            <s-link href="/app/plan">{t("common.action.changePlan")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : data.usage.level === "high" ? (
        <s-banner tone="warning" heading={t("overview.banner.high.heading", { percent: Math.floor(usagePercent) })}>
          <s-paragraph>
            {t("overview.banner.high.body")} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {next ? (
        <s-section heading={t("overview.start.heading")}>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>{t("overview.start.progress", { done, total: data.checklist.length })}</s-text>
              <s-box inlineSize="200px">
                <ProgressBar value={(done / data.checklist.length) * 100} label={t("overview.start.progressLabel")} />
              </s-box>
            </s-stack>
            <s-stack direction="block" gap="small">
              {data.checklist.map((step) => (
                <s-box key={step.id} padding="base" borderWidth="base" borderRadius="base" background={step === next ? "subdued" : "base"}>
                  <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {step.done ? <s-badge tone="success">{t("common.state.done")}</s-badge> : <s-badge>{t("common.state.toDo")}</s-badge>}
                        <s-text type="strong">{msg(step.label)}</s-text>
                      </s-stack>
                      {!step.done ? <s-text color="subdued">{msg(step.detail)}</s-text> : null}
                    </s-stack>
                    {!step.done ? (
                      <s-button
                        href={step.href}
                        variant={step === next ? "primary" : "secondary"}
                        {...(step.external ? { target: "_top" } : {})}
                      >
                        {msg(step.action)}
                      </s-button>
                    ) : null}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading={t("overview.languages.heading")}>
        {data.progress.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("overview.languages.onlyPrimary", { primary: data.primary ?? t("overview.languages.unknown") })}</s-paragraph>
            <s-button href="shopify://admin/settings/languages" target="_top">
              {t("overview.checklist.languageSettings")}
            </s-button>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("common.language")}</s-table-header>
                <s-table-header listSlot="secondary">{t("overview.languages.storefront")}</s-table-header>
                <s-table-header>{t("common.translationStatus.translated")}</s-table-header>
                <s-table-header>{t("overview.languages.action")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.progress.map((l) => (
                  <s-table-row key={l.locale}>
                    <s-table-cell>{l.name}</s-table-cell>
                    <s-table-cell>
                      {l.published ? (
                        <s-badge tone="success">{t("common.state.published")}</s-badge>
                      ) : (
                        <s-badge>{t("overview.languages.hidden")}</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {l.percent === null ? (
                        <s-text color="subdued">{t("overview.languages.notMeasured")}</s-text>
                      ) : (
                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-box inlineSize="120px">
                            <ProgressBar value={l.percent} label={t("overview.languages.progressLabel", { language: l.name })} />
                          </s-box>
                          <s-text>{l.percent} %</s-text>
                        </s-stack>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-link
                        href={`/app/products?lang=${encodeURIComponent(l.locale)}`}
                        accessibilityLabel={t("overview.languages.translateLabel", { language: l.name })}
                      >
                        {t("overview.languages.translate")}
                      </s-link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-paragraph>
              {data.coverageCheckedAt
                ? t("overview.languages.measured", { date: dateTime(data.coverageCheckedAt) })
                : t("overview.languages.runCoverage")}{" "}
              <s-link href="/app/coverage">
                {data.coverageCheckedAt ? t("overview.languages.updateCoverage") : t("overview.languages.openCoverage")}
              </s-link>
            </s-paragraph>
          </s-stack>
        )}
      </s-section>

      <s-section heading={t("overview.translate.heading")}>
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">{t("common.nav.products")}</s-button>
          <s-button href="/app/collections">{t("common.nav.collections")}</s-button>
          <s-button href="/app/content">{t("overview.translate.content")}</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={t("overview.attention.heading")}>
        <s-stack direction="block" gap="small">
          {data.pendingDrafts ? (
            <s-paragraph>
              <s-link href="/app/review">{t("overview.attention.drafts", { count: data.pendingDrafts })}</s-link>
            </s-paragraph>
          ) : (
            <s-paragraph>{t("overview.attention.noDrafts")}</s-paragraph>
          )}
          {data.activeJobs ? (
            <s-paragraph>
              <s-link href="/app/jobs">{t("overview.attention.jobs", { count: data.activeJobs })}</s-link>
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={t("overview.usage.heading")}>
        <s-stack direction="block" gap="small">
          <ProgressBar
            value={usagePercent}
            label={t("overview.usage.heading")}
            tone={data.usage.level === "exhausted" ? "critical" : data.usage.level === "high" ? "warning" : "success"}
          />
          <s-text>{t("overview.usage.characters", { used: data.usage.used, limit: data.usage.limit })}</s-text>
          <s-text color="subdued">{t("overview.usage.memoryFree")}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={data.shopName}>
        <s-paragraph>
          {t("overview.store.languages", { enabled: data.enabledCount, max: data.maxLocales, published: data.publishedCount })}{" "}
          <s-link href="/app/languages">{t("common.languages")}</s-link>
        </s-paragraph>
        <s-paragraph>{t("overview.store.installed", { date: date(data.installedAt, "long") })}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
