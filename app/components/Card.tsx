/**
 * A card of a page, in the app's one look on every width: a native section
 * with the card's edge (CARD; Polaris draws its sections flat on a phone,
 * where their padding then reads as a stray indent under the page's header)
 * and its heading in the type scale (.lv-h2, as the Overview's and Import &
 * export's cards). The tools pages and the Plan page take it, as Settings,
 * the Overview and Content take CARD.
 *
 * Never a Polaris section heading beside a visible one: s-section's heading
 * is a second heading for screen readers (CI's axe check found them).
 */
import { useId, type ReactNode } from "react";
import { CARD } from "./LanguageLayout";

/** A grid item that is a grid itself, so its card fills the row's height beside a taller one. */
const FILL = { display: "grid" } as const;

export function Card({
  heading,
  labelledBy,
  padding = "base",
  fill = false,
  children,
}: {
  /** The card's h2; it names the section too. */
  heading?: string;
  /** Without a heading of its own: the id of the heading inside that names the card (the Plan hero's "Your plan: Pro"). */
  labelledBy?: string;
  /** "none": a table or a fold that runs to the card's edges; the heading keeps its room. */
  padding?: "base" | "none";
  /** Beside other cards in a stretched grid row: as high as the row. */
  fill?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const named = heading ? id : labelledBy;
  const title = heading ? (
    <h2 id={id} className="lv-h2">
      {heading}
    </h2>
  ) : null;
  const size = fill ? { blockSize: "100%" as const } : {};
  return (
    <section {...(named ? { "aria-labelledby": named } : {})} {...(fill ? { style: FILL } : {})}>
      {padding === "none" ? (
        // Clipped to the card's corners: a table's rows run to its edges.
        <s-box {...CARD} padding="none" overflow="hidden" {...size}>
          {title ? <s-box padding="base base small-200">{title}</s-box> : null}
          {children}
        </s-box>
      ) : (
        <s-box {...CARD} padding="base" {...size}>
          {title ? (
            <s-stack direction="block" gap="base">
              {title}
              {children}
            </s-stack>
          ) : (
            children
          )}
        </s-box>
      )}
    </section>
  );
}
