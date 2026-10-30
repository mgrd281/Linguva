/**
 * "Compare plans": the four plans side by side, each with its sign, its
 * list price (display only, from PLAN_PRICES), its allowances and the five
 * features plans differ in; "Fits your store", computed only from the
 * store's own use; the footnote on prices; and "In every plan". Every plan
 * button is a link to Shopify's plan page (target _top): the app never
 * creates or changes a subscription.
 *
 * The cards share their rows (CSS subgrid), so prices, figures, features
 * and buttons line up across the cards in four and in two columns, in any
 * language. Polaris has no subgrid: the cards are native groups, their
 * frame a Polaris box behind the content.
 */
import type { ReactNode } from "react";
import { INTL_LOCALE, type I18n, type MessageKey } from "../../i18n/i18n";
import { everyPlanRows, FEATURE_ICON, PLAN_CARD_FEATURES, PLAN_ICON } from "../../lib/plan-features";
import { formatUsd, monthsFree, priceLabel } from "../../lib/plan-prices";
import { PLAN_ORDER, planName, type FitReason, type HeroView, type ShopUse } from "../../lib/plan-view";
import { PLAN_PRICES, PLANS, TRIAL_AI_CHARS, TRIAL_DAYS, type PlanHandle } from "../../lib/plans";
import { IconTile } from "../CategoryCard";
import { PLAIN_LIST } from "../LanguageLayout";
import { CARD_NAME, PRICE, SECTION_HEADING, STAT, SUB_HEADING } from "./styles";

const AUDIENCE: Record<PlanHandle, MessageKey> = {
  free: "plan.audience.free",
  starter: "plan.audience.starter",
  pro: "plan.audience.pro",
  business: "plan.audience.business",
};

const REASON: Record<Exclude<FitReason, "languages" | "chars">, MessageKey> = {
  bulk: "plan.recommend.part.bulk",
  auto: "plan.recommend.part.auto",
  autoPublish: "plan.recommend.part.autoPublish",
  smart: "plan.recommend.part.smart",
};

/** "The smallest plan for your 4 languages and automatic publishing." */
export function recommendationReason(i18n: I18n, reasons: readonly FitReason[], use: ShopUse): string {
  if (reasons.length === 0) return i18n.t("plan.recommend.reasonFree");
  const parts = reasons.map((reason) =>
    reason === "languages"
      ? i18n.t("plan.recommend.part.languages", { count: use.languages })
      : reason === "chars"
        ? i18n.t("plan.recommend.part.chars", { count: use.monthChars })
        : i18n.t(REASON[reason]),
  );
  return i18n.t("plan.recommend.reason", { reasons: new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(parts) });
}

export interface PlanCardsProps {
  i18n: I18n;
  hero: HeroView;
  now: string;
  /** The intro under the heading: how a plan is chosen, or why it can't be now. */
  intro: MessageKey;
  /** Shopify's plan page, when the store can choose a plan here (else no plan buttons). */
  choosePlanUrl: string | null;
  /** The paid cards' trial line (showTrial). */
  trial: boolean;
  recommendation: { plan: PlanHandle; reasons: FitReason[] } | null;
  use: ShopUse | null;
}

