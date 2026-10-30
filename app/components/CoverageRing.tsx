/**
 * A language's figure as a ring: done, waiting, outdated and failed texts
 * as segments clockwise from the top, what is missing the empty track, the
 * percentage in the middle. The ring is one image whose label says the
 * same in words (Polaris has no chart component).
 */
import type { StateCounts } from "../lib/coverage-rules";
import { TRACK_COLOUR } from "./Coverage";
import { DRAWN_STATES, ITEM_STATE_LOOK, textCounts } from "./ItemStates";

const RADIUS = 48;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Shortest visible segment, so a single failed text still shows. */
const MIN_SEGMENT = 2;

export function CoverageRing({ counts, figure, caption, label, size = 120 }: { counts: StateCounts; figure: string; caption: string; label: string; size?: number }) {
  const texts = textCounts(counts);
  const total = texts.complete + texts.waiting + texts.outdated + texts.failed + texts.missing;
  // Each segment starts where the one before it ended.
  const segments = DRAWN_STATES.filter((state) => total > 0 && texts[state] > 0).reduce<Array<{ state: (typeof DRAWN_STATES)[number]; length: number; offset: number }>>(
    (drawn, state) => {
      const last = drawn[drawn.length - 1];
      const offset = last ? last.offset + last.length : 0;
      const length = Math.min(CIRCUMFERENCE - offset, Math.max(MIN_SEGMENT, (texts[state] / total) * CIRCUMFERENCE));
      return length > 0 ? [...drawn, { state, length, offset }] : drawn;
    },
    [],
  );
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={TRACK_COLOUR} strokeWidth={STROKE} />
        <g transform="rotate(-90 60 60)" fill="none" strokeWidth={STROKE}>
          {segments.map((s) => (
            <circle
              key={s.state}
              cx="60"
              cy="60"
              r={RADIUS}
              stroke={ITEM_STATE_LOOK[s.state].colour}
              strokeDasharray={`${s.length} ${CIRCUMFERENCE - s.length}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size >= 112 ? 28 : 22, lineHeight: 1.15, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{figure}</span>
        <s-text color="subdued">{caption}</s-text>
      </div>
    </div>
  );
}
