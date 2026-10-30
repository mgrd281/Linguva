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
  // Light: what is missing reads as the open part of the bar, not as a value.
  missing: "#d4d4d4",
};

/** Empty part of every bar (Polaris' subdued surface). */
export const TRACK_COLOUR = "#ebebeb";

/** A card's own surface (Polaris' base background), for marks drawn over pictures. */
export const SURFACE_COLOUR = "#ffffff";

/** Behind numbers marked in a text (Review's number hints): a light yellow that keeps text contrast. */
export const MARK_COLOUR = "#ffef9d";

/**
 * Drafts and translations waiting for review aren't live yet: striped, so a
 * bar full of drafts never looks like a complete one.
 */
const NOT_LIVE: ReadonlySet<FieldState> = new Set(["review", "draft"]);
export function stateFill(state: FieldState): string {
  const colour = STATE_COLOURS[state];
  return NOT_LIVE.has(state) ? `repeating-linear-gradient(135deg, ${colour} 0 4px, ${colour}66 4px 7px)` : colour;
}

/** One bar per item: complete, needs review, draft, failed, outdated and missing, left to right. */
export function StateBar({ counts, label, i18n, height = 8 }: { counts: StateCounts; label: string; i18n: I18n; height?: number }) {
  const total = totalOf(counts);
  const description = FIELD_STATES.filter((s) => counts[s] > 0)
    .map((s) => `${i18n.t(`coverage.state.${s}`)} ${i18n.number(counts[s])}`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={`${label}: ${description || i18n.t("coverage.types.empty")}`}
      style={{ display: "flex", gap: total > 0 ? 1 : 0, background: TRACK_COLOUR, borderRadius: height / 2, height, width: "100%", minWidth: 80, overflow: "hidden" }}
    >
      {total > 0
        ? FIELD_STATES.map((s) =>
            counts[s] > 0 ? (
              <div key={s} style={{ background: stateFill(s), width: `${(counts[s] / total) * 100}%`, minWidth: 3, transition: "width 0.3s ease" }} />
            ) : null,
          )
        : null}
    </div>
  );
}

/** Percentage and bar on one line, the percentage aligned for scanning down a table. */
export function CoverageMeter({ counts, complete, total, label, i18n }: { counts: StateCounts; complete: number; total: number; label: string; i18n: I18n }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 140 }}>
      <div style={{ flex: "1 1 auto", minWidth: 80 }}>
        <StateBar counts={counts} label={label} i18n={i18n} />
      </div>
      <span style={{ flex: "0 0 auto", minWidth: 40, textAlign: "end", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{percentLabel(i18n, complete, total)}</span>
    </div>
  );
}

export function StateDot({ state }: { state: FieldState }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: stateFill(state), marginInlineEnd: 6, verticalAlign: "middle" }}
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

/** The states with fields, as a key to the bar: "● Complete 11 ● Draft 18 …" (text, no links). */
export function StateSummary({ counts, i18n }: { counts: StateCounts; i18n: I18n }) {
  const shown = FIELD_STATES.filter((s) => counts[s] > 0);
  if (!shown.length) return null;
  return (
    <s-stack direction="inline" gap="base">
      {shown.map((s) => (
        <s-text key={s} color="subdued">
          <StateDot state={s} />
          {i18n.t(`coverage.state.${s}`)} {i18n.number(counts[s])}
        </s-text>
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
