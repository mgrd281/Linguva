/**
 * Language and country names inside sentences (pure). French and Spanish
 * language names come lower-case from Intl, as they are written inside
 * sentences; only a link or label that starts with one capitalises it.
 */
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import type { CountryCoverage } from "./country-coverage";

/** A gap line names at most this many languages; the Markets page has them all. */
export const GAP_SHOWN = 10;
/** Countries named per language in a gap line. */
const COUNTRIES_SHOWN = 3;

export function upperFirst(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

/** A name written inside parentheses: its own become brackets ("Produkte (Portugiesisch [Portugal])"). */
export function inParentheses(name: string): string {
  return name.replace(/\(([^()]*)\)/g, "[$1]");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name says the country as a word of its own ("portugués de Portugal"), not inside another ("Bulgarian"). */
const namesCountry = (name: string, country: string) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(country)}($|[^\\p{L}])`, "u").test(name);

/** Countries inside parentheses: "Italy, Switzerland and 2 more". */
export function countryList(i18n: I18n, names: readonly string[], shown = COUNTRIES_SHOWN): string {
  const list = names.slice(0, shown).join(", ");
  return names.length > shown ? i18n.t("overview.countries.missing.more", { list, count: names.length - shown }) : list;
}

/** Languages inside a sentence: "Czech and Polish", "Czech, Polish, Slovak and 2 more". */
export function languageList(i18n: I18n, names: readonly string[], shown = 3): string {
  if (names.length <= shown) return new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(names);
  return i18n.t("overview.languages.more", { list: names.slice(0, shown).join(", "), count: names.length - shown });
}

/**
 * "Bulgarian (Bulgaria)", "Italian (Italy, Switzerland)": the language and the
 * countries it would reach. A regional name that says its only country needs
 * none ("Portuguese (Brazil)", "portugués de Portugal"); with parentheses in
 * the name or a shown country name, the countries follow a colon ("Portuguese
 * (Brazil): Portugal").
 */
export function gapEntry(i18n: I18n, name: string, countries: readonly Pick<CountryCoverage, "code" | "name">[]): string {
  const names = countries.map((c) => i18n.country(c.code, c.name));
  if (names.length === 1 && namesCountry(name, names[0]!)) return name;
  const list = countryList(i18n, names);
  const nested = name.includes("(") || names.slice(0, COUNTRIES_SHOWN).some((n) => n.includes("("));
  return nested ? i18n.t("overview.countries.gap.entry", { language: name, countries: list }) : `${name} (${list})`;
}

/**
 * The entries of one gap line: at most GAP_SHOWN, then "and N more". An entry
 * with a colon runs into the next after a comma: such lines use semicolons,
 * and the rest is counted in languages.
 */
export function gapLine(i18n: I18n, entries: readonly string[]): string {
  const shown = entries.slice(0, GAP_SHOWN);
  const open = shown.some((e) => e.includes(":"));
  const list = shown.join(open ? i18n.t("overview.countries.gap.separator") : ", ");
  if (entries.length <= GAP_SHOWN) return list;
  return i18n.t(open ? "overview.languages.moreSeparate" : "overview.languages.more", { list, count: entries.length - GAP_SHOWN });
}
