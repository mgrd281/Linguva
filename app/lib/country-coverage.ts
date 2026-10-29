/**
 * Which countries the shop sells to can read it in their language, and how
 * much of that language is translated. Pure and shared by server and UI.
 *
 * Input: the active markets with their countries and the languages their
 * web presences offer (a market without its own web presence uses the
 * shop's published languages), the shop's primary and published languages,
 * and the coverage per language from the coverage report.
 */
import { countryLanguageGroups, localeKey } from "./country-languages";

/** Below this share of translated fields a language reads as untranslated. */
export const LOW_COVERAGE_PERCENT = 50;

export interface MarketCountries {
  name: string;
  status: string;
  countries: Array<{ code: string; name: string }>;
  /** Languages the market's web presences offer; null when it has none of its own. */
  locales: Array<{ locale: string; published: boolean }> | null;
}

export type CountryStatus =
  /** No language of the country is offered there: customers read the default language. */
  | "missing"
  /** Offered, but less than half translated (measured). */
  | "low"
  /** Some of the country's languages are offered, others not (Switzerland without French). */
  | "partial"
  | "ok";

export const COUNTRY_STATUSES: readonly CountryStatus[] = ["missing", "low", "partial", "ok"];

/** Why a country can't read one of its languages. */
export type MissingReason =
  /** The shop doesn't have the language. */
  | "not-added"
  /** Added in Shopify but hidden from customers. */
  | "unpublished"
  /** Published, but the country's market doesn't offer it. */
  | "not-in-market";

export interface CountryLanguage {
  /** The shop's locale when it has the language, else the language the country needs. */
  locale: string;
  available: boolean;
  /** Set when not available. */
  reason?: MissingReason;
  /** The shop's primary language: the original text, always complete. */
  primary: boolean;
  /** Translated share (100 for the primary language; null: not measured or not offered). */
  percent: number | null;
}

export interface CountryCoverage {
  code: string;
  name: string;
  markets: string[];
  status: CountryStatus;
  /** One entry per language group of the country. */
  languages: CountryLanguage[];
  /** Lowest translated share of the offered languages (null: not measured or none offered). */
  percent: number | null;
}

export function analyzeCountries(
  markets: readonly MarketCountries[],
  /** `enabled`: every language the shop has besides the primary one, published or not. */
  shop: { primary: string | null; published: readonly string[]; enabled?: readonly string[] },
  percents: ReadonlyMap<string, number | null>,
): CountryCoverage[] {
  const primaryKey = shop.primary ? localeKey(shop.primary) : null;
  const publishedByKey = new Map(shop.published.map((l) => [localeKey(l), l]));
  const enabledByKey = new Map((shop.enabled ?? shop.published).map((l) => [localeKey(l), l]));
  const shopPublished = shop.primary ? [shop.primary, ...shop.published.filter((l) => l !== shop.primary)] : [...shop.published];
  const byCountry = new Map<string, { name: string; markets: Set<string>; offered: Map<string, string> }>();

  for (const market of markets) {
    if (market.status !== "ACTIVE") continue;
    const offered = market.locales
      ? market.locales.filter((l) => l.published || (primaryKey !== null && localeKey(l.locale) === primaryKey)).map((l) => l.locale)
      : shopPublished;
    for (const country of market.countries) {
      const code = country.code.toUpperCase();
      const entry = byCountry.get(code) ?? { name: country.name, markets: new Set<string>(), offered: new Map<string, string>() };
      entry.markets.add(market.name);
      for (const locale of offered) if (!entry.offered.has(localeKey(locale))) entry.offered.set(localeKey(locale), locale);
      byCountry.set(code, entry);
    }
  }

  const rows: CountryCoverage[] = [];
  for (const [code, entry] of byCountry) {
    const groups = countryLanguageGroups(code);
    if (!groups.length) continue;
    const languages: CountryLanguage[] = groups.map((group) => {
      for (const wanted of group) {
        const shopLocale = entry.offered.get(localeKey(wanted));
        if (!shopLocale) continue;
        const primary = localeKey(shopLocale) === primaryKey;
        return { locale: shopLocale, available: true, primary, percent: primary ? 100 : (percents.get(shopLocale) ?? null) };
      }
      // Not offered here: say why, with the shop's own locale when it has the language.
      const published = group.map((l) => publishedByKey.get(localeKey(l))).find(Boolean);
      if (published) return { locale: published, available: false, reason: "not-in-market" as const, primary: false, percent: null };
      const hidden = group.map((l) => enabledByKey.get(localeKey(l))).find(Boolean);
      if (hidden) return { locale: hidden, available: false, reason: "unpublished" as const, primary: false, percent: null };
      return { locale: group[0]!, available: false, reason: "not-added" as const, primary: false, percent: null };
    });
    const offered = languages.filter((l) => l.available);
    const status: CountryStatus =
      offered.length === 0
        ? "missing"
        : offered.length < languages.length
          ? "partial"
          : offered.some((l) => l.percent !== null && l.percent < LOW_COVERAGE_PERCENT)
            ? "low"
            : "ok";
    const measured = offered.every((l) => l.percent !== null);
    rows.push({
      code,
      name: entry.name,
      markets: [...entry.markets].sort(),
      status,
      languages,
      percent: offered.length && measured ? Math.min(...offered.map((l) => l.percent!)) : null,
    });
  }
  const order = (s: CountryStatus) => COUNTRY_STATUSES.indexOf(s);
  return rows.sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name));
}

/**
 * Languages to add, with the countries each would reach: from countries
 * without any of their languages and from those missing one of several.
 * Most countries first.
 */
export function missingLanguages(countries: readonly CountryCoverage[]): Array<{ locale: string; reason: MissingReason; countries: CountryCoverage[] }> {
  const byLocale = new Map<string, { reason: MissingReason; countries: CountryCoverage[] }>();
  for (const country of countries) {
    if (country.status !== "missing" && country.status !== "partial") continue;
    for (const language of country.languages) {
      if (language.available) continue;
      const entry = byLocale.get(language.locale) ?? { reason: language.reason ?? "not-added", countries: [] };
      entry.countries.push(country);
      byLocale.set(language.locale, entry);
    }
  }
  return [...byLocale]
    .map(([locale, entry]) => ({ locale, ...entry }))
    .sort((a, b) => b.countries.length - a.countries.length || a.locale.localeCompare(b.locale));
}

/** Countries per status, for the summary figures. */
export function countByStatus(countries: readonly CountryCoverage[]): Record<CountryStatus, number> {
  const counts: Record<CountryStatus, number> = { missing: 0, low: 0, partial: 0, ok: 0 };
  for (const c of countries) counts[c.status]++;
  return counts;
}
