import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { getConfig } from "../.server/lib/config";
import { getDailyUsage, getMonthlyUsage } from "../.server/usage/usage-ledger";
import { estimatedCostUsd, PLANS, planSelectionUrl } from "../lib/plans";
import { useI18n } from "../i18n/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const billing = await shopBilling(admin, shop, { force: url.searchParams.get("welcome") === "1" });
  const appHandle = getConfig().SHOPIFY_APP_HANDLE;
  const sub = billing.subscription;
  return {
    configured: billing.configured,
    state: billing.state,
    stale: billing.stale,
    welcome: url.searchParams.get("welcome") === "1",
    entitlements: billing.entitlements,
    subscription: sub
      ? {
          planHandle: sub.planHandle,
          pendingPlanHandle: sub.pendingPlanHandle,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          cancelAtEndOfCycle: sub.cancelAtEndOfCycle,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          checkedAt: sub.checkedAt.toISOString(),
        }
      : null,
    choosePlanUrl: billing.configured && appHandle ? planSelectionUrl(shop.shopDomain, appHandle) : null,
    usage: { month: await getMonthlyUsage(shop.id), today: await getDailyUsage(shop.id) },
    costPerMillion: getConfig().AI_COST_USD_PER_MILLION_CHARS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const billing = await shopBilling(admin, shop, { force: true });
  return { state: billing.state, stale: billing.stale };
};

export default function Plan() {
  const data = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const i18n = useI18n();
  const { t } = i18n;
  const date = (iso: string | null) => (iso ? i18n.date(iso, "medium") : "");
  const yesNo = (value: boolean) => (value ? t("plan.current.yes") : t("plan.current.no"));
  const e = data.entitlements;
  const planName = (handle: string) => handle.charAt(0).toUpperCase() + handle.slice(1);
  const complimentary = data.state === "COMPLIMENTARY";
  const currentPlan = complimentary
    ? t("plan.complimentary.heading")
    : data.state === "ACTIVE"
      ? planName(e.plan)
      : t("plan.current.none");

  return (
    <s-page heading={t("common.nav.plan")}>
      {complimentary ? (
        <s-banner tone="success" heading={t("plan.complimentary.heading")}>
          <s-paragraph>{t("plan.complimentary.body")}</s-paragraph>
        </s-banner>
      ) : null}
      {!data.configured ? (
        <s-banner tone="info" heading={t("plan.unconfigured.heading")}>
          <s-paragraph>{t("plan.unconfigured.body")}</s-paragraph>
        </s-banner>
      ) : null}
      {data.welcome && data.state === "ACTIVE" ? (
        <s-banner tone="success" heading={t("plan.welcome.heading")}>
          <s-paragraph>{t("plan.welcome.body")}</s-paragraph>
        </s-banner>
      ) : null}
      {data.stale || (data.configured && data.state === "UNKNOWN") ? (
        <s-banner tone="warning" heading={t("plan.stale.heading")}>
          <s-paragraph>{t("plan.stale.body")}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={data.configured ? t("plan.current.headingWithPlan", { plan: currentPlan }) : t("plan.current.heading")}>
        <s-stack direction="block" gap="small">
          {data.subscription?.trialEndsAt ? (
            <s-paragraph>{t("plan.current.trial", { date: date(data.subscription.trialEndsAt) })}</s-paragraph>
          ) : null}
          {data.subscription?.cancelAtEndOfCycle ? (
            <s-paragraph>{t("plan.current.ends", { date: date(data.subscription.currentPeriodEnd) })}</s-paragraph>
          ) : null}
          {data.subscription?.pendingPlanHandle ? (
            <s-paragraph>{t("plan.current.pending", { plan: planName(data.subscription.pendingPlanHandle) })}</s-paragraph>
          ) : null}
          <s-paragraph>
            {t("plan.current.usage", { month: data.usage.month, limit: e.monthlyChars, today: data.usage.today })}
          </s-paragraph>
          <s-paragraph>
            {t("plan.current.features", {
              languages: e.maxTargetLocales,
              bulk: yesNo(e.bulk),
              glossary: yesNo(e.glossary),
              autoPublish: yesNo(e.autoPublish),
            })}
          </s-paragraph>
          {complimentary ? (
            <s-paragraph>
              {t("plan.current.cost", {
                cost: estimatedCostUsd(data.usage.month, data.costPerMillion).toFixed(2),
                rate: String(data.costPerMillion),
              })}
            </s-paragraph>
          ) : null}
          <s-paragraph>{t("plan.current.memory")}</s-paragraph>
        </s-stack>
        <s-box paddingBlockStart="base">
          <s-stack direction="inline" gap="base">
            {data.choosePlanUrl && !complimentary ? (
              <s-button variant="primary" href={data.choosePlanUrl} target="_top">
                {data.state === "ACTIVE" ? t("common.action.changePlan") : t("plan.current.choose")}
              </s-button>
            ) : null}
            {data.configured && !complimentary ? (
              <refresh.Form method="post">
                <s-button type="submit" {...(refresh.state !== "idle" ? { loading: true } : {})}>
                  {t("plan.current.checkAgain")}
                </s-button>
              </refresh.Form>
            ) : null}
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading={t("plan.plans.heading")} padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("plan.plans.name")}</s-table-header>
            <s-table-header format="numeric">{t("plan.plans.characters")}</s-table-header>
            <s-table-header format="numeric">{t("common.languages")}</s-table-header>
            <s-table-header>{t("plan.plans.bulk")}</s-table-header>
            <s-table-header>{t("common.nav.glossary")}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {Object.values(PLANS).map((p) => (
              <s-table-row key={p.plan}>
                <s-table-cell>{planName(p.plan)}</s-table-cell>
                <s-table-cell>{i18n.number(p.monthlyChars)}</s-table-cell>
                <s-table-cell>{p.maxTargetLocales}</s-table-cell>
                <s-table-cell>{p.bulk ? t("plan.plans.yes") : t("plan.plans.no")}</s-table-cell>
                <s-table-cell>{p.glossary ? t("plan.plans.yes") : t("plan.plans.no")}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
