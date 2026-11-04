/**
 * The header of the five menu pages (Overview, Content, Review, Jobs, Settings), the Plan page and the smart schedule's page: the page's icon in its
 * tinted square, its heading (h1, the type scale's .lv-h1) and one line under it. The same pattern starts
 * a tools page (ToolHeader), an area's list and the editor, so every page of the app opens the same way.
 * The icons are the places' own: approving is eye-check-mark everywhere, Settings the gear.
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
  plan: { icon: "gauge", tint: "rose" },
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

export function PageHeader({
  page,
  title,
  lead,
  trail,
  children,
}: {
  page: HeaderPage;
  title: string;
  lead?: ReactNode;
  /** Links up to the page (the Plan page's "Settings"): the trail, a 44 px back row on a phone, as a tools page has. */
  trail?: { i18n: I18n; links: Array<{ href: string; label: string }> };
  children?: ReactNode;
}) {
  const look = PAGE_LOOK[page];
  return (
    <s-query-container>
      {/* The trail as close to the heading as on a tools page (ToolHeader): every page opens the same way. */}
      <s-stack direction="block" gap="small-200">
        {trail ? <Breadcrumbs i18n={trail.i18n} trail={trail.links} current={title} touch /> : null}
        <HeaderRow sign={<IconSquare icon={look.icon} tint={look.tint} />} lead={Boolean(lead)}>
          <s-stack direction="block" gap="small-500">
            <h1 className="lv-h1">{title}</h1>
            {lead ? <s-text color="subdued">{lead}</s-text> : null}
            {children}
          </s-stack>
        </HeaderRow>
      </s-stack>
    </s-query-container>
  );
}
