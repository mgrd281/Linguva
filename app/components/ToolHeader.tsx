/**
 * The header of a page in Settings › Tools (glossary, languages, translation
 * memory, coverage, Countries & markets, import & export): the trail back to
 * Settings › Tools (a 44 px back row "‹ Tools" on a phone), the tool's icon
 * in the tinted square of its tile in Settings, the page's heading (h1, the
 * type scale's .lv-h1) and one line that says what the page is for. What
 * the page shows at a glance (the memory's figures) goes under it.
 *
 * The admin's title bar keeps the page's heading (s-page) and gets the way
 * back too: put `<ToolsBreadcrumbSlot />` directly inside s-page.
 */
import type { ReactNode } from "react";
import type { I18n } from "../i18n/i18n";
import type { IconName } from "../lib/icons";
import { IconSquare, type Tint } from "./IconSquare";
import { Breadcrumbs } from "./LanguageLayout";
import { HeaderRow } from "./PageHeader";

/** Settings' tools section: where every tools page leads back to. */
export const TOOLS_HREF = "/app/settings?section=tools";

/**
 * Each tool's sign: the icon and tint of its tile in Settings › Tools (app.settings.tsx, TOOLS). Import &
 * export is a spreadsheet: files that go out and come back, as the page's CSV (the Plan page's too).
 */
export const TOOL_LOOK = {
  glossary: { href: "/app/glossary", icon: "book-open", tint: "violet" },
  languages: { href: "/app/languages", icon: "language", tint: "blue" },
  markets: { href: "/app/markets", icon: "globe", tint: "teal" },
  memory: { href: "/app/memory", icon: "database", tint: "amber" },
  coverage: { href: "/app/coverage", icon: "chart-donut", tint: "green" },
  transfer: { href: "/app/translations", icon: "data-table", tint: "slate" },
} as const satisfies Record<string, { href: string; icon: IconName; tint: Tint }>;

export type ToolId = keyof typeof TOOL_LOOK;

/** "Settings › Tools": the trail every tools page starts with. */
export function toolsTrail(i18n: I18n): Array<{ href: string; label: string }> {
  return [
    { href: "/app/settings", label: i18n.t("common.nav.settings") },
    { href: TOOLS_HREF, label: i18n.t("settings.tools.heading") },
  ];
}

/** The admin title bar's way back (s-page's breadcrumb slot): a direct child of s-page. */
export function ToolsBreadcrumbSlot({ i18n, href = TOOLS_HREF, label }: { i18n: I18n; href?: string; label?: string }) {
  return (
    <s-link slot="breadcrumb-actions" href={href}>
      {label ?? i18n.t("settings.tools.heading")}
    </s-link>
  );
}

export function ToolHeader({
  tool,
  title,
  lead,
  i18n,
  trail,
  children,
}: {
  tool: ToolId;
  title: string;
  lead: string;
  i18n: I18n;
  /** Links up to the page (default: Settings › Tools); the last one is the phone's back row. */
  trail?: Array<{ href: string; label: string }>;
  /** Under the heading: what the page shows at a glance. */
  children?: ReactNode;
}) {
  const look = TOOL_LOOK[tool];
  return (
    <s-query-container>
      <s-stack direction="block" gap="small-200">
        <Breadcrumbs i18n={i18n} trail={trail ?? toolsTrail(i18n)} current={title} touch />
        <HeaderRow sign={<IconSquare icon={look.icon} tint={look.tint} />} lead>
          <s-stack direction="block" gap="small-500">
            <h1 className="lv-h1">{title}</h1>
            <s-text color="subdued">{lead}</s-text>
          </s-stack>
        </HeaderRow>
        {children}
      </s-stack>
    </s-query-container>
  );
}
