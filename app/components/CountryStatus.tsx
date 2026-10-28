/**
 * The countries a shop sells to, by status, as one bar (parts of the whole)
 * with its key. Status colours from good to critical, always next to their
 * label: the key is the text version of the bar, so the bar itself is hidden
 * from screen readers.
 */
import { COUNTRY_STATUSES, type CountryStatus } from "../lib/country-coverage";
import type { I18n } from "../i18n/i18n";

const COUNTRY_STATUS_COLOURS: Record<CountryStatus, string> = {
  missing: "#d03b3b",
  low: "#ec835a",
  partial: "#fab219",
  ok: "#29845a",
};

function CountryStatusDot({ status }: { status: CountryStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: COUNTRY_STATUS_COLOURS[status], marginInlineEnd: 6, verticalAlign: "middle" }}
    />
  );
}

export function CountryStatusBar({ counts, i18n }: { counts: Record<CountryStatus, number>; i18n: I18n }) {
  const shown = COUNTRY_STATUSES.filter((s) => counts[s] > 0);
  if (!shown.length) return null;
  const text = (s: CountryStatus) => i18n.t(`overview.countries.status.${s}`, { count: counts[s] });
  return (
    <s-stack direction="block" gap="small">
      {/* A 2px gap of the card's surface between the parts, rounded only at the ends. */}
      <div aria-hidden="true" style={{ display: "flex", gap: 2, height: 10, borderRadius: 5, overflow: "hidden" }}>
        {shown.map((s) => (
          <div key={s} title={text(s)} style={{ flex: `${counts[s]} 1 0`, minWidth: 4, background: COUNTRY_STATUS_COLOURS[s] }} />
        ))}
      </div>
      <s-stack direction="inline" gap="small-100 base">
        {shown.map((s) => (
          <s-text key={s}>
            <CountryStatusDot status={s} />
            {text(s)}
          </s-text>
        ))}
      </s-stack>
    </s-stack>
  );
}
