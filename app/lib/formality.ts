/**
 * Languages whose form of address DeepL can set (its `formality` option),
 * and the pronouns that name the two forms in Settings. For other
 * languages DeepL ignores the option, so Settings offers no choice.
 * https://developers.deepl.com/docs/api-reference/translate (formality)
 */
const FORMALITY_LANGUAGES = new Set(["de", "fr", "it", "es", "nl", "pl", "pt", "ja", "ru"]);

/** Formal and informal pronouns where they name the choice clearly ("Sie" / "du"). */
const PRONOUNS: Record<string, { formal: string; informal: string }> = {
  de: { formal: "Sie", informal: "du" },
  fr: { formal: "vous", informal: "tu" },
  es: { formal: "usted", informal: "tú" },
  it: { formal: "Lei", informal: "tu" },
  nl: { formal: "u", informal: "jij" },
  pl: { formal: "Pan/Pani", informal: "ty" },
  pt: { formal: "você", informal: "tu" },
};

function base(locale: string): string {
  return locale.toLowerCase().split("-")[0]!;
}

export function supportsFormality(locale: string): boolean {
  return FORMALITY_LANGUAGES.has(base(locale));
}

export function formalityPronouns(locale: string): { formal: string; informal: string } | null {
  return PRONOUNS[base(locale)] ?? null;
}
