/**
 * Numbers, money and dates in the admin console (client-safe): Intl in the
 * interface language, Western digits in Arabic too (ar-u-nu-latn), every
 * instant in UTC with the zone shown, so all admins read the same times.
 */
import type { AdminLocale } from "./locale";

const INTL: Record<AdminLocale, string> = { en: "en-US", ar: "ar-u-nu-latn" };

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function numberFormat(locale: AdminLocale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.NumberFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.NumberFormat(INTL[locale], options)));
  return format;
}
function dateFormat(locale: AdminLocale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.DateTimeFormat(INTL[locale], { timeZone: "UTC", ...options })));
  return format;
}

/** 1,234,567 */
export function formatNumber(locale: AdminLocale, value: number): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** 1.2M, 340K: large character counts at a glance (the exact figure goes in the title or a table). */
export function formatCompact(locale: AdminLocale, value: number): string {
  return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * "$29", "$9.99"; `cents: true` always shows two digits ("$29.00"), for
 * columns of amounts that line up. Arabic shows the same "$29" (browsers
 * render Arabic's own "US$" pattern inconsistently, split across lines),
 * isolated left to right so the sign stays in front of the figure.
 */
export function formatUsd(locale: AdminLocale, value: number, { cents = false }: { cents?: boolean } = {}): string {
  const digits = cents || !Number.isInteger(value) ? 2 : 0;
  const text = numberFormat("en", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return locale === "ar" ? `\u2066${text}\u2069` : text;
}

/** 0.42 → 42% */
export function formatPercent(locale: AdminLocale, ratio: number): string {
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
}

/** Nov 4, 2026 (the UTC date). */
export function formatDate(locale: AdminLocale, iso: string): string {
  return dateFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
}

/** Nov 4, 2026, 14:05 UTC */
export function formatDateTime(locale: AdminLocale, iso: string): string {
  return dateFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(iso));
}

/** Nov 4, 14:05 (a recent instant in a dense table; the page says the zone). */
export function formatShortDateTime(locale: AdminLocale, iso: string): string {
  return dateFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** 14:05 UTC */
export function formatTime(locale: AdminLocale, iso: string): string {
  return dateFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(iso));
}

/** "2026-11" → Nov 2026 */
export function formatMonth(locale: AdminLocale, period: string): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  return dateFormat(locale, { year: "numeric", month: "short" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** A language's name from its code ("de" → German, ألمانية), the code itself when Intl doesn't know it. */
export function formatLanguage(locale: AdminLocale, code: string): string {
  try {
    return new Intl.DisplayNames([INTL[locale]], { type: "language", fallback: "code" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whole days from `now` until `iso` (0 on the day itself; negative once past). */
export function daysUntil(iso: string, now: string | Date): number {
  const at = typeof now === "string" ? Date.parse(now) : now.getTime();
  return Math.ceil((Date.parse(iso) - at) / (24 * 60 * 60 * 1000));
}
