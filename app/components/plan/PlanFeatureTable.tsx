/**
 * "Compare all features": one native table in the app's fold (Disclosure),
 * closed by default (the cards already show every difference). Native, not
 * s-table: Polaris turns s-table into label/value lists on a phone, which
 * repeats four labels per row; one fixed-layout table with short figures
 * fits 390 px. The price row comes first; every row has its feature's icon.
 * The current plan's column is drawn in the cards' chosen look (blue), its
 * head says "Your plan" (app/styles/ui.css, the Plan section).
 */
import { INTL_LOCALE, type I18n } from "../../i18n/i18n";
import { FEATURE_ICON, PLAN_FEATURE_ROWS, PRICE_ROW, type FeatureRow } from "../../lib/plan-features";
import { formatUsd, monthsFree, priceLabel, yearlyHandles } from "../../lib/plan-prices";
import { PLAN_ORDER, planName, type OwnKeyPlanView } from "../../lib/plan-view";
import { PLANS, type KnownPlanHandle, type PlanHandle } from "../../lib/plans";
import { Disclosure } from "../Disclosure";

/** Short figures, so four columns fit a phone: "300.000", "1,2 Mio." (a message, the same text on server and browser). */
function compactChars(i18n: I18n, chars: number): string {
  return chars >= 1_000_000 ? i18n.t("plan.table.million", { value: chars / 1_000_000 }) : i18n.number(chars);
}

export function featureTableCounts() {
  return { rows: PLAN_FEATURE_ROWS.reduce((sum, group) => sum + group.rows.length, 0), groups: PLAN_FEATURE_ROWS.length };
}

/** `ownKeyPlan`: when the Own key plan is shown, one note under the table (it isn't one of the columns). */
export function PlanFeatureTable({ i18n, current, ownKeyPlan }: { i18n: I18n; current: KnownPlanHandle | null; ownKeyPlan?: Pick<OwnKeyPlanView, "visible" | "price"> | null }) {
  const { t } = i18n;
  const counts = featureTableCounts();
  const yearly = yearlyHandles();
  const months = yearly.length ? monthsFree(yearly[0]!) : null;
  // The current plan's cells, in the chosen look (ui.css: .lv-plan-table [data-current]).
  const mine = (handle: PlanHandle) => (handle === current ? { "data-current": "" } : {});
  const value = (row: FeatureRow, handle: PlanHandle) => {
    const v = row.value(PLANS[handle]);
    if (typeof v === "number") return row.key === "chars" ? compactChars(i18n, v) : i18n.number(v);
    return v ? (
      <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
        <s-icon type="check" tone="success" size="small" />
        <s-text accessibilityVisibility="exclusive">{t("plan.compare.included")}</s-text>
      </span>
    ) : (
      <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
        <s-icon type="minus" color="subdued" size="small" />
        <s-text accessibilityVisibility="exclusive">{t("plan.compare.notIncluded")}</s-text>
      </span>
    );
  };
  const label = (row: Pick<FeatureRow, "key" | "label" | "detail">, detail: string | null) => (
    <span className="lv-plan-table__feature">
      <s-icon type={FEATURE_ICON[row.key]} size="small" />
      <span>
        <span className="lv-plan-table__name">{t(row.label)}</span>
        {detail ? (
          <span className="lv-plan-table__detail">
            <s-text color="subdued">{detail}</s-text>
          </span>
        ) : null}
      </span>
    </span>
  );
  // The fold's row: the title, then its size as one unit (on a phone it moves to the next line whole), the chevron at the end.
  const summary = (
    <>
      {t("plan.table.summary")}{" "}
      <span className="lv-plan-fold__detail">
        <s-text color="subdued">{t("plan.table.summaryDetail", { count: counts.rows, groups: counts.groups })}</s-text>
      </span>
    </>
  );
  return (
    <s-section padding="none">
      <div className="lv-plan-fold lv-plan-fold--table">
        <Disclosure summary={summary}>
          <table className="lv-plan-table">
            <caption>
              <s-text accessibilityVisibility="exclusive">{t("plan.table.caption")}</s-text>
            </caption>
            <thead>
              <tr>
                <th scope="col" className="lv-plan-table__head lv-plan-table__head--feature">
                  <s-text color="subdued">{t("plan.table.feature")}</s-text>
                </th>
                {PLAN_ORDER.map((handle) => (
                  <th key={handle} scope="col" className="lv-plan-table__head lv-plan-table__head--plan" {...mine(handle)}>
                    {planName(handle)}
                    {handle === current ? (
                      <span className="lv-plan-table__mine">
                        <s-text accessibilityVisibility="exclusive"> – </s-text>
                        {t("plan.hero.label")}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="lv-plan-table__label lv-plan-table__label--price">
                  {label(PRICE_ROW, months ? t("plan.price.rowYearly", { plans: new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(yearly.map(planName)), count: months }) : null)}
                </th>
                {PLAN_ORDER.map((handle) => (
                  <td key={handle} className="lv-plan-table__value lv-plan-table__value--price" {...mine(handle)}>
                    {priceLabel(i18n, handle)}
                  </td>
                ))}
              </tr>
            </tbody>
            {PLAN_FEATURE_ROWS.map((group) => (
              <tbody key={group.key}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="lv-plan-table__group">
                    {t(group.label)}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="lv-plan-table__label">
                      {label(row, row.detail ? t(row.detail) : null)}
                    </th>
                    {PLAN_ORDER.map((handle) => (
                      <td key={handle} className="lv-plan-table__value" {...mine(handle)}>
                        {value(row, handle)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {ownKeyPlan?.visible ? (
            <div className="lv-plan-table__note">
              <s-text color="subdued">{t("plan.compare.ownKeyNote", { price: formatUsd(i18n.locale, ownKeyPlan.price.monthlyUsd) })}</s-text>
            </div>
          ) : null}
        </Disclosure>
      </div>
    </s-section>
  );
}
