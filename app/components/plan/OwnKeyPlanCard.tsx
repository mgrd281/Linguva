/**
 * The Own key plan's card on the Plan page: outside the ladder of four (so
 * the 1/2/4-column grid above stays as it is), one full-width card under it.
 * Pro's features with the merchant's own DeepL, Microsoft Azure or Google
 * Cloud key, $49 a month, monthly only, never a trial line and never "0 AI
 * characters per month": its figure is the key's own quota. Its button is a
 * link to Shopify's plan page like every other card's (target _top).
 */
import type { ReactNode } from "react";
import type { I18n, MessageKey } from "../../i18n/i18n";
import type { IconType } from "../../lib/icons";
import { OWN_KEY_ICON } from "../../lib/plan-features";
import { formatUsd } from "../../lib/plan-prices";
import { OWN_KEY_NAME, type HeroView, type OwnKeyPlanView } from "../../lib/plan-view";
import { isOwnKeyHandle, OWN_KEY_PLAN } from "../../lib/plans";
import { IconTile } from "../CategoryCard";
import { PLAIN_LIST } from "../LanguageLayout";
import { CARD_NAME, PRICE, STAT } from "./styles";

/** What the plan includes and what it doesn't, in this order (the cost sentence right after the engines). */
const POINTS: ReadonlyArray<{ key: MessageKey; icon: IconType; included: boolean }> = [
  { key: "plan.ownKey.included", icon: "gauge", included: true },
  { key: "plan.ownKey.engines", icon: "connect", included: true },
  { key: "plan.ownKey.cost", icon: "cash-dollar", included: true },
  { key: "plan.ownKey.features", icon: "check-circle", included: true },
  { key: "plan.ownKey.noSmart", icon: "calendar-time", included: false },
  { key: "plan.ownKey.noFallback", icon: "alert-triangle", included: true },
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
  return (
    <div role="group" aria-labelledby={nameId} style={{ position: "relative", isolation: "isolate", minWidth: 0 }}>
      {/* The frame, as the other cards draw it (the current plan's ring inside it, in the text's colour). */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1 }}>
        <s-box background="base" border={current ? "none" : "base"} borderRadius="large-100" blockSize="100%" />
        {current ? <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: "inset 0 0 0 2px currentColor" }} /> : null}
      </div>
      <div style={{ padding: 16 }}>
        <s-query-container>
          {/* Name and price beside what it includes on a wide page, one under the other on a phone. */}
          <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 2fr, 1fr" gap="large">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" alignItems="start" gap="small-200">
                <IconTile icon={OWN_KEY_ICON} size={40} color="base" />
                {badges.length ? <span aria-hidden="true" style={{ flex: "1 0 0" }} /> : null}
                {badges}
              </s-stack>
              <s-stack direction="block" gap="small-500">
                <h3 id={nameId} style={CARD_NAME}>
                  {OWN_KEY_NAME}
                </h3>
                <s-text color="subdued">{t("plan.audience.ownKey")}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small-200" alignItems="baseline">
                  <span style={PRICE}>{formatUsd(i18n.locale, plan.price.monthlyUsd)}</span>
                  <s-text color="subdued" accessibilityVisibility="hidden">
                    {t("plan.price.perMonth")}
                  </s-text>
                  <s-text accessibilityVisibility="exclusive">{t("plan.price.perMonthSpoken")}</s-text>
                </s-stack>
                <s-text color="subdued">{t("plan.price.monthlyOnly")}</s-text>
              </s-stack>
              {button ? (
                <s-stack direction="inline">
                  <s-button href={button} target="_top">
                    {t("plan.compare.choose", { plan: OWN_KEY_NAME })}
                  </s-button>
                </s-stack>
              ) : null}
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
                    <span style={STAT}>{i18n.number(OWN_KEY_PLAN.maxTargetLocales)}</span>
                    <s-text color="subdued">{t("plan.compare.languages", { count: OWN_KEY_PLAN.maxTargetLocales })}</s-text>
                  </s-stack>
                </s-grid>
              </s-grid>
              <s-divider />
              <ul style={{ ...PLAIN_LIST, display: "grid", gap: 10 }}>
                {POINTS.map((point) => (
                  <li key={point.key}>
                    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" columnGap="small-300" alignItems="start">
                      <s-icon type={point.icon} color={point.included ? "base" : "subdued"} />
                      <s-text color={point.included ? undefined : "subdued"}>{t(point.key)}</s-text>
                    </s-grid>
                  </li>
                ))}
              </ul>
            </s-stack>
          </s-grid>
        </s-query-container>
      </div>
    </div>
  );
}
