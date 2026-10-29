/**
 * Language and country names inside the Overview's sentences (pure). French
 * and Spanish language names come lower-case from Intl, as they are written
 * inside sentences; only a link or label that starts with one capitalises it.
 */
import { INTL_LOCALE, type I18n } from "../i18n/i18n";
import type { CountryCoverage } from "./country-coverage";

/** A gap line names at most this many languages; the Markets page has them all. */
export const GAP_SHOWN = 10;

export function upperFirst(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

/** Countries inside parentheses: "Italy, Switzerland and 2 more". */
export function countryList(i18n: I18n, names: readonly string[], shown = 3): string {
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
 * countries it would reach. A name that already names its only country needs
 * none ("Portuguese (Brazil)"); with parentheses in the name or a country
 * name, the countries follow a colon ("Portuguese (Brazil): Portugal").
 */
export function gapEntry(i18n: I18n, name: string, countries: readonly Pick<CountryCoverage, "code" | "name">[]): string {
  const names = countries.map((c) => i18n.country(c.code, c.name));
  if (names.length === 1 && name.includes(names[0]!)) return name;
  const list = countryList(i18n, names);
  return name.includes("(") || names.some((n) => n.includes("(")) ? i18n.t("overview.countries.gap.entry", { language: name, countries: list }) : `${name} (${list})`;
}

/** The entries of one gap line: at most GAP_SHOWN, then "and N more"; semicolons once an entry has a colon. */
export function gapLine(i18n: I18n, entries: readonly string[]): string {
  const separator = entries.some((e) => e.includes(":")) ? "; " : ", ";
  return entries.length > GAP_SHOWN
    ? i18n.t("overview.languages.more", { list: entries.slice(0, GAP_SHOWN).join(separator), count: entries.length - GAP_SHOWN })
    : entries.join(separator);
}
