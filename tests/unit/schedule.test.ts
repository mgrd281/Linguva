/**
 * Scheduled check times (app/lib/schedule.ts): wall-clock times in the
 * shop's time zone, daylight-saving changes, weekdays, several times a day,
 * and the rules a merchant's schedule is checked against.
 */
import { describe, expect, it } from "vitest";
import {
  formatTime,
  isTimeZone,
  nextOccurrence,
  normaliseSchedule,
  offsetMinutes,
  parseTime,
  startOfLocalDay,
  startOfLocalMonth,
  upcomingOccurrences,
  wallClock,
  zonedInstant,
  type ScheduleSpec,
} from "../../app/lib/schedule";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const daily = (timeZone: string, time: string): ScheduleSpec => ({ mode: "daily", timeZone, times: [parseTime(time)!], weekdays: [1, 2, 3, 4, 5, 6, 7] });

describe("local times in a time zone", () => {
  it("knows the offset in summer and winter", () => {
    expect(offsetMinutes(at("2026-07-01T12:00:00Z"), "Europe/Berlin")).toBe(120);
    expect(offsetMinutes(at("2026-01-01T12:00:00Z"), "Europe/Berlin")).toBe(60);
    expect(offsetMinutes(at("2026-01-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(offsetMinutes(at("2026-01-01T12:00:00Z"), "America/New_York")).toBe(-300);
  });

  it("finds the instant of a local time, also where the clocks jump", () => {
    expect(iso(zonedInstant(2026, 7, 1, 23 * 60, "Europe/Berlin"))).toBe("2026-07-01T21:00:00.000Z");
    // 29 March 2026: 02:00 jumps to 03:00, so 02:30 doesn't exist and runs at 03:30.
    expect(iso(zonedInstant(2026, 3, 29, 150, "Europe/Berlin"))).toBe("2026-03-29T01:30:00.000Z");
    // 25 October 2026: 02:30 exists twice, the first one counts.
    expect(iso(zonedInstant(2026, 10, 25, 150, "Europe/Berlin"))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(zonedInstant(2026, 3, 8, 150, "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(zonedInstant(2026, 11, 1, 90, "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("starts a local day and month at local midnight", () => {
    expect(iso(startOfLocalDay(at("2026-07-01T23:30:00Z"), "Europe/Berlin"))).toBe("2026-07-01T22:00:00.000Z");
    expect(iso(startOfLocalDay(at("2026-03-29T12:00:00Z"), "Europe/Berlin"))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(startOfLocalMonth(at("2026-10-31T23:30:00Z"), "Europe/Berlin"))).toBe("2026-10-31T23:00:00.000Z");
  });

  it("accepts IANA time zones only", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });
});

describe("the next check", () => {
  it("keeps a daily check at the same local time across daylight saving", () => {
    const spec = daily("Europe/Berlin", "23:00");
    const checks = upcomingOccurrences(spec, at("2026-03-28T12:00:00Z"), 3).map(iso);
    expect(checks).toEqual(["2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z", "2026-03-30T21:00:00.000Z"]);
    const autumn = upcomingOccurrences(spec, at("2026-10-24T12:00:00Z"), 2).map(iso);
    expect(autumn).toEqual(["2026-10-24T21:00:00.000Z", "2026-10-25T22:00:00.000Z"]);
    for (const t of [...checks, ...autumn]) expect(wallClock(Date.parse(t!), "Europe/Berlin")).toMatchObject({ hour: 23, minute: 0 });
  });

  it("runs once on the night the clocks go back, and on the night they jump forward", () => {
    const spec = daily("Europe/Berlin", "02:30");
    expect(upcomingOccurrences(spec, at("2026-10-24T12:00:00Z"), 3).map(iso)).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
      "2026-10-27T01:30:00.000Z",
    ]);
    expect(upcomingOccurrences(spec, at("2026-03-28T12:00:00Z"), 2).map(iso)).toEqual(["2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"]);
    // New York changes on other dates.
    const ny = daily("America/New_York", "01:30");
    expect(upcomingOccurrences(ny, at("2026-10-31T12:00:00Z"), 2).map(iso)).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
  });

  it("orders a jumped-over time after the next real one", () => {
    // 02:30 doesn't exist on 29 March, so it runs at 03:30, after the 03:00 check.
    const spec: ScheduleSpec = { mode: "custom", timeZone: "Europe/Berlin", times: [150, 180], weekdays: [1, 2, 3, 4, 5, 6, 7] };
    expect(upcomingOccurrences(spec, at("2026-03-29T00:00:00Z"), 3).map(iso)).toEqual([
      "2026-03-29T01:00:00.000Z",
      "2026-03-29T01:30:00.000Z",
      "2026-03-30T00:30:00.000Z",
    ]);
  });

  it("follows weekdays and several times a day", () => {
    // Monday and Thursday at 09:00; after Tuesday 1 September 2026 comes Thursday.
    const weekly: ScheduleSpec = { mode: "weekly", timeZone: "Europe/Berlin", times: [540], weekdays: [1, 4] };
    expect(iso(nextOccurrence(weekly, at("2026-09-01T10:00:00Z")))).toBe("2026-09-03T07:00:00.000Z");
    // Weekdays at 08:00 and 20:00; after Friday 4 September 21:00 comes Monday 08:00.
    const custom: ScheduleSpec = { mode: "custom", timeZone: "Europe/Berlin", times: [480, 1200], weekdays: [1, 2, 3, 4, 5] };
    expect(iso(nextOccurrence(custom, at("2026-09-04T19:00:00Z")))).toBe("2026-09-07T06:00:00.000Z");
    expect(iso(nextOccurrence(custom, at("2026-09-07T06:00:00Z")))).toBe("2026-09-07T18:00:00.000Z");
  });

  it("works in zones with half and three-quarter hour offsets", () => {
    expect(iso(nextOccurrence(daily("Asia/Kolkata", "23:00"), at("2026-01-01T00:00:00Z")))).toBe("2026-01-01T17:30:00.000Z");
    // Chatham Islands: +13:45 in January (summer).
    expect(iso(nextOccurrence(daily("Pacific/Chatham", "09:00"), at("2026-01-01T00:00:00Z")))).toBe("2026-01-01T19:15:00.000Z");
    // Lord Howe Island moves its clocks by 30 minutes (5 April 2026, 02:00 → 01:30).
    const lordHowe = upcomingOccurrences(daily("Australia/Lord_Howe", "01:45"), at("2026-04-04T00:00:00Z"), 2).map(iso);
    expect(lordHowe).toEqual(["2026-04-04T14:45:00.000Z", "2026-04-05T15:15:00.000Z"]);
  });

  it("finds the first check after any instant, wherever the shop is", () => {
    const zones = ["Europe/Berlin", "America/New_York", "America/Sao_Paulo", "Asia/Tokyo", "Australia/Sydney", "Africa/Casablanca", "UTC"];
    for (const timeZone of zones) {
      const spec = daily(timeZone, "23:00");
      for (let k = 0; k < 40; k++) {
        const after = at("2026-01-01T00:00:00Z") + k * 9 * 86_400_000 + k * 3_600_000;
        const next = nextOccurrence(spec, after)!;
        expect(next).toBeGreaterThan(after);
        expect(next - after).toBeLessThanOrEqual(25 * 3_600_000);
        expect(wallClock(next, timeZone)).toMatchObject({ hour: 23, minute: 0 });
        // Nothing earlier: an hour before isn't 23:00 local yet.
        expect(nextOccurrence(spec, next - 1)).toBe(next);
      }
    }
  });

  it("has no time for real-time, manual or an empty choice", () => {
    expect(nextOccurrence({ mode: "realtime", timeZone: "UTC", times: [], weekdays: [] }, Date.now())).toBeNull();
    expect(nextOccurrence({ mode: "manual", timeZone: "UTC", times: [600], weekdays: [1] }, Date.now())).toBeNull();
    expect(nextOccurrence({ mode: "weekly", timeZone: "UTC", times: [600], weekdays: [] }, Date.now())).toBeNull();
  });
});

describe("the merchant's schedule", () => {
  it("runs a daily check every day at one time", () => {
    expect(normaliseSchedule({ mode: "daily", timeZone: "Europe/Berlin", times: ["23:00"], weekdays: [] })).toEqual({
      ok: true,
      spec: { mode: "daily", timeZone: "Europe/Berlin", times: [1380], weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    expect(normaliseSchedule({ mode: "daily", timeZone: "Europe/Berlin", times: ["23:00", "08:00"], weekdays: [] })).toMatchObject({ ok: false, problem: "TIMES" });
  });

  it("needs weekdays for weekly and custom checks, and valid times", () => {
    expect(normaliseSchedule({ mode: "weekly", timeZone: "UTC", times: ["09:00"], weekdays: [] })).toMatchObject({ ok: false, problem: "WEEKDAYS" });
    expect(normaliseSchedule({ mode: "weekly", timeZone: "UTC", times: ["09:00"], weekdays: [1, 8] })).toMatchObject({ ok: false, problem: "WEEKDAYS" });
    expect(normaliseSchedule({ mode: "weekly", timeZone: "UTC", times: ["24:00"], weekdays: [1] })).toMatchObject({ ok: false, problem: "TIMES" });
    expect(normaliseSchedule({ mode: "weekly", timeZone: "UTC", times: ["9:00"], weekdays: [1] })).toMatchObject({ ok: false, problem: "TIMES" });
    expect(normaliseSchedule({ mode: "weekly", timeZone: "UTC", times: ["09:00"], weekdays: [4, 1, 1] })).toEqual({
      ok: true,
      spec: { mode: "weekly", timeZone: "UTC", times: [540], weekdays: [1, 4] },
    });
  });

  it("keeps custom checks a little apart, also across midnight, and limits how many", () => {
    const custom = (times: string[]) => normaliseSchedule({ mode: "custom", timeZone: "UTC", times, weekdays: [1, 2, 3, 4, 5] });
    expect(custom(["20:00", "08:00"])).toMatchObject({ ok: true, spec: { times: [480, 1200] } });
    expect(custom(["08:00", "08:30"])).toMatchObject({ ok: false, problem: "TIMES_TOO_CLOSE" });
    expect(custom(["23:30", "00:10"])).toMatchObject({ ok: false, problem: "TIMES_TOO_CLOSE" });
    expect(custom(["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "22:00"])).toMatchObject({ ok: false, problem: "TOO_MANY_TIMES" });
  });

  it("refuses an unknown time zone, and keeps only the zone for real-time and manual", () => {
    expect(normaliseSchedule({ mode: "daily", timeZone: "Nowhere/City", times: ["23:00"], weekdays: [] })).toMatchObject({ ok: false, problem: "TIME_ZONE" });
    expect(normaliseSchedule({ mode: "manual", timeZone: "UTC", times: ["23:00"], weekdays: [1] })).toEqual({
      ok: true,
      spec: { mode: "manual", timeZone: "UTC", times: [], weekdays: [] },
    });
  });

  it("reads and writes 24-hour times", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime(" 07:05 ")).toBe(425);
    expect(parseTime("7:05")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(formatTime(1380)).toBe("23:00");
    expect(formatTime(425)).toBe("07:05");
  });
});
