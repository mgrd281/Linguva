/** Merchant-facing names for validation issue codes (see validate.ts and seo.ts). */
const LABELS: Record<string, string> = {
  EMPTY_TRANSLATION: "Empty translation",
  NUMBERS_CHANGED: "Numbers changed",
  FORBIDDEN_TERM: "Uses a forbidden term",
  PREFERRED_TERM_MISSING: "Glossary wording missing",
  LENGTH_RATIO: "Unusual length",
  UNTRANSLATED: "Looks untranslated",
  WRONG_SCRIPT: "Not in the language's script",
  FORMALITY_MISMATCH: "Other form of address than chosen",
  SEO_TOO_LONG: "Too long for search results",
  SEO_TOO_SHORT: "Short for search results",
  SEO_SAME_AS_SOURCE: "Same as the original",
};

export function issueLabel(code: string): string {
  return LABELS[code] ?? code;
}
