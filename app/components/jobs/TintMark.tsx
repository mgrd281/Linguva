/**
 * A soft round mark: a Polaris icon on a circle tinted with its colour, as
 * Review's done mark. The Jobs list's empty and no-match states (56 px) and
 * a queued job's hero, in the ring's place (112 px on wide cards, 96 px on
 * narrow ones), share it. Decorative: the heading beside it says the same in
 * words.
 */
import type { IconName } from "../../lib/icons";

/** The icon grows with the circle: 1.25 at 40 px, 1.5 from 56, 2.2 from 96, 2.5 from 112. */
export function tintMarkScale(size: number): number {
  return size >= 112 ? 2.5 : size >= 96 ? 2.2 : size >= 56 ? 1.5 : 1.25;
}

/**
 * `colour` is a #rrggbb colour (STATE_COLOURS): the fill takes it at 8 %, the 1 px border at 25 %.
 * Without one the mark is neutral (nothing has happened yet): the app's subdued surface and edge.
 */
export function TintMark({ icon, tone, colour, size = 40 }: { icon: IconName; tone: JSX.IntrinsicElements["s-icon"]["tone"]; colour?: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        flex: "none",
        boxSizing: "border-box",
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        background: colour ? `${colour}14` : "var(--lv-surface-subdued)",
        border: colour ? `1px solid ${colour}40` : "1px solid var(--lv-border)",
      }}
    >
      <span style={{ display: "flex", transform: `scale(${tintMarkScale(size)})` }}>
        <s-icon type={icon} tone={tone} />
      </span>
    </span>
  );
}
