/**
 * The Settings page's way between its sections: on a wide container a nav
 * card beside the section (each entry its name and a one-line summary of
 * its state, the current one filled), on a phone a list of rows (icon tile,
 * name, a summary of up to two lines, chevron) that open one section each.
 * Every entry is a link to `?section=<key>`. Above them the status row: all
 * is set up, or the one thing that needs the merchant with its fix.
 *
 * Polaris web components; the wide and the narrow form switch by the page's
 * container (Breadcrumbs `touch` does the same), so only one of them is
 * displayed, read and focusable.
 */
import { Fragment, type ReactNode } from "react";
import type { IconName } from "../lib/icons";
import { IconTile } from "./CategoryCard";
import { CARD } from "./ContentTiles";
import { PLAIN_LIST } from "./LanguageLayout";
import { StateBadge, type SettingState } from "./SettingsParts";

/** Shown on a wide container only, or on a narrow one only (the page's s-query-container). */
export const WIDE_ONLY = "@container (inline-size > 640px) auto, none";
export const NARROW_ONLY = "@container (inline-size > 640px) none, auto";

export interface SectionEntry {
  key: string;
  href: string;
  name: string;
  icon: IconName;
  /** One line in the wide nav ("Selbst starten"). */
  summary: string;
  /** Up to two lines in the phone list ("Nichts läuft von selbst"). */
  detail: string;
}

/** A name, semibold: s-text type="strong" keeps the body weight in Polaris. */
const NAME = { display: "block", fontWeight: 600, lineHeight: "20px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const ONE_LINE = { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const TWO_LINES = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minWidth: 0 } as const;
const STATUS_TITLE = { fontWeight: 600, lineHeight: "20px" } as const;

function NavText({ entry }: { entry: SectionEntry }) {
  return (
    <span style={{ display: "grid", minWidth: 0 }}>
      <span style={NAME}>{entry.name}</span>
      <span style={ONE_LINE}>
        <s-text color="subdued">{entry.summary}</s-text>
      </span>
    </span>
  );
}

/** The wide nav: one card, the groups apart by a divider, the current section filled (not a link). */
export function SectionNav({ label, groups, current }: { label: string; groups: SectionEntry[][]; current: string }) {
  return (
    <nav aria-label={label}>
      <s-box {...CARD} padding="small-200">
        <s-stack direction="block" gap="small-200">
          {groups.map((group, index) => (
            <Fragment key={group[0]?.key ?? index}>
              {index > 0 ? <s-divider /> : null}
              <ul style={{ ...PLAIN_LIST, display: "grid", gap: 2 }}>
                {group.map((entry) => (
                  <li key={entry.key}>
                    {entry.key === current ? (
                      <span aria-current="page" style={{ display: "block" }}>
                        <s-box background="subdued" borderRadius="base" padding="small-200 small-100">
                          <NavText entry={entry} />
                        </s-box>
                      </span>
                    ) : (
                      <s-clickable href={entry.href} borderRadius="base" padding="small-200 small-100" inlineSize="100%">
                        <NavText entry={entry} />
                      </s-clickable>
                    )}
                  </li>
                ))}
              </ul>
            </Fragment>
          ))}
        </s-stack>
      </s-box>
    </nav>
  );
}

/** The phone list: a card per group, a row per section (each at least 56 px high, the whole row the link). */
export function SectionList({ label, groups }: { label: string; groups: SectionEntry[][] }) {
  return (
    <nav aria-label={label}>
      <s-stack direction="block" gap="base">
        {groups.map((group, index) => (
          <s-box key={group[0]?.key ?? index} {...CARD} overflow="hidden">
            <ul style={PLAIN_LIST}>
              {group.map((entry, row) => (
                <li key={entry.key}>
                  {row > 0 ? <s-divider /> : null}
                  <s-clickable href={entry.href} padding="small-200 base" minBlockSize="56px" inlineSize="100%">
                    <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" columnGap="small-100" alignItems="center">
                      <IconTile icon={entry.icon} size={40} color="base" />
                      <span style={{ display: "grid", minWidth: 0 }}>
                        <span style={{ ...NAME, whiteSpace: "normal" }}>{entry.name}</span>
                        <span style={TWO_LINES}>
                          <s-text color="subdued">{entry.detail}</s-text>
                        </span>
                      </span>
                      <s-icon type="chevron-right" color="subdued" />
                    </s-grid>
                  </s-clickable>
                </li>
              ))}
            </ul>
          </s-box>
        ))}
      </s-stack>
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

/** The full-width row under the page's heading: a round mark, the bold line, why, and the fix (beside it where there is room). */
export function StatusRow({ id, status, action }: { id?: string; status: StatusView; action?: ReactNode }) {
  return (
    <s-box id={id} {...CARD} padding="base">
      <s-query-container>
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
          <s-icon type={STATUS_ICON[status.tone]} tone={status.tone} />
          <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr auto, 1fr" gap="small-200 base" alignItems="center" justifyItems="start">
            <s-stack direction="block" gap="small-500">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <strong style={STATUS_TITLE}>{status.title}</strong>
                {status.badge ? <StateBadge state={status.badge} /> : null}
              </s-stack>
              {status.detail ? <s-text color="subdued">{status.detail}</s-text> : null}
            </s-stack>
            {action ?? null}
          </s-grid>
        </s-grid>
      </s-query-container>
    </s-box>
  );
}