export function PlanCards({ i18n, hero, now, intro, choosePlanUrl, trial, recommendation, use }: PlanCardsProps) {
  const { t } = i18n;
  const buttonFor = (handle: PlanHandle) => choosePlanUrl !== null && hero.current !== handle;
  const hasFoot = PLAN_ORDER.some((handle) => buttonFor(handle) || (trial && PLAN_PRICES[handle].monthlyUsd > 0));
  const strip = everyPlanRows(Object.values(PLANS));
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <h2 id="tarife" style={SECTION_HEADING}>
          {t("plan.compare.heading")}
        </h2>
        <s-paragraph color="subdued">{t(intro)}</s-paragraph>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small-200">
          {recommendation && use ? (
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
              <s-icon type="target" tone="info" />
              <s-text>
                <s-text type="strong">{t("plan.recommend.line", { plan: planName(recommendation.plan) })}</s-text> {recommendationReason(i18n, recommendation.reasons, use)}
              </s-text>
            </s-grid>
          ) : (
            <span />
          )}
          {/* The rows say it in words too. */}
          <span aria-hidden="true">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-stack direction="inline" gap="small-500" alignItems="center">
                <s-icon type="check" tone="success" size="small" />
                <s-text color="subdued">{t("plan.compare.included")}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-500" alignItems="center">
                <s-icon type="minus" color="subdued" size="small" />
                <s-text color="subdued">{t("plan.compare.notIncluded")}</s-text>
              </s-stack>
            </s-stack>
          </span>
        </s-stack>
      </s-stack>
      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, (inline-size > 900px) 1fr 1fr 1fr 1fr, 1fr" gap="base">
          {PLAN_ORDER.map((handle) => (
            <PlanCard
              key={handle}
              i18n={i18n}
              handle={handle}
              hero={hero}
              now={now}
              rows={hasFoot ? 8 : 7}
              button={buttonFor(handle) ? choosePlanUrl : null}
              trial={trial && PLAN_PRICES[handle].monthlyUsd > 0}
              fits={recommendation?.plan === handle}
            />
          ))}
        </s-grid>
      </s-query-container>
      <s-paragraph color="subdued">{t(choosePlanUrl ? "plan.price.footnote" : "plan.price.usd")}</s-paragraph>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
            <s-icon type="check-circle" tone="success" />
            <s-stack direction="block" gap="small-500">
              <h3 style={SUB_HEADING}>{t("plan.everyPlan.heading")}</h3>
              <s-text color="subdued">{t("plan.everyPlan.lead")}</s-text>
            </s-stack>
          </s-grid>
          <ul style={{ ...PLAIN_LIST, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: "12px 24px" }}>
            {strip.map((row) => (
              <li key={row.key}>
                <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-100" alignItems="center">
                  <IconTile icon={FEATURE_ICON[row.key]} size={32} color="base" />
                  <s-text>{t(row.everyPlanLabel ?? row.label)}</s-text>
                </s-grid>
              </li>
            ))}
          </ul>
        </s-stack>
      </s-section>
    </s-stack>
  );
}

interface PlanCardProps {
  i18n: I18n;
  handle: PlanHandle;
  hero: HeroView;
  now: string;
  /** The rows every card has (shared across the cards in a grid row). */
  rows: number;
  /** Shopify's plan page for this card's button; null: no button. */
  button: string | null;
  trial: boolean;
  fits: boolean;
}

