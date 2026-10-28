/**
 * Building blocks of the coverage pages: a segmented bar of field states, a
 * legend whose entries open the matching items, and durations. Colours are
 * the admin's tones; every visual has the same information as text.
 */
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import { FIELD_STATES, percentText, totalOf, type FieldState, type StateCounts } from "../lib/coverage-rules";

export const STATE_COLOURS: Record<FieldState, string> = {
  complete: "#29845a",
  review: "#8051ff",
  draft: "#0094d5",
  failed: "#c70a24",
  outdated: "#b98900",
  missing: "#b5b5b5",
};

/** One bar per item: complete, needs review, draft, failed, outdated and missing, left to right. */
export function StateBar({ counts, label, i18n, height = 10 }: { counts: StateCounts; label: string; i18n: I18n; height?: number }) {
  const total = totalOf(counts);
  const description = FIELD_STATES.filter((s) => counts[s] > 0)
    .map((s) => `${i18n.t(`coverage.state.${s}`)} ${i18n.number(counts[s])}`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={`${label}: ${description || i18n.t("coverage.types.empty")}`}
      style={{ display: "flex", background: "#e3e3e3", borderRadius: height / 2, height, width: "100%", minWidth: 80, overflow: "hidden" }}
    >
      {total > 0
        ? FIELD_STATES.map((s) =>
            counts[s] > 0 ? (
              <div
                key={s}
                style={{ background: STATE_COLOURS[s], width: `${(counts[s] / total) * 100}%`, minWidth: 2, transition: "width 0.3s ease" }}
              />
            ) : null,
          )
        : null}
    </div>
  );
}

export function StateDot({ state }: { state: FieldState }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: STATE_COLOURS[state], marginInlineEnd: 6, verticalAlign: "middle" }}
    />
  );
}

/** "Missing: 120 fields" entries, each a link to those items (states with fields only). */
export function StateLegend({
  counts,
  i18n,
  hrefFor,
  states = FIELD_STATES,
}: {
  counts: StateCounts;
  i18n: I18n;
  hrefFor: (state: FieldState) => string;
  states?: readonly FieldState[];
}) {
  const shown = states.filter((s) => counts[s] > 0);
  if (!shown.length) return null;
  return (
    <s-stack direction="inline" gap="base">
      {shown.map((s) => (
        <s-link key={s} href={hrefFor(s)} accessibilityLabel={`${i18n.t("coverage.stateLink", { state: i18n.t(`coverage.state.${s}`), count: counts[s] })}. ${i18n.t(`coverage.stateHelp.${s}`)}`}>
          <StateDot state={s} />
          {i18n.t(`coverage.state.${s}`)} {i18n.number(counts[s])}
        </s-link>
      ))}
    </s-stack>
  );
}

/** "42%" / "42 %", "<1%" or "—", formatted for the interface language. */
export function percentLabel(i18n: I18n, complete: number, total: number): string {
  const text = percentText(complete, total);
  if (text === "—") return text;
  const format = new Intl.NumberFormat(INTL_LOCALE[i18n.locale], { style: "percent", maximumFractionDigits: 0 });
  return text === "<1" ? `<${format.format(0.01)}` : format.format(Number(text) / 100);
}

/** "3 minutes", "2 hours", "less than a minute", "more than a day". */
export function durationText(i18n: I18n, ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return i18n.t("coverage.duration.underMinute");
  if (minutes < 90) return i18n.t("coverage.duration.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours >= 24) return i18n.t("coverage.duration.overDay");
  return i18n.t("coverage.duration.hours", { count: hours });
}

/** Link to the items behind a number. */
export function itemsHref(params: { lang: string; type?: string | null; group?: string | null; state?: FieldState | "incomplete" | null }) {
  const search = new URLSearchParams({ lang: params.lang });
  if (params.type) search.set("type", params.type);
  if (params.group) search.set("group", params.group);
  if (params.state && params.state !== "incomplete") search.set("state", params.state);
  return `/app/coverage/items?${search.toString()}`;
}
