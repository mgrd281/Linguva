/**
 * What the Jobs list and a job's page draw the same way: each outcome
 * group's icon and colour (the legend, the bar, the ring), each job state's
 * badge, the origin badges, and the words of a JobText in the interface
 * language and the store's time zone (app/lib/job-view.ts jobText). Never
 * colour alone: every mark has its words beside it.
 */
import { useMemo, type ReactNode } from "react";
import type { I18n } from "../../i18n/i18n";
import { useI18n } from "../../i18n/react";
import type { IconName } from "../../lib/icons";
import {
  AUTO_STARTER,
  displayParts,
  jobText,
  jobValue,
  STATE_WORD,
  type JobGroups,
  type JobState,
  type JobText,
  type LanguageNames,
  type LegendLine,
  type OutcomeGroup,
  type TextValue,
  type When,
} from "../../lib/job-view";
import { SMART_REQUESTED_BY } from "../../lib/smart-auto";
import { durationText, KEPT_COLOUR, STATE_COLOURS, TRACK_COLOUR } from "../Coverage";
import type { RingSegment } from "../CoverageRing";
import { PLAIN_LIST } from "../LanguageLayout";

type IconTone = JSX.IntrinsicElements["s-icon"]["tone"];
type BadgeTone = JSX.IntrinsicElements["s-badge"]["tone"];

/** Light grey for what wasn't translated: darker than the open track, so it reads as a share, not as what is left. */
export const NOT_TRANSLATED_COLOUR = STATE_COLOURS.missing;

/** An outcome group's icon, tone and colour: the language pages' looks for translated, waiting and failed. */
export const GROUP_LOOK: Readonly<Record<OutcomeGroup, { icon: IconName; tone: IconTone | null; colour: string }>> = {
  translated: { icon: "check-circle-filled", tone: "success", colour: STATE_COLOURS.complete },
  waiting: { icon: "clock", tone: "info", colour: STATE_COLOURS.draft },
  kept: { icon: "check-circle", tone: "success", colour: KEPT_COLOUR },
  look: { icon: "alert-triangle", tone: "caution", colour: STATE_COLOURS.outdated },
  failed: { icon: "alert-circle", tone: "critical", colour: STATE_COLOURS.failed },
  notYet: { icon: "circle-dashed", tone: null, colour: NOT_TRANSLATED_COLOUR },
  skipped: { icon: "minus-circle", tone: null, colour: NOT_TRANSLATED_COLOUR },
  open: { icon: "circle-dashed", tone: null, colour: TRACK_COLOUR },
};

/** A job state's badge: the same icon and tone in the list and on the job's page. */
export const STATE_LOOK: Readonly<Record<JobState, { icon: IconName; tone: BadgeTone }>> = {
  queued: { icon: "clock", tone: "info" },
  finding: { icon: "search", tone: "info" },
  running: { icon: "refresh", tone: "info" },
  done: { icon: "check-circle", tone: "success" },
  doneLook: { icon: "alert-triangle", tone: "caution" },
  doneErrors: { icon: "alert-circle", tone: "critical" },
  stopped: { icon: "pause-circle", tone: "critical" },
  stoppedWait: { icon: "pause-circle", tone: "warning" },
  cancelled: { icon: "x-circle", tone: "neutral" },
};

/** The ring's or the bar's parts: the groups with items in their display order, what is open last (the track). */
export function groupSegments(groups: JobGroups): RingSegment[] {
  return displayParts(groups).map(({ group, count }) => ({ colour: GROUP_LOOK[group].colour, count }));
}

/** A group's icon (subdued for the groups without a tone of their own). */
export function GroupIcon({ group, size = "small" }: { group: OutcomeGroup | "paused"; size?: "small" | "base" }) {
  if (group === "paused") return <s-icon type="pause-circle" tone="warning" size={size} />;
  const look = GROUP_LOOK[group];
  return look.tone ? <s-icon type={look.icon} tone={look.tone} size={size} /> : <s-icon type={look.icon} color="subdued" size={size} />;
}

/** The words of the Jobs pages' texts: the page's helpers in the store's zone, its clock and Shopify's language names. */
export interface JobWords {
  i18n: I18n;
  say: (text: JobText) => string;
  value: (value: TextValue) => string;
}

export function useJobWords(now: When, names?: LanguageNames): JobWords {
  const i18n = useI18n();
  return useMemo(() => {
    const context = { now, duration: (ms: number) => durationText(i18n, ms), names };
    return { i18n, say: (text: JobText) => jobText(i18n, text, context), value: (value: TextValue) => jobValue(i18n, value, context) };
  }, [i18n, now, names]);
}

/** A job state's badge: its icon and word. */
export function StateBadge({ state, words }: { state: JobState; words: JobWords }) {
  const look = STATE_LOOK[state];
  return (
    <s-badge tone={look.tone} icon={look.icon}>
      {words.i18n.t(STATE_WORD[state])}
    </s-badge>
  );
}

/** Automatic translation's and the smart schedule's jobs, and a job of the texts for Google only, carry a badge. */
export function OriginBadges({ job, words, skipOrigin = false }: { job: { requestedBy: string | null; fieldScope: string }; words: JobWords; skipOrigin?: boolean }) {
  const { t } = words.i18n;
  const badges: ReactNode[] = [];
  if (!skipOrigin && job.requestedBy === AUTO_STARTER) badges.push(<s-badge key="auto">{t("common.automatic")}</s-badge>);
  if (!skipOrigin && job.requestedBy === SMART_REQUESTED_BY)
    badges.push(
      <s-badge key="smart" tone="info" icon="calendar-time">
        {t("automatic.name")}
      </s-badge>,
    );
  if (job.fieldScope === "SEO") badges.push(<s-badge key="seo">{t("jobs.badge.seo")}</s-badge>);
  return badges.length ? <>{badges}</> : null;
}

/** The legend: one line per group with items, its icon and figure with words. */
export function Legend({ lines, words, label }: { lines: readonly LegendLine[]; words: JobWords; label: string }) {
  if (!lines.length) return null;
  return (
    <ul aria-label={label} style={{ ...PLAIN_LIST, display: "grid", gap: 6 }}>
      {lines.map((line) => (
        <li key={line.group}>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <GroupIcon group={line.group} />
            <s-text>{words.say(line.text)}</s-text>
          </s-stack>
        </li>
      ))}
    </ul>
  );
}

/**
 * A segmented bar of a job's groups (what is open is the track), for a list
 * row; `striped` while the job still finds its items. Decorative: the row's
 * words say the same.
 */
export function GroupBar({ groups, striped = false }: { groups: JobGroups; striped?: boolean }) {
  const parts = striped ? [] : groupSegments(groups).filter((part) => part.colour !== TRACK_COLOUR);
  const total = Math.max(1, groups.total);
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        background: striped ? `repeating-linear-gradient(-45deg, ${TRACK_COLOUR} 0 6px, #f6f6f6 6px 12px)` : TRACK_COLOUR,
      }}
    >
      {parts.map((part, i) => (
        <span key={i} style={{ flex: "none", width: `${(part.count / total) * 100}%`, minWidth: part.count > 0 ? 2 : 0, background: part.colour }} />
      ))}
    </div>
  );
}
