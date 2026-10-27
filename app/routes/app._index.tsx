import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadOverview } from "../.server/overview/overview";
import { ProgressBar } from "../components/ProgressBar";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  return loadOverview(admin, shop);
};

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const done = data.checklist.filter((s) => s.done).length;
  const next = data.checklist.find((s) => !s.done);
  const usagePercent = data.usage.limit ? (data.usage.used / data.usage.limit) * 100 : 100;

  return (
    <s-page heading="Overview">
      {data.usage.level === "exhausted" ? (
        <s-banner tone="critical" heading="This month's AI allowance is used up">
          <s-paragraph>
            AI translation pauses until next month. Manual translation and translation memory keep working.{" "}
            <s-link href="/app/plan">Change plan</s-link>
          </s-paragraph>
        </s-banner>
      ) : data.usage.level === "high" ? (
        <s-banner tone="warning" heading={`${Math.floor(usagePercent)} % of this month's AI allowance used`}>
          <s-paragraph>
            Large bulk jobs may stop when the allowance runs out. <s-link href="/app/plan">See plans</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {next ? (
        <s-section heading="Get started">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>
                {done} of {data.checklist.length} steps done
              </s-text>
              <s-box inlineSize="200px">
                <ProgressBar value={(done / data.checklist.length) * 100} label="Setup progress" />
              </s-box>
            </s-stack>
            <s-stack direction="block" gap="small">
              {data.checklist.map((step) => (
                <s-box key={step.id} padding="base" borderWidth="base" borderRadius="base" background={step === next ? "subdued" : "base"}>
                  <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        {step.done ? <s-badge tone="success">Done</s-badge> : <s-badge>To do</s-badge>}
                        <s-text type="strong">{step.label}</s-text>
                      </s-stack>
                      {!step.done ? <s-text color="subdued">{step.detail}</s-text> : null}
                    </s-stack>
                    {!step.done ? (
                      <s-button
                        href={step.href}
                        variant={step === next ? "primary" : "secondary"}
                        {...(step.external ? { target: "_top" } : {})}
                      >
                        {step.action}
                      </s-button>
                    ) : null}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Your languages">
        {data.progress.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Your store only has its primary language ({data.primary ?? "unknown"}). Add the languages you sell in
              under Settings → Languages in Shopify, then come back here.
            </s-paragraph>
            <s-button href="shopify://admin/settings/languages" target="_top">
              Open language settings
            </s-button>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Language</s-table-header>
                <s-table-header listSlot="secondary">On your storefront</s-table-header>
                <s-table-header>Translated</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.progress.map((l) => (
                  <s-table-row key={l.locale}>
                    <s-table-cell>{l.name}</s-table-cell>
                    <s-table-cell>
                      {l.published ? <s-badge tone="success">Published</s-badge> : <s-badge>Hidden</s-badge>}
                    </s-table-cell>
                    <s-table-cell>
                      {l.percent === null ? (
                        <s-text color="subdued">Not measured yet</s-text>
                      ) : (
                        <s-stack direction="inline" gap="small" alignItems="center">
                          <s-box inlineSize="120px">
                            <ProgressBar value={l.percent} label={`${l.name} translated`} />
                          </s-box>
                          <s-text>{l.percent} %</s-text>
                        </s-stack>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-link href={`/app/products?locale=${encodeURIComponent(l.locale)}`} accessibilityLabel={`Translate into ${l.name}`}>
                        Translate
                      </s-link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-paragraph>
              {data.coverageCheckedAt
                ? `Measured ${new Date(data.coverageCheckedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. `
                : "Run the coverage report to see how complete each language is. "}
              <s-link href="/app/coverage">{data.coverageCheckedAt ? "Update coverage report" : "Open coverage report"}</s-link>
            </s-paragraph>
          </s-stack>
        )}
      </s-section>

      <s-section heading="What do you want to translate?">
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">Products</s-button>
          <s-button href="/app/collections">Collections</s-button>
          <s-button href="/app/content">Pages, menus, theme and more</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Needs your attention">
        <s-stack direction="block" gap="small">
          {data.pendingDrafts ? (
            <s-paragraph>
              <s-link href="/app/review">
                {data.pendingDrafts.toLocaleString()} translation{data.pendingDrafts === 1 ? "" : "s"} to review
              </s-link>
            </s-paragraph>
          ) : (
            <s-paragraph>Nothing waiting for review.</s-paragraph>
          )}
          {data.activeJobs ? (
            <s-paragraph>
              <s-link href="/app/jobs">
                {data.activeJobs} translation job{data.activeJobs === 1 ? "" : "s"} running
              </s-link>
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="AI usage this month">
        <s-stack direction="block" gap="small">
          <ProgressBar
            value={usagePercent}
            label="AI usage this month"
            tone={data.usage.level === "exhausted" ? "critical" : data.usage.level === "high" ? "warning" : "success"}
          />
          <s-text>
            {data.usage.used.toLocaleString()} of {data.usage.limit.toLocaleString()} characters
          </s-text>
          <s-text color="subdued">Text reused from your translation memory is free.</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading={data.shopName}>
        <s-paragraph>
          {data.enabledCount} of {data.maxLocales} languages enabled, {data.publishedCount} published.{" "}
          <s-link href="/app/languages">Languages</s-link>
        </s-paragraph>
        <s-paragraph>
          Installed {new Date(data.installedAt).toLocaleDateString(undefined, { dateStyle: "long" })}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
