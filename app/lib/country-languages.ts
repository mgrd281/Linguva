/**
 * The languages customers in a country read a shop in, as storefront locale
 * codes ("cs", "zh-TW", "pt-BR"). Pure and shared by server and UI.
 *
 * Source: the country's most likely language from CLDR (built into Intl:
 * `new Intl.Locale("und-CZ").maximize()` → cs), with overrides where a
 * country has several languages or where shops are read in an official
 * second language rather than in CLDR's most spoken one (Senegal: French,
 * not Wolof). Advisory: it says which language a shop needs, not who buys.
 *
 * A country has one or more groups: every group needs one of its languages
 * (Switzerland: German, French and Italian regions); within a group any
 * language will do (Luxembourg: French or German).
 */
const OVERRIDES: Record<string, string[][]> = {
  // Several regions, each with its own language.
  BE: [["nl"], ["fr"]],
  CA: [["en"], ["fr"]],
  CH: [["de"], ["fr"], ["it"]],
  CM: [["fr"], ["en"]],
  // Any of these is read by most customers.
  AD: [["ca", "es"]],
  AE: [["ar", "en"]],
  AN: [["nl", "en"]],
  AW: [["nl", "en"]],
  BA: [["bs", "hr", "sr"]],
  BH: [["ar", "en"]],
  BI: [["fr", "rn"]],
  BQ: [["nl", "en"]],
  BT: [["dz", "en"]],
  BY: [["ru", "be"]],
  CC: [["en"]],
  CF: [["fr"]],
  CW: [["nl", "en"]],
  DJ: [["fr", "ar"]],
  DZ: [["ar", "fr"]],
  FO: [["fo", "da"]],
  GH: [["en"]],
  GL: [["da", "kl"]],
  HK: [["zh-TW", "en"]],
  HT: [["fr"]],
  IN: [["en", "hi"]],
  KE: [["en", "sw"]],
  KG: [["ky", "ru"]],
  KM: [["fr", "ar"]],
  KW: [["ar", "en"]],
  KZ: [["ru", "kk"]],
  LB: [["ar", "fr", "en"]],
  LK: [["si", "ta", "en"]],
  LS: [["en"]],
  LU: [["fr", "de"]],
  MA: [["ar", "fr"]],
  ME: [["sr", "bs", "hr"]],
  MG: [["fr", "mg"]],
  ML: [["fr"]],
  MO: [["zh-TW", "pt-PT"]],
  MR: [["ar", "fr"]],
  MT: [["en", "mt"]],
  MU: [["fr", "en"]],
  MV: [["dv", "en"]],
  MY: [["ms", "en"]],
  NA: [["en"]],
  NE: [["fr"]],
  OM: [["ar", "en"]],
  PG: [["en"]],
  PH: [["en", "fil"]],
  PK: [["en", "ur"]],
  PY: [["es"]],
  QA: [["ar", "en"]],
  RW: [["rw", "en", "fr"]],
  SC: [["fr", "en"]],
  SG: [["en", "zh-CN"]],
  SN: [["fr"]],
  SX: [["en", "nl"]],
  TD: [["fr", "ar"]],
  TK: [["en"]],
  TN: [["ar", "fr"]],
  TO: [["en"]],
  TV: [["en"]],
  TZ: [["sw", "en"]],
  UG: [["en", "sw"]],
  VU: [["en", "fr"]],
  WS: [["en"]],
  XK: [["sq", "sr"]],
  ZW: [["en"]],
};

/** CLDR language and script as a Shopify storefront locale code. */
function storefrontLocale(language: string, script: string | undefined, country: string): string {
  if (language === "zh") return script === "Hant" ? "zh-TW" : "zh-CN";
  if (language === "pt") return country === "BR" ? "pt-BR" : "pt-PT";
  if (language === "no") return "nb";
  return language;
}

const likelyCache = new Map<string, string | null>();

/** CLDR's most likely language for a country (null for unknown regions). */
function likelyLanguage(country: string): string | null {
  if (likelyCache.has(country)) return likelyCache.get(country)!;
  let result: string | null = null;
  if (/^[A-Z]{2}$/.test(country) && country !== "ZZ") {
    try {
      const max = new Intl.Locale(`und-${country}`).maximize();
      if (max.language && max.language !== "und") result = storefrontLocale(max.language, max.script, country);
    } catch {
      result = null;
    }
  }
  likelyCache.set(country, result);
  return result;
}

/** The language groups of a country ([] for unknown regions). */
export function countryLanguageGroups(country: string): string[][] {
  const code = country.toUpperCase();
  const override = OVERRIDES[code];
  if (override) return override;
  const likely = likelyLanguage(code);
  return likely ? [[likely]] : [];
}

/**
 * Comparable form of a locale: the language, with Chinese split by script
 * (Simplified and Traditional read differently) and Norwegian Bokmål under
 * one code. Portuguese variants match each other: Brazilian customers read
 * European Portuguese and the other way round.
 */
export function localeKey(locale: string): string {
  const [base = "", ...rest] = locale.toLowerCase().split(/[-_]/);
  if (base === "zh") return /^(tw|hk|mo|hant)$/.test(rest[0] ?? "") ? "zh-hant" : "zh-hans";
  if (base === "no" || base === "nb") return "nb";
  return base;
}
