/**
 * When scheduled automatic translation checks run (pure; server and UI).
 *
 * Check times are wall-clock times in the shop's IANA time zone, so "every
 * day at 23:00" stays 23:00 local across daylight-saving changes. A local
 * time that doesn't exist on a day (the clocks jump forward over it) runs at
 * the same distance after the jump: 02:30 becomes 03:30 when 02:00 jumps to
 * 03:00. A local time that exists twice (the clocks go back) runs once, the
 * first time.
 */

export const SCHEDULE_MODES = ["realtime", "daily", "weekly", "custom", "manual"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

/** ISO weekdays: 1 Monday … 7 Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const MINUTES_PER_DAY = 24 * 60;
/** A custom schedule checks at most this often per day, at least this far apart. */
export const MAX_TIMES_PER_DAY = 6;
export const MIN_MINUTES_APART = 60;

export interface ScheduleSpec {
  mode: ScheduleMode;
  timeZone: string;
  /** Minutes after local midnight (0–1439), ascending. */
  times: readonly number[];
  /** ISO weekdays the checks run on. */
  weekdays: readonly number[];
}

/** Modes with check times of their own (real-time follows the changes; manual never runs by itself). */
export function isTimed(mode: ScheduleMode): mode is "daily" | "weekly" | "custom" {
  return mode === "daily" || mode === "weekly" || mode === "custom";
}

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** A time zone Intl knows (IANA names and their aliases, "UTC"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock time of an instant in a time zone. */
export function wallClock(instant: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** The zone's offset from UTC at an instant, in minutes (Berlin in summer: 120). */
export function offsetMinutes(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The instant of a local date and time (see the module comment for times that don't exist or exist twice). */
export function zonedInstant(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): number {
  const local = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  // The zone's offsets around that day: the one before a change and the one after.
  const offsets = [...new Set([-1, 0, 1].map((d) => offsetMinutes(local + d * DAY_MS, timeZone)))];
  const matches = offsets
    .map((o) => local - o * 60_000)
    .filter((t) => {
      const w = wallClock(t, timeZone);
      return w.year === year && w.month === month && w.day === day && w.hour * 60 + w.minute === minuteOfDay;
    });
  if (matches.length) return Math.min(...matches);
  // The clocks jumped over it: the same distance after the jump.
  return local - Math.min(...offsets) * 60_000;
}

function addDays(date: { year: number; month: number; day: number }, n: number) {
  const t = new Date(Date.UTC(date.year, date.month - 1, date.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** ISO weekday (1 Monday … 7 Sunday) of a calendar date. */
export function isoWeekday(year: number, month: number, day: number): number {
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** The instants of a schedule's checks on local days from `fromDay` to `toDay` days after `instant`'s local day. */
function candidates(spec: ScheduleSpec, instant: number, fromDay: number, toDay: number): number[] {
  const today = wallClock(instant, spec.timeZone);
  const weekdays = new Set(spec.weekdays);
  const out: number[] = [];
  for (let n = fromDay; n <= toDay; n++) {
    const date = addDays(today, n);
    if (!weekdays.has(isoWeekday(date.year, date.month, date.day))) continue;
    for (const minute of spec.times) out.push(zonedInstant(date.year, date.month, date.day, minute, spec.timeZone));
  }
  return out;
}

/**
 * The first check strictly after `after` (epoch ms), or null when the mode
 * has no check times or nothing is chosen. A nonexistent time can map later
 * than the next one, so the earliest of all candidates wins.
 */
export function nextOccurrence(spec: ScheduleSpec, after: number): number | null {
  if (!isTimed(spec.mode) || !spec.times.length || !spec.weekdays.length) return null;
  // One day early: near a change a late time of the previous local day can still be ahead.
  const later = candidates(spec, after, -1, 8).filter((t) => t > after);
  return later.length ? Math.min(...later) : null;
}

/** The next `count` checks after `after`. */
export function upcomingOccurrences(spec: ScheduleSpec, after: number, count: number): number[] {
  const out: number[] = [];
  let from = after;
  while (out.length < count) {
    const next = nextOccurrence(spec, from);
    if (next === null) break;
    out.push(next);
    from = next;
  }
  return out;
}

/** Local midnight that starts the day of `instant` (budgets count per local day). */
export function startOfLocalDay(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return zonedInstant(w.year, w.month, w.day, 0, timeZone);
}

/** Local midnight that starts the month of `instant`. */
export function startOfLocalMonth(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return zonedInstant(w.year, w.month, 1, 0, timeZone);
}

/** "23:00" → 1380; null when not a valid 24-hour time. */
export function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 1380 → "23:00". */
export function formatTime(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type ScheduleProblem = "TIME_ZONE" | "TIMES" | "WEEKDAYS" | "TIMES_TOO_CLOSE" | "TOO_MANY_TIMES";

/**
 * A schedule as the merchant chose it, made consistent: daily runs every
 * day at one time, weekly on chosen days at one time, custom at up to
 * MAX_TIMES_PER_DAY times at least MIN_MINUTES_APART apart on chosen days.
 * Real-time and manual keep their time zone only.
 */
export function normaliseSchedule(input: {
  mode: ScheduleMode;
  timeZone: unknown;
  times: readonly unknown[];
  weekdays: readonly unknown[];
}): { ok: true; spec: ScheduleSpec } | { ok: false; problem: ScheduleProblem } {
  if (!isTimeZone(input.timeZone)) return { ok: false, problem: "TIME_ZONE" };
  const timeZone = input.timeZone;
  if (!isTimed(input.mode)) return { ok: true, spec: { mode: input.mode, timeZone, times: [], weekdays: [] } };
  const times = [...new Set(input.times.map((t) => (typeof t === "number" && Number.isInteger(t) && t >= 0 && t < MINUTES_PER_DAY ? t : parseTime(t))))];
  if (!times.length || times.some((t) => t === null)) return { ok: false, problem: "TIMES" };
  const sorted = (times as number[]).sort((a, b) => a - b);
  const weekdays = [...new Set(input.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (input.mode === "daily") {
    if (sorted.length !== 1) return { ok: false, problem: "TIMES" };
    return { ok: true, spec: { mode: "daily", timeZone, times: sorted, weekdays: [...WEEKDAYS] } };
  }
  if (!weekdays.length || weekdays.length !== new Set(input.weekdays.map(Number)).size) return { ok: false, problem: "WEEKDAYS" };
  if (input.mode === "weekly") {
    if (sorted.length !== 1) return { ok: false, problem: "TIMES" };
    return { ok: true, spec: { mode: "weekly", timeZone, times: sorted, weekdays } };
  }
  if (sorted.length > MAX_TIMES_PER_DAY) return { ok: false, problem: "TOO_MANY_TIMES" };
  // Also across midnight: 23:30 and 00:10 are 40 minutes apart.
  const tooClose = sorted.some((t, i) => t - (i === 0 ? sorted[sorted.length - 1]! - MINUTES_PER_DAY : sorted[i - 1]!) < MIN_MINUTES_APART);
  if (sorted.length > 1 && tooClose) return { ok: false, problem: "TIMES_TOO_CLOSE" };
  return { ok: true, spec: { mode: "custom", timeZone, times: sorted, weekdays } };
}
