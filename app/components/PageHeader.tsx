/**
 * The header of the five menu pages (Overview, Content, Review, Jobs, Settings), the Plan page and the smart schedule's page: the page's icon in its
 * tinted square, its heading (h1, the type scale's .lv-h1) and one line under it. The same pattern starts
 * a tools page (ToolHeader), an area's list and the editor, so every page of the app opens the same way.
 * The icons are the places' own: approving is eye-check-mark everywhere, Settings the gear, the Plan a
 * credit card (gauge means AI characters only).
 *
 * A page that is about one thing shows that thing's sign instead of a page's icon (`sign`): a language's
 * flag, an area's icon square, an item's picture. Badges that belong to the heading (a language's
 * "Visible", a job's state) sit beside it (`badges`).
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import type { IconName } from "../lib/icons";
import { IconSquare, type Tint } from "./IconSquare";
import { Breadcrumbs } from "./LanguageLayout";

/**
 * Each menu page's sign, the Plan page's (its tile in Settings, "Plan & usage") and the smart schedule's (its
 * choice in Settings' "Translating changes").
 */
export const PAGE_LOOK = {
  overview: { icon: "home", tint: "blue" },
  content: { icon: "content", tint: "teal" },
  review: { icon: "eye-check-mark", tint: "violet" },
  jobs: { icon: "clipboard-checklist", tint: "slate" },
  settings: { icon: "settings", tint: "grey" },
  // Plan & usage: a credit card (what the store pays for); gauge is the AI characters' sign only.
  plan: { icon: "credit-card", tint: "rose" },
  smart: { icon: "calendar-time", tint: "violet" },
} as const satisfies Record<string, { icon: IconName; tint: Tint }>;

export type HeaderPage = keyof typeof PAGE_LOOK;

/**
 * The sign beside the heading and its lead: centred on them on a wide page; on a narrow one, where the lead
 * wraps to several lines, level with the heading (ui.css, .lv-page-head), as centring would move it beside
 * the lead. A heading alone keeps it centred. Shared with ToolHeader.
 */
export function HeaderRow({ sign, lead, children }: { sign: ReactNode; lead: boolean; children: ReactNode }) {
  return (
    <div className={lead ? "lv-page-head" : undefined}>
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
        {sign}
        {children}
      </s-grid>
    </div>
  );
}

/** The page's sign: one of the menu pages' (PAGE_LOOK), or the thing the page is about (a flag, an area's icon, a picture). */
type HeaderSign = { page: HeaderPage; sign?: never } | { sign: ReactNode; page?: never };

/** Links up to the page: the trail, a 44 px back row on a phone, as a tools page has. */
export interface HeaderTrail {
  i18n: I18n;
  links: Array<{ href: string; label: string; before?: ReactNode }>;
  /** The page's own name at the trail's end, when it is shorter than the heading ("Products" for "Products in German"). */
  current?: string;
}

export function PageHeader({
  page,
  sign,
  title,
  badges,
  lead,
  trail,
  children,
}: HeaderSign & {
  title: string;
  /** Beside the heading, on its line: what the heading's subject is ("Visible", a job's state). */
  badges?: ReactNode;
  lead?: ReactNode;
  /** Links up to the page (the Plan page's "Settings"): the trail, a 44 px back row on a phone, as a tools page has. */
  trail?: HeaderTrail;
  children?: ReactNode;
}) {
  const look = page ? PAGE_LOOK[page] : null;
  const heading = <h1 className="lv-h1">{title}</h1>;
  return (
    <s-query-container>
      {/* The trail as close to the heading as on a tools page (ToolHeader): every page opens the same way. */}
      <s-stack direction="block" gap="small-200">
        {trail ? <Breadcrumbs i18n={trail.i18n} trail={trail.links} current={trail.current ?? title} touch /> : null}
        <HeaderRow sign={look ? <IconSquare icon={look.icon} tint={look.tint} /> : sign} lead={Boolean(lead)}>
          <s-stack direction="block" gap="small-500">
            {badges ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {heading}
                {badges}
              </s-stack>
            ) : (
              heading
            )}
            {lead ? <s-text color="subdued">{lead}</s-text> : null}
            {children}
          </s-stack>
        </HeaderRow>
      </s-stack>
    </s-query-container>
  );
}
