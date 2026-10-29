/**
 * The app interface in the merchant's language (English, German, French
 * and Spanish; the French and Spanish texts still need a native speaker's
 * review, docs/I18N_REVIEW.md).
 *
 * Shopify passes the admin user's language as the `locale` parameter of
 * the page request; public pages use the browser's Accept-Language. Texts
 * live in typed catalogues (app/i18n/messages): every catalogue has
 * exactly the English keys, checked by TypeScript and a unit test.
 *
 * Numbers and dates are formatted for the language and, for dates, in UTC,
 * so the server and the browser render the same text.
 */
import { MESSAGES, type MessageKey, type Message } from "./messages";

export const APP_LOCALES = ["en", "de", "fr", "es"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export type { MessageKey };

/** Values for {placeholders}; `count` also picks the plural form. */
export type MessageVars = Record<string, string | number>;

/** A message to show, e.g. returned by a loader: key plus values. */
export interface MessageRef {
  key: MessageKey;
  vars?: MessageVars;
}

export const INTL_LOCALE: Record<AppLocale, string> = { en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES" };

function supported(tag: string | null | undefined): AppLocale | null {
  const primary = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return primary && (APP_LOCALES as readonly string[]).includes(primary) ? (primary as AppLocale) : null;
}

/**
 * The first supported language of the `locale` parameter, then of an
 * Accept-Language header (in its order), else English.
 */
export function resolveLocale(param: string | null | undefined, acceptLanguage?: string | null): AppLocale {
  const fromParam = supported(param);
  if (fromParam) return fromParam;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = supported(tag);
    if (locale) return locale;
  }
  return "en";
}

function pick(message: Message, locale: AppLocale, vars?: MessageVars): string {
  if (typeof message === "string") return message;
  const count = Number(vars?.count ?? 0);
  const form = new Intl.PluralRules(INTL_LOCALE[locale]).select(count);
  return form === "one" ? message.one : message.other;
}

export function formatNumber(locale: AppLocale, value: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
}

/** A date (e.g. "27. Oktober 2026"), in UTC so server and browser agree. */
export function formatDate(locale: AppLocale, value: string | Date, style: "medium" | "long" = "long"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: style, timeZone: "UTC" }).format(date);
}

/** Date and time with "UTC", so server and browser render the same text. */
export function formatDateTime(locale: AppLocale, value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

/** "October 2026" for a "2026-10" period. */
export function formatMonth(locale: AppLocale, period: string): string {
  const date = new Date(`${period}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return period;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * The text for a key in a language, with {placeholders} filled in. Numbers
 * are formatted for the language. Unknown placeholders stay visible, so a
 * missing value is noticed instead of hidden.
 */
export function translate(locale: AppLocale, key: MessageKey, vars?: MessageVars): string {
  const message = MESSAGES[locale][key] ?? MESSAGES.en[key];
  const text = pick(message, locale, vars);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

/**
 * A language's name in the interface language ("Französisch"). English
 * keeps Shopify's own name; other interface languages name the code with
 * Intl, falling back to Shopify's name.
 */
export function languageName(locale: AppLocale, code: string, shopifyName?: string | null): string {
  // English keeps Shopify's name; a language the shop doesn't have yet is named by Intl too.
  if (locale !== "en" || !shopifyName) {
    try {
      const name = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "language", fallback: "none" }).of(code);
      // German capitalises language names; French and Spanish write them in lower case.
      if (name) return locale === "de" ? name.charAt(0).toLocaleUpperCase(INTL_LOCALE[locale]) + name.slice(1) : name;
    } catch {
      // Not a valid language code: use Shopify's name.
    }
  }
  return shopifyName || code;
}

/** A country's name in the interface language ("Tschechien"), falling back to Shopify's name. */
export function countryName(locale: AppLocale, code: string, shopifyName?: string | null): string {
  try {
    const name = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region", fallback: "none" }).of(code.toUpperCase());
    if (name) return name;
  } catch {
    // Not a valid region code: use Shopify's name.
  }
  return shopifyName || code;
}

/** "42 %" / "42%" for a whole percentage, formatted for the interface language. */
export function formatPercent(locale: AppLocale, value: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "percent", maximumFractionDigits: 0 }).format(value / 100);
}

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

export function translator(locale: AppLocale) {
  const t: Translate = (key, vars) => translate(locale, key, vars);
  return {
    locale,
    t,
    /** Renders a message returned by the server. */
    msg: (ref: MessageRef) => translate(locale, ref.key, ref.vars),
    number: (value: number) => formatNumber(locale, value),
    date: (value: string | Date, style?: "medium" | "long") => formatDate(locale, value, style),
    dateTime: (value: string | Date) => formatDateTime(locale, value),
    month: (period: string) => formatMonth(locale, period),
    language: (code: string, shopifyName?: string | null) => languageName(locale, code, shopifyName),
    country: (code: string, shopifyName?: string | null) => countryName(locale, code, shopifyName),
    percent: (value: number) => formatPercent(locale, value),
  };
}

export type I18n = ReturnType<typeof translator>;
