/**
 * A figure as a ring: coloured segments clockwise from the top, what is
 * left the empty track, the figure in the middle. The ring is one image
 * whose label says the same in words (Polaris has no chart component).
 *
 * A language's coverage passes `counts`: done, waiting, outdated and failed
 * texts, missing is the track. A job passes `segments` in its display order
 * (what ended well first, then the problems, what is left last in
 * TRACK_COLOUR), and `dashed` while it is still finding its items: the track
 * in dashes and no segments, since nothing has a share yet.
 */
import type { StateCounts } from "../lib/coverage-rules";
import { ringFigureSize } from "../lib/job-view";
import { TRACK_COLOUR } from "./Coverage";
import { DRAWN_STATES, ITEM_STATE_LOOK, textCounts } from "./ItemStates";

const RADIUS = 48;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Shortest visible segment, so a single failed text still shows. */
const MIN_SEGMENT = 2;
/** The track of a figure that is still being found. */
const DASHES = "6 5";

/** A part of the ring: its colour and how many items or texts it stands for. TRACK_COLOUR is what is left. */
export interface RingSegment {
  colour: string;
  count: number;
}

/**
 * The figure's size by its length in characters (a no-break space counts: "62 %" has 4), so a longer figure
 * stays inside the ring: 28 px up to 3 characters ("34%", "—"), 24 px for 4 ("62 %", "100%"), 22 px from 5
 * ("100 %") in a ring of 112 px or more; 22, 20 and 18 px in a smaller one. One rule, in the Jobs view logic
 * (app/lib/job-view.ts), so a job's hero model (ringFigure) and the drawn ring always agree.
 */
export { ringFigureSize };

/** A language's texts as segments: the drawn states in their order, then the missing ones (the track). */
function countSegments(counts: StateCounts): RingSegment[] {
  const texts = textCounts(counts);
  return [...DRAWN_STATES.map((state) => ({ colour: ITEM_STATE_LOOK[state].colour, count: texts[state] })), { colour: TRACK_COLOUR, count: texts.missing }];
}

export function CoverageRing({
  counts,
  segments,
  dashed = false,
  figure,
  caption,
  label,
  size = 120,
}: {
  counts?: StateCounts;
  /** Used instead of `counts` when given, drawn in this order. */
  segments?: readonly RingSegment[];
  /** Still finding: the track in dashes, no segments. */
  dashed?: boolean;
  figure: string;
  caption: string;
  label: string;
  size?: number;
}) {
  const parts = segments ?? (counts ? countSegments(counts) : []);
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  // Each segment starts where the one before it ended. What is left comes last and stays the track.
  const drawn = dashed
    ? []
    : parts
        .filter((part) => total > 0 && part.count > 0 && part.colour !== TRACK_COLOUR)
        .reduce<Array<{ colour: string; length: number; offset: number }>>((list, part) => {
          const last = list[list.length - 1];
          const offset = last ? last.offset + last.length : 0;
          const length = Math.min(CIRCUMFERENCE - offset, Math.max(MIN_SEGMENT, (part.count / total) * CIRCUMFERENCE));
          return length > 0 ? [...list, { colour: part.colour, length, offset }] : list;
        }, []);
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={TRACK_COLOUR} strokeWidth={STROKE} strokeDasharray={dashed ? DASHES : undefined} />
        <g transform="rotate(-90 60 60)" fill="none" strokeWidth={STROKE}>
          {drawn.map((s, i) => (
            <circle key={i} cx="60" cy="60" r={RADIUS} stroke={s.colour} strokeDasharray={`${s.length} ${CIRCUMFERENCE - s.length}`} strokeDashoffset={-s.offset} />
          ))}
        </g>
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: ringFigureSize(figure, size), lineHeight: 1.15, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{figure}</span>
        <s-text color="subdued">{caption}</s-text>
      </div>
    </div>
  );
}
