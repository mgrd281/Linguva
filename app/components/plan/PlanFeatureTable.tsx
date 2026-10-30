/**
 * "Compare all features": one native table in a native <details>, closed
 * by default (the cards already show every difference). Native, not
 * s-table: Polaris turns s-table into label/value lists on a phone, which
 * repeats four labels per row; one fixed-layout table with short figures
 * fits 390 px. The price row comes first; every row has its feature's icon.
 */
import { INTL_LOCALE, type I18n } from "../../i18n/i18n";
import { FEATURE_ICON, PLAN_FEATURE_ROWS, PRICE_ROW, type FeatureRow } from "../../lib/plan-features";
import { monthsFree, priceLabel, yearlyHandles } from "../../lib/plan-prices";
import { PLAN_ORDER, planName } from "../../lib/plan-view";
import { PLANS, type PlanHandle } from "../../lib/plans";
import { TRACK_COLOUR } from "../Coverage";
import { EMPHASIS } from "./styles";

const LINE = `1px solid ${TRACK_COLOUR}`;
/** The current plan's column and the group rows. */
const TINT = `${TRACK_COLOUR}80`;
const TABLE = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13, lineHeight: "18px" } as const;
const LABEL_CELL = { padding: "10px 4px 10px 16px", textAlign: "left", fontWeight: 500, verticalAlign: "middle", borderTop: LINE, overflowWrap: "break-word" } as const;
const VALUE_CELL = { padding: "10px 1px", textAlign: "center", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", verticalAlign: "middle", borderTop: LINE } as const;
const HEAD_CELL = { padding: "12px 1px", fontSize: 12, lineHeight: "16px", fontWeight: 650, letterSpacing: "-0.01em", textAlign: "center", verticalAlign: "bottom", borderTop: LINE } as const;
const DETAIL = { display: "block", fontSize: 12, lineHeight: "16px", fontWeight: 400, marginTop: 2 } as const;
/** Only long words break, at a hyphen ("Übersetzungs-speicher"); short ones never. */
const HYPHENATE = { hyphens: "auto", WebkitHyphens: "auto", hyphenateLimitChars: "10 4 4" } as const;

/** Short figures, so four columns fit a phone: "300.000", "1,2 Mio." (a message, the same text on server and browser). */
function compactChars(i18n: I18n, chars: number): string {
  return chars >= 1_000_000 ? i18n.t("plan.table.million", { value: chars / 1_000_000 }) : i18n.number(chars);
}

export function featureTableCounts() {
  return { rows: PLAN_FEATURE_ROWS.reduce((sum, group) => sum + group.rows.length, 0), groups: PLAN_FEATURE_ROWS.length };
}

export function PlanFeatureTable({ i18n, current }: { i18n: I18n; current: PlanHandle | null }) {
  const { t } = i18n;
  const counts = featureTableCounts();
  const yearly = yearlyHandles();
  const months = yearly.length ? monthsFree(yearly[0]!) : null;
  const tint = (handle: PlanHandle) => (handle === current ? { background: TINT } : {});
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
    <span style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      <s-icon type={FEATURE_ICON[row.key]} size="small" />
      <span style={{ minWidth: 0 }}>
        <span style={HYPHENATE}>{t(row.label)}</span>
        {detail ? (
          <span style={DETAIL}>
            <s-text color="subdued">{detail}</s-text>
          </span>
        ) : null}
      </span>
    </span>
  );
  return (
    <s-section padding="none">
      <details>
        <summary style={{ padding: "14px 20px", cursor: "pointer", minHeight: 44, boxSizing: "border-box" }}>
          <span style={EMPHASIS}>{t("plan.table.summary")}</span>
          {/* One unit: on a phone it moves to the next line whole ("18 features in 5 groups"), never split, and then
              starts under the title (the marker and its space are 14 px wide). */}
          <span style={{ display: "inline-block", marginInlineStart: 14 }}>
            <s-text color="subdued">{t("plan.table.summaryDetail", { count: counts.rows, groups: counts.groups })}</s-text>
          </span>
        </summary>
        <table style={TABLE}>
          <caption>
            <s-text accessibilityVisibility="exclusive">{t("plan.table.caption")}</s-text>
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...HEAD_CELL, width: "40%", textAlign: "left", paddingInlineStart: 16 }}>
                <s-text color="subdued">{t("plan.table.feature")}</s-text>
              </th>
              {PLAN_ORDER.map((handle) => (
                <th key={handle} scope="col" style={{ ...HEAD_CELL, width: "15%", ...tint(handle) }}>
                  {planName(handle)}
                  {handle === current ? (
                    <span style={{ display: "block", fontSize: 11, lineHeight: "14px", fontWeight: 500 }}>
                      <s-text accessibilityVisibility="exclusive"> – </s-text>
                      {t("plan.table.yourPlan")}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" style={{ ...LABEL_CELL, fontWeight: 650 }}>
                {label(PRICE_ROW, months ? t("plan.price.rowYearly", { plans: new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(yearly.map(planName)), count: months }) : null)}
              </th>
              {PLAN_ORDER.map((handle) => (
                // The word "Free" may break only where its message allows (a soft hyphen in German).
                <td key={handle} style={{ ...VALUE_CELL, fontWeight: 700, whiteSpace: "normal", ...tint(handle) }}>
                  {priceLabel(i18n, handle)}
                </td>
              ))}
            </tr>
          </tbody>
          {PLAN_FEATURE_ROWS.map((group) => (
            <tbody key={group.key}>
              <tr>
                <th scope="rowgroup" colSpan={5} style={{ padding: "8px 16px", textAlign: "left", fontSize: 12, lineHeight: "16px", fontWeight: 650, background: TINT, borderTop: LINE }}>
                  {t(group.label)}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" style={LABEL_CELL}>
                    {label(row, row.detail ? t(row.detail) : null)}
                  </th>
                  {PLAN_ORDER.map((handle) => (
                    <td key={handle} style={{ ...VALUE_CELL, ...tint(handle) }}>
                      {value(row, handle)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </details>
    </s-section>
  );
}
