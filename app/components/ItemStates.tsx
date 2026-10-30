/**
 * The five states of a text on the language pages, the same everywhere: an
 * icon and a word, never colour alone. Done, waiting for approval (drafts
 * with and without quality notes alike), outdated, failed and missing.
 * Bars draw them in the colours of Coverage.tsx; what is missing is the
 * empty part of the track, and waiting is one solid colour, always named
 * beside its icon.
 */
import type { I18n } from "../i18n/i18n";
import type { StateCounts } from "../lib/coverage-rules";
import type { ItemState } from "../lib/language-categories";
import { STATE_COLOURS, SURFACE_COLOUR, TRACK_COLOUR } from "./Coverage";
import { PLAIN_LIST } from "./LanguageLayout";

/** The states in reading order: what is live first, what is missing last. */
export const SHOWN_STATES = ["complete", "waiting", "outdated", "failed", "missing"] as const satisfies readonly ItemState[];

/** The states drawn on bars and rings (missing is the track). */
export const DRAWN_STATES = ["complete", "waiting", "outdated", "failed"] as const satisfies readonly ItemState[];

export const ITEM_STATE_LOOK = {
  complete: { icon: "check-circle-filled", tone: "success", colour: STATE_COLOURS.complete },
  waiting: { icon: "clock", tone: "info", colour: STATE_COLOURS.draft },
  outdated: { icon: "refresh", tone: "caution", colour: STATE_COLOURS.outdated },
  failed: { icon: "alert-circle", tone: "critical", colour: STATE_COLOURS.failed },
  missing: { icon: "circle-dashed", tone: "neutral", colour: TRACK_COLOUR },
} as const satisfies Record<ItemState, { icon: string; tone: string; colour: string }>;

/** Texts per item state: drafts with and without quality notes both wait for approval. */
export function textCounts(counts: StateCounts): Record<ItemState, number> {
  return { complete: counts.complete, waiting: counts.draft + counts.review, outdated: counts.outdated, failed: counts.failed, missing: counts.missing };
}

/** "74 done, 18 waiting for approval, …" for the states with texts. */
export function stateSummary(i18n: I18n, counts: StateCounts): string {
  const texts = textCounts(counts);
  return SHOWN_STATES.filter((s) => texts[s] > 0)
    .map((s) => i18n.t(`language.count.${s}`, { count: texts[s] }))
    .join(", ");
}

/** A state's icon; `slot`: where it goes in a Polaris component (a chip's "graphic"). */
export function StateIcon({ state, size = "base", slot }: { state: ItemState; size?: "small" | "base"; slot?: Lowercase<string> }) {
  const look = ITEM_STATE_LOOK[state];
  // Missing has no colour of its own: the subdued text colour.
  return state === "missing" ? <s-icon slot={slot} type={look.icon} color="subdued" size={size} /> : <s-icon slot={slot} type={look.icon} tone={look.tone} size={size} />;
}

/** "✓ 74 done  ◷ 18 waiting for approval …": the states with texts, each icon and words. */
export function StateCountList({ counts, i18n }: { counts: StateCounts; i18n: I18n }) {
  const texts = textCounts(counts);
  const shown = SHOWN_STATES.filter((s) => texts[s] > 0);
  if (!shown.length) return null;
  return (
    <s-stack direction="inline" gap="small-100 base" alignItems="center">
      {shown.map((s) => (
        <s-stack key={s} direction="inline" gap="small-300" alignItems="center">
          <StateIcon state={s} size="small" />
          <s-text color="subdued">{i18n.t(`language.count.${s}`, { count: texts[s] })}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

/** "✓ 15 done – customers see them": one line per state with texts, the figure first (a hero's list). */
export function StateLines({ counts, i18n }: { counts: StateCounts; i18n: I18n }) {
  const texts = textCounts(counts);
  return (
    <ul style={{ ...PLAIN_LIST, display: "grid", gap: 6 }}>
      {SHOWN_STATES.filter((s) => texts[s] > 0).map((s) => (
        <li key={s}>
          <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
            <StateIcon state={s} size="small" />
            <s-text>
              <s-text type="strong">{i18n.number(texts[s])}</s-text> {i18n.t(`language.hero.state.${s}`, { count: texts[s] })}
            </s-text>
          </s-grid>
        </li>
      ))}
    </ul>
  );
}

/** One bar per area: done, waiting, outdated and failed from the left; the empty rest is missing. */
export function TextStateBar({ counts, label, i18n, height = 8 }: { counts: StateCounts; label: string; i18n: I18n; height?: number }) {
  const texts = textCounts(counts);
  const total = SHOWN_STATES.reduce((n, s) => n + texts[s], 0);
  return (
    <div
      role="img"
      aria-label={`${label}: ${stateSummary(i18n, counts) || i18n.t("coverage.types.empty")}`}
      style={{ display: "flex", gap: 1, background: TRACK_COLOUR, borderRadius: height / 2, height, width: "100%", overflow: "hidden" }}
    >
      {total > 0
        ? DRAWN_STATES.map((s) =>
            texts[s] > 0 ? <div key={s} style={{ background: ITEM_STATE_LOOK[s].colour, width: `${(texts[s] / total) * 100}%`, minWidth: 3, transition: "width 0.3s ease" }} /> : null,
          )
        : null}
    </div>
  );
}

/** A picture's state: its icon on a small white disc in the corner (decorative, the state is also written below). */
export function StateMarker({ state }: { state: ItemState }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        insetInlineEnd: 6,
        insetBlockEnd: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        background: SURFACE_COLOUR,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <StateIcon state={state} size="small" />
    </span>
  );
}

/** The key to bars and markers: each state's icon and word. */
export function StateKey({ i18n }: { i18n: I18n }) {
  return (
    <s-stack direction="inline" gap="small-100 base" alignItems="center">
      {SHOWN_STATES.map((s) => (
        <s-stack key={s} direction="inline" gap="small-300" alignItems="center">
          <StateIcon state={s} size="small" />
          <s-text color="subdued">{i18n.t(`language.state.${s}`)}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}
