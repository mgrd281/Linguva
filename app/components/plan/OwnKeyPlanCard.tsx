/**
 * The Own key plan's card on the Plan page: outside the ladder of four (so
 * the 1/2/4-column grid above stays as it is), one full-width card under it.
 * Pro's features with the merchant's own DeepL, Microsoft Azure or Google
 * Cloud key, its list price (OwnKeyPlanView.price: $49 a month, monthly only,
 * unless the admin console set another), never a trial line and never "0 AI
 * characters per month": its figure is the key's own quota. Its button is a
 * link to Shopify's plan page like every other card's (target _top), at the
 * card's foot as on the four cards.
 */
import type { ReactNode } from "react";
import type { I18n, MessageKey } from "../../i18n/i18n";
import type { IconType } from "../../lib/icons";
import { OWN_KEY_ICON, PLAN_TINT } from "../../lib/plan-features";
import { formatUsd, monthsFree } from "../../lib/plan-prices";
import { OWN_KEY_NAME, type HeroView, type OwnKeyPlanView } from "../../lib/plan-view";
import { DEFAULT_PRICES, isOwnKeyHandle, OWN_KEY, OWN_KEY_PLAN } from "../../lib/plans";
import { Button } from "../Button";
import { IconSquare } from "../IconSquare";
import { PLAIN_LIST } from "../LanguageLayout";
import { CardBack } from "./CardBack";

/**
 * What the plan includes and what it doesn't, in this order (the cost sentence right after the engines).
 * The features end in the cards' marks (included ✓, not included –); the two rules about cost and a
 * used-up key are no features and carry none. Each sentence says it in words too ("Kein …").
 */
const POINTS: ReadonlyArray<{ key: MessageKey; icon: IconType; mark: "included" | "excluded" | null }> = [
  { key: "plan.ownKey.engines", icon: OWN_KEY_ICON, mark: "included" },
  { key: "plan.ownKey.cost", icon: "cash-dollar", mark: null },
  { key: "plan.ownKey.features", icon: "check-circle", mark: "included" },
  { key: "plan.ownKey.noSmart", icon: "calendar-time", mark: "excluded" },
  { key: "plan.ownKey.noFallback", icon: "alert-triangle", mark: null },
];

export interface OwnKeyPlanCardProps {
  i18n: I18n;
  plan: OwnKeyPlanView;
  hero: Pick<HeroView, "current" | "pending">;
  now: string;
}

export function OwnKeyPlanCard({ i18n, plan, hero, now }: OwnKeyPlanCardProps) {
  const { t } = i18n;
  const current = plan.current && isOwnKeyHandle(hero.current);
  const pendingDate = isOwnKeyHandle(hero.pending?.handle) ? (hero.pending?.date ?? null) : null;
  const nameId = "plan-own-key";
  const badges: ReactNode[] = [];
  if (current)
    badges.push(
      <s-badge key="current" tone="info" color="strong" icon="check-circle">
        {t("plan.hero.label")}
      </s-badge>,
    );
  if (pendingDate)
    badges.push(
      <s-badge key="pending" tone="info" icon="calendar">
        {t("plan.compare.from", { date: i18n.dayMonth(pendingDate, now) })}
      </s-badge>,
    );
  const button = plan.choosePlanUrl !== null && !current ? plan.choosePlanUrl : null;
  const months = monthsFree(OWN_KEY, { ...DEFAULT_PRICES, [OWN_KEY]: plan.price });
  // The allowance comes from OWN_KEY_PLAN, never typed into a text.
  const words = (key: MessageKey) => (key === "plan.ownKey.features" ? t(key, { count: OWN_KEY_PLAN.maxTargetLocales }) : t(key));
  return (
    <div role="group" aria-labelledby={nameId} className="lv-plan-card lv-plan-card--wide">
      <CardBack current={current} />
      <s-query-container>
        {/* Name and price beside what it includes on a wide page, one under the other on a phone. */}
        <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 2fr, 1fr" gap="large">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" alignItems="start" gap="small-200">
              <IconSquare icon={OWN_KEY_ICON} tint={PLAN_TINT} />
              {badges.length ? <span aria-hidden="true" style={{ flex: "1 0 0" }} /> : null}
              {badges}
            </s-stack>
            <s-stack direction="block" gap="small-500">
              <h3 id={nameId} className="lv-h2">
                {OWN_KEY_NAME}
              </h3>
              <s-text color="subdued">{t("plan.audience.ownKey")}</s-text>
            </s-stack>
            <s-stack direction="block" gap="small-300">
              <s-stack direction="inline" gap="small-200" alignItems="baseline">
                <span className="lv-plan-price">{formatUsd(i18n.locale, plan.price.monthlyUsd)}</span>
                <s-text color="subdued" accessibilityVisibility="hidden">
                  {t("plan.price.perMonth")}
                </s-text>
                <s-text accessibilityVisibility="exclusive">{t("plan.price.perMonthSpoken")}</s-text>
              </s-stack>
              {plan.price.yearlyUsd !== null ? (
                // A yearly price set in the admin console: the four cards' yearly line.
                <s-stack direction="inline" alignItems="start" gap="small-300">
                  <s-text color="subdued" accessibilityVisibility="hidden">
                    {t("plan.price.yearly", { amount: formatUsd(i18n.locale, plan.price.yearlyUsd) })}
                  </s-text>
                  <s-text accessibilityVisibility="exclusive">{t("plan.price.yearlySpoken", { amount: formatUsd(i18n.locale, plan.price.yearlyUsd) })}</s-text>
                  {months ? <s-badge tone="success">{t("plan.price.monthsFree", { count: months })}</s-badge> : null}
                </s-stack>
              ) : (
                <s-text color="subdued">{t("plan.price.monthlyOnly")}</s-text>
              )}
            </s-stack>
          </s-stack>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small-300">
              {/* Its figure is the key's own quota, never "0 AI characters per month". */}
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-300" alignItems="start">
                <s-icon type="gauge" />
                <s-text>{t("plan.ownKey.stat")}</s-text>
              </s-grid>
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-300" alignItems="start">
                <s-icon type="language" />
                <s-stack direction="block" gap="small-500">
                  <span className="lv-figure-row lv-plan-stat">{i18n.number(OWN_KEY_PLAN.maxTargetLocales)}</span>
                  <s-text color="subdued">{t("plan.compare.languages", { count: OWN_KEY_PLAN.maxTargetLocales })}</s-text>
                </s-stack>
              </s-grid>
            </s-grid>
            <s-divider />
            <ul style={{ ...PLAIN_LIST, display: "grid", gap: 10 }}>
              {POINTS.map((point) => (
                <li key={point.key}>
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" columnGap="small-300" alignItems="start">
                    <s-icon type={point.icon} color={point.mark === "excluded" ? "subdued" : "base"} />
                    <s-text color={point.mark === "excluded" ? "subdued" : undefined}>{words(point.key)}</s-text>
                    {point.mark === "included" ? (
                      <s-icon type="check" tone="success" size="small" />
                    ) : point.mark === "excluded" ? (
                      <s-icon type="minus" color="subdued" size="small" />
                    ) : (
                      <span />
                    )}
                  </s-grid>
                </li>
              ))}
            </ul>
          </s-stack>
        </s-grid>
      </s-query-container>
      {button ? (
        <div className="lv-plan-card__foot">
          <Button href={button} target="_top">
            {t("plan.compare.choose", { plan: OWN_KEY_NAME })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
