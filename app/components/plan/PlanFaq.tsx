/**
 * "Good to know": four questions in the app's fold (Disclosure), closed by
 * default, each a full-width row with the chevron at its end, between
 * dividers. The answers state what the code does (a smaller plan deletes
 * nothing, what counts as an AI character, the UTC month, how a plan is
 * changed).
 */
import type { ReactNode } from "react";
import { INTL_LOCALE, type I18n } from "../../i18n/i18n";
import { yearlyHandles } from "../../lib/plan-prices";
import { planName } from "../../lib/plan-view";
import { DEFAULT_PRICES, type PriceTable } from "../../lib/plans";
import { Card } from "../Card";
import { Disclosure } from "../Disclosure";

/** One question: its row in semibold, 44 px high, the answer under it (app/styles/ui.css, .lv-plan-fold). */
function Question({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div className="lv-plan-fold">
      <Disclosure summary={question}>{children}</Disclosure>
    </div>
  );
}

/**
 * `canChange`: the page has a plan button (else the question how to change is left out).
 * `ownKeyPlan`: the Own key plan's question when it is shown; a subscriber's downgrade answer says
 * that characters through its own keys don't count toward the new plan.
 * `prices`: the list prices (which plans have a yearly price; the defaults when absent).
 */
export function PlanFaq({
  i18n,
  canChange,
  ownKeyPlan,
  prices = DEFAULT_PRICES,
}: {
  i18n: I18n;
  canChange: boolean;
  ownKeyPlan?: { visible: boolean; current: boolean } | null;
  prices?: PriceTable;
}) {
  const { t } = i18n;
  const yearly = yearlyHandles(prices);
  return (
    <Card heading={t("plan.faq.heading")}>
      <s-stack direction="block" gap="none">
        <Question question={t("plan.faq.downgrade.q")}>
          <s-paragraph>{t("plan.faq.downgrade.a")}</s-paragraph>
          <s-paragraph>{t("plan.faq.downgrade.stops")}</s-paragraph>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>
              <s-text>{t("plan.faq.downgrade.stopAi")}</s-text>
            </li>
            <li>
              <s-text>{t("plan.faq.downgrade.stopBulk")}</s-text>
            </li>
            <li>
              <s-text>{t("plan.faq.downgrade.stopPublish")}</s-text>
            </li>
            <li>
              <s-text>{t("plan.faq.downgrade.stopSmart")}</s-text>
            </li>
          </ul>
          <s-paragraph>{ownKeyPlan?.current ? t("plan.faq.downgrade.allowance.ownKey") : t("plan.faq.downgrade.allowance")}</s-paragraph>
          <s-paragraph>{t("plan.faq.downgrade.glossary")}</s-paragraph>
        </Question>
        <s-divider />
        <Question question={t("plan.faq.chars.q")}>
          <s-paragraph>{t("plan.faq.chars.a")}</s-paragraph>
        </Question>
        <s-divider />
        <Question question={t("plan.faq.reset.q")}>
          <s-paragraph>{t("plan.faq.reset.a")}</s-paragraph>
        </Question>
        {ownKeyPlan?.visible ? (
          <>
            <s-divider />
            <Question question={t("plan.faq.ownKey.q")}>
              <s-paragraph>{t("plan.faq.ownKey.a")}</s-paragraph>
            </Question>
          </>
        ) : null}
        {canChange ? (
          <>
            <s-divider />
            <Question question={t("plan.faq.change.q")}>
              <s-paragraph>
                {yearly.length
                  ? t("plan.faq.change.aYearly", { plans: new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(yearly.map(planName)) })
                  : t("plan.faq.change.a")}
              </s-paragraph>
            </Question>
          </>
        ) : null}
      </s-stack>
    </Card>
  );
}
