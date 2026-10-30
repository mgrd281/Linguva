/**
 * The Content page's language (pure, shared by server and UI; tested in
 * tests/unit/content-language.test.ts): which one it shows when the URL
 * names none, and the order its chips are read in.
 */
import type { I18n } from "../i18n/i18n";
import { upperFirst } from "./name-lists";

/** More additional languages than this: one select instead of a chip each (six chips are two rows on desktop, three on a phone). */
export const MAX_CHIPS = 6;

export interface LanguageChoiceInput {
  /** The URL's ?lang, if any. */
  requested: string | null;
  /** The store's additional languages in the app's order (by Shopify's name, as plans count them). */
  targets: ReadonlyArray<{ locale: string; published: boolean }>;
  /** The languages the plan includes (allowedTargetLocales). */
  allowed: readonly string[];
  /** Fully counted languages (measuredLocales). */
  measured: ReadonlySet<string>;
  /** Texts still to translate per language: missing, outdated and failed. */
  open: ReadonlyMap<string, number>;
}

/**
 * The language to show: the URL's when it is one of the store's additional
 * languages; else, among the visible languages the plan includes that are
 * counted, the one with the most texts to translate (ties: the app's
 * order); else the first visible one the plan includes, the first visible
 * one, the first one; null without any. Never a hidden language while a
 * visible one exists, never one outside the plan while one inside exists.
 */
export function chooseLanguage(input: LanguageChoiceInput): string | null {
  const { targets } = input;
  if (input.requested && targets.some((l) => l.locale === input.requested)) return input.requested;
  const visibleInPlan = targets.filter((l) => l.published && input.allowed.includes(l.locale));
  const counted = visibleInPlan.filter((l) => input.measured.has(l.locale));
  if (counted.length) {
    const open = (locale: string) => input.open.get(locale) ?? 0;
    // A stable pick: the first of the app's order among the most open.
    return counted.reduce((best, l) => (open(l.locale) > open(best.locale) ? l : best)).locale;
  }
  return (visibleInPlan[0] ?? targets.find((l) => l.published) ?? targets[0])?.locale ?? null;
}

/** A language's name as a chip shows it: the interface language's name, capitalised ("Dänisch", "Allemand"). */
export function chipName(i18n: I18n, language: { locale: string; name: string }): string {
  return upperFirst(i18n.language(language.locale, language.name));
}

/**
 * The chips' order for reading: visible languages first, then hidden ones,
 * each by the name in the interface language (Shopify orders them by their
 * English names, which reads as random in German). Display only: which
 * languages the plan includes still follows the app's order.
 */
export function chipOrder<T extends { locale: string; name: string; published: boolean }>(i18n: I18n, languages: readonly T[]): T[] {
  return [...languages].sort((a, b) => Number(b.published) - Number(a.published) || chipName(i18n, a).localeCompare(chipName(i18n, b), i18n.locale));
}

/** Chips for up to MAX_CHIPS languages, one select for more. */
export function switcherKind(count: number): "chips" | "select" {
  return count > MAX_CHIPS ? "select" : "chips";
}
