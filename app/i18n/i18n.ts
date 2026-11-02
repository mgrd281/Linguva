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
 * Numbers and dates are formatted for the language. Instants are shown in
 * the store's time zone (`translator(locale, { timeZone })`; the app route's
 * loader names it, so the server and the browser render the same text);
 * without a zone, or in UTC, they are shown in UTC and a time says "UTC".
 * The clock follows the interface language: 12-hour in English ("2:02 PM"),
 * 24-hour in German, French and Spanish ("14:02").
 */
import { MESSAGES, type MessageKey, type Message } from "./messages";
import { wallClock } from "../lib/schedule";

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

/** An instant as the loaders send it: an ISO string, a Date or epoch milliseconds. */
export type Instant = string | Date | number;

const DAY_MS = 86_400_000;

function toDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

const zoneChecks = new Map<string, { zone: string; utc: boolean } | null>();
// Zone names only ("Europe/Berlin", "UTC"): an offset such as "+05:30" isn't known to every browser's Intl.
const ZONE_NAME = /^[A-Za-z][\w+/-]{0,63}$/;

/**
 * A time zone Intl knows (Shopify's spelling is kept: "Asia/Kolkata"), and
 * whether it is UTC under another name ("Etc/UTC"). Null for a missing or
 * unknown zone, so a bad value never breaks a page.
 */
function checkZone(timeZone: string | null | undefined): { zone: string; utc: boolean } | null {
  if (!timeZone || !ZONE_NAME.test(timeZone)) return null;
  let checked = zoneChecks.get(timeZone);
  if (checked === undefined) {
    try {
      const utc = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone === "UTC";
      checked = { zone: utc ? "UTC" : timeZone, utc };
    } catch {
      checked = null;
    }
    // Only zones from the app's own data get here, but the cache never grows without bound.
    if (zoneChecks.size >= 500) zoneChecks.clear();
    zoneChecks.set(timeZone, checked);
  }
  return checked;
}

/**
 * The zone instants are shown in ("Europe/Berlin"), and whether a shown time
 * must say "UTC": a missing or unknown zone shows UTC, named as such.
 */
export function displayZone(timeZone?: string | null): { zone: string; utc: boolean } {
  return checkZone(timeZone) ?? { zone: "UTC", utc: true };
}

const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: AppLocale, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    if (formats.size >= 1000) formats.clear();
    format = new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone });
    formats.set(key, format);
  }
  return format;
}

const relativeFormats = new Map<AppLocale, Intl.RelativeTimeFormat>();