function PlanCard({ i18n, handle, hero, now, rows, button, trial, fits }: PlanCardProps) {
  const { t } = i18n;
  const plan = PLANS[handle];
  const price = PLAN_PRICES[handle];
  const paid = price.monthlyUsd > 0;
  const current = hero.current === handle;
  const nameId = `plan-${handle}`;
  const badges: ReactNode[] = [];
  // Polaris draws neutral + strong exactly like a plain neutral badge ("Versteckt"): the
  // spec's fallback, info + strong, keeps the current plan's marker distinct.
  if (current)
    badges.push(
      <s-badge key="current" tone="info" color="strong" icon="check-circle">
        {t("plan.hero.label")}
      </s-badge>,
    );
  if (handle === "free" && hero.freeAppliesNow)
    badges.push(
      <s-badge key="now" tone="neutral" icon="status-active">
        {t("plan.compare.appliesNow")}
      </s-badge>,
    );
  if (hero.pending?.handle === handle && hero.pending.date)
    badges.push(
      <s-badge key="pending" tone="info" icon="calendar">
        {t("plan.compare.from", { date: i18n.dayMonth(hero.pending.date, now) })}
      </s-badge>,
    );
  if (fits)
    badges.push(
      <s-badge key="fits" tone="info" icon="target">
        {t("plan.recommend.badge")}
      </s-badge>,
    );
  const months = monthsFree(handle);
  return (
    <div
      role="group"
      aria-labelledby={nameId}
      style={{ position: "relative", isolation: "isolate", display: "grid", gridTemplateRows: "subgrid", gridRow: `span ${rows}`, rowGap: 16, padding: 16, minWidth: 0 }}
    >
      {/* The card's frame, behind its rows. The current plan's ring lies inside the frame, so its edges line up with
          the other cards', and is drawn in the text's own colour (Polaris' dark ink, no colour of its own). */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
        <s-box background="base" border={current ? "none" : "base"} borderRadius="large-100" blockSize="100%" />
        {current ? <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: "inset 0 0 0 2px currentColor" }} /> : null}
      </div>
      {/* The sign, then each badge on its own: beside the sign at the right while it fits, else on the next line at
          the left. So a state badge ("Your plan", "Applies now", "from …") keeps its place and only a badge too wide
          for a narrow card moves below the sign. */}
      <s-stack direction="inline" alignItems="start" gap="small-200">
        <IconTile icon={PLAN_ICON[handle]} size={40} color="base" />
        {badges.length ? <span aria-hidden="true" style={{ flex: "1 0 0" }} /> : null}
        {badges}
      </s-stack>
      <s-stack direction="block" gap="small-500">
        <h3 id={nameId} style={CARD_NAME}>
          {planName(handle)}
        </h3>
        <s-text color="subdued">{t(AUDIENCE[handle])}</s-text>
      </s-stack>
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" alignItems="baseline">
          <span style={PRICE}>{priceLabel(i18n, handle)}</span>
          {paid ? (
            <>
              <s-text color="subdued" accessibilityVisibility="hidden">
                {t("plan.price.perMonth")}
              </s-text>
              <s-text accessibilityVisibility="exclusive">{t("plan.price.perMonthSpoken")}</s-text>
            </>
          ) : null}
        </s-stack>
        {price.yearlyUsd !== null ? (
          // Stacked when four cards stand side by side (a card is too narrow for both), inline otherwise.
          <s-stack direction="@container (inline-size > 900px) block, inline" alignItems="start" gap="small-300">
            <s-text color="subdued" accessibilityVisibility="hidden">
              {t("plan.price.yearly", { amount: formatUsd(i18n.locale, price.yearlyUsd) })}
            </s-text>
            <s-text accessibilityVisibility="exclusive">{t("plan.price.yearlySpoken", { amount: formatUsd(i18n.locale, price.yearlyUsd) })}</s-text>
            {months ? <s-badge tone="success">{t("plan.price.monthsFree", { count: months })}</s-badge> : null}
          </s-stack>
        ) : paid ? (
          <s-text color="subdued">{t("plan.price.monthlyOnly")}</s-text>
        ) : null}
      </s-stack>
      <s-divider />
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="small-300">
        <Stat icon="gauge" value={i18n.number(plan.monthlyChars)} caption={t("plan.compare.chars")} />
        <Stat icon="language" value={i18n.number(plan.maxTargetLocales)} caption={t("plan.compare.languages", { count: plan.maxTargetLocales })} />
      </s-grid>
      <s-divider />
      <ul style={{ ...PLAIN_LIST, display: "grid", gap: 10, alignContent: "start" }}>
        {PLAN_CARD_FEATURES.map((row) => {
          const included = row.value(plan) === true;
          return (
            <li key={row.key}>
              <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" columnGap="small-300" alignItems="start">
                <s-icon type={FEATURE_ICON[row.key]} color={included ? "base" : "subdued"} />
                <s-text color={included ? undefined : "subdued"}>
                  <s-text accessibilityVisibility="exclusive">{`${t(included ? "plan.compare.includedPrefix" : "plan.compare.notIncludedPrefix")} `}</s-text>
                  {t(row.label)}
                </s-text>
                {included ? <s-icon type="check" tone="success" size="small" /> : <s-icon type="minus" color="subdued" size="small" />}
              </s-grid>
            </li>
          );
        })}
      </ul>
      {rows > 7 ? (
        // At the bottom of the card, so the buttons line up whatever is above them.
        <div style={{ alignSelf: "end" }}>
          {trial || button ? (
            <s-stack direction="block" gap="base" alignItems="start">
              {trial ? (
                <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-400" alignItems="start">
                  <s-icon type="clock" size="small" />
                  <s-text>{t("plan.price.trial", { count: TRIAL_DAYS, chars: i18n.number(TRIAL_AI_CHARS) })}</s-text>
                </s-grid>
              ) : null}
              {button ? (
                <s-button href={button} target="_top">
                  {t("plan.compare.choose", { plan: planName(handle) })}
                </s-button>
              ) : null}
            </s-stack>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ icon, value, caption }: { icon: "gauge" | "language"; value: string; caption: string }) {
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-300" alignItems="start">
      <s-icon type={icon} />
      <s-stack direction="block" gap="small-500">
        <span style={STAT}>{value}</span>
        <s-text color="subdued">{caption}</s-text>
      </s-stack>
    </s-grid>
  );
}
