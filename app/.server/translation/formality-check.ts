/**
 * Does a translation use the form of address the merchant chose for the
 * language (Settings → Translation style)? A warning, not an error: the
 * patterns can also match quoted text or product names, so the merchant
 * decides. Only clear markers are used; ambiguous words (French "vous",
 * Italian "Lei", German "Sie" at the start of a sentence) are not.
 */

type Formality = "more" | "less";

// Words that only appear when addressing someone informally, or formally.
const MARKERS: Record<string, { informal?: RegExp; formal?: RegExp }> = {
  de: {
    informal: /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure|euren|eurem|eurer)(?![\p{L}])/iu,
    // Capitalised "Sie/Ihnen/Ihr…" in the middle of a sentence (at the start it may mean "they").
    formal: /(?<=[\p{Ll},;]\s+)(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?![\p{L}])/u,
  },
  fr: { informal: /(?<![\p{L}])(tu|toi|tes)(?![\p{L}])|(?<![\p{L}])t['’](?=\p{L})/iu },
  es: {
    informal: /(?<![\p{L}])(tú|tus|contigo|tuyo|tuya|tuyos|tuyas)(?![\p{L}])/iu,
    formal: /(?<![\p{L}])(usted)(?![\p{L}])/iu,
  },
  it: { informal: /(?<![\p{L}])(tu|tuo|tua|tuoi|tue)(?![\p{L}])/iu },
  nl: {
    informal: /(?<![\p{L}])(je|jij|jou|jouw)(?![\p{L}])/iu,
    formal: /(?<![\p{L}])(u|uw)(?![\p{L}])/iu,
  },
};

/** The marker found when the text uses the other form of address, else null. */
export function formalityMismatch(locale: string, formality: Formality, text: string): string | null {
  const markers = MARKERS[locale.toLowerCase().split("-")[0]!];
  const pattern = formality === "more" ? markers?.informal : markers?.formal;
  return pattern?.exec(text)?.[0] ?? null;
}
