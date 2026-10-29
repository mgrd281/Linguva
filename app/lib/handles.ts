/**
 * URL handles per language (SEO S2). Linguva never machine-translates or
 * bulk-changes handles: it suggests one from the translated title, checks
 * the format, and asks for confirmation before changing a published one,
 * because Shopify doesn't redirect old language URLs (SHOPIFY_API_MATRIX).
 */

export const MAX_HANDLE_LENGTH = 255;

// Latin-script languages get ASCII handles (customary, easy to share);
// others keep their script, which Shopify supports in handles.
const GERMAN = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" } as Record<string, string>;
const NON_LATIN = new Set(["ar", "fa", "he", "ur", "ru", "uk", "bg", "el", "zh", "ja", "ko", "th", "hi", "bn", "ta", "ka", "hy", "sr", "mk", "be", "kk"]);

function language(locale: string) {
  return locale.toLowerCase().split("-")[0]!;
}

/** Suggests a handle from a (translated) title. Empty when nothing usable remains. */
export function suggestHandle(title: string, locale: string): string {
  const lang = language(locale);
  let text = title.normalize("NFKC").trim();
  if (lang === "de") text = text.replace(/[äöüßÄÖÜ]/g, (c) => GERMAN[c]!);
  if (!NON_LATIN.has(lang)) {
    // Strip accents from Latin letters (é → e); other scripts are untouched.
    text = text.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");
  }
  const handle = text
    .toLocaleLowerCase(locale)
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return truncateHandle(handle);
}

function truncateHandle(handle: string): string {
  if (handle.length <= MAX_HANDLE_LENGTH) return handle;
  const cut = handle.slice(0, MAX_HANDLE_LENGTH);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > MAX_HANDLE_LENGTH / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

export type HandleProblem = "EMPTY" | "TOO_LONG" | "INVALID_CHARACTERS" | "UPPERCASE";

/** Checks a handle the merchant entered. */
export function validateHandle(value: string): HandleProblem | null {
  if (!value.trim()) return "EMPTY";
  if (value.length > MAX_HANDLE_LENGTH) return "TOO_LONG";
  if (value !== value.toLocaleLowerCase()) return "UPPERCASE";
  if (!/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u.test(value)) return "INVALID_CHARACTERS";
  return null;
}

export const HANDLE_PROBLEM_MESSAGES: Record<HandleProblem, string> = {
  EMPTY: "Enter a URL handle.",
  TOO_LONG: `Use at most ${MAX_HANDLE_LENGTH} characters.`,
  UPPERCASE: "Use lowercase letters only.",
  INVALID_CHARACTERS: "Use letters, numbers and single hyphens only (no spaces or other characters).",
};
