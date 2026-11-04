/**
 * The Settings page's way between its sections: square buttons, one per
 * section (its icon in a tinted square, its name, its state in a few words,
 * a dot where it needs the merchant), in two groups. On a wide container one
 * row above the section, the current one framed in blue (`aria-current`);
 * narrower, four in a row; on a phone three in a row (a last one alone
 * across the row), each opening its section alone. A tile's words start at
 * its top, so a row's icons line up where a name wraps. Every tile is a
 * link to `?section=<key>` (React Router: no
 * reload, and the page's data isn't loaded again); a click on the current
 * one stays. Above them the status row: all set up, or the one thing that
 * needs the merchant with its fix.
 *
 * Styles in app/styles/ui.css (.lv-tile, .lv-status). The wide and the
 * narrow form switch by the page's container (Breadcrumbs `touch` does the
 * same), so only one of them is displayed, read and focusable.
 */
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import type { IconName } from "../lib/icons";
import { IconSquare, StateBadge, type SettingState, type Tint } from "./SettingsParts";

export type { Tint };

/** Shown on a wide container only, or on a narrow one only (the page's s-query-container). */
export const WIDE_ONLY = "@container (inline-size > 640px) auto, none";
export const NARROW_ONLY = "@container (inline-size > 640px) none, auto";

export interface SectionEntry {
  key: string;
  href: string;
  /** The section's name, as its heading says it (also the tile's accessible name). */
  name: string;
  /** The name as the tile shows it: soft hyphens where a long word must break ("Übersetzungs­speicher"). */
  tileName?: string;
  icon: IconName;
  tint: Tint;
  /** Its state in a few words ("Selbst starten", "Pro · 0 % genutzt"). */
  state: string;
  /** Needs the merchant: the state in this tone, with a dot. */
  tone?: "warning" | "critical" | null;
}

/**
 * A click on the current tile stays: a link to the same address would load the page's data again. With a
 * modifier key the browser still opens it (a new tab or window), as it does every other tile.
 */
function stay(event: MouseEvent<HTMLAnchorElement>) {
  if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) event.preventDefault();
}

function Tile({ entry, current }: { entry: SectionEntry; current: boolean }) {
  // A name with soft hyphens is shown as it breaks and read as the word itself.
  const split = entry.tileName !== undefined && entry.tileName !== entry.name;
  return (
    <Link
      to={entry.href}
      className="lv-tile"
      data-section={entry.key}
      {...(entry.tone ? { "data-tone": entry.tone } : {})}
      {...(current ? { "aria-current": "page" as const, onClick: stay } : {})}
    >
      <IconSquare icon={entry.icon} tint={entry.tint} />
      {split ? <span className="lv-sr">{entry.name}</span> : null}
      <span className="lv-tile__name" {...(split ? { "aria-hidden": true } : {})}>
        {split ? entry.tileName : entry.name}
      </span>
      <span className="lv-tile__state">{entry.state}</span>
      {entry.tone ? <span className="lv-tile__dot" aria-hidden="true" /> : null}
    </Link>
  );
}

/**
 * The tiles: one list, the groups apart by a little room and a fine line (`current`: the tile of the
 * section shown beside them; none on a phone's list).
 */
export function SectionTiles({ label, groups, current }: { label: string; groups: SectionEntry[][]; current: string | null }) {
  return (
    <nav aria-label={label} className="lv-tilenav">
      <ul className="lv-tilenav__list">
        {groups.flatMap((group, index) =>
          group.map((entry, row) => (
            <li key={entry.key} className="lv-tilenav__item" {...(index > 0 && row === 0 ? { "data-group-start": "" } : {})}>
              <Tile entry={entry} current={entry.key === current} />
            </li>
          )),
        )}
      </ul>
    </nav>
  );
}

/** What the status row says: all set up (success), or what needs the merchant and its one fix. */
export interface StatusView {
  tone: "success" | "warning" | "critical";
  title: string;
  /** Beside the title (the state of translating changes). */
  badge?: SettingState | null;
  detail?: string | null;
}

const STATUS_ICON: Record<StatusView["tone"], IconName> = { success: "check-circle-filled", warning: "alert-triangle", critical: "alert-circle" };

/**
 * The full-width row under the page's heading, tinted by its tone: a round mark, the bold line, why, and
 * the fix (beside it where there is room). Inside a card the same row says a feature's state (the smart
 * schedule paused or waiting), so one state has one look everywhere.
 */
export function StatusRow({ id, status, action }: { id?: string; status: StatusView; action?: ReactNode }) {
  return (
    <div id={id} className="lv-status" data-tone={status.tone}>
      <div className="lv-status__row">
        <span className="lv-status__mark" aria-hidden="true">
          <s-icon type={STATUS_ICON[status.tone]} tone={status.tone} />
        </span>
        <div className="lv-status__body">
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <strong className="lv-status__title">{status.title}</strong>
              {status.badge ? <StateBadge state={status.badge} /> : null}
            </s-stack>
            {status.detail ? <s-text color="subdued">{status.detail}</s-text> : null}
          </s-stack>
          {action ?? null}
        </div>
      </div>
    </div>
  );
}
