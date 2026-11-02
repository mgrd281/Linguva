/**
 * "Plan" (Settings › Plan): which plan the store has and how much of it it
 * used, every plan side by side with its list price, and the way to change
 * it, which is always Shopify's plan page (a link, target _top). The app
 * never creates, changes or cancels a subscription; prices are display only
 * (PLAN_PRICES must equal the Partner Dashboard).
 */
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { shopBilling } from "../.server/billing/billing";
import { loadPlanPage, REFRESH_MIN_INTERVAL_MS } from "../.server/billing/plan-page";
import { requireShop } from "../.server/shopify/require-shop";
import { useResultToast } from "../components/app-bridge";
import { BIG_HEADING, Breadcrumbs } from "../components/LanguageLayout";
import { PlanCards } from "../components/plan/PlanCards";
import { PlanFaq } from "../components/plan/PlanFaq";
import { PlanFeatureTable } from "../components/plan/PlanFeatureTable";
import { PlanHero } from "../components/plan/PlanHero";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { showTrial } from "../lib/plan-prices";
import { planName, planView, recommendPlan, usableEngines, type HeroView } from "../lib/plan-view";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  // Back from Shopify's plan page: only forces a fresh check; the plan itself always comes from Shopify.
  const welcome = new URL(request.url).searchParams.get("welcome") === "1";
  return loadPlanPage({ admin, shop, welcome, billing: shopBilling(admin, shop, { force: welcome }) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  // "Refresh" / "Try again": a forced check, but a check that succeeded in the last 30 s is reused.
  const billing = await shopBilling(admin, shop, { force: true, minAgeMs: REFRESH_MIN_INTERVAL_MS });
  return {
    ok: !billing.stale && billing.state !== "UNKNOWN",
    state: billing.state,
    stale: billing.stale,
    // The shop's own plan, already on the page; the toast names it like the hero does.
    planHandle: billing.state === "ACTIVE" ? (billing.subscription?.planHandle ?? null) : null,
  };
};

type Refresh = ReturnType<typeof useFetcher<typeof action>>;

/** The hero's main action (a link to Shopify's plan page, or "Try again") and the quiet refresh beside "As of …". */
function HeroActions({ i18n, hero, choosePlanUrl, refresh }: { i18n: I18n; hero: HeroView; choosePlanUrl: string | null; refresh: Refresh }) {
  const { t } = i18n;
  const busy = refresh.state !== "idle";
  // Own key plan without a usable key: the key comes first (Settings › Your translation keys).
  const addKey = (
    <s-button variant="primary" href="/app/settings#settings-keys">
      {t("plan.hero.addKey")}
    </s-button>
  );
  const link = (kind: "change" | "choose", variant: "primary" | "secondary") =>
    choosePlanUrl ? (
      <s-button variant={variant} href={choosePlanUrl} target="_top">
        {kind === "change" ? t("common.action.changePlan") : t("plan.action.choose")}
      </s-button>
    ) : null;
  const main =
    hero.primary === "retry" ? (
      <s-stack direction="inline" gap="small-200">
        <refresh.Form method="post">
          <s-button type="submit" variant="primary" icon="refresh" {...(busy ? { loading: true } : {})}>
            {t("plan.action.retry")}
          </s-button>
        </refresh.Form>
        {hero.secondary ? link(hero.secondary, "secondary") : null}
      </s-stack>
    ) : hero.primary === "addKey" ? (
      <s-stack direction="inline" gap="small-200">
        {addKey}
        {hero.secondary ? link(hero.secondary, "secondary") : null}
      </s-stack>
    ) : hero.primary ? (
      link(hero.primary, "primary")
    ) : null;
  const checked =
    hero.checkedAt && hero.refresh ? (
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-text color="subdued">{t("plan.checkedAt", { date: i18n.dateTime(hero.checkedAt) })}</s-text>
        <refresh.Form method="post">
          <s-button type="submit" variant="tertiary" icon="refresh" {...(busy ? { loading: true } : {})}>
            {t("plan.action.refresh")}
          </s-button>
        </refresh.Form>
      </s-stack>
    ) : null;
  if (!main && !checked) return null;
  // Beside the plan on a wide card (right-aligned, one above the other); below it on a phone (left-aligned).
  return (
    <s-stack direction="@container (inline-size > 640px) block, inline" alignItems="end" gap="small-300">
      {main}
      {checked}
    </s-stack>
  );
}

export default function Plan() {
  const data = useLoaderData<typeof loader>();
  const refresh = useFetcher<typeof action>();
  const i18n = useI18n();
  const { t } = i18n;
  const ownKeyEngines = data.ownKeys ? usableEngines(data.ownKeys.keys) : [];
  const hero = planView({ ...data, ownKeys: data.ownKeys ? { engines: ownKeyEngines } : null });
  // Subscribed to Own key, but no key works yet: "You can start translating now" would be false.
  const ownKeyMissing = data.ownKeyPlan.current && ownKeyEngines.length === 0;
  const complimentary = data.state === "COMPLIMENTARY";
  // Plan buttons only where a plan can be chosen here: billing on, the app's handle known, not the owner's store.
  const choosePlanUrl = complimentary ? null : data.choosePlanUrl;
  const recommendation = data.configured && choosePlanUrl && data.use ? recommendPlan(data.use) : null;

  const result = refresh.data;
  const toast = !result
    ? null
    : !result.ok
      ? t("plan.toast.failed")
      : result.state === "NONE"
        ? t("plan.toast.none")
        : result.state === "ACTIVE" && result.planHandle
          ? t("plan.toast.confirmed", { plan: planName(result.planHandle) })
          : null;
  useResultToast(result, toast, { isError: Boolean(result && !result.ok) });

  return (
    <s-page heading={t("common.nav.plan")}>
      <s-stack direction="block" gap="large">
        <s-stack direction="block" gap="base">
          <Breadcrumbs i18n={i18n} trail={[{ href: "/app/settings", label: t("common.nav.settings") }]} current={t("common.nav.plan")} />
          <s-stack direction="block" gap="small-300">
            <h1 style={BIG_HEADING}>{t("common.nav.plan")}</h1>
            <s-text color="subdued">{t("plan.page.subtitle")}</s-text>
          </s-stack>
        </s-stack>
        {data.welcome && data.state === "ACTIVE" ? (
          <s-banner tone="success" heading={t("plan.welcome.heading")}>
            {ownKeyMissing ? (
              <s-paragraph>
                {t("plan.welcome.body.ownKey")} <s-link href="/app/settings#settings-keys">{t("plan.welcome.action.ownKey")}</s-link>
              </s-paragraph>
            ) : (
              <s-paragraph>{t("plan.welcome.body")}</s-paragraph>
            )}
          </s-banner>
        ) : null}
        <PlanHero
          i18n={i18n}
          hero={hero}
          now={data.now}
          resetsOn={data.resetsOn}
          entitlements={data.entitlements}
          usage={data.usage}
          limits={data.limits}
          aiAvailable={data.aiAvailable}
          languages={data.languages}
          costPerMillion={data.costPerMillion}
          actions={<HeroActions i18n={i18n} hero={hero} choosePlanUrl={choosePlanUrl} refresh={refresh} />}
          ownKeys={data.ownKeys}
        />
        <PlanCards
          i18n={i18n}
          hero={hero}
          now={data.now}
          intro={complimentary ? "plan.compare.introComplimentary" : choosePlanUrl ? "plan.compare.intro" : "plan.compare.introUnconfigured"}
          choosePlanUrl={choosePlanUrl}
          trial={showTrial({ state: data.state, stale: data.stale, choosePlanUrl })}
          recommendation={recommendation}
          use={data.use}
          ownKeyPlan={data.ownKeyPlan}
        />
        <PlanFeatureTable i18n={i18n} current={hero.current} ownKeyPlan={data.ownKeyPlan} />
        <PlanFaq i18n={i18n} canChange={choosePlanUrl !== null} ownKeyPlan={data.ownKeyPlan} />
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