/** Intl's relative words ("yesterday", "in 13 hours"); French gets the catalogues' apostrophe ("aujourd'hui"). */
function relative(locale: AppLocale, value: number, unit: Intl.RelativeTimeFormatUnit): string {
  let format = relativeFormats.get(locale);
  if (!format) relativeFormats.set(locale, (format = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" })));
  return format.format(value, unit).replace(/\u2019/g, "'");
}

function capitalised(locale: AppLocale, text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(INTL_LOCALE[locale]) + text.slice(1) : text;
}

const TIME: Intl.DateTimeFormatOptions = { timeStyle: "short" };
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const SHORT_DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const SHORT_DAY_YEAR: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: "long" };

/** The calendar day of an instant in a zone, as a day count (comparable across daylight-saving changes). */
function dayNumber(date: Date, timeZone: string): number {
  const { year, month, day } = wallClock(date.getTime(), timeZone);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** A calendar day: its date ("2026-11-02") and its day count (comparable across daylight-saving changes). */
export interface CalendarDay {
  day: string;
  number: number;
}

/**
 * The calendar day of an instant in the store's zone (UTC when the zone is
 * missing, unknown or an offset: displayZone), counted exactly as the day
 * headings count (formatDayHeading), so the Jobs list's day groups
 * (dayGroups in app/lib/job-view.ts) and their headings never disagree. An
 * invalid instant has no day ("", NaN).
 */
export function calendarDay(value: Instant, timeZone?: string | null): CalendarDay {
  const date = toDate(value);
  if (!isValid(date)) return { day: "", number: Number.NaN };
  const number = dayNumber(date, displayZone(timeZone).zone);
  return { day: new Date(number * DAY_MS).toISOString().slice(0, 10), number };
}

function sameYear(date: Date, now: Date, timeZone: string): boolean {
  return isValid(now) && wallClock(date.getTime(), timeZone).year === wallClock(now.getTime(), timeZone).year;
}

/** A date (e.g. "27. Oktober 2026"), in the store's zone (UTC without one). */
export function formatDate(locale: AppLocale, value: Instant, style: "medium" | "long" = "long", timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  return dateFormat(locale, displayZone(timeZone).zone, { dateStyle: style }).format(date);
}

/**
 * Day and month ("1. November", "November 1"), with the year only when it
 * isn't `now`'s year ("1. Januar 2027"). In the store's zone (UTC without one).
 */
export function formatDayMonth(locale: AppLocale, value: Instant, now: Instant, timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const { zone } = displayZone(timeZone);
  return dateFormat(locale, zone, sameYear(date, toDate(now), zone) ? DAY_MONTH : DAY_MONTH_YEAR).format(date);
}

/**
 * Date and time in the store's zone ("Oct 29, 2026, 2:02 PM"); in UTC with
 * "UTC" when the zone is UTC or unknown ("Oct 29, 2026, 1:02 PM UTC").
 */
export function formatDateTime(locale: AppLocale, value: Instant, timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const { zone, utc } = displayZone(timeZone);
  const text = dateFormat(locale, zone, { dateStyle: "medium", timeStyle: "short" }).format(date);
  return utc ? `${text} UTC` : text;
}

/** The time of an instant in a zone, as the interface language writes it ("2:02 PM", "14:02"). */
function timeIn(locale: AppLocale, date: Date, timeZone: string): string {
  return dateFormat(locale, timeZone, TIME).format(date);
}

/**
 * The time of an instant in the store's zone ("2:02 PM" / "14:02"), with
 * "UTC" when the zone is UTC or unknown ("13:02 UTC").
 */
export function formatTime(locale: AppLocale, value: Instant, timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const { zone, utc } = displayZone(timeZone);
  const text = timeIn(locale, date, zone);
  return utc ? `${text} UTC` : text;
}

/**
 * A time inside a sentence (every {time}, {from} and {to}): `formatTime`,
 * in Spanish with its article ("la 1:00" for 1:00 to 1:59, "las 14:02"
 * otherwise), so Spanish texts say "a {time}", "desde {time}".
 */
export function formatTimeRef(locale: AppLocale, value: Instant, timeZone?: string | null): string {
  const text = formatTime(locale, value, timeZone);
  if (locale !== "es" || !text) return text;
  const hour = wallClock(toDate(value).getTime(), displayZone(timeZone).zone).hour;
  return `${hour === 1 ? "la" : "las"} ${text}`;
}

/**
 * A wall-clock time of a schedule, given as minutes after midnight (1380 →
 * "11:00 PM" / "23:00"): the interface language's clock, in no zone. Form
 * values stay "HH:MM" (formatTime in app/lib/schedule.ts).
 */
export function formatClock(locale: AppLocale, minuteOfDay: number): string {
  if (!Number.isFinite(minuteOfDay)) return "";
  const minutes = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return dateFormat(locale, "UTC", TIME).format(Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/**
 * Date and time in a time zone ("Thu, Oct 29, 11:00 PM", "Do., 29. Okt.,
 * 23:00"): scheduled checks are shown in the schedule's zone. The time is
 * the interface language's clock (as `formatTime`). The zone is explicit, so
 * the server and the browser render the same text; an unknown zone shows UTC.
 */
export function formatDateTimeIn(locale: AppLocale, value: Instant, timeZone: string): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const checked = checkZone(timeZone);
  if (!checked) return formatDateTime(locale, date);
  const day = dateFormat(locale, checked.zone, { weekday: "short", month: "short", day: "numeric" }).format(date);
  return `${day}, ${timeIn(locale, date, checked.zone)}`;
}

/** Today, yesterday or tomorrow as a word ("today", "gestern"); else the date ("Oct 31", "12. Mai 2025"); then the time. */
function dayAndTime(locale: AppLocale, date: Date, now: Date, timeZone: string, sentence: boolean): string {
  const days = isValid(now) ? dayNumber(date, timeZone) - dayNumber(now, timeZone) : Number.NaN;
  let day: string;
  if (Math.abs(days) <= 1) {
    const word = relative(locale, days, "day");
    day = sentence ? word : capitalised(locale, word);
  } else {
    day = dateFormat(locale, timeZone, sameYear(date, now, timeZone) ? SHORT_DAY : SHORT_DAY_YEAR).format(date);
  }
  return `${day}, ${timeIn(locale, date, timeZone)}`;
}

/**
 * An instant with its day, in a time zone: "Today, 11:00 PM", "Yesterday,
 * 11:06 PM", "Oct 31, 11:00 PM" (German "Heute, 23:00", "31. Okt., 23:00"),
 * with the year when it isn't `now`'s. `sentence`: the day word in lower case,
 * for the middle of a sentence ("Next check: today, 11:00 PM"). The zone is
 * named elsewhere on the page; an unknown zone shows UTC, named as such.
 */
export function formatDayTimeIn(locale: AppLocale, value: Instant, timeZone: string, now: Instant, options: { sentence?: boolean } = {}): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const checked = checkZone(timeZone);
  const text = dayAndTime(locale, date, toDate(now), checked?.zone ?? "UTC", options.sentence ?? false);
  return checked ? text : `${text} UTC`;
}

/**
 * When something happened, short, in the store's zone: "today, 2:02 PM",
 * "gestern, 22:01", "30. Okt., 15:48", "12. Mai 2025, 14:12"; with "UTC"
 * when the zone is UTC or unknown.
 */
export function formatShortWhen(locale: AppLocale, value: Instant, now: Instant, timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const { zone, utc } = displayZone(timeZone);
  const text = dayAndTime(locale, date, toDate(now), zone, true);
  return utc ? `${text} UTC` : text;
}

/**
 * When something happened, as a phrase for a sentence, in the store's zone:
 * "today at 2:02 PM", "gestern um 22:14", "am 30. Oktober um 15:48"
 * (jobs.when.*; the time as `formatTimeRef` writes it).
 */
export function formatAt(locale: AppLocale, value: Instant, now: Instant, timeZone?: string | null): string {
  const date = toDate(value);
  if (!isValid(date)) return "";
  const reference = toDate(now);
  const { zone } = displayZone(timeZone);
  const time = formatTimeRef(locale, date, timeZone);
  const days = isValid(reference) ? dayNumber(date, zone) - dayNumber(reference, zone) : Number.NaN;
  if (days === 0) return translate(locale, "jobs.when.today", { time });
  if (days === -1) return translate(locale, "jobs.when.yesterday", { time });
  return translate(locale, "jobs.when.date", { date: formatDayMonth(locale, date, reference, timeZone), time });
}

/** A day heading: a title and the detail beside it ("Heute" · "Montag, 2. November"). */
export interface DayHeading {
  title: string;
  detail: string;
}

/**
 * The heading of a day of instants, by calendar days in the store's zone:
 * today and yesterday by name with the full date ("Heute" · "Montag,
 * 2. November"); 2 to 6 days ago the weekday with the date ("Freitag" ·
 * "30. Oktober", never seven days, so a weekday is never ambiguous); older
 * days the date with the weekday ("26. Oktober" · "Montag"), with the year
 * when it isn't `now`'s ("12. Mai 2025").
 */
export function formatDayHeading(locale: AppLocale, value: Instant, now: Instant, timeZone?: string | null): DayHeading {
  const date = toDate(value);
  if (!isValid(date)) return { title: "", detail: "" };
  const reference = toDate(now);
  const { zone } = displayZone(timeZone);
  const daysAgo = isValid(reference) ? dayNumber(reference, zone) - dayNumber(date, zone) : Number.NaN;
  const thisYear = sameYear(date, reference, zone);
  const weekday = dateFormat(locale, zone, WEEKDAY).format(date);
  if (Math.abs(daysAgo) <= 1) {
    const detail = dateFormat(locale, zone, { weekday: "long", day: "numeric", month: "long", ...(thisYear ? {} : { year: "numeric" as const }) }).format(date);
    return { title: capitalised(locale, relative(locale, -daysAgo, "day")), detail };
  }
  const dayMonth = dateFormat(locale, zone, thisYear ? DAY_MONTH : DAY_MONTH_YEAR).format(date);
  if (daysAgo >= 2 && daysAgo <= 6) return { title: capitalised(locale, weekday), detail: dayMonth };
  return { title: capitalised(locale, dayMonth), detail: weekday };
}

/**
 * How far an instant is from `now`, in words ("in 13 hours", "in 13
 * Stunden", "vor 5 Minuten", "now"): minutes below an hour, hours below two
 * days, then days.
 */
export function formatRelativeTime(locale: AppLocale, value: Instant, now: Instant): string {
  const ms = toDate(value).getTime() - toDate(now).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (Math.abs(minutes) < 1) return relative(locale, 0, "second");
  if (Math.abs(minutes) < 60) return relative(locale, minutes, "minute");
  const hours = Math.round(ms / 3_600_000);
  if (Math.abs(hours) < 48) return relative(locale, hours, "hour");
  return relative(locale, Math.round(ms / DAY_MS), "day");
}

/** A weekday's name, ISO numbering (1 Monday … 7 Sunday). */
export function formatWeekday(locale: AppLocale, isoWeekday: number, style: "long" | "short" = "long"): string {
  // 5 January 2026 is a Monday.
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + isoWeekday)));
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

