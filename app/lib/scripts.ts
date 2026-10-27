/**
 * Writing system checks: a translation into Arabic, Japanese, Russian and so
 * on must mostly use that script. Catches provider results in the wrong
 * language or left untranslated.
 */
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = {
  ar: /\p{Script=Arabic}/gu,
  fa: /\p{Script=Arabic}/gu,
  ur: /\p{Script=Arabic}/gu,
  he: /\p{Script=Hebrew}/gu,
  ru: /\p{Script=Cyrillic}/gu,
  uk: /\p{Script=Cyrillic}/gu,
  bg: /\p{Script=Cyrillic}/gu,
  mk: /\p{Script=Cyrillic}/gu,
  be: /\p{Script=Cyrillic}/gu,
  kk: /\p{Script=Cyrillic}/gu,
  el: /\p{Script=Greek}/gu,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  zh: /\p{Script=Han}/gu,
  ko: /\p{Script=Hangul}/gu,
  th: /\p{Script=Thai}/gu,
  hi: /\p{Script=Devanagari}/gu,
  mr: /\p{Script=Devanagari}/gu,
  ne: /\p{Script=Devanagari}/gu,
};

const LETTER = /\p{L}/gu;

/** The script a language is written in, or null for Latin-script and unknown languages. */
export function expectedScript(locale: string): RegExp | null {
  return SCRIPT_BY_LANGUAGE[locale.toLowerCase().split("-")[0]!] ?? null;
}

/**
 * True when the text has enough letters to judge and fewer than half of
 * them are in the target language's script. Brand names and SKUs in Latin
 * letters are fine as long as most of the text is in the right script.
 */
export function isWrongScript(locale: string, text: string): boolean {
  const script = expectedScript(locale);
  if (!script) return false;
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters < 12) return false;
  const inScript = text.match(script)?.length ?? 0;
  return inScript / letters < 0.5;
}
