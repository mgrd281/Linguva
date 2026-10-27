import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { getConfig } from "../.server/lib/config";
import { getDailyUsage, getMonthlyUsage } from "../.server/usage/usage-ledger";
import { estimatedCostUsd, PLANS, planSelectionUrl } from "../lib/plans";

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

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";

export default function Plan() {
  const data = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const e = data.entitlements;
  const planName = (handle: string) => handle.charAt(0).toUpperCase() + handle.slice(1);
  const complimentary = data.state === "COMPLIMENTARY";
  const currentPlan = complimentary ? "Complimentary access" : data.state === "ACTIVE" ? planName(e.plan) : "none";

  return (
    <s-page heading="Plan">
      {complimentary ? (
        <s-banner tone="success" heading="Complimentary access">
          <s-paragraph>
            This store has every feature without a subscription. AI usage is still counted, and the monthly allowance
            below protects against unexpected costs.
          </s-paragraph>
        </s-banner>
      ) : null}
      {!data.configured ? (
        <s-banner tone="info" heading="Billing isn't set up yet">
          <s-paragraph>All features are available while plans are being prepared.</s-paragraph>
        </s-banner>
      ) : null}
      {data.welcome && data.state === "ACTIVE" ? (
        <s-banner tone="success" heading="Thanks for choosing a plan">
          <s-paragraph>Your plan is active. You can start translating now.</s-paragraph>
        </s-banner>
      ) : null}
      {data.stale || (data.configured && data.state === "UNKNOWN") ? (
        <s-banner tone="warning" heading="We couldn't confirm your plan with Shopify just now">
          <s-paragraph>Nothing is blocked because of this. We&apos;ll check again automatically.</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={data.configured ? `Current plan: ${currentPlan}` : "Current plan"}>
        <s-stack direction="block" gap="small">
          {data.subscription?.trialEndsAt ? <s-paragraph>Free trial until {date(data.subscription.trialEndsAt)}.</s-paragraph> : null}
          {data.subscription?.cancelAtEndOfCycle ? (
            <s-paragraph>Your plan ends on {date(data.subscription.currentPeriodEnd)}. Your translations stay in your store.</s-paragraph>
          ) : null}
          {data.subscription?.pendingPlanHandle ? (
            <s-paragraph>Changes to {planName(data.subscription.pendingPlanHandle)} at the next billing cycle.</s-paragraph>
          ) : null}
          <s-paragraph>
            AI characters this month: {data.usage.month.toLocaleString()} of {e.monthlyChars.toLocaleString()} · today:{" "}
            {data.usage.today.toLocaleString()}
          </s-paragraph>
          <s-paragraph>
            Languages: up to {e.maxTargetLocales} · Bulk translation: {e.bulk ? "yes" : "no"} · Glossary: {e.glossary ? "yes" : "no"} ·
            Automatic publishing: {e.autoPublish ? "yes" : "no"}
          </s-paragraph>
          {complimentary ? (
            <s-paragraph>
              Estimated AI cost this month (internal): ${estimatedCostUsd(data.usage.month, data.costPerMillion).toFixed(2)} at $
              {data.costPerMillion} per million characters.
            </s-paragraph>
          ) : null}
          <s-paragraph>Translation memory reuse never counts against your characters.</s-paragraph>
        </s-stack>
        <s-stack direction="inline" gap="base">
          {data.choosePlanUrl && !complimentary ? (
            <s-button variant="primary" href={data.choosePlanUrl} target="_top">
              {data.state === "ACTIVE" ? "Change plan" : "Choose a plan"}
            </s-button>
          ) : null}
          {data.configured && !complimentary ? (
            <refresh.Form method="post">
              <s-button type="submit" {...(refresh.state !== "idle" ? { loading: true } : {})}>
                Check again
              </s-button>
            </refresh.Form>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Plans" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Plan</s-table-header>
            <s-table-header format="numeric">AI characters / month</s-table-header>
            <s-table-header format="numeric">Languages</s-table-header>
            <s-table-header>Bulk</s-table-header>
            <s-table-header>Glossary</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {Object.values(PLANS).map((p) => (
              <s-table-row key={p.plan}>
                <s-table-cell>{planName(p.plan)}</s-table-cell>
                <s-table-cell>{p.monthlyChars.toLocaleString()}</s-table-cell>
                <s-table-cell>{p.maxTargetLocales}</s-table-cell>
                <s-table-cell>{p.bulk ? "Yes" : "No"}</s-table-cell>
                <s-table-cell>{p.glossary ? "Yes" : "No"}</s-table-cell>
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
