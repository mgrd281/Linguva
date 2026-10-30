/**
 * Type sizes the Plan page needs where Polaris text has none (s-text has no
 * size): plan names, headings, big figures and prices. Inline styles, no
 * colours: text keeps Polaris' colours.
 */
import { BIG_HEADING } from "../LanguageLayout";

export const PLAN_NAME = { margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 700, letterSpacing: "-0.02em" } as const;
export const FIGURE = { fontSize: 28, lineHeight: "32px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" } as const;
export const SECTION_HEADING = { ...BIG_HEADING, fontSize: 17, lineHeight: "24px", fontWeight: 650 } as const;
export const SUB_HEADING = { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 650 } as const;
export const CARD_NAME = { margin: 0, fontSize: 18, lineHeight: "24px", fontWeight: 700 } as const;
export const PRICE = { fontSize: 32, lineHeight: "36px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
/**
 * Semibold for a label or a lead phrase. Polaris draws <s-text type="strong"> at the
 * body weight (450, measured), so text that must stand out is set like the
 * language page's summaries (600).
 */
export const EMPHASIS = { fontWeight: 600 } as const;
/** A meter's name in the hero (Polaris' body size, semibold). */
export const METER_LABEL = { margin: 0, fontSize: 13, lineHeight: "20px", fontWeight: 600 } as const;
export const STAT = { display: "block", fontSize: 16, lineHeight: "20px", fontWeight: 650, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
