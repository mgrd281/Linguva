/**
 * Times and days as every page shows them: instants in the store's time
 * zone, "UTC" only when the zone is UTC or unknown (Jobs D1); the clock of
 * the interface language, 12-hour in English and 24-hour in German, French
 * and Spanish (D1b); Spanish times in sentences with their article; day
 * headings and short "when" texts by calendar days in the store's zone,
 * across midnight and daylight-saving changes; the Settings' relative time
 * and day-and-time in a schedule's zone.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  APP_LOCALES,
  calendarDay,
  displayZone,
  formatAt,
  formatClock,
  formatClockRef,
  formatDate,
  formatDateTime,
  formatDateTimeIn,
  formatDayHeading,
  formatDayMonth,
  formatDayTimeIn,
  formatRelativeTime,
  formatShortWhen,
  formatTime,
  formatTimeRef,
  INTL_LOCALE,
  translate,
  translator,
} from "../../app/i18n/i18n";
import { I18nProvider, useI18n } from "../../app/i18n/react";
import { NAMESPACES } from "../../app/i18n/messages";

const BERLIN = "Europe/Berlin";
const NEW_YORK = "America/New_York";
// Monday, November 2, 2026: 14:30 in Berlin (CET, UTC+1), 8:30 AM in New York (EST, UTC-5).
const NOW = "2026-11-02T13:30:00Z";
// 23:30 UTC on Tuesday, October 27: already Wednesday, 00:30 in Berlin; 7:30 PM in New York.
const LATE = "2026-10-27T23:30:00Z";

describe("instants in the store's time zone (D1)", () => {
  it("dateTime: in the store's zone without a suffix; in UTC with 'UTC' when the zone is UTC, unknown or missing", () => {
    expect(formatDateTime("de", LATE, BERLIN)).toBe("28.10.2026, 00:30");
    expect(formatDateTime("en", LATE, BERLIN)).toBe("Oct 28, 2026, 12:30 AM");
    expect(formatDateTime("de", LATE, NEW_YORK)).toBe("27.10.2026, 19:30");
    expect(formatDateTime("en", LATE, NEW_YORK)).toBe("Oct 27, 2026, 7:30 PM");
    expect(formatDateTime("fr", LATE, BERLIN)).toBe("28 oct. 2026, 00:30");
    expect(formatDateTime("es", LATE, BERLIN)).toBe("28 oct 2026, 0:30");
    // Today's text without a zone, and for UTC under any of its names.
    expect(formatDateTime("de", LATE)).toBe("27.10.2026, 23:30 UTC");
    expect(formatDateTime("en", LATE)).toBe("Oct 27, 2026, 11:30 PM UTC");
    for (const zone of ["UTC", "Etc/UTC", "GMT", null, undefined, "", "Not/AZone", "+05:30"]) {
      expect(formatDateTime("de", LATE, zone), String(zone)).toBe("27.10.2026, 23:30 UTC");
    }
    expect(formatDateTime("de", "not a date", BERLIN)).toBe("");
  });

  it("the translator shows instants in its zone, and a translator without one stays as before", () => {
    const de = translator("de", { timeZone: BERLIN });
    expect(de.timeZone).toBe(BERLIN);
    expect(de.dateTime(LATE)).toBe("28.10.2026, 00:30");
    expect(de.date(LATE)).toBe("28. Oktober 2026");
    expect(de.date(LATE, "medium")).toBe("28.10.2026");
    expect(de.dayMonth(LATE, NOW)).toBe("28. Oktober");
    expect(translator("de").timeZone).toBe("UTC");
    expect(translator("de").dateTime(LATE)).toBe("27.10.2026, 23:30 UTC");
    expect(translator("de").date(LATE)).toBe("27. Oktober 2026");
    expect(translator("en", { timeZone: "Etc/UTC" }).timeZone).toBe("UTC");
    expect(translator("en", { timeZone: "Bogus/Zone" }).timeZone).toBe("UTC");
    // Shopify's spelling is kept (Intl's own is "Asia/Calcutta").
    expect(translator("en", { timeZone: "Asia/Kolkata" }).timeZone).toBe("Asia/Kolkata");
    expect(displayZone("Asia/Kolkata")).toEqual({ zone: "Asia/Kolkata", utc: false });
    expect(displayZone(null)).toEqual({ zone: "UTC", utc: true });
  });

  it("date and day-and-month count the store's calendar day, with the year by the store's year", () => {
    expect(formatDate("de", LATE, "long", BERLIN)).toBe("28. Oktober 2026");
    expect(formatDate("en", LATE, "long", NEW_YORK)).toBe("October 27, 2026");
    expect(formatDayMonth("de", "2026-10-31T23:30:00Z", NOW, BERLIN)).toBe("1. November");
    expect(formatDayMonth("en", "2026-10-31T23:30:00Z", NOW, NEW_YORK)).toBe("October 31");
    // New Year's Eve, 23:30 UTC, is already next year in Berlin.
    expect(formatDayMonth("de", "2026-12-31T23:30:00Z", NOW, BERLIN)).toBe("1. Januar 2027");
    expect(formatDayMonth("de", "2026-12-31T23:30:00Z", NOW)).toBe("31. Dezember");
  });

  it("the I18nProvider passes the store's zone to every page", () => {
    const Probe = () => createElement("span", null, `${useI18n().dateTime(LATE)} | ${useI18n().time(LATE)}`);
    const html = (timeZone?: string | null) => renderToStaticMarkup(createElement(I18nProvider, { locale: "de", timeZone } as ComponentProps<typeof I18nProvider>, createElement(Probe)));
    expect(html(BERLIN)).toBe("<span>28.10.2026, 00:30 | 00:30</span>");
    expect(html(null)).toBe("<span>27.10.2026, 23:30 UTC | 23:30 UTC</span>");
  });
});

describe("the clock follows the interface language (D1b)", () => {
  const T = "2026-11-02T13:02:00Z";

  it("time: 12-hour in English, 24-hour in German, French and Spanish, in the store's zone", () => {
    expect(APP_LOCALES.map((l) => formatTime(l, T, BERLIN))).toEqual(["2:02 PM", "14:02", "14:02", "14:02"]);
    expect(APP_LOCALES.map((l) => formatTime(l, T, NEW_YORK))).toEqual(["8:02 AM", "08:02", "08:02", "8:02"]);
    expect(APP_LOCALES.map((l) => formatTime(l, T))).toEqual(["1:02 PM UTC", "13:02 UTC", "13:02 UTC", "13:02 UTC"]);
    expect(translator("en", { timeZone: BERLIN }).time(T)).toBe("2:02 PM");
    expect(formatTime("en", "nonsense", BERLIN)).toBe("");
  });

  it("daylight saving: the hour that repeats when the clocks go back reads the same, and summer has its own offset", () => {
    // Berlin, Sunday, October 25: 03:00 summer time becomes 02:00 winter time at 01:00 UTC.
    expect(formatTime("de", "2026-10-25T00:30:00Z", BERLIN)).toBe("02:30");
    expect(formatTime("de", "2026-10-25T01:30:00Z", BERLIN)).toBe("02:30");
    expect(formatTime("de", "2026-10-25T02:30:00Z", BERLIN)).toBe("03:30");
    // New York, Sunday, November 1: 2:00 AM daylight time becomes 1:00 AM standard time at 06:00 UTC.
    expect(formatTime("en", "2026-11-01T05:30:00Z", NEW_YORK)).toBe("1:30 AM");
    expect(formatTime("en", "2026-11-01T06:30:00Z", NEW_YORK)).toBe("1:30 AM");
    expect(formatTime("de", "2026-07-01T12:00:00Z", BERLIN)).toBe("14:00");
    expect(formatTime("en", "2026-07-01T12:00:00Z", NEW_YORK)).toBe("8:00 AM");
  });

  it("clock: a schedule's wall-clock time (minutes after midnight), in no zone and never with 'UTC'", () => {
    expect(APP_LOCALES.map((l) => formatClock(l, 1380))).toEqual(["11:00 PM", "23:00", "23:00", "23:00"]);
    expect(APP_LOCALES.map((l) => formatClock(l, 540))).toEqual(["9:00 AM", "09:00", "09:00", "9:00"]);
    expect(APP_LOCALES.map((l) => formatClock(l, 0))).toEqual(["12:00 AM", "00:00", "00:00", "0:00"]);
    expect(formatClock("en", 1440 + 90)).toBe("1:30 AM");
    expect(formatClock("en", Number.NaN)).toBe("");
    expect(translator("en", { timeZone: NEW_YORK }).clock(1380)).toBe("11:00 PM");
  });

  it("dateTimeIn: weekday, day and month, then time's clock, in the schedule's own zone", () => {
    const at23 = "2026-10-29T22:00:00Z";
    const at9 = "2026-10-30T08:00:00Z";
    expect(formatDateTimeIn("en", at23, BERLIN)).toBe("Thu, Oct 29, 11:00 PM");
    expect(formatDateTimeIn("de", at23, BERLIN)).toBe("Do., 29. Okt., 23:00");
    expect(formatDateTimeIn("fr", at23, BERLIN)).toBe("jeu. 29 oct., 23:00");
    expect(formatDateTimeIn("es", at23, BERLIN)).toBe("jue, 29 oct, 23:00");
    expect(formatDateTimeIn("en", at9, BERLIN)).toBe("Fri, Oct 30, 9:00 AM");
    expect(formatDateTimeIn("de", at9, BERLIN)).toBe("Fr., 30. Okt., 09:00");
    expect(formatDateTimeIn("es", at9, BERLIN)).toBe("vie, 30 oct, 9:00");
    // The schedule's zone, whatever the store's.
    expect(translator("en", { timeZone: NEW_YORK }).dateTimeIn(at23, BERLIN)).toBe("Thu, Oct 29, 11:00 PM");
    // An unknown zone shows UTC, named as such.
    expect(formatDateTimeIn("en", at23, "Not/AZone")).toBe("Oct 29, 2026, 10:00 PM UTC");
  });

  it("dateTimeIn reads exactly as before in German and French (hourCycle h23 gone, same text)", () => {
    const before = (locale: "de" | "fr", v: number, timeZone: string) =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(v));
    for (const zone of [BERLIN, NEW_YORK, "Asia/Tokyo", "UTC"]) {
      for (let v = Date.UTC(2026, 9, 24); v < Date.UTC(2026, 9, 26); v += 30 * 60_000) {
        for (const locale of ["de", "fr"] as const) expect(formatDateTimeIn(locale, v, zone), `${locale} ${zone} ${v}`).toBe(before(locale, v, zone));
      }
    }
  });
});

describe("times inside sentences", () => {
  it("timeRef: Spanish with its article, 'la' for 1:00 to 1:59 and 'las' otherwise; other languages as time", () => {
    // Berlin is UTC+1 in November.
    const es = (iso: string) => formatTimeRef("es", iso, BERLIN);
    expect(es("2026-11-02T00:00:00Z")).toBe("la 1:00");
    expect(es("2026-11-02T00:59:00Z")).toBe("la 1:59");
    expect(es("2026-11-01T23:30:00Z")).toBe("las 0:30");
    expect(es("2026-11-02T12:00:00Z")).toBe("las 13:00");
    expect(es("2026-11-02T13:02:00Z")).toBe("las 14:02");
    expect(es("2026-11-02T01:00:00Z")).toBe("las 2:00");
    for (const locale of ["en", "de", "fr"] as const) {
      for (const iso of ["2026-11-02T00:00:00Z", "2026-11-02T13:02:00Z"]) expect(formatTimeRef(locale, iso, BERLIN)).toBe(formatTime(locale, iso, BERLIN));
    }
    // The article follows the hour in the store's zone, and UTC is named after the time.
    expect(formatTimeRef("es", "2026-11-01T05:30:00Z", NEW_YORK)).toBe("la 1:30");
    expect(formatTimeRef("es", "2026-11-01T05:30:00Z", BERLIN)).toBe("las 6:30");
    expect(formatTimeRef("es", "2026-11-02T14:02:00Z")).toBe("las 14:02 UTC");
    expect(translator("es", { timeZone: BERLIN }).timeRef("2026-11-02T00:00:00Z")).toBe("la 1:00");
  });

  it("Spanish messages carry no article of their own before a time ('a {time}', never 'a las {time}')", () => {
    expect(translate("es", "jobs.when.today", { time: formatTimeRef("es", "2026-11-02T00:00:00Z", BERLIN) })).toBe("hoy a la 1:00");
    // The smart schedule's times too (formatClockRef: a wall-clock time, no instant).
    for (const [key, message] of [...Object.entries(NAMESPACES.jobs.es), ...Object.entries(NAMESPACES.automatic.es)]) {
      expect(JSON.stringify(message), key).not.toMatch(/\bla(s)? \{(time|times|from|to)\}/);
    }
  });

  it("a schedule's time in a sentence: the interface clock, in Spanish with its article", () => {
    expect(formatClockRef("en", 1380)).toMatch(/^11:00\sPM$/);
    expect(formatClockRef("de", 1380)).toBe("23:00");
    expect(formatClockRef("es", 60)).toBe("la 1:00");
    expect(formatClockRef("es", 119)).toBe("la 1:59");
    expect(formatClockRef("es", 0)).toBe("las 0:00");
    expect(formatClockRef("es", 1380)).toBe("las 23:00");
    expect(translate("es", "automatic.schedule.daily", { time: formatClockRef("es", 60) })).toBe("Cada día a la 1:00");
  });

  it("at: today, yesterday or the date, with the time, in the store's zone (jobs.when.*)", () => {
    const de = (iso: string) => formatAt("de", iso, NOW, BERLIN);
    expect(de("2026-11-02T13:02:00Z")).toBe("heute um 14:02");
    expect(de("2026-11-01T21:14:00Z")).toBe("gestern um 22:14");
    expect(de("2026-10-30T14:48:00Z")).toBe("am 30. Oktober um 15:48");
    expect(de("2025-05-12T12:12:00Z")).toBe("am 12. Mai 2025 um 14:12");
    expect(formatAt("en", "2026-11-02T13:02:00Z", NOW, BERLIN)).toBe("today at 2:02 PM");
    expect(formatAt("en", "2026-11-01T21:14:00Z", NOW, BERLIN)).toBe("yesterday at 10:14 PM");
    expect(formatAt("en", "2026-10-30T14:48:00Z", NOW, BERLIN)).toBe("on October 30 at 3:48 PM");
    expect(formatAt("fr", "2026-11-02T13:02:00Z", NOW, BERLIN)).toBe("aujourd'hui à 14:02");
    expect(formatAt("fr", "2026-10-30T14:48:00Z", NOW, BERLIN)).toBe("le 30 octobre à 15:48");
    expect(formatAt("es", "2026-11-02T13:02:00Z", NOW, BERLIN)).toBe("hoy a las 14:02");
    expect(formatAt("es", "2026-11-01T21:14:00Z", NOW, BERLIN)).toBe("ayer a las 22:14");
    expect(formatAt("es", "2026-10-30T14:48:00Z", NOW, BERLIN)).toBe("el 30 de octubre a las 15:48");
    // 23:30 UTC on Sunday: already Monday in Berlin, still Sunday evening in New York.
    expect(formatAt("de", "2026-11-01T23:30:00Z", NOW, BERLIN)).toBe("heute um 00:30");
    expect(formatAt("en", "2026-11-01T23:30:00Z", NOW, NEW_YORK)).toBe("yesterday at 6:30 PM");
    expect(formatAt("de", "2026-11-02T13:02:00Z", NOW)).toBe("heute um 13:02 UTC");
    expect(translator("de", { timeZone: BERLIN }).at("2026-11-02T13:02:00Z", NOW)).toBe("heute um 14:02");
  });

  it("shortWhen: 'heute, 14:02', 'gestern, 22:01', '30. Okt., 15:48', '12. Mai 2025, 14:12'", () => {
    const de = (iso: string) => formatShortWhen("de", iso, NOW, BERLIN);
    expect(de("2026-11-02T13:02:00Z")).toBe("heute, 14:02");
    expect(de("2026-11-01T21:01:00Z")).toBe("gestern, 22:01");
    expect(de("2026-10-30T14:48:00Z")).toBe("30. Okt., 15:48");
    expect(de("2025-05-12T12:12:00Z")).toBe("12. Mai 2025, 14:12");
    expect(formatShortWhen("en", "2026-11-02T13:02:00Z", NOW, BERLIN)).toBe("today, 2:02 PM");
    expect(formatShortWhen("en", "2026-10-30T14:48:00Z", NOW, NEW_YORK)).toBe("Oct 30, 10:48 AM");
    expect(formatShortWhen("fr", "2026-11-02T13:02:00Z", NOW, BERLIN)).toBe("aujourd'hui, 14:02");
    expect(formatShortWhen("es", "2026-11-01T21:01:00Z", NOW, BERLIN)).toBe("ayer, 22:01");
    expect(formatShortWhen("de", "2026-11-02T13:02:00Z", NOW)).toBe("heute, 13:02 UTC");
    expect(translator("de", { timeZone: BERLIN }).shortWhen("2026-11-01T21:01:00Z", NOW)).toBe("gestern, 22:01");
  });
});

describe("day headings by calendar days in the store's zone", () => {
  const de = (iso: string, now = NOW, zone: string | null = BERLIN) => formatDayHeading("de", iso, now, zone);

  it("today and yesterday by name, 2 to 6 days ago the weekday, from 7 days the date first, another year with the year", () => {
    expect(de("2026-11-02T08:00:00Z")).toEqual({ title: "Heute", detail: "Montag, 2. November" });
    expect(de("2026-11-01T08:00:00Z")).toEqual({ title: "Gestern", detail: "Sonntag, 1. November" });
    // Friday lies in the previous ISO week: the weekday is still the title (six days at most, never ambiguous).
    expect(de("2026-10-30T14:48:00Z")).toEqual({ title: "Freitag", detail: "30. Oktober" });
    expect(de("2026-10-27T08:00:00Z")).toEqual({ title: "Dienstag", detail: "27. Oktober" });
    expect(de("2026-10-26T08:00:00Z")).toEqual({ title: "26. Oktober", detail: "Montag" });
    expect(de("2025-05-12T12:12:00Z")).toEqual({ title: "12. Mai 2025", detail: "Montag" });
    expect(formatDayHeading("en", "2026-11-02T08:00:00Z", NOW, BERLIN)).toEqual({ title: "Today", detail: "Monday, November 2" });
    expect(formatDayHeading("en", "2026-10-30T14:48:00Z", NOW, BERLIN)).toEqual({ title: "Friday", detail: "October 30" });
    expect(formatDayHeading("en", "2026-10-26T08:00:00Z", NOW, BERLIN)).toEqual({ title: "October 26", detail: "Monday" });
    expect(formatDayHeading("en", "2025-05-12T12:12:00Z", NOW, BERLIN)).toEqual({ title: "May 12, 2025", detail: "Monday" });
    // French and Spanish: the title starts with a capital, the detail as written in a sentence.
    expect(formatDayHeading("fr", "2026-11-02T08:00:00Z", NOW, BERLIN)).toEqual({ title: "Aujourd'hui", detail: "lundi 2 novembre" });
    expect(formatDayHeading("fr", "2026-10-30T14:48:00Z", NOW, BERLIN)).toEqual({ title: "Vendredi", detail: "30 octobre" });
    expect(formatDayHeading("es", "2026-11-01T08:00:00Z", NOW, BERLIN)).toEqual({ title: "Ayer", detail: "domingo, 1 de noviembre" });
    expect(formatDayHeading("es", "2026-10-26T08:00:00Z", NOW, BERLIN)).toEqual({ title: "26 de octubre", detail: "lunes" });
  });

  it("midnight in the store's zone decides the day, not UTC's", () => {
    // 23:30 UTC on Tuesday, October 27 is Wednesday in Berlin, Tuesday in New York and in UTC.
    expect(de(LATE)).toEqual({ title: "Mittwoch", detail: "28. Oktober" });
    expect(de(LATE, NOW, NEW_YORK)).toEqual({ title: "Dienstag", detail: "27. Oktober" });
    expect(de(LATE, NOW, null)).toEqual({ title: "Dienstag", detail: "27. Oktober" });
    // 23:30 UTC on Sunday is Monday 00:30 in Berlin: today, while UTC calls it yesterday.
    expect(de("2026-11-01T23:30:00Z").title).toBe("Heute");
    expect(de("2026-11-01T23:30:00Z", NOW, null).title).toBe("Gestern");
    // New York's evening of November 1 is November 2 in UTC.
    expect(formatDayHeading("en", "2026-11-02T04:30:00Z", NOW, NEW_YORK).title).toBe("Yesterday");
    expect(translator("de", { timeZone: BERLIN }).dayHeading(LATE, NOW)).toEqual({ title: "Mittwoch", detail: "28. Oktober" });
  });

  it("counts calendar days across the daylight-saving change (Berlin, October 25)", () => {
    const friday = "2026-10-30T12:00:00Z";
    // Sunday, October 25, 00:30 summer time: 5 days before Friday.
    expect(de("2026-10-24T22:30:00Z", friday)).toEqual({ title: "Sonntag", detail: "25. Oktober" });
    // Saturday, October 24, 00:30 and 23:30 summer time: 6 days.
    expect(de("2026-10-23T22:30:00Z", friday)).toEqual({ title: "Samstag", detail: "24. Oktober" });
    expect(de("2026-10-24T21:30:00Z", friday)).toEqual({ title: "Samstag", detail: "24. Oktober" });
    // Friday, October 23, 23:30 summer time: 7 days, so the date leads.
    expect(de("2026-10-23T21:30:00Z", friday)).toEqual({ title: "23. Oktober", detail: "Freitag" });
    // Monday after the change, 00:30 winter time (23:30 UTC on Sunday): yesterday seen from Tuesday.
    expect(de("2026-10-25T23:30:00Z", "2026-10-27T10:00:00Z")).toEqual({ title: "Gestern", detail: "Montag, 26. Oktober" });
  });

  it("a weekday title from last year names the year in its detail", () => {
    expect(de("2026-12-30T10:00:00Z", "2027-01-02T10:00:00Z")).toEqual({ title: "Mittwoch", detail: "30. Dezember 2026" });
    expect(de("2026-12-31T10:00:00Z", "2027-01-01T10:00:00Z")).toEqual({ title: "Gestern", detail: "Donnerstag, 31. Dezember 2026" });
  });

  it("calendarDay: the store's calendar day the headings count with (the Jobs list's day groups use it)", () => {
    expect(calendarDay(LATE, BERLIN)).toEqual({ day: "2026-10-28", number: Date.UTC(2026, 9, 28) / 86_400_000 });
    expect(calendarDay(LATE, NEW_YORK).day).toBe("2026-10-27");
    // UTC for a missing, unknown or offset zone, as every helper here.
    for (const zone of [null, "Mars/Olympus", "+05:30"]) expect(calendarDay(LATE, zone).day, String(zone)).toBe("2026-10-27");
    // One day from Saturday to Sunday, October 25, although that day has 25 hours in Berlin.
    expect(calendarDay("2026-10-25T10:00:00Z", BERLIN).number - calendarDay("2026-10-24T10:00:00Z", BERLIN).number).toBe(1);
    expect(calendarDay("not a date", BERLIN)).toEqual({ day: "", number: Number.NaN });
  });
});

describe("the Settings' date helpers", () => {
  const MORNING = "2026-11-02T09:00:00Z"; // 10:00 in Berlin
  const ELEVEN_PM = "2026-11-02T22:00:00Z"; // 23:00 in Berlin

  it("relativeTime: how far from now, in the interface language", () => {
    expect(APP_LOCALES.map((l) => formatRelativeTime(l, ELEVEN_PM, MORNING))).toEqual(["in 13 hours", "in 13 Stunden", "dans 13 heures", "dentro de 13 horas"]);
    expect(formatRelativeTime("en", "2026-11-02T09:05:00Z", MORNING)).toBe("in 5 minutes");
    expect(formatRelativeTime("de", "2026-11-02T08:55:00Z", MORNING)).toBe("vor 5 Minuten");
    expect(formatRelativeTime("en", "2026-11-02T09:00:20Z", MORNING)).toBe("now");
    expect(formatRelativeTime("en", "2026-11-02T09:59:00Z", MORNING)).toBe("in 59 minutes");
    expect(formatRelativeTime("en", "2026-11-02T10:00:00Z", MORNING)).toBe("in 1 hour");
    // Hours up to two days, so "tomorrow" never repeats the day beside it.
    expect(formatRelativeTime("en", "2026-11-03T22:00:00Z", MORNING)).toBe("in 37 hours");
    expect(formatRelativeTime("en", "2026-11-05T09:00:00Z", MORNING)).toBe("in 3 days");
    expect(formatRelativeTime("en", "nonsense", MORNING)).toBe("");
    expect(translator("es").relativeTime(ELEVEN_PM, MORNING)).toBe("dentro de 13 horas");
  });

  it("dayTimeIn: today, yesterday, tomorrow or the date, with the time, in the given zone; title or sentence case", () => {
    const en = (iso: string, sentence = false) => formatDayTimeIn("en", iso, BERLIN, MORNING, { sentence });
    expect(en(ELEVEN_PM)).toBe("Today, 11:00 PM");
    expect(en(ELEVEN_PM, true)).toBe("today, 11:00 PM");
    expect(en("2026-11-01T22:06:00Z")).toBe("Yesterday, 11:06 PM");
    expect(en("2026-11-03T22:00:00Z", true)).toBe("tomorrow, 11:00 PM");
    expect(en("2026-10-31T22:00:00Z")).toBe("Oct 31, 11:00 PM");
    expect(en("2025-12-31T22:00:00Z")).toBe("Dec 31, 2025, 11:00 PM");
    expect(formatDayTimeIn("de", ELEVEN_PM, BERLIN, MORNING)).toBe("Heute, 23:00");
    expect(formatDayTimeIn("de", ELEVEN_PM, BERLIN, MORNING, { sentence: true })).toBe("heute, 23:00");
    expect(formatDayTimeIn("de", "2026-10-31T22:00:00Z", BERLIN, MORNING)).toBe("31. Okt., 23:00");
    expect(formatDayTimeIn("fr", ELEVEN_PM, BERLIN, MORNING)).toBe("Aujourd'hui, 23:00");
    expect(formatDayTimeIn("es", ELEVEN_PM, BERLIN, MORNING, { sentence: true })).toBe("hoy, 23:00");
    expect(formatDayTimeIn("es", "2026-11-01T22:06:00Z", BERLIN, MORNING)).toBe("Ayer, 23:06");
  });

  it("dayTimeIn: the zone's midnight decides the day word; the store's zone of the translator doesn't matter", () => {
    // Monday 23:30 in Berlin; the check at 00:30 Berlin time is tomorrow there, still today in UTC and New York.
    const lateMonday = "2026-11-02T22:30:00Z";
    const check = "2026-11-02T23:30:00Z";
    expect(formatDayTimeIn("en", check, BERLIN, lateMonday)).toBe("Tomorrow, 12:30 AM");
    expect(formatDayTimeIn("en", check, "UTC", lateMonday)).toBe("Today, 11:30 PM");
    expect(formatDayTimeIn("en", check, NEW_YORK, lateMonday)).toBe("Today, 6:30 PM");
    expect(translator("de", { timeZone: NEW_YORK }).dayTimeIn(check, BERLIN, lateMonday, { sentence: true })).toBe("morgen, 00:30");
    // The zone is named elsewhere on the page; an unknown one shows UTC, named as such.
    expect(formatDayTimeIn("en", check, "Not/AZone", lateMonday)).toBe("Today, 11:30 PM UTC");
    expect(formatDayTimeIn("en", "nonsense", BERLIN, lateMonday)).toBe("");
  });
});
