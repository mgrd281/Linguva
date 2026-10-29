/**
 * A flag emoji for a language, decorative only (aria-hidden; the language
 * name is always shown as text). Uses the locale's region when it has one
 * ("pt-BR" → 🇧🇷), otherwise the country most associated with the language;
 * languages spoken across many countries without a region (English, Arabic,
 * Chinese) get none rather than a guess that could offend.
 */
const LANGUAGE_REGION: Record<string, string> = {
  de: "DE",
  fr: "FR",
  es: "ES",
  it: "IT",
  nl: "NL",
  pl: "PL",
  cs: "CZ",
  da: "DK",
  sv: "SE",
  nb: "NO",
  no: "NO",
  fi: "FI",
  ja: "JP",
  ko: "KR",
  tr: "TR",
  el: "GR",
  hu: "HU",
  ro: "RO",
  bg: "BG",
  hr: "HR",
  sk: "SK",
  sl: "SI",
  lt: "LT",
  lv: "LV",
  et: "EE",
  uk: "UA",
  th: "TH",
  vi: "VN",
  id: "ID",
  he: "IL",
  pt: "PT",
};

function regionFlag(region: string): string {
  if (!/^[A-Z]{2}$/.test(region)) return "";
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A country's flag from its ISO code ("CZ" → 🇨🇿), decorative only. */
export function countryFlag(country: string): string {
  return regionFlag(country.toUpperCase());
}

export function localeFlag(locale: string): string {
  const [language, region] = locale.split("-");
  if (region && /^[A-Za-z]{2}$/.test(region)) return regionFlag(region.toUpperCase());
  const fallback = LANGUAGE_REGION[(language ?? "").toLowerCase()];
  return fallback ? regionFlag(fallback) : "";
}
