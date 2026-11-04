/**
 * Emphasis in the app's type: Polaris draws `s-text type="strong"` at the
 * body weight (450), so a name or a lead phrase that must stand out is a
 * `<strong>` at 600 (ui.css, .lv-strong). The type scale's other classes
 * (.lv-h1, .lv-h2, .lv-h3, .lv-figure, .lv-figure-row, .lv-caption) are used
 * on the elements themselves.
 */
import type { ReactNode } from "react";

/** A name that leads its card, row or line ("Produkte", "Belgien", "Erste Übersetzung veröffentlichen"). */
export function Strong({ children }: { children: ReactNode }) {
  return <strong className="lv-strong">{children}</strong>;
}
