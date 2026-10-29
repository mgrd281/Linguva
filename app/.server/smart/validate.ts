/**
 * Validates the Smart Auto-Translate settings form on the server (pure).
 * Every value comes from the browser, so nothing is trusted: the schedule
 * goes through normaliseSchedule, languages must be the shop's current
 * additional languages within the plan, types and field groups come from
 * fixed lists, budgets are bounded integers, and automatic publishing needs
 * the plan and an explicit confirmation.
 */
import type { Entitlements } from "../../lib/plans";
import { normaliseSchedule, WEEKDAYS, type ScheduleProblem } from "../../lib/schedule";
import { isSmartType, REALTIME_CHECK_MINUTE, SMART_FIELD_GROUPS, type SmartType } from "../../lib/smart-auto";

export interface SmartSettingsInput {
  mode: unknown;
  timeZone: unknown;
  /** "HH:MM" values (one for daily, weekly and real-time; up to six for custom). */
  times: readonly unknown[];
  weekdays: readonly unknown[];
  locales: readonly unknown[];
  resourceTypes: readonly unknown[];
  /** "all", or the chosen groups. */
  fieldGroups: "all" | readonly unknown[];
  includeAttached: boolean;
  publishMode: unknown;
  /** The merchant ticked the confirmation for automatic publishing. */
  confirmPublish: boolean;
  replaceOutdatedMachine: boolean;
  /** "" (no budget) or a whole number of characters. */
  dailyBudget: unknown;
  monthlyBudget: unknown;
}

export interface SmartSettingsContext {
  /** The shop's additional languages now (Shopify), in the app's order. */
  targets: readonly string[];
  /** The plan's languages among them (allowedTargetLocales). */
  allowed: readonly string[];
  /** The shop's own time zone as Shopify names it. */
  shopTimeZone: string | null;
  entitlements: Entitlements;
  /** The stored publish mode: switching to automatic publishing needs the confirmation. */
  currentPublishMode: "DRAFT" | "AUTO_PUBLISH";
}

export interface SmartSettingsValue {
  mode: "realtime" | "daily" | "weekly" | "custom" | "manual";
  timeZone: string;
  times: number[];
  weekdays: number[];
  locales: string[];
  resourceTypes: SmartType[];
  fieldGroups: string[];
  includeAttached: boolean;
  publishMode: "DRAFT" | "AUTO_PUBLISH";
  replaceOutdatedMachine: boolean;
  dailyBudget: number | null;
  monthlyBudget: number | null;
}

export type SmartSettingsProblem =
  | ScheduleProblem
  | "NO_LANGUAGE"
  | "PLAN_LANGUAGE"
  | "UNKNOWN_LANGUAGE"
  | "NO_TYPE"
  | "UNKNOWN_TYPE"
  | "NO_FIELD_GROUP"
  | "UNKNOWN_FIELD_GROUP"
  | "BUDGET"
  | "PLAN_AUTO_PUBLISH"
  | "CONFIRMATION_REQUIRED";

const MAX_LIST = 50;

/** Splits comma-joined form values (s-choice-list submits one value), trims and de-duplicates. */
export function formList(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values
        .slice(0, MAX_LIST)
        .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

function budget(value: unknown, max: number): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  // Whole numbers, with thousands separators as merchants type them ("20,000", "400.000", "1 000").
  if (!/^\d{1,9}$/.test(raw) && !/^\d{1,3}([\s,.'’_]\d{3}){1,2}$/.test(raw)) return "invalid";
  const n = Number(raw.replace(/[\s,.'’_]/g, ""));
  return n >= 1 && n <= max ? n : "invalid";
}

export function normaliseSmartSettings(
  input: SmartSettingsInput,
  context: SmartSettingsContext,
): { ok: true; value: SmartSettingsValue } | { ok: false; problem: SmartSettingsProblem } {
  // The schedule: real-time keeps one time for its daily full check, manual none.
  const mode = input.mode;
  const times = formList(input.times);
  const weekdays = formList(input.weekdays);
  const schedule = normaliseSchedule({
    mode: mode === "realtime" ? "daily" : mode,
    timeZone: input.timeZone,
    times: mode === "realtime" && times.length === 0 ? [REALTIME_CHECK_MINUTE] : times,
    weekdays,
    shopTimeZone: context.shopTimeZone,
  });
  if (!schedule.ok) return schedule;
  const spec = schedule.spec;
  const scheduleValue =
    mode === "realtime"
      ? { mode: "realtime" as const, timeZone: spec.timeZone, times: [...spec.times], weekdays: [...WEEKDAYS] }
      : { mode: spec.mode, timeZone: spec.timeZone, times: [...spec.times], weekdays: [...spec.weekdays] };

  // Languages: the shop's own additional languages, within the plan.
  const locales = formList(input.locales);
  if (locales.some((l) => !context.targets.includes(l))) return { ok: false, problem: "UNKNOWN_LANGUAGE" };
  if (locales.some((l) => !context.allowed.includes(l))) return { ok: false, problem: "PLAN_LANGUAGE" };
  if (locales.length === 0) return { ok: false, problem: "NO_LANGUAGE" };

  const types = formList(input.resourceTypes);
  if (types.some((t) => !isSmartType(t))) return { ok: false, problem: "UNKNOWN_TYPE" };
  if (types.length === 0) return { ok: false, problem: "NO_TYPE" };

  let fieldGroups: string[] = [];
  if (input.fieldGroups !== "all") {
    fieldGroups = formList(input.fieldGroups);
    if (fieldGroups.some((g) => !(SMART_FIELD_GROUPS as readonly string[]).includes(g))) return { ok: false, problem: "UNKNOWN_FIELD_GROUP" };
    if (fieldGroups.length === 0) return { ok: false, problem: "NO_FIELD_GROUP" };
    // All of them is the same as "all".
    if (fieldGroups.length === SMART_FIELD_GROUPS.length) fieldGroups = [];
  }

  const publishMode = input.publishMode === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "DRAFT";
  if (publishMode === "AUTO_PUBLISH") {
    if (!context.entitlements.autoPublish) return { ok: false, problem: "PLAN_AUTO_PUBLISH" };
    if (context.currentPublishMode !== "AUTO_PUBLISH" && !input.confirmPublish) return { ok: false, problem: "CONFIRMATION_REQUIRED" };
  }

  const dailyBudget = budget(input.dailyBudget, context.entitlements.monthlyChars);
  const monthlyBudget = budget(input.monthlyBudget, context.entitlements.monthlyChars);
  if (dailyBudget === "invalid" || monthlyBudget === "invalid") return { ok: false, problem: "BUDGET" };

  return {
    ok: true,
    value: {
      ...scheduleValue,
      locales: context.targets.filter((t) => locales.includes(t)),
      resourceTypes: types as SmartType[],
      fieldGroups,
      includeAttached: input.includeAttached,
      publishMode,
      replaceOutdatedMachine: input.replaceOutdatedMachine,
      dailyBudget,
      monthlyBudget,
    },
  };
}
