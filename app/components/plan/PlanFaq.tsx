/**
 * "Good to know": four questions in native <details>, closed by default.
 * The answers state what the code does (a smaller plan deletes nothing,
 * what counts as an AI character, the UTC month, how a plan is changed).
 */
import type { ReactNode } from "react";
import { INTL_LOCALE, type I18n } from "../../i18n/i18n";
import { yearlyHandles } from "../../lib/plan-prices";
import { planName } from "../../lib/plan-view";

function Question({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details>
      <summary style={{ cursor: "pointer", minHeight: 44, padding: "12px 0", boxSizing: "border-box" }}>
        <s-text type="strong">{question}</s-text>
      </summary>
      <div style={{ padding: "0 0 16px 18px" }}>
        <s-stack direction="block" gap="small-200">
          {children}
        </s-stack>
      </div>
    </details>
  );
}

/** `canChange`: the page has a plan button (else the question how to change is left out). */
export function PlanFaq({ i18n, canChange }: { i18n: I18n; canChange: boolean }) {
  const { t } = i18n;
  const yearly = yearlyHandles();
  return (
    <s-section heading={t("plan.faq.heading")}>
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
          <s-paragraph>{t("plan.faq.downgrade.allowance")}</s-paragraph>
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
    </s-section>
  );
}
