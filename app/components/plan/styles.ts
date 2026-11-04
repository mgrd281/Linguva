/**
 * Inline type that Settings and the smart schedule's page still take from
 * here (SettingsParts' SETTING_NAME, Settings' plan figures and headings,
 * the smart page's headings). The Plan page itself uses the app's type
 * scale (app/styles/ui.css: .lv-h1, .lv-h2, .lv-h3, .lv-strong,
 * .lv-figure, .lv-figure-row) and its own section there (.lv-plan-name,
 * .lv-plan-price, .lv-plan-stat). Values unchanged, so those pages look as
 * before; they can move to the scale and these go.
 */

/** A heading inside a card (as .lv-h3). */
export const SUB_HEADING = { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 650 } as const;
/** A setting's or a meter's name in the body size, semibold. */
export const METER_LABEL = { margin: 0, fontSize: 13, lineHeight: "20px", fontWeight: 600 } as const;
/** A figure in a row of figures. */
export const STAT = { display: "block", fontSize: 16, lineHeight: "20px", fontWeight: 650, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
