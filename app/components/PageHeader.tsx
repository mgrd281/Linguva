/**
 * The header of the five menu pages (Overview, Content, Review, Jobs, Settings) and the Plan page: the page's icon in its
 * tinted square, its heading (h1, the type scale's .lv-h1) and one line under it. The same pattern starts
 * a tools page (ToolHeader), an area's list and the editor, so every page of the app opens the same way.
 * The icons are the places' own: approving is eye-check-mark everywhere, Settings the gear.
 */
import type { ReactNode } from "react";
import type { IconName } from "../lib/icons";
import { IconSquare, type Tint } from "./IconSquare";

/** Each menu page's sign, and the Plan page's: the icon and tint of its tile in Settings ("Plan & usage"). */
export const PAGE_LOOK = {
  overview: { icon: "home", tint: "blue" },
  content: { icon: "content", tint: "teal" },
  review: { icon: "eye-check-mark", tint: "violet" },
  jobs: { icon: "clipboard-checklist", tint: "slate" },
  settings: { icon: "settings", tint: "grey" },
  plan: { icon: "gauge", tint: "rose" },
} as const satisfies Record<string, { icon: IconName; tint: Tint }>;

export type HeaderPage = keyof typeof PAGE_LOOK;

export function PageHeader({ page, title, lead, children }: { page: HeaderPage; title: string; lead?: ReactNode; children?: ReactNode }) {
  const look = PAGE_LOOK[page];
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
      <IconSquare icon={look.icon} tint={look.tint} />
      <s-stack direction="block" gap="small-500">
        <h1 className="lv-h1">{title}</h1>
        {lead ? <s-text color="subdued">{lead}</s-text> : null}
        {children}
      </s-stack>
    </s-grid>
  );
}
