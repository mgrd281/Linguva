/**
 * Smart Auto-Translate (Business): what a check translates and when (pure;
 * server and UI). The schedule maths is in schedule.ts; the design is
 * docs/SMART_AUTO_TRANSLATE.md.
 */
import { FIELD_GROUPS, type FieldGroup } from "./coverage-rules";
import { IMAGE_COVERAGE_TYPES } from "./resource-kinds";
import { isTimed, startOfLocalDay, startOfLocalMonth, WEEKDAYS, zonedInstant, wallClock, type ScheduleMode, type ScheduleSpec } from "./schedule";

/** requestedBy of the jobs Smart Auto-Translate creates. */
export const SMART_REQUESTED_BY = "system:smart";

/**
 * Content types a smart check can translate (their own fields), in the order
 * the settings list them. Metaobjects and payment methods can hold personal
 * data (testimonials, team members, bank details): only on explicit choice.
 */
export const SMART_TYPES = [
  "PRODUCT",
  "COLLECTION",
  "PAGE",
  "ARTICLE",
  "BLOG",
  "MENU",
  "LINK",
  "FILTER",
  "PRODUCT_OPTION",
  "PRODUCT_OPTION_VALUE",
  "SELLING_PLAN_GROUP",
  "SELLING_PLAN",
  "SHOP",
  "DELIVERY_METHOD_DEFINITION",
  "METAOBJECT",
  "PAYMENT_GATEWAY",
] as const;
export type SmartType = (typeof SMART_TYPES)[number];

export const SMART_DEFAULT_TYPES: readonly SmartType[] = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"];
/** Types that may hold personal data: the settings say so next to them. */
export const SMART_PERSONAL_DATA_TYPES: ReadonlySet<SmartType> = new Set(["METAOBJECT", "PAYMENT_GATEWAY"]);

export function isSmartType(value: string): value is SmartType {
  return (SMART_TYPES as readonly string[]).includes(value);
}

/** Field groups a merchant can limit a check to (URL handles are never machine-translated). */
export const SMART_FIELD_GROUPS = FIELD_GROUPS.filter((g) => g !== "url") as Exclude<FieldGroup, "url">[];

/** Image alt text and custom-field coverage types of each content type. */
const ATTACHED_BY_OWNER: Record<string, readonly string[]> = Object.entries(IMAGE_COVERAGE_TYPES).reduce<Record<string, string[]>>(
  (acc, [type, meta]) => ({ ...acc, [meta.parent]: [...(acc[meta.parent] ?? []), type] }),
  { PRODUCT: ["PRODUCT_METAFIELD"], COLLECTION: ["COLLECTION_METAFIELD"], PAGE: ["PAGE_METAFIELD"], ARTICLE: ["ARTICLE_METAFIELD"] },
);

/** The coverage types a check plans: the chosen content types, plus their images and custom fields when included. */
export function smartCoverageTypes(scope: { resourceTypes: readonly string[]; includeAttached: boolean }): string[] {
  const types = scope.resourceTypes.filter(isSmartType);
  return scope.includeAttached ? [...types, ...types.flatMap((t) => ATTACHED_BY_OWNER[t] ?? [])] : [...types];
}

/** The daily full check of real-time mode, when no time is chosen: 03:00 local. */
export const REALTIME_CHECK_MINUTE = 180;

/**
 * The schedule of the full checks: the chosen one, and for real-time mode a
 * daily check at its first time (webhooks translate everything in between).
 * Manual mode has none.
 */
export function checkSpec(config: { mode: string; timeZone: string; times: readonly number[]; weekdays: readonly number[] }): ScheduleSpec | null {
  const mode = config.mode as ScheduleMode;
  if (mode === "realtime") {
    return { mode: "daily", timeZone: config.timeZone, times: [config.times[0] ?? REALTIME_CHECK_MINUTE], weekdays: [...WEEKDAYS] };
  }
  if (!isTimed(mode)) return null;
  return { mode, timeZone: config.timeZone, times: config.times, weekdays: config.weekdays };
}

/** Why Smart Auto-Translate pauses (SmartAutoConfig.pauseReason). */
export const SMART_PAUSE_REASONS = [
  "MANUAL",
  "BUDGET_DAILY",
  "BUDGET_MONTHLY",
  "PLAN_ALLOWANCE",
  "DAILY_CAP",
  "PROVIDER",
  "PLAN",
  "CONSENT",
  "PRIMARY_LANGUAGE",
] as const;
export type SmartPauseReason = (typeof SMART_PAUSE_REASONS)[number];

/**
 * When a pause lifts by itself (null: the merchant resumes, or a re-check
 * finds the cause gone). Budgets count in the schedule's time zone; the
 * plan's allowance and the daily caps in UTC, like the usage ledger.
 */
export function pauseLiftsAt(reason: SmartPauseReason, now: number, timeZone: string): number | null {
  switch (reason) {
    case "BUDGET_DAILY": {
      const w = wallClock(now, timeZone);
      return localMidnight(new Date(Date.UTC(w.year, w.month - 1, w.day + 1)), timeZone);
    }
    case "BUDGET_MONTHLY": {
      const w = wallClock(now, timeZone);
      return localMidnight(new Date(Date.UTC(w.year, w.month, 1)), timeZone);
    }
    case "PLAN_ALLOWANCE": {
      const d = new Date(now);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
    case "DAILY_CAP": {
      const d = new Date(now);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    }
    case "PROVIDER":
      return now + 60 * 60_000;
    default:
      return null;
  }
}

/** Local midnight that starts a calendar date (given as a UTC date). */
function localMidnight(date: Date, timeZone: string): number {
  return zonedInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, timeZone);
}

/** The start of the budget windows that contain `now`, in the schedule's zone. */
export function budgetWindows(now: number, timeZone: string) {
  return { daySince: startOfLocalDay(now, timeZone), monthSince: startOfLocalMonth(now, timeZone) };
}

export type SmartStatus =
  | { state: "off" }
  | { state: "on" }
  | { state: "paused"; reason: SmartPauseReason; until: number | null }
  /** On, but it can't run: the reason is shown with what to do. */
  | { state: "waiting"; reason: "PLAN" | "CONSENT" | "UNAVAILABLE" | "NO_LANGUAGE" };

/**
 * What the merchant sees as the state: the stored switch, an active pause,
 * and whatever keeps it from running now (the plan, AI consent, the
 * installation, languages). One function for Settings, the smart page and
 * the Coverage header, so they never disagree.
 */
export function smartStatus(input: {
  enabled: boolean;
  pausedAt: number | null;
  pauseReason: string | null;
  pausedUntil: number | null;
  entitled: boolean;
  consent: boolean;
  available: boolean;
  /** Chosen languages the shop and the plan still have. */
  languages: number;
  now: number;
}): SmartStatus {
  if (!input.enabled) return { state: "off" };
  if (!input.entitled) return { state: "waiting", reason: "PLAN" };
  if (!input.consent) return { state: "waiting", reason: "CONSENT" };
  if (!input.available) return { state: "waiting", reason: "UNAVAILABLE" };
  if (input.pausedAt !== null && (input.pausedUntil === null || input.pausedUntil > input.now)) {
    const reason = (SMART_PAUSE_REASONS as readonly string[]).includes(input.pauseReason ?? "") ? (input.pauseReason as SmartPauseReason) : "MANUAL";
    return { state: "paused", reason, until: input.pausedUntil };
  }
  if (input.languages === 0) return { state: "waiting", reason: "NO_LANGUAGE" };
  return { state: "on" };
}
