/**
 * The numbers of a text as the quality checks compare them: on the server
 * (app/.server/translation/validate.ts) and in the browser, where Review
 * checks an edited translation again while the merchant types. Pure.
 */

/** Eastern Arabic (U+0660–0669) and Persian (U+06F0–06F9) digits as the same numbers as ASCII digits. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Digit runs, sorted. "1.5 kg" and "1,5 kg" both yield ["1", "5"], so
 * locale-specific decimal separators are accepted; leading zeros don't count.
 */
export function digitRuns(text: string): string[] {
  return (normalizeDigits(text).match(/\d+/g) ?? [])
    .map((run) => run.replace(/^0+(?=\d)/, ""))
    .sort();
}
