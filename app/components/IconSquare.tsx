/**
 * An icon in a soft square: a Settings section's tile, an option, a tool, an
 * area, a step, a notice. The square's colour (`tint`) names a place, never a
 * state (states are words, badges and their own icons); grey is the quiet
 * default. Styles in app/styles/ui.css (.lv-icon-square, [data-tint]).
 */
import type { CSSProperties } from "react";
import type { IconName } from "../lib/icons";

/** A place's colour behind its icon (ui.css, [data-tint]). */
export type Tint = "blue" | "green" | "violet" | "amber" | "slate" | "teal" | "rose" | "grey";

/** 40 px unless `size` says otherwise; squares under 32 px take the small icon unless `iconSize` says otherwise. */
export function IconSquare({
  icon,
  tint = "grey",
  size = 40,
  color = "base",
  iconSize,
}: {
  icon: IconName;
  tint?: Tint;
  size?: number;
  color?: "base" | "subdued";
  iconSize?: "small" | "base";
}) {
  const style: CSSProperties | undefined = size === 40 ? undefined : { width: size, height: size, borderRadius: Math.max(6, Math.round(size * 0.3)) };
  return (
    <span className="lv-icon-square" data-tint={tint} aria-hidden="true" style={style}>
      <s-icon type={icon} color={color} size={iconSize ?? (size < 32 ? "small" : "base")} />
    </span>
  );
}