export interface I18nOptions {
  /**
   * The store's IANA time zone (app/.server/shopify/shop-time-zone.ts, sent
   * by the app route's loader): instants are shown in it. Missing, unknown
   * or UTC: shown in UTC, and a time then says "UTC".
   */
  timeZone?: string | null;
}

export function translator(locale: AppLocale, options: I18nOptions = {}) {
  const t: Translate = (key, vars) => translate(locale, key, vars);
  // The zone instants are shown in: "UTC" when the store's is missing or unknown (times then say "UTC").
  const zone = displayZone(options.timeZone).zone;
  return {
    locale,
    /** The zone instants are shown in ("Europe/Berlin"; "UTC" when the store's is unknown). */
    timeZone: zone,
    t,
    /** Renders a message returned by the server. */
    msg: (ref: MessageRef) => translate(locale, ref.key, ref.vars),
    number: (value: number) => formatNumber(locale, value),
    /** "27. Oktober 2026", in the store's zone. */
    date: (value: Instant, style?: "medium" | "long") => formatDate(locale, value, style, zone),
    /** "Oct 29, 2026, 2:02 PM", in the store's zone ("… UTC" without one). */
    dateTime: (value: Instant) => formatDateTime(locale, value, zone),
    /** "1. November" ("1. Januar 2027" in another year), in the store's zone. */
    dayMonth: (value: Instant, now: Instant) => formatDayMonth(locale, value, now, zone),
    /** "Thu, Oct 29, 11:00 PM" in a schedule's own zone. */
    dateTimeIn: (value: Instant, timeZone: string) => formatDateTimeIn(locale, value, timeZone),
    /** "Today, 11:00 PM" / "today, 11:00 PM" (sentence) / "Oct 31, 11:00 PM", in a given zone. */
    dayTimeIn: (value: Instant, timeZone: string, now: Instant, options?: { sentence?: boolean }) => formatDayTimeIn(locale, value, timeZone, now, options),
    /** "2:02 PM" / "14:02", in the store's zone. */
    time: (value: Instant) => formatTime(locale, value, zone),
    /** A time inside a sentence: `time`, in Spanish with its article ("la 1:00", "las 14:02"). */
    timeRef: (value: Instant) => formatTimeRef(locale, value, zone),
    /** A schedule's wall-clock time from minutes after midnight (1380 → "11:00 PM" / "23:00"). */
    clock: (minuteOfDay: number) => formatClock(locale, minuteOfDay),
    /** A day's heading by calendar days in the store's zone ("Heute" · "Montag, 2. November"). */
    dayHeading: (value: Instant, now: Instant) => formatDayHeading(locale, value, now, zone),
    /** "today, 2:02 PM" / "30. Okt., 15:48", in the store's zone. */
    shortWhen: (value: Instant, now: Instant) => formatShortWhen(locale, value, now, zone),
    /** "today at 2:02 PM" / "am 30. Oktober um 15:48", in the store's zone (jobs.when.*). */
    at: (value: Instant, now: Instant) => formatAt(locale, value, now, zone),
    /** "in 13 hours" / "vor 5 Minuten". */
    relativeTime: (value: Instant, now: Instant) => formatRelativeTime(locale, value, now),
    weekday: (isoWeekday: number, style?: "long" | "short") => formatWeekday(locale, isoWeekday, style),
    month: (period: string) => formatMonth(locale, period),
    language: (code: string, shopifyName?: string | null) => languageName(locale, code, shopifyName),
    country: (code: string, shopifyName?: string | null) => countryName(locale, code, shopifyName),
    percent: (value: number) => formatPercent(locale, value),
  };
}

export type I18n = ReturnType<typeof translator>;
