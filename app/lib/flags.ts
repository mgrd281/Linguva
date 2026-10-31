/**
 * Flags for languages and countries, decorative only (aria-hidden; the
 * language or country name is always shown as text): pictures from
 * public/flags (components/Flag.tsx) for the country localeCountry picks,
 * and emoji where pages still use them. A language's flag is its locale's
 * region when it has one ("pt-BR" → BR), otherwise the country most
 * associated with the language; languages spoken across many countries
 * get a flag only where the store's markets name a country, never a guess
 * that could offend.
 */
import { countryLanguageGroups, localeKey } from "./country-languages";

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

/**
 * Languages without a region that are read in many countries: their flag is
 * a country the store sells to that reads them, these first (English: the
 * United Kingdom before the United States).
 */
const MANY_COUNTRIES: Record<string, readonly string[]> = {
  en: ["GB", "US"],
  ar: [],
  zh: [],
  es: ["ES"],
  pt: ["PT", "BR"],
};

/** Countries with a picture in public/flags/<code>.svg: the two-letter codes of country-flag-icons 1.6.20 (3x2). */
export const FLAG_COUNTRIES: ReadonlySet<string> = new Set(
  (
    "AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET EU FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU " +
    "MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB " +
    "SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US " +
    "UY UZ VA VC VE VG VI VN VU WF WS XA XC XK XO YE YT ZA ZM ZW"
  ).split(" "),
);

/** A locale's language and two-letter region ("pt-BR" → pt, BR; "es-419" and "zh-Hant" have none). */
function localeParts(locale: string): { language: string; region: string | null } {
  const [language = "", ...rest] = locale.split(/[-_]/);
  const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part));
  return { language: language.toLowerCase(), region: region ? region.toUpperCase() : null };
}

/**
 * The country whose flag stands for a language: the locale's region, else
 * the language's country, else, for a language of many countries (English,
 * Arabic, Chinese, Spanish and Portuguese without a region), a country of
 * the store's markets that reads it (the preferred ones first, then in the
 * order given). Null when there is none, or the markets aren't known: show
 * the language's code instead of a flag.
 */
export function localeCountry(locale: string, markets?: readonly string[] | null): string | null {
  const { language, region } = localeParts(locale);
  if (region) return region;
  if (!Object.hasOwn(MANY_COUNTRIES, language)) return Object.hasOwn(LANGUAGE_REGION, language) ? LANGUAGE_REGION[language]! : null;
  const sold = (markets ?? []).map((country) => country.toUpperCase());
  const preferred = MANY_COUNTRIES[language]!.find((country) => sold.includes(country));
  if (preferred) return preferred;
  const key = localeKey(locale);
  const seller = sold.find((country) => countryLanguageGroups(country).some((group) => group.some((l) => localeKey(l) === key)));
  if (seller) return seller;
  // Plain "es" is Spain's Spanish ("es-419" is Latin America's): Spain's flag when the markets don't say otherwise.
  return locale.toLowerCase() === "es" ? "ES" : null;
}

function regionFlag(region: string): string {
  if (!/^[A-Z]{2}$/.test(region)) return "";
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A country's flag emoji from its ISO code ("CZ" → 🇨🇿). */
export function countryFlag(country: string): string {
  return regionFlag(country.toUpperCase());
}

/** A language's flag emoji: its region's, or its language's country (none for English, Arabic or Chinese without a region). */
export function localeFlag(locale: string): string {
  const [language, region] = locale.split("-");
  if (region && /^[A-Za-z]{2}$/.test(region)) return regionFlag(region.toUpperCase());
  const fallback = LANGUAGE_REGION[(language ?? "").toLowerCase()];
  return fallback ? regionFlag(fallback) : "";
}
