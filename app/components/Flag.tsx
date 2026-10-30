/**
 * A country's flag (country-flag-icons, vendored in public/flags; see
 * docs/THIRD_PARTY_NOTICES.md) in a 3:2 frame with rounded corners and a
 * hairline border, so white flags keep their edge. Decorative only: the
 * country's or language's name is always next to it as text.
 */
import type { CSSProperties } from "react";
import { FLAG_COUNTRIES } from "../lib/flags";
import { TRACK_COLOUR } from "./Coverage";

export type FlagSize = 20 | 28 | 40;

// 3:2 in whole pixels, so the border stays sharp.
const HEIGHT: Record<FlagSize, number> = { 20: 13, 28: 19, 40: 27 };
const CODE_FONT_SIZE: Record<FlagSize, number> = { 20: 8, 28: 10, 40: 13 };

/**
 * `country`: an ISO code ("DK"), or null for a language without one country
 * (localeCountry). Without a picture for it, a neutral box shows `fallback`,
 * the language's code ("en" → EN), or else the country code. `size` is the
 * width in pixels.
 */
export function Flag({ country, fallback, size = 20 }: { country: string | null; fallback?: string; size?: FlagSize }) {
  const code = country?.toUpperCase() ?? null;
  const frame: CSSProperties = {
    display: "inline-block",
    flex: "none",
    boxSizing: "border-box",
    width: size,
    height: HEIGHT[size],
    border: "1px solid rgba(0, 0, 0, 0.12)",
    borderRadius: 3,
    overflow: "hidden",
    verticalAlign: "middle",
  };
  if (code && FLAG_COUNTRIES.has(code)) {
    return (
      <span aria-hidden="true" style={frame}>
        <img src={`/flags/${code}.svg`} alt="" aria-hidden="true" width={size} height={HEIGHT[size]} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      </span>
    );
  }
  const label = /^[A-Za-z]{2,3}/.exec(fallback ?? country ?? "")?.[0].toUpperCase() ?? "";
  return (
    <span
      aria-hidden="true"
      style={{ ...frame, background: TRACK_COLOUR, fontSize: CODE_FONT_SIZE[size], fontWeight: 600, lineHeight: `${HEIGHT[size] - 2}px`, letterSpacing: "0.02em", textAlign: "center", whiteSpace: "nowrap" }}
    >
      {label}
    </span>
  );
}
