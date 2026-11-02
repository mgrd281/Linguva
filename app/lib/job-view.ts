/**
 * The Jobs pages' vocabulary (/app/jobs and /app/jobs/:id), pure and shared by
 * the server and the pages: no I/O and no React. A text is a message key with
 * its values (JobText); instants, durations, counts with their noun and job
 * names inside it are written by jobText in the interface language and the
 * store's time zone, so the pages and the tests write the same words. Tested
 * in tests/unit/job-view.test.ts.
 *
 * - Which failed items a new try can fix (retryHelps): the retry step, the
 *   problem groups and retryJobItems re-queue only those.
 * - Why a job stopped (stopGroup), how the stop looks (stopLook: it needs the
 *   merchant, or it goes on by itself) and where its fix is (STOP_FIX_HREF,
 *   stopFixHref with the way back to the job). Whether the cause is fixed by
 *   now is a cheap server check (app/.server/jobs/stop-fix.ts).
 * - One name per job (jobName), one state (jobState), one outcome group per
 *   item (outcomeGroups on the job page, rowCounts in the list) shown in one
 *   order (DISPLAY_ORDER), and one figure: what ended well (ringFigure).
 * - The list: a row's result and meta, the store-zone days and the clusters
 *   of one check or one click, the attention card's verdict, the addresses of
 *   tabs, filters and pages (parseJobsQuery, jobsHref).
 * - A job's page: the hero by state with its numbered steps (heroModel), the
 *   problems card's heading, the cancel dialog's sentences, the stats.
 */
import { calendarDay, INTL_LOCALE, type I18n, type MessageKey, type MessageVars } from "../i18n/i18n";
import { MESSAGES } from "../i18n/messages";
import { coveragePercent } from "./coverage-rules";
import { ENGINE_NAMES } from "./engines";
import type { IconType } from "./icons";
import { CATEGORIES, isCategoryId, languagePath, type CategoryId } from "./language-categories";
import { upperFirst } from "./name-lists";
import { parseOwnKeyCode } from "./own-keys";
import { CONTENT_TYPES, coverageTypeLabel, RESOURCE_KINDS } from "./resource-kinds";
import { SMART_REQUESTED_BY } from "./smart-auto";

/**
 * Item codes a new try never changes: the `item-permanent` results of
 * classifyError (app/.server/jobs/errors.ts). A unit test feeds classifyError
 * every error it classes so, so the two lists can't drift apart.
 */
export const ITEM_PERMANENT_CODES = ["PROVIDER_REJECTED", "SHOPIFY_QUERY_ERROR", "TOO_LARGE_FOR_LIMIT"] as const;
export type ItemPermanentCode = (typeof ITEM_PERMANENT_CODES)[number];

export function isItemPermanentCode(code: string | null | undefined): code is ItemPermanentCode {
  return (ITEM_PERMANENT_CODES as readonly string[]).includes(code ?? "");
}

/**
 * Whether a new try can fix a failed item: a DEAD item (a retryable error ran
 * out of tries) and a FAILED item whose code isn't permanent (also one without
 * a code). False for every other status: there is nothing to try again.
 */
export function retryHelps(status: string, code: string | null | undefined): boolean {
  if (status === "DEAD") return true;
  return status === "FAILED" && !isItemPermanentCode(code);
}

/**
 * Why a job stopped, in groups that share their texts (jobs.stop.<G>.*), look,
 * fix and check. OWN_KEY_QUOTA and OWN_KEY_AUTH hold every engine's code
 * (OWN_KEY_QUOTA_DEEPL, …); PROVIDER the operator's engine problems; UNKNOWN
 * anything else (also no code).
 */
export const STOP_GROUPS = [
  "DAILY_LIMIT",
  "PLATFORM_LIMIT",
  "QUOTA_EXCEEDED",
  "CONSENT_REQUIRED",
  "ENGINE_CONSENT",
  "PLAN_REQUIRED",
  "PLAN_SMART",
  "SMART_BUDGET_DAILY",
  "SMART_BUDGET_MONTHLY",
  "PRIMARY_LANGUAGE",
  "OWN_KEY_MISSING",
  "OWN_KEY_QUOTA",
  "OWN_KEY_AUTH",
  "SHOP_AUTH",
  "DISCOVERY_FAILED",
  "PROVIDER",
  "SHOP_INACTIVE",
  "UNKNOWN",
] as const;
export type StopGroup = (typeof STOP_GROUPS)[number];

/** Groups whose only code is the group's own name. */
const SINGLE_CODE_GROUPS: ReadonlySet<string> = new Set<StopGroup>([
  "DAILY_LIMIT",
  "PLATFORM_LIMIT",
  "QUOTA_EXCEEDED",
  "CONSENT_REQUIRED",
  "ENGINE_CONSENT",
  "PLAN_REQUIRED",
  "PLAN_SMART",
  "SMART_BUDGET_DAILY",
  "SMART_BUDGET_MONTHLY",
  "PRIMARY_LANGUAGE",
  "OWN_KEY_MISSING",
  "SHOP_AUTH",
  "DISCOVERY_FAILED",
  "SHOP_INACTIVE",
]);

/** The operator's engine isn't there or refused us: nothing the merchant can fix. */
const PROVIDER_CODES: ReadonlySet<string> = new Set(["AI_NOT_CONFIGURED", "PROVIDER_QUOTA", "PROVIDER_AUTH"]);

/** An own key's stop with its engine (app/lib/own-keys.ts ownKeyStopCode), or the engine-less catalogue name. */
const OWN_KEY_STOP = /^OWN_KEY_(QUOTA|AUTH)(?:_(?:DEEPL|AZURE|GOOGLE))?$/;

/** The stop group of a FAILED job's error code; UNKNOWN for a code no group holds and for none. */
export function stopGroup(code: string | null | undefined): StopGroup {
  if (!code) return "UNKNOWN";
  if (SINGLE_CODE_GROUPS.has(code)) return code as StopGroup;
  if (PROVIDER_CODES.has(code)) return "PROVIDER";
  const own = OWN_KEY_STOP.exec(code);
  if (own) return own[1] === "QUOTA" ? "OWN_KEY_QUOTA" : "OWN_KEY_AUTH";
  return "UNKNOWN";
}

/**
 * How a stop looks: "needsYou" (critical: nothing goes on until the merchant
 * acts) or "waits" (warning: it goes on by itself, or resuming later works).
 * Null for SHOP_INACTIVE: the app isn't installed, so there is nothing to show
 * or do.
 */
export type StopLook = "needsYou" | "waits";

const NEEDS_YOU: ReadonlySet<StopGroup> = new Set<StopGroup>([
  "CONSENT_REQUIRED",
  "ENGINE_CONSENT",
  "PLAN_REQUIRED",
  "PLAN_SMART",
  "PRIMARY_LANGUAGE",
  "OWN_KEY_MISSING",
  "OWN_KEY_QUOTA",
  "OWN_KEY_AUTH",
  "SHOP_AUTH",
]);

export function stopLook(group: StopGroup): StopLook | null {
  if (group === "SHOP_INACTIVE") return null;
  return NEEDS_YOU.has(group) ? "needsYou" : "waits";
}

/**
 * Where each fixable cause is fixed: Settings sections by `?section=<key>`
 * (never the old hashes of Settings' cards), the smart page's cards by their hash,
 * the Plan page. Groups without an entry have no in-app fix (a reset to wait
 * for, the operator's engines, reopening the app for SHOP_AUTH).
 */
export const STOP_FIX_HREF: Readonly<Partial<Record<StopGroup, string>>> = {
  QUOTA_EXCEEDED: "/app/plan",
  CONSENT_REQUIRED: "/app/settings?section=ai",
  ENGINE_CONSENT: "/app/settings?section=ai",
  PLAN_REQUIRED: "/app/plan",
  PLAN_SMART: "/app/plan",
  SMART_BUDGET_DAILY: "/app/settings/automatic#smart-budgets",
  SMART_BUDGET_MONTHLY: "/app/settings/automatic#smart-budgets",
  PRIMARY_LANGUAGE: "/app/settings/automatic#smart-scope",
  OWN_KEY_MISSING: "/app/settings?section=keys",
  OWN_KEY_QUOTA: "/app/settings?section=keys",
  OWN_KEY_AUTH: "/app/settings?section=keys",
};

/**
 * The fix target with the stopped job (`job=<id>`, before the hash), so the
 * target can lead back to it once the cause is fixed; null without a target.
 */
export function stopFixHref(group: StopGroup, jobId: string): string | null {
  const target = STOP_FIX_HREF[group];
  if (!target) return null;
  const hashAt = target.indexOf("#");
  const path = hashAt === -1 ? target : target.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : target.slice(hashAt);
  return `${path}${path.includes("?") ? "&" : "?"}job=${encodeURIComponent(jobId)}${hash}`;
}

// ─── Texts ───────────────────────────────────────────────────────────────────

/** An instant as the server has it (Date) or a loader sends it (ISO text). */
export type When = string | Date;

/** Shopify's names of the store's languages, by locale (English keeps them: "Portuguese (Brazil)"). */
export type LanguageNames = Readonly<Record<string, string | null | undefined>>;

/** What names a job: its language and its kind. */
export interface JobNaming {
  targetLocale: string;
  resourceType: string;
}

/**
 * A value inside a JobText: plain (a ready string; a number, formatted for
 * the language, whose `count` also picks the plural form), another text, or
 * a thing jobText writes with the page's helpers:
 * - `time`: a time on its own (i18n.time: "14:02", "2:02 PM");
 * - `timeRef`: a time inside a sentence (i18n.timeRef: Spanish "las 14:02");
 * - `at`: when something happened (i18n.at: "heute um 14:02");
 * - `dayMonth`: a day and month (i18n.dayMonth: "30. Oktober");
 * - `duration`: milliseconds in words ("4 Minuten");
 * - `items` of a `type`: a count with the kind's noun (jobItems: "14 Kollektionen");
 * - `kind`: a kind's label (jobKindLabel: "Kollektionen");
 * - `language`: a language's name ("Italienisch");
 * - `job`: a job's name (jobName: "Italienisch · Kollektionen");
 * - `percent`: a whole percentage ("60 %");
 * - `list`: values as a list ("A, B und 2 weiteren");
 * - `join`: values joined by `separator` ("06:10–21:40").
 */
export type TextValue =
  | string
  | number
  | JobText
  | { time: When }
  | { timeRef: When }
  | { at: When }
  | { dayMonth: When }
  | { duration: number }
  | { items: number; type: string }
  | { kind: string }
  | { language: string }
  | { job: JobNaming }
  | { percent: number }
  | { list: readonly TextValue[] }
  | { join: readonly TextValue[]; separator: string };

/** A text: a message key and its values. */
export interface JobText {
  key: MessageKey;
  vars?: Readonly<Record<string, TextValue>>;
  /** A figure written before the words ("14 warten auf deine Freigabe": the legend's and the rows' pattern). */
  figure?: number;
  /** The first letter upper-cased: words written for the middle of a sentence that start a line ("Vom Zeitplan"). */
  upperFirst?: boolean;
}

/**
 * What jobText needs: the page's I18n, whose time helpers (time, timeRef, at,
 * dayMonth) write instants in the store's zone, "UTC" only when it is UTC or
 * unknown (app/i18n/i18n.ts).
 */
export type JobTextI18n = I18n;

export interface JobTextContext {
  /** The page's time (the loader's), for day words ("heute um 14:02"). */
  now: When;
  /** A duration in words: durationText (app/components/Coverage.tsx), the Overview's and Coverage's words. */
  duration: (ms: number) => string;
  /** Shopify's names of the store's languages, for job names and {language}. */
  names?: LanguageNames;
}

/** A text in the interface language. */
export function jobText(i18n: JobTextI18n, text: JobText, context: JobTextContext): string {
  const vars: MessageVars = {};
  for (const [name, value] of Object.entries(text.vars ?? {})) vars[name] = written(i18n, value, context);
  const words = i18n.t(text.key, vars);
  const shown = text.upperFirst ? upperFirst(words) : words;
  return text.figure === undefined ? shown : `${i18n.number(text.figure)} ${shown}`;
}

/** A value on its own (a figure formatted for the language): a stat, a part of a row's meta. */
export function jobValue(i18n: JobTextI18n, value: TextValue, context: JobTextContext): string {
  const text = written(i18n, value, context);
  return typeof text === "number" ? i18n.number(text) : text;
}

function written(i18n: JobTextI18n, value: TextValue, context: JobTextContext): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  if ("key" in value) return jobText(i18n, value, context);
  if ("time" in value) return i18n.time(value.time);
  if ("timeRef" in value) return i18n.timeRef(value.timeRef);
  if ("at" in value) return i18n.at(value.at, context.now);
  if ("dayMonth" in value) return i18n.dayMonth(value.dayMonth, context.now);
  if ("duration" in value) return context.duration(value.duration);
  if ("items" in value) return jobItems(i18n, value.type, value.items);
  if ("kind" in value) return jobKindLabel(i18n, value.kind);
  if ("language" in value) return i18n.language(value.language, context.names?.[value.language]);
  if ("job" in value) return jobName(i18n, value.job, context.names);
  if ("percent" in value) return i18n.percent(value.percent);
  if ("list" in value) {
    const parts = value.list.map((part) => jobValue(i18n, part, context));
    return new Intl.ListFormat(INTL_LOCALE[i18n.locale], { type: "conjunction" }).format(parts);
  }
  return value.join.map((part) => jobValue(i18n, part, context)).join(value.separator);
}

// ─── Names ───────────────────────────────────────────────────────────────────

const known = (key: string): key is MessageKey => Object.prototype.hasOwnProperty.call(MESSAGES.en, key);

// A smart check's image and custom-field kinds have words of their own (jobs.kind.*, jobs.unit.*): the language page's.
const IMAGE_TYPES: readonly string[] = CATEGORIES.images.types;
const FIELD_TYPES: readonly string[] = CATEGORIES.customFields.types;
type AttachedType = (typeof CATEGORIES.images.types)[number] | (typeof CATEGORIES.customFields.types)[number];
const isAttachedType = (type: string): type is AttachedType => IMAGE_TYPES.includes(type) || FIELD_TYPES.includes(type);

/** The types a job can have: the 16 bulk types (SUPPORTED_BULK_RESOURCE_TYPES) and the 7 image and custom-field types of a smart check. */
export const JOB_TYPES: readonly string[] = [
  ...Object.keys(RESOURCE_KINDS),
  ...Object.entries(CONTENT_TYPES)
    .filter(([, meta]) => meta.bulk)
    .map(([type]) => type),
  ...IMAGE_TYPES,
  ...FIELD_TYPES,
];

/** A job's kind: "Produkte", "Menülinks"; images and custom fields by the language page's words ("Bildbeschreibungen (Produkte)"). */
export function jobKindLabel(i18n: I18n, type: string): string {
  if (isAttachedType(type)) return i18n.t(`jobs.kind.${type}`);
  const label = `common.kind.${type}.label`;
  return known(label) ? i18n.t(label) : coverageTypeLabel(type);
}

/** A count with the kind's noun: "1 Produkt", "14 Kollektionen", "46 Bildbeschreibungen"; a kind without nouns: "3 Einträge". */
export function jobItems(i18n: I18n, type: string, count: number): string {
  if (IMAGE_TYPES.includes(type)) return i18n.t("jobs.unit.image", { count });
  if (FIELD_TYPES.includes(type)) return i18n.t("jobs.unit.field", { count });
  const form = new Intl.PluralRules(INTL_LOCALE[i18n.locale]).select(count) === "one" ? "singular" : "plural";
  const noun = `common.kind.${type}.${form}`;
  return known(noun) ? `${i18n.number(count)} ${i18n.t(noun)}` : i18n.t("jobs.unit.item", { count });
}

/** One name per job, everywhere: "Französisch · Produkte" (the language as a name's start: "Français · Produits"). */
export function jobName(i18n: I18n, job: JobNaming, names?: LanguageNames): string {
  const language = upperFirst(i18n.language(job.targetLocale, names?.[job.targetLocale]));
  return i18n.t("jobs.name", { language, kind: jobKindLabel(i18n, job.resourceType) });
}

/** requestedBy of automatic translation's jobs (AUTO_REQUESTED_BY in app/.server/jobs/bulk-jobs.ts). */
export const AUTO_STARTER = "system:auto";

/**
 * Who started a job: you (the staff member looking), your team (another
 * one), hand (no starter recorded: older jobs), automatic translation, or the
 * smart schedule.
 */
export type JobOrigin = "you" | "team" | "hand" | "auto" | "smart";

export function jobOrigin(job: { requestedBy: string | null }, actorId?: string | null): JobOrigin {
  const by = job.requestedBy;
  if (by === AUTO_STARTER) return "auto";
  if (by === SMART_REQUESTED_BY) return "smart";
  if (!by || by.startsWith("system:")) return "hand";
  return actorId && by === actorId ? "you" : "team";
}

/** A job of the smart schedule (its checks and its real-time job): the schedule translates a changed original again by itself. */
const isSmart = (job: { requestedBy: string | null }) => job.requestedBy === SMART_REQUESTED_BY;

/**
 * A job that collects changes as they come in (isAutomaticJob on the
 * server): automatic translation's and the smart schedule's real-time one. It
 * has no time left, and its time is the span of the changes.
 */
export function isAutomatic(job: { requestedBy: string | null; smartRunId: string | null }): boolean {
  return job.requestedBy === AUTO_STARTER || (isSmart(job) && !job.smartRunId);
}

/** The job fields these functions read: a TranslationJob row, or its JSON in a loader's data. */
export interface JobFields {
  id: string;
  resourceType: string;
  targetLocale: string;
  status: string;
  requestedBy: string | null;
  smartRunId: string | null;
  idempotencyKey: string;
  discoveryDone: boolean;
  totalItems: number;
  succeededItems: number;
  skippedItems: number;
  failedItems: number;
  charsBilled: number;
  charsSaved: number;
  publishMode: string;
  fieldScope: string;
  errorCode: string | null;
  createdAt: When;
  startedAt: When | null;
  finishedAt: When | null;
  updatedAt: When;
}

const ACTIVE: ReadonlySet<string> = new Set(["PENDING", "DISCOVERING", "RUNNING"]);

// ─── States ──────────────────────────────────────────────────────────────────

/** A job's one look: the same mark, badge and word (STATE_WORD) in the list and on its page. */
export const JOB_STATES = ["queued", "finding", "running", "done", "doneLook", "doneErrors", "stopped", "stoppedWait", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];

/**
 * A job's state. `look` counts the items left for the merchant (the groups'
 * `look`: PARTIAL, ALL_FIELDS_REJECTED, a changed original of a job that
 * isn't smart); `fixed` is a stop's fix check (stopFix). A stop is "stopped"
 * while it needs the merchant, "stoppedWait" when it goes on by itself or
 * its cause is fixed (one click resumes it).
 */
export function jobState(job: Pick<JobFields, "status" | "discoveryDone" | "failedItems" | "errorCode">, look = 0, fixed: boolean | null = null): JobState {
  switch (job.status) {
    case "PENDING":
      return "queued";
    case "DISCOVERING":
      return "finding";
    case "RUNNING":
      return job.discoveryDone ? "running" : "finding";
    case "COMPLETED":
      return job.failedItems > 0 ? "doneErrors" : look > 0 ? "doneLook" : "done";
    case "FAILED":
      return fixed !== true && stopLook(stopGroup(job.errorCode)) === "needsYou" ? "stopped" : "stoppedWait";
    default:
      return "cancelled";
  }
}

/** Each state's word: the badge, the row's meta and the rows' sentence. */
export const STATE_WORD: Readonly<Record<JobState, MessageKey>> = {
  queued: "common.jobStatus.PENDING",
  finding: "common.jobStatus.DISCOVERING",
  running: "common.jobStatus.RUNNING",
  done: "common.jobStatus.COMPLETED",
  doneLook: "jobs.state.completedGaps",
  doneErrors: "jobs.state.completedErrors",
  stopped: "common.jobStatus.FAILED",
  stoppedWait: "common.jobStatus.FAILED",
  cancelled: "common.jobStatus.CANCELLED",
};

// ─── Outcome groups ──────────────────────────────────────────────────────────

/**
 * The outcome groups in one order: the legend (top down), the bar (from the
 * left) and the ring (clockwise from 12 o'clock). What ended well is one arc
 * from 12 o'clock, the problems follow at its end, the open track comes last.
 */
export const DISPLAY_ORDER = ["translated", "waiting", "kept", "look", "failed", "notYet", "skipped", "open"] as const;
export type OutcomeGroup = (typeof DISPLAY_ORDER)[number];

/** What ended well: "fertig" / "done" counts exactly these, everywhere. */
export const ENDED_WELL: readonly OutcomeGroup[] = ["translated", "waiting", "kept"];

/** A job's items by outcome group: every item is in exactly one. */
export interface JobGroups {
  counts: Readonly<Record<OutcomeGroup, number>>;
  /** Every item: the counts add up to it. */
  total: number;
  /** Failed items a new try can fix (retryHelps); the other failed items only the editor can. */
  retryable: number;
  /** A smart job's changed originals (part of notYet): the schedule's next check translates them again by itself. */
  selfResolving: number;
}

const noCounts = (): Record<OutcomeGroup, number> => ({ translated: 0, waiting: 0, kept: 0, look: 0, failed: 0, notYet: 0, skipped: 0, open: 0 });
const sum = (counts: Readonly<Record<OutcomeGroup, number>>) => DISPLAY_ORDER.reduce((total, group) => total + counts[group], 0);

/** One line of jobOutcomes: how many items ended with a status and a code. */
export interface ItemOutcomes {
  status: string;
  code: string | null;
  count: number;
}

/**
 * A job page's groups from its items (jobOutcomes) and the items waiting for
 * approval (jobPendingDrafts().items), by the classification priority:
 * failed (FAILED, DEAD) > look (PARTIAL, ALL_FIELDS_REJECTED, a changed
 * original of a job that isn't smart) > waiting > translated (the other
 * succeeded items) > kept (the other skipped ones: up to date, protected, …)
 * > notYet (a stopped job's cancelled items, which resuming sends again; a
 * smart job's changed originals) / skipped (any other job's cancelled items)
 * > open.
 */
export function outcomeGroups(outcomes: readonly ItemOutcomes[], waiting: number, job: Pick<JobFields, "status" | "requestedBy">): JobGroups {
  const smart = isSmart(job);
  const counts = noCounts();
  let succeeded = 0;
  let retryable = 0;
  let selfResolving = 0;
  for (const { status, code, count } of outcomes) {
    if (status === "FAILED" || status === "DEAD") {
      counts.failed += count;
      if (retryHelps(status, code)) retryable += count;
    } else if (status === "SUCCEEDED") {
      if (code === "PARTIAL") counts.look += count;
      else succeeded += count;
    } else if (status === "SKIPPED") {
      if (code === "ALL_FIELDS_REJECTED" || (code === "SOURCE_CHANGED" && !smart)) counts.look += count;
      else if (code === "SOURCE_CHANGED") {
        counts.notYet += count;
        selfResolving += count;
      } else counts.kept += count;
    } else if (status === "CANCELLED") {
      counts[job.status === "FAILED" ? "notYet" : "skipped"] += count;
    } else counts.open += count;
  }
  counts.waiting = Math.min(Math.max(0, waiting), succeeded);
  counts.translated = succeeded - counts.waiting;
  return { counts, total: sum(counts), retryable, selfResolving };
}

/** What a list row knows of its items beyond the counters (rowOutcomesByJob). */
export interface RowOutcomeCounts {
  waiting: number;
  partial: number;
  rejected: number;
  sourceChanged: number;
  cancelled: number;
  retryable: number;
}

/**
 * A list row's groups, the same as outcomeGroups', from the job's counters
 * and its items' aggregate (rowOutcomesByJob) instead of every item. The
 * skipped counter also counts cancelled items.
 */
export function rowCounts(
  job: Pick<JobFields, "status" | "requestedBy" | "totalItems" | "succeededItems" | "skippedItems" | "failedItems">,
  outcomes?: RowOutcomeCounts | null,
): JobGroups {
  const o = outcomes ?? { waiting: 0, partial: 0, rejected: 0, sourceChanged: 0, cancelled: 0, retryable: 0 };
  const smart = isSmart(job);
  const stopped = job.status === "FAILED";
  const counts = noCounts();
  const partial = Math.min(o.partial, job.succeededItems);
  counts.waiting = Math.min(o.waiting, job.succeededItems - partial);
  counts.translated = job.succeededItems - partial - counts.waiting;
  counts.look = partial + o.rejected + (smart ? 0 : o.sourceChanged);
  counts.kept = Math.max(0, job.skippedItems - o.cancelled - o.rejected - o.sourceChanged);
  counts.notYet = (stopped ? o.cancelled : 0) + (smart ? o.sourceChanged : 0);
  counts.skipped = stopped ? 0 : o.cancelled;
  counts.failed = job.failedItems;
  const done = job.succeededItems + job.skippedItems + job.failedItems;
  counts.open = Math.max(0, job.totalItems - done);
  return { counts, total: Math.max(job.totalItems, done), retryable: Math.min(o.retryable, job.failedItems), selfResolving: smart ? o.sourceChanged : 0 };
}

/** The items that ended well: translated, waiting for approval, already up to date ("fertig"). */
export function endedWell(groups: JobGroups): number {
  return ENDED_WELL.reduce((total, group) => total + groups.counts[group], 0);
}

/** The groups that have items, in DISPLAY_ORDER: the legend's lines, the bar's and the ring's segments. */
export function displayParts(groups: JobGroups): Array<{ group: OutcomeGroup; count: number }> {
  return DISPLAY_ORDER.filter((group) => groups.counts[group] > 0).map((group) => ({ group, count: groups.counts[group] }));
}

const GROUP_WORDS: Readonly<Record<Exclude<OutcomeGroup, "translated">, MessageKey>> = {
  waiting: "language.hero.state.waiting",
  kept: "jobs.legend.kept",
  look: "jobs.legend.look",
  failed: "language.hero.state.failed",
  notYet: "jobs.legend.notYet",
  skipped: "jobs.legend.skipped",
  open: "jobs.legend.open",
};

/** A group's figure and words: "176 warten auf deine Freigabe"; translated "4 übersetzt und live" when the job publishes, else "38 übersetzt". */
export function groupText(group: OutcomeGroup, count: number, autoPublish: boolean): JobText {
  const key = group !== "translated" ? GROUP_WORDS[group] : autoPublish ? "jobs.legend.translated" : "jobs.legend.translatedPlain";
  return { key, vars: { count }, figure: count };
}

export interface LegendLine {
  group: OutcomeGroup;
  count: number;
  text: JobText;
}

/** The legend: one line per group with items, in DISPLAY_ORDER. */
export function legend(groups: JobGroups, autoPublish: boolean): LegendLine[] {
  return displayParts(groups).map(({ group, count }) => ({ group, count, text: groupText(group, count, autoPublish) }));
}

// ─── The figure ──────────────────────────────────────────────────────────────

/** What ended well, in whole percent rounded down (coveragePercent: 100 only when every item did); null without items. */
export function ringPercent(groups: JobGroups): number | null {
  return coveragePercent(endedWell(groups), groups.total);
}

/** "aktuell" when every item was already up to date, "gefunden" while the job still finds its items, else "fertig". */
function ringCaption(groups: JobGroups, finding: boolean): MessageKey {
  if (finding) return "jobs.ring.found";
  return groups.total > 0 && groups.counts.kept === groups.total ? "jobs.ring.upToDate" : "jobs.ring.finished";
}

export interface RingFigure {
  /** ringPercent; null while finding and without items. */
  percent: number | null;
  /** The figure as shown: "60 %" / "60%", the found count while finding, "—" without items. */
  figure: string;
  caption: MessageKey;
  /** The figure's font size in a ring of 112 px and in one of 96 px. */
  fontSize: { wide: number; narrow: number };
}

/**
 * The ring's one figure in every state with a total, so a live job climbs to
 * its final figure and keeps it; while finding, the count found so far.
 */
export function ringFigure(i18n: Pick<I18n, "number" | "percent">, groups: JobGroups, options: { finding?: boolean } = {}): RingFigure {
  const finding = options.finding ?? false;
  const percent = finding ? null : ringPercent(groups);
  const figure = finding ? i18n.number(groups.total) : percent === null ? "—" : i18n.percent(percent);
  return { percent, figure, caption: ringCaption(groups, finding), fontSize: { wide: ringFigureSize(figure, 112), narrow: ringFigureSize(figure, 96) } };
}

/**
 * The figure's size by its length in characters (a no-break space counts:
 * "62 %" has 4), so a longer figure stays inside the ring: 28 px up to 3
 * characters, 24 px for 4, 22 px from 5 in a ring of 112 px or more; 22, 20
 * and 18 px in a smaller one. CoverageRing draws every ring's figure with it.
 */
export function ringFigureSize(figure: string, size: number): number {
  const length = [...figure].length;
  const [short, four, long] = size >= 112 ? [28, 24, 22] : [22, 20, 18];
  return length <= 3 ? short : length === 4 ? four : long;
}

// ─── Stop texts ──────────────────────────────────────────────────────────────

/** Stop causes with a fix step (jobs.stop.<G>.fixTitle, .fixText, .action): a place in the app (STOP_FIX_HREF), or opening the app again. */
export const FIX_GROUPS = [
  "QUOTA_EXCEEDED",
  "CONSENT_REQUIRED",
  "ENGINE_CONSENT",
  "PLAN_REQUIRED",
  "PLAN_SMART",
  "SMART_BUDGET_DAILY",
  "SMART_BUDGET_MONTHLY",
  "PRIMARY_LANGUAGE",
  "OWN_KEY_MISSING",
  "OWN_KEY_QUOTA",
  "OWN_KEY_AUTH",
  "SHOP_AUTH",
] as const satisfies readonly StopGroup[];
export type FixGroup = (typeof FIX_GROUPS)[number];

export function hasFix(group: StopGroup): group is FixGroup {
  return (FIX_GROUPS as readonly string[]).includes(group);
}

/** The place a fix text names ({section}): where the step's button lands (until the Settings redesign names it settings.section.keys, the keys card's name). */
const FIX_SECTION: Readonly<Partial<Record<FixGroup, MessageKey>>> = {
  CONSENT_REQUIRED: "settings.ai.heading",
  ENGINE_CONSENT: "settings.ai.heading",
  OWN_KEY_MISSING: "settings.glance.keys.label",
  OWN_KEY_QUOTA: "settings.glance.keys.label",
  OWN_KEY_AUTH: "settings.glance.keys.label",
  PRIMARY_LANGUAGE: "automatic.section.scope",
};

/** Allowances that come back by themselves: their fixed stop says "Das KI‑Kontingent ist wieder da". */
const ALLOWANCE_GROUPS: ReadonlySet<StopGroup> = new Set<StopGroup>(["DAILY_LIMIT", "PLATFORM_LIMIT", "QUOTA_EXCEEDED"]);
/** Causes nothing in the app fixes: resuming is always offered (a provider's only as a second choice). */
const NOTHING_TO_FIX: ReadonlySet<StopGroup> = new Set<StopGroup>(["DISCOVERY_FAILED", "PROVIDER", "UNKNOWN"]);
/** Causes whose full text (common.jobError.<code>) is folded under "Was ist passiert?". */
const FOLDED: ReadonlySet<StopGroup> = new Set<StopGroup>(["OWN_KEY_MISSING", "OWN_KEY_QUOTA", "OWN_KEY_AUTH", "PROVIDER"]);

/** What the server knows of a stop beyond its code. */
export interface StopFacts {
  /** stopFix: true fixed, false not yet, null no cheap check. */
  fixed: boolean | null;
  /** stopResumesAt: when a limit goes on by itself (the next midnight UTC, the next usage period). */
  resumesAt?: When | null;
  /** A smart budget's stop: the schedule's next check. */
  nextCheckAt?: When | null;
}

type StopJob = Pick<JobFields, "targetLocale" | "errorCode">;

/** The values a stop's texts name: the language, an own key's engine, the resume time and date, the next check. */
function stopVars(job: StopJob, facts: StopFacts | null | undefined): Record<string, TextValue> {
  const vars: Record<string, TextValue> = { language: { language: job.targetLocale } };
  const own = parseOwnKeyCode(job.errorCode);
  if (own && own.kind !== "MISSING") vars.engine = ENGINE_NAMES[own.engine];
  if (facts?.resumesAt) {
    vars.time = { timeRef: facts.resumesAt };
    vars.date = { dayMonth: facts.resumesAt };
  }
  if (facts?.nextCheckAt) vars.when = { at: facts.nextCheckAt };
  return vars;
}

/** A stop's words: `short` (the row's result, the card's title), `help` (the hero's reason, the card's text). */
export function stopText(job: StopJob, part: "short" | "help", facts?: StopFacts | null): JobText {
  return { key: `jobs.stop.${stopGroup(job.errorCode)}.${part}`, vars: stopVars(job, facts) };
}

// ─── List rows ───────────────────────────────────────────────────────────────

type RowJob = Pick<
  JobFields,
  "targetLocale" | "resourceType" | "requestedBy" | "smartRunId" | "publishMode" | "fieldScope" | "errorCode" | "totalItems" | "createdAt" | "finishedAt" | "updatedAt"
>;

/** A row of the list: the job, its state (jobState) and its groups (rowCounts). */
export interface JobRowView {
  job: RowJob;
  state: JobState;
  groups: JobGroups;
}

/** A fragment's icon: an outcome group's (the legend's), or a stop that goes on (pause-circle, warning). */
export type FragmentLook = OutcomeGroup | "paused";
export type FragmentTone = "critical" | "caution" | "warning" | "subdued" | null;

export interface RowFragment {
  look: FragmentLook;
  tone: FragmentTone;
  text: JobText;
}

/** A live row: its words and its bar (outcome segments, or striped while finding); a history row: one or two fragments. */
export type RowResult = { live: true; text: JobText; subdued: boolean; bar: "segments" | "striped" | null } | { live: false; fragments: RowFragment[] };

const GROUP_TONE: Readonly<Record<OutcomeGroup, FragmentTone>> = {
  translated: null,
  waiting: null,
  kept: "subdued",
  look: "caution",
  failed: "critical",
  notYet: "subdued",
  skipped: "subdued",
  open: "subdued",
};

const doneOf = (groups: JobGroups): JobText => ({ key: "jobs.result.doneOf", vars: { ok: endedWell(groups), total: groups.total } });

/**
 * What came out of a history row, in words, at most two fragments by
 * priority: failed > look > waiting, else translated; nothing of these → what
 * wasn't translated, else "Alles war schon aktuell". Never a ✓ while items
 * are left for the merchant.
 */
function outcomeFragments(job: RowJob, groups: JobGroups): RowFragment[] {
  const { counts } = groups;
  const autoPublish = job.publishMode === "AUTO_PUBLISH";
  const fragment = (group: OutcomeGroup): RowFragment => ({ look: group, tone: GROUP_TONE[group], text: groupText(group, counts[group], autoPublish) });
  const shown: OutcomeGroup[] = (["failed", "look"] as const).filter((group) => counts[group] > 0);
  if (counts.waiting > 0) shown.push("waiting");
  else if (counts.translated > 0) shown.push("translated");
  if (!shown.length) shown.push(...(["notYet", "skipped"] as const).filter((group) => counts[group] > 0));
  if (!shown.length) return [{ look: "kept", tone: "subdued", text: { key: "jobs.result.allUpToDate" } }];
  return shown.slice(0, 2).map(fragment);
}

export function rowResult(row: JobRowView, options: { workerDown?: boolean } = {}): RowResult {
  const { job, state, groups } = row;
  switch (state) {
    case "running":
      return {
        live: true,
        text: { key: "jobs.result.progress", vars: { ok: endedWell(groups), total: groups.total, percent: { percent: ringPercent(groups) ?? 0 } } },
        subdued: false,
        bar: "segments",
      };
    case "finding":
      return { live: true, text: { key: "jobs.result.found", vars: { count: groups.total } }, subdued: true, bar: "striped" };
    case "queued":
      return { live: true, text: { key: options.workerDown ? "jobs.result.waitingWorker" : "jobs.result.startsSoon" }, subdued: true, bar: null };
    case "stopped":
      return { live: false, fragments: [{ look: "failed", tone: "critical", text: stopText(job, "short") }] };
    case "stoppedWait":
      return { live: false, fragments: [{ look: "paused", tone: "warning", text: stopText(job, "short") }] };
    case "cancelled":
      return { live: false, fragments: [{ look: "skipped", tone: "subdued", text: doneOf(groups) }] };
    default:
      return { live: false, fragments: outcomeFragments(job, groups) };
  }
}

/** The system's reasons for cancelling a job (jobs.cancelReason.*, jobs.hero.cancelledBy.*). */
export const CANCEL_REASONS = ["AUTO_OFF", "SMART_OFF", "SHOP_UNINSTALLED"] as const;
type CancelReason = (typeof CANCEL_REASONS)[number];

function cancelReason(code: string | null): CancelReason | null {
  return (CANCEL_REASONS as readonly string[]).includes(code ?? "") ? (code as CancelReason) : null;
}

const changesFromTo = (job: RowJob): JobText => ({ key: "jobs.meta.changesFromTo", vars: { from: { timeRef: job.createdAt }, to: { timeRef: job.updatedAt } } });

/**
 * The origin as a narrow card's first word, where no badges fit: automatic,
 * the schedule (neither inside a cluster, whose header names it) or the SEO
 * scope.
 */
function originWord(job: RowJob, inCluster: boolean): JobText | null {
  if (!inCluster && job.requestedBy === AUTO_STARTER) return { key: "common.automatic" };
  if (!inCluster && isSmart(job)) return { key: "jobs.filter.started.smart", upperFirst: true };
  return job.fieldScope === "SEO" ? { key: "jobs.badge.seo" } : null;
}

export interface RowMetaOptions {
  /** A narrow card: the origin is the first word (rowMeta). */
  narrow?: boolean;
  /** The staff member looking (requireShop's actorId): their jobs say "von dir". */
  actorId?: string | null;
  /** A running job's time left (reliableEta, ms). */
  eta?: number | null;
  /** The row is in a cluster, whose header names the check or the click. */
  inCluster?: boolean;
  /** A smart check's time (its run's occurrence); default the job's start. */
  checkAt?: When | null;
}

/**
 * A row's meta, its parts joined by " · ": the state word first, then what
 * the row adds (the time left, the check's time, the item count or the span
 * of the changes) and who started it (merchant jobs only: automatic and smart
 * jobs carry a badge). A system cancel says its reason alone. On a narrow
 * card the origin takes the state word's place (the mark and the result say
 * the state); a cancelled row keeps when it was cancelled.
 */
export function rowMeta(row: JobRowView, options: RowMetaOptions = {}): TextValue[] {
  const { job, state, groups } = row;
  const reason = state === "cancelled" ? cancelReason(job.errorCode) : null;
  if (reason) return [{ key: "jobs.meta.cancelledBecause", vars: { reason: { key: `jobs.cancelReason.${reason}` } } }];
  const origin = jobOrigin(job, options.actorId);
  const who: JobText | null = origin === "you" ? { key: "jobs.meta.byYou" } : origin === "team" ? { key: "jobs.meta.byTeam" } : null;
  const word: JobText = { key: STATE_WORD[state] };
  let parts: Array<TextValue | null>;
  switch (state) {
    case "running":
      parts = [word, options.eta != null && !isAutomatic(job) ? { key: "jobs.meta.eta", vars: { duration: { duration: options.eta } } } : null, who];
      break;
    case "finding":
      parts = [word, origin === "smart" ? { key: "jobs.meta.checkAt", vars: { time: { timeRef: options.checkAt ?? job.createdAt } } } : who];
      break;
    case "queued":
      parts = [word, who];
      break;
    case "stopped":
    case "stoppedWait":
      parts = [word, doneOf(groups), who];
      break;
    case "cancelled":
      parts = [{ key: "jobs.meta.cancelledAt", vars: { time: { timeRef: job.finishedAt ?? job.updatedAt } } }, origin === "you" ? { key: "jobs.meta.startedByYou" } : who];
      break;
    default:
      parts = isAutomatic(job) ? [word, changesFromTo(job)] : [word, { items: job.totalItems, type: job.resourceType }, who];
  }
  const meta = parts.filter((part): part is TextValue => part !== null);
  const first = options.narrow ? originWord(job, options.inCluster ?? false) : null;
  if (!first) return meta;
  return state === "cancelled" ? [first, ...meta] : [first, ...meta.slice(1)];
}

// ─── Days and clusters ───────────────────────────────────────────────────────

/** A day of the list in the store's zone. */
export interface DayGroup<T> {
  /** The calendar day ("2026-11-02"): a stable id. */
  day: string;
  /** Calendar days before `now`'s (0 today, 1 yesterday, 2–6 by weekday, from 7 by date). */
  daysAgo: number;
  /** An instant of the day (its newest row's), for its heading (i18n.dayHeading). */
  at: When;
  rows: T[];
}

/**
 * The rows (newest first) by their calendar day in the store's zone, each
 * day with how many days before `now`'s it is; its heading is
 * i18n.dayHeading(at, now) ("Heute · Montag, 2. November"). `zone` is the
 * page's `i18n.timeZone`: the days are counted by the headings' own rule
 * (calendarDay in app/i18n/i18n.ts; a missing, unknown or offset zone is UTC).
 */
export function dayGroups<T extends { createdAt: When }>(rows: readonly T[], zone: string | null | undefined, now: When): DayGroup<T>[] {
  const today = calendarDay(now, zone).number;
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const { day, number } = calendarDay(row.createdAt, zone);
    const last = groups.at(-1);
    if (last?.day === day) last.rows.push(row);
    else groups.push({ day, daysAgo: today - number, at: row.createdAt, rows: [row] });
  }
  return groups;
}

/** What a cluster reads of a row. */
export interface ClusterFields {
  id: string;
  createdAt: When;
  resourceType: string;
  smartRunId: string | null;
  idempotencyKey: string;
}

/** Jobs that belong together: the jobs of one smart check, or of one click that started several kinds. */
export interface JobCluster<T> {
  origin: "smart" | "click";
  /** Its first row's id (a stable key). */
  key: string;
  rows: T[];
  /** "Abgleich des Zeitplans um 03:00" / "Zusammen gestartet um 14:02": when its first job started. */
  title: JobText;
  /** "3 Aufträge". */
  count: JobText;
  /** The schedule's recent checks (smart, wide cards only). */
  link: { href: string; label: JobText } | null;
}

export type ListEntry<T> = { kind: "row"; row: T } | { kind: "cluster"; cluster: JobCluster<T> };

/** What ties a row to its neighbours: its smart check, or its click (one form key, `<key>:<TYPE>` per kind). */
function tie(row: ClusterFields): string | null {
  if (row.smartRunId) return `smart:${row.smartRunId}`;
  const suffix = `:${row.resourceType}`;
  return row.idempotencyKey.length > suffix.length && row.idempotencyKey.endsWith(suffix) ? `click:${row.idempotencyKey.slice(0, -suffix.length)}` : null;
}

function cluster<T extends ClusterFields>(tied: string, rows: T[]): JobCluster<T> {
  const smart = tied.startsWith("smart:");
  // Rows are newest first: the check or the click started with the last one.
  const at = rows[rows.length - 1].createdAt;
  return {
    origin: smart ? "smart" : "click",
    key: rows[0].id,
    rows,
    title: { key: smart ? "jobs.cluster.smart" : "jobs.cluster.click", vars: { time: { timeRef: at } } },
    count: { key: "jobs.cluster.count", vars: { count: rows.length } },
    link: smart ? { href: "/app/settings/automatic#smart-activity", label: { key: "jobs.cluster.schedule" } } : null,
  };
}

/**
 * One day's rows (dayGroups: a cluster never spans two days) with their
 * clusters: two or more adjacent rows of one smart check or one click. Drawn
 * from the rows on screen only.
 */
export function clusters<T extends ClusterFields>(rows: readonly T[]): ListEntry<T>[] {
  const entries: ListEntry<T>[] = [];
  let start = 0;
  while (start < rows.length) {
    const tied = tie(rows[start]);
    let end = start + 1;
    while (tied && end < rows.length && tie(rows[end]) === tied) end++;
    entries.push(tied && end - start >= 2 ? { kind: "cluster", cluster: cluster(tied, rows.slice(start, end)) } : { kind: "row", row: rows[start] });
    start = end;
  }
  return entries;
}

// ─── A job's page ────────────────────────────────────────────────────────────

/** A job's translations waiting in Review and the items they belong to (jobPendingDrafts). */
export interface PendingDrafts {
  translations: number;
  items: number;
}

/** A step's button: a link, Retry (posts intent=retry, only the retryable items), Resume (the same), or opening the app again. */
export type StepAction =
  | { kind: "link"; href: string; label: JobText }
  | { kind: "retry"; label: JobText; accessibilityLabel: JobText }
  | { kind: "resume"; label: JobText }
  | { kind: "reload"; label: JobText };

export type StepId = "review" | "retry" | "finish" | "fix" | "resume" | "wait" | "rest" | "autoOff" | "smartOff";

/** A numbered step; at most one step of a panel is primary: the first one with a button, when it may lead. */
export interface Step {
  id: StepId;
  title: JobText;
  text: JobText[];
  action: StepAction | null;
  primary: boolean;
}

export type CancelAction = { kind: "cancel"; label: JobText };
export type LinkAction = { kind: "link"; href: string; label: JobText };

/** A panel's foot: a sentence and a quiet button, side by side once `wide` pixels fit (the Actions rule). */
export interface PanelFoot {
  text: JobText;
  action: CancelAction | LinkAction;
  wide: number;
}

export interface NextPanel {
  heading: MessageKey;
  steps: Step[];
  foot: PanelFoot | null;
  /** "Was ist passiert?": the stop's full text (common.jobError.<code>, jobErrorMessage). */
  fold: { summary: MessageKey; code: string } | null;
}

/**
 * The hero's foot strip when there are no steps: "Nichts zu tun." with a
 * check for a job that is over, a neutral info icon for one still active; a
 * queued job's strip is the cancel foot alone.
 */
export type HeroStrip = { kind: "nothing"; icon: "done" | "active"; title: JobText; text: JobText; action: CancelAction | LinkAction | null } | { kind: "foot"; foot: PanelFoot };

/** A line under the hero's title: subdued, or the stop's reason (pause-circle in its tone); `live` is the "updates by itself" line with the live dot. */
export interface HeroLine {
  text: JobText[];
  tone: "critical" | "warning" | null;
  live: boolean;
}

export interface HeroModel {
  state: JobState;
  /** The ring (dashed while finding, its label the whole sentence), or a queued job's clock mark. */
  mark: { kind: "ring"; dashed: boolean; caption: MessageKey; label: JobText } | { kind: "clock"; tone: "info" | "caution" };
  title: JobText;
  lines: HeroLine[];
  legend: LegendLine[];
  panel: NextPanel | null;
  strip: HeroStrip | null;
}

export interface HeroOptions {
  /** A running job's time left (reliableEta, ms). */
  eta?: number | null;
  /** Background jobs aren't running (backgroundJobsRunning() false): a queued job waits for them. */
  workerDown?: boolean;
  /** A cancelled or stopped job still has items that settle (PENDING, RUNNING). */
  settling?: boolean;
  /** The store is on the Own key plan: no plan upsell. */
  ownKeyPlan?: boolean;
}

type HeroJob = Pick<JobFields, "id" | "resourceType" | "targetLocale" | "status" | "discoveryDone" | "failedItems" | "errorCode" | "requestedBy" | "smartRunId" | "publishMode">;

type StepDraft = Omit<Step, "primary"> & { mayLead: boolean };

/** The first step with a button is the panel's primary, when it may lead; no other step is. */
function withPrimary(drafts: ReadonlyArray<StepDraft | null>): Step[] {
  const steps = drafts.filter((step): step is StepDraft => step !== null);
  const lead = steps.findIndex((step) => step.action !== null);
  return steps.map(({ mayLead, ...step }, index) => ({ ...step, primary: index === lead && mayLead }));
}

const line = (...text: JobText[]): HeroLine => ({ text, tone: null, live: false });
const LIVE: HeroLine = { text: [{ key: "jobs.group.liveNote" }], tone: null, live: true };
const CANCEL: CancelAction = { kind: "cancel", label: { key: "jobs.detail.cancel" } };
const CANCEL_FOOT: PanelFoot = { text: { key: "jobs.next.cancelFoot" }, action: CANCEL, wide: 280 };
const PLANS_FOOT: PanelFoot = { text: { key: "jobs.next.plansFoot" }, action: { kind: "link", href: "/app/plan", label: { key: "jobs.action.plans" } }, wide: 540 };
const NOTHING: JobText = { key: "jobs.next.nothing.title" };
const OVER: Extract<HeroStrip, { kind: "nothing" }> = { kind: "nothing", icon: "done", title: NOTHING, text: { key: "jobs.next.nothing.done" }, action: null };

const viewLanguage = (job: HeroJob): LinkAction => ({
  kind: "link",
  href: languagePath(job.targetLocale),
  label: { key: "jobs.action.viewLanguage", vars: { language: { language: job.targetLocale } } },
});

function reviewStep(job: HeroJob, pending: PendingDrafts): StepDraft {
  return {
    id: "review",
    title: { key: "language.next.review.title", vars: { count: pending.translations } },
    text: [{ key: "jobs.next.review.detail", vars: { count: pending.translations, items: { items: pending.items, type: job.resourceType } } }],
    action: { kind: "link", href: `/app/review?job=${encodeURIComponent(job.id)}`, label: { key: "language.next.review.action" } },
    mayLead: true,
  };
}

function retryStep(job: HeroJob, groups: JobGroups): StepDraft {
  const items: TextValue = { items: groups.retryable, type: job.resourceType };
  return {
    id: "retry",
    title: { key: "jobs.next.retry.title", vars: { count: groups.retryable, items } },
    text: [{ key: "jobs.next.retry.text" }],
    action: { kind: "retry", label: { key: "jobs.action.retry" }, accessibilityLabel: { key: "jobs.action.retryLabel", vars: { items } } },
    mayLead: true,
  };
}

function finishStep(job: HeroJob, count: number): StepDraft {
  return {
    id: "finish",
    title: { key: "jobs.next.finish.title", vars: { count, items: { items: count, type: job.resourceType } } },
    text: [{ key: "jobs.next.finish.text" }],
    action: { kind: "link", href: "#problems-heading", label: { key: "jobs.action.view" } },
    mayLead: true,
  };
}

function fixStep(job: HeroJob, group: FixGroup, stop: StopFacts | null): StepDraft {
  const vars = stopVars(job, stop);
  const section = FIX_SECTION[group];
  const href = stopFixHref(group, job.id);
  const label: JobText = { key: `jobs.stop.${group}.action`, vars };
  return {
    id: "fix",
    title: { key: `jobs.stop.${group}.fixTitle`, vars },
    text: [{ key: `jobs.stop.${group}.fixText`, vars: section ? { ...vars, section: { key: section } } : vars }],
    action: href ? { kind: "link", href, label } : { kind: "reload", label },
    // Raising a smart budget is optional: the schedule goes on by itself.
    mayLead: group !== "SMART_BUDGET_DAILY" && group !== "SMART_BUDGET_MONTHLY",
  };
}

/** Resume: what it sends again (the cancelled and retryable items, the items still waiting) and what stays. */
function resumeStep(job: HeroJob, groups: JobGroups, group: StopGroup, fixed: boolean): StepDraft {
  const ready = fixed || NOTHING_TO_FIX.has(group);
  const open = groups.counts.notYet - groups.selfResolving + groups.retryable + groups.counts.open;
  const ok = endedWell(groups);
  const text: JobText[] = [];
  if (open > 0) text.push({ key: "jobs.next.resume.open", vars: { count: open, open: { items: open, type: job.resourceType } } });
  if (ok > 0) text.push({ key: "jobs.next.resume.done", vars: { count: ok, done: { items: ok, type: job.resourceType } } });
  return {
    id: "resume",
    title: { key: ready ? "jobs.next.resumeNow.title" : "jobs.next.resume.title" },
    text,
    action: { kind: "resume", label: { key: "jobs.detail.resume" } },
    mayLead: ready && group !== "PROVIDER",
  };
}

function waitStep(stop: StopFacts | null): StepDraft {
  return {
    id: "wait",
    title: { key: "jobs.next.waitUntil.title", vars: stop?.resumesAt ? { time: { timeRef: stop.resumesAt } } : {} },
    text: [{ key: "jobs.next.waitUntil.text" }],
    action: null,
    mayLead: false,
  };
}

function ringMark(groups: JobGroups, title: JobText, autoPublish: boolean): HeroModel["mark"] {
  const percent = ringPercent(groups);
  const caption = ringCaption(groups, false);
  const states: TextValue = { join: legend(groups, autoPublish).map((entry) => entry.text), separator: ", " };
  return {
    kind: "ring",
    dashed: false,
    caption,
    label: { key: "jobs.ring.label", vars: { figure: percent === null ? "—" : { percent }, caption: { key: caption }, title, states } },
  };
}

type HeroEnd = Pick<HeroModel, "panel" | "strip">;

const panelOf = (heading: MessageKey, steps: Step[], foot: PanelFoot | null = null): HeroEnd => ({ panel: { heading, steps, foot, fold: null }, strip: null });

/** An active job: its steps with the cancel foot, else "Nichts zu tun." with a neutral icon and the cancel action. */
function activeEnd(job: HeroJob, steps: Step[]): HeroEnd {
  if (steps.length) return panelOf("language.next.heading", steps, CANCEL_FOOT);
  return {
    panel: null,
    strip: { kind: "nothing", icon: "active", title: NOTHING, text: { key: isSmart(job) ? "jobs.next.nothing.smart" : "jobs.next.nothing.running" }, action: CANCEL },
  };
}

type HeroBody = Pick<HeroModel, "title" | "mark" | "lines"> & HeroEnd;

function finishedHero(job: HeroJob, groups: JobGroups, review: StepDraft | null): HeroBody {
  const kind: TextValue = { kind: job.resourceType };
  const autoPublish = job.publishMode === "AUTO_PUBLISH";
  const ok = endedWell(groups);
  if (groups.counts.kept === groups.total) {
    const title: JobText = { key: "jobs.hero.upToDate", vars: { kind, total: groups.total } };
    const settings: LinkAction | null = isAutomatic(job) ? { kind: "link", href: "/app/settings?section=changes", label: { key: "jobs.action.autoSettings" } } : null;
    return {
      title,
      mark: ringMark(groups, title, autoPublish),
      lines: [line({ key: "jobs.hero.nothingText", vars: { items: { items: groups.total, type: job.resourceType } } })],
      panel: null,
      strip: { ...OVER, action: settings },
    };
  }
  if (ok === groups.total) {
    const title: JobText = { key: "jobs.hero.allDone", vars: { kind, total: groups.total } };
    const mark = ringMark(groups, title, autoPublish);
    if (review) return { title, mark, lines: [line({ key: "jobs.hero.draftsText" })], ...panelOf("language.next.heading", withPrimary([review])) };
    const live: HeroStrip = { kind: "nothing", icon: "done", title: { key: "jobs.next.allLive.title" }, text: { key: "jobs.next.allLive.text" }, action: viewLanguage(job) };
    return { title, mark, lines: [line({ key: "jobs.hero.liveText" })], panel: null, strip: live };
  }
  const title: JobText = { key: "jobs.hero.title", vars: { kind, ok, total: groups.total } };
  // The items only the editor finishes: incomplete ones, and failed ones a new try doesn't help (a smart job's changed originals are its schedule's).
  const finish = groups.counts.look + groups.counts.failed - groups.retryable;
  const steps = withPrimary([review, groups.retryable > 0 ? retryStep(job, groups) : null, finish > 0 ? finishStep(job, finish) : null]);
  const lines = [line(...(review ? [{ key: "jobs.hero.draftsText" } as const] : []), { key: "jobs.hero.missingBelow" })];
  return { title, mark: ringMark(groups, title, autoPublish), lines, ...(steps.length ? panelOf("language.next.heading", steps) : { panel: null, strip: OVER }) };
}

function stoppedHero(job: HeroJob, groups: JobGroups, review: StepDraft | null, stop: StopFacts | null, state: JobState, options: HeroOptions): Pick<HeroModel, "lines"> & HeroEnd {
  const group = stopGroup(job.errorCode);
  const fixed = stop?.fixed === true;
  const reason: HeroLine = fixed
    ? { text: [{ key: ALLOWANCE_GROUPS.has(group) ? "jobs.hero.allowanceBack" : "jobs.hero.fixed" }], tone: "warning", live: false }
    : { text: [stopText(job, "help", stop)], tone: state === "stopped" ? "critical" : "warning", live: false };
  const lines = [reason, line({ key: "jobs.hero.kept" })];
  // The app isn't installed: nothing to resume.
  if (group === "SHOP_INACTIVE") return { lines, panel: null, strip: OVER };
  // Before the daily reset there is nothing to resume yet: approving comes first.
  const waits = !fixed && (group === "DAILY_LIMIT" || group === "PLATFORM_LIMIT");
  const fix = hasFix(group) && !fixed ? fixStep(job, group, stop) : null;
  const steps = withPrimary(waits ? [review, waitStep(stop)] : [fix, resumeStep(job, groups, group, fixed), review]);
  const foot = group === "DAILY_LIMIT" && !options.ownKeyPlan ? PLANS_FOOT : null;
  const fold = FOLDED.has(group) && job.errorCode ? { summary: "jobs.next.whatHappened" as const, code: job.errorCode } : null;
  return { lines, panel: { heading: "jobs.next.howTo", steps, foot, fold }, strip: null };
}

function cancelledHero(job: HeroJob, groups: JobGroups, review: StepDraft | null, settling: boolean): Pick<HeroModel, "lines"> & HeroEnd {
  // Items still settle after the cancel: the figures move, nothing to do yet.
  if (settling) return { lines: [line({ key: "jobs.hero.cancelling" })], panel: null, strip: { ...OVER, icon: "active" } };
  const reason = cancelReason(job.errorCode);
  const kept: JobText = { key: "jobs.hero.cancelledText" };
  const lines = [reason ? line({ key: `jobs.hero.cancelledBy.${reason}`, vars: { language: { language: job.targetLocale } } }, kept) : line(kept)];
  let next: StepDraft | null = null;
  if (reason === "AUTO_OFF") {
    const settings: LinkAction = { kind: "link", href: "/app/settings?section=changes", label: { key: "jobs.action.settings" } };
    next = { id: "autoOff", title: { key: "jobs.next.autoOff.title" }, text: [{ key: "jobs.next.autoOff.text" }], action: settings, mayLead: false };
  } else if (reason === "SMART_OFF") {
    const schedule: LinkAction = { kind: "link", href: "/app/settings/automatic", label: { key: "jobs.cluster.schedule" } };
    next = { id: "smartOff", title: { key: "jobs.next.smartOff.title" }, text: [{ key: "jobs.next.smartOff.text" }], action: schedule, mayLead: false };
  } else if (!reason && endedWell(groups) < groups.total) {
    // A cancelled job gets no primary of its own: translating the rest starts a new job on the language page.
    next = { id: "rest", title: { key: "jobs.next.rest.title" }, text: [{ key: "jobs.next.rest.text" }], action: viewLanguage(job), mayLead: false };
  }
  const steps = withPrimary([review, next]);
  return { lines, ...(steps.length ? panelOf("language.next.heading", steps) : { panel: null, strip: OVER }) };
}

/**
 * A job page's hero by state: the ring (or a queued job's clock mark), the
 * title in the job's kind, the lines under it, the legend, and the Next panel
 * with at most three numbered steps (at most one primary), or the foot strip
 * when there is nothing to do. `pending` are the job's translations waiting
 * in Review; `stop` what the server knows of a stopped job's cause.
 */
export function heroModel(job: HeroJob, groups: JobGroups, pending: PendingDrafts, stop: StopFacts | null, options: HeroOptions = {}): HeroModel {
  const state = jobState(job, groups.counts.look, stop?.fixed ?? null);
  const autoPublish = job.publishMode === "AUTO_PUBLISH";
  const kind: TextValue = { kind: job.resourceType };
  const review = pending.translations > 0 ? reviewStep(job, pending) : null;
  if (state === "queued") {
    const down = options.workerDown ?? false;
    return {
      state,
      mark: { kind: "clock", tone: down ? "caution" : "info" },
      title: { key: down ? "jobs.result.waitingWorker" : "jobs.result.startsSoon" },
      lines: [line({ key: down ? "jobs.hero.workerText" : "jobs.hero.queuedText" })],
      legend: [],
      panel: null,
      strip: { kind: "foot", foot: CANCEL_FOOT },
    };
  }
  if (state === "finding") {
    return {
      state,
      mark: { kind: "ring", dashed: true, caption: "jobs.ring.found", label: { key: "jobs.ring.findingLabel", vars: { count: groups.total } } },
      title: { key: "jobs.hero.finding", vars: { kind, count: groups.total } },
      lines: [line({ key: "jobs.hero.findingText" }), LIVE],
      legend: [],
      ...activeEnd(job, withPrimary([review])),
    };
  }
  const shown = legend(groups, autoPublish);
  if (state === "done" || state === "doneLook" || state === "doneErrors") return { state, legend: shown, ...finishedHero(job, groups, review) };
  const title: JobText = { key: "jobs.hero.title", vars: { kind, ok: endedWell(groups), total: groups.total } };
  const mark = ringMark(groups, title, autoPublish);
  if (state === "running") {
    // A job that collects changes has no time left.
    const time = isAutomatic(job) ? [] : [line(options.eta != null ? { key: "jobs.hero.eta", vars: { duration: { duration: options.eta } } } : { key: "jobs.hero.noEta" })];
    const steps = withPrimary([review, groups.retryable > 0 ? retryStep(job, groups) : null]);
    return { state, mark, title, lines: [...time, LIVE], legend: shown, ...activeEnd(job, steps) };
  }
  if (state === "cancelled") return { state, mark, title, legend: shown, ...cancelledHero(job, groups, review, options.settling ?? false) };
  return { state, mark, title, legend: shown, ...stoppedHero(job, groups, review, stop, state, options) };
}

/**
 * The problems card's heading and its line: the items left for the merchant
 * (failed and incomplete), or, when a smart job's only problems are its
 * changed originals, that the schedule translates them again; null without
 * either. A job that is over adds how many are fine.
 */
export function problemsHeading(job: Pick<JobFields, "status" | "resourceType">, groups: JobGroups): { heading: JobText; text: JobText[] } | null {
  const type = job.resourceType;
  const work = groups.counts.failed + groups.counts.look;
  let heading: JobText;
  if (work > 0) heading = { key: "jobs.problems.heading", vars: { count: work, items: { items: work, type } } };
  else if (groups.selfResolving > 0) heading = { key: "jobs.problems.headingSelf", vars: { items: { items: groups.selfResolving, type } } };
  else return null;
  const ok = endedWell(groups);
  const text: JobText[] = ACTIVE.has(job.status) ? [] : [{ key: "jobs.problems.rest", vars: { count: ok, ok, total: groups.total } }];
  text.push({ key: "jobs.problems.open" });
  return { heading, text };
}

/**
 * The cancel dialog's sentences: what ended well and stays (left out when
 * nothing did), what is still to do and won't be translated, and what
 * cancelling means for the job's origin. Failed and incomplete items aren't
 * mentioned: they stay as they are, listed on the page.
 */
export function cancelBody(job: Pick<JobFields, "resourceType" | "requestedBy">, groups: JobGroups): JobText[] {
  const type = job.resourceType;
  const ok = endedWell(groups);
  const open = groups.counts.open;
  const text: JobText[] = [];
  if (ok > 0) text.push({ key: "jobs.cancel.done", vars: { count: ok, items: { items: ok, type } } });
  if (open > 0) text.push({ key: "jobs.cancel.rest", vars: { count: open, items: { items: open, type } } });
  const origin = jobOrigin(job);
  text.push({ key: origin === "auto" ? "jobs.cancel.final.auto" : origin === "smart" ? "jobs.cancel.final.smart" : "jobs.cancel.final.manual" });
  return text;
}

/** One of the hero's stats: its name, its value and an optional note. */
export interface JobStat {
  name: JobText;
  value: TextValue;
  note: JobText | null;
}

const msOf = (value: When) => new Date(value).getTime();

/**
 * The stats under the hero (time, AI characters, saved), in three fixed
 * columns: only when the job sent or saved characters, a stat whose value is
 * 0 left out (null keeps its column). The time is how long the job has run
 * (active), took (finished, stopped, cancelled), or, for a job that collects
 * changes, the span of the changes.
 */
export function visibleStats(
  job: Pick<JobFields, "status" | "requestedBy" | "smartRunId" | "charsBilled" | "charsSaved" | "createdAt" | "startedAt" | "finishedAt" | "updatedAt">,
  options: { now: When; ownKeyPlan?: boolean },
): [JobStat, JobStat | null, JobStat | null] | null {
  if (job.charsBilled + job.charsSaved <= 0) return null;
  const started = msOf(job.startedAt ?? job.createdAt);
  const time: JobStat = isAutomatic(job)
    ? { name: { key: "jobs.stats.window" }, value: { join: [{ time: job.createdAt }, { time: job.updatedAt }], separator: "–" }, note: null }
    : ACTIVE.has(job.status)
      ? { name: { key: "jobs.stats.runningFor" }, value: { duration: Math.max(0, msOf(options.now) - started) }, note: null }
      : { name: { key: "jobs.stats.duration" }, value: { duration: Math.max(0, msOf(job.finishedAt ?? job.updatedAt) - started) }, note: null };
  const own = options.ownKeyPlan ?? false;
  const ai: JobStat | null =
    job.charsBilled > 0
      ? { name: { key: own ? "jobs.stats.ownKey" : "jobs.stats.ai" }, value: job.charsBilled, note: { key: own ? "jobs.stats.ownKeyNote" : "jobs.stats.aiNote" } }
      : null;
  const saved: JobStat | null =
    job.charsSaved > 0
      ? { name: { key: "jobs.stats.saved" }, value: { key: "jobs.stats.savedValue", vars: { count: job.charsSaved } }, note: { key: "jobs.stats.savedNote" } }
      : null;
  return [time, ai, saved];
}

// ─── The attention card ──────────────────────────────────────────────────────

type AttentionJob = Pick<JobFields, "id" | "resourceType" | "targetLocale" | "errorCode" | "finishedAt" | "updatedAt">;

/** A stop the card may name: the job, its groups (rowCounts, for "9 von 24 sind fertig") and what the server knows of its cause. */
export interface AttentionStop {
  job: AttentionJob;
  groups: JobGroups;
  facts: StopFacts;
}

/** What calls for the merchant (jobsAttention, countPendingDrafts, the tab counts, backgroundJobsRunning). */
export interface AttentionInput {
  /** The stops, newest first (jobsAttention().stops.jobs, at most ATTENTION_STOPS). */
  stops: readonly AttentionStop[];
  /** All stops (jobsAttention().stops.count). */
  stopCount: number;
  /** Failed items of completed jobs (jobsAttention().failed). */
  failed: { count: number; retryable: number; jobCount: number; jobs: ReadonlyArray<JobNaming & { id: string }>; sameKind: boolean };
  /** Translations waiting in Review (countPendingDrafts). */
  drafts: number;
  /** Active jobs: running, finding, queued (the "Läuft gerade" figure). */
  active: number;
  /** A queued job is listed while background jobs aren't running. */
  workerDown: boolean;
}

export type AttentionVerdict = "needsYou" | "waits" | "failed" | "delayed" | "review";

/** The featured stop's one primary: the fix, opening the app again, or resuming; none while it waits for a reset. */
export type FeaturedAction = LinkAction | { kind: "reload"; label: JobText } | { kind: "resume"; label: JobText; jobId: string };

export interface FeaturedStop {
  jobId: string;
  /** The flag's language. */
  locale: string;
  title: JobText;
  text: JobText[];
  primary: FeaturedAction | null;
  /** "Auftrag ansehen": tertiary beside a primary, else secondary. */
  view: { href: string; label: JobText; variant: "tertiary" | "secondary" };
}

/** A quiet row: a link with its mark, title and text. */
export interface QuietRow {
  mark: { icon: IconType; tone: "critical" | "warning" | "info" };
  title: JobText;
  text: JobText[];
  href: string;
}

export interface AttentionModel {
  verdict: AttentionVerdict;
  mark: { icon: IconType; tone: "critical" | "warning" | "caution" | "info" };
  heading: JobText;
  text: JobText[];
  /** Only translations wait: "Jetzt prüfen" in the head, the page's primary. */
  headAction: LinkAction | null;
  featured: FeaturedStop | null;
  /** At most two. */
  rows: QuietRow[];
}

const jobHref = (id: string) => `/app/jobs/${encodeURIComponent(id)}`;

function resumableWords(stop: AttentionStop): { title: JobText; text: JobText[] } {
  const group = stopGroup(stop.job.errorCode);
  return {
    title: { key: "jobs.attention.resumable", vars: { name: { job: stop.job } } },
    text: [{ key: ALLOWANCE_GROUPS.has(group) ? "jobs.attention.allowanceBack" : "jobs.attention.resumableText" }],
  };
}

function featuredStop(stop: AttentionStop): FeaturedStop {
  const { job, facts } = stop;
  const label: JobText = { key: "jobs.action.viewJob" };
  const view = (variant: "tertiary" | "secondary") => ({ href: jobHref(job.id), label, variant });
  if (facts.fixed === true) {
    return {
      jobId: job.id,
      locale: job.targetLocale,
      ...resumableWords(stop),
      primary: { kind: "resume", label: { key: "jobs.detail.resume" }, jobId: job.id },
      view: view("tertiary"),
    };
  }
  const group = stopGroup(job.errorCode);
  const ok = endedWell(stop.groups);
  const text: JobText[] = [
    { key: "jobs.attention.stopText", vars: { count: ok, when: { at: job.finishedAt ?? job.updatedAt }, done: ok, total: stop.groups.total } },
    stopText(job, "help", facts),
  ];
  let primary: FeaturedAction | null = null;
  if (hasFix(group)) {
    text.push({ key: "jobs.attention.thenResume" });
    const href = stopFixHref(group, job.id);
    const label: JobText = { key: `jobs.stop.${group}.action`, vars: stopVars(job, facts) };
    primary = href ? { kind: "link", href, label } : { kind: "reload", label };
  }
  return {
    jobId: job.id,
    locale: job.targetLocale,
    title: { key: "jobs.attention.stopTitle", vars: { name: { job }, reason: stopText(job, "short", facts) } },
    text,
    primary,
    view: view(primary ? "tertiary" : "secondary"),
  };
}

function failedRow(failed: AttentionInput["failed"]): QuietRow {
  const first = failed.jobs[0];
  const items: TextValue = failed.sameKind && first ? { items: failed.count, type: first.resourceType } : { key: "jobs.unit.item", vars: { count: failed.count } };
  const names: TextValue[] = failed.jobs.slice(0, 2).map((job) => ({ job }));
  if (failed.jobCount > names.length) names.push({ key: "jobs.attention.moreJobs", vars: { count: failed.jobCount - names.length } });
  const text: JobText[] = [{ key: "jobs.attention.failedIn", vars: { count: failed.jobCount, jobs: { list: names } } }];
  // Only a promise a new try keeps: every counted item can be tried again.
  if (failed.retryable >= failed.count) text.push({ key: "jobs.attention.retryHint" });
  return {
    mark: { icon: "alert-circle", tone: "critical" },
    title: { key: "jobs.attention.failed", vars: { count: failed.count, items } },
    text,
    href: failed.jobCount === 1 && first ? jobHref(first.id) : "/app/jobs?status=problems",
  };
}

/**
 * The attention card (first match wins): a stop that needs the merchant, or
 * stops that all go on by themselves; failed items; a queued job while
 * background jobs don't run; only translations to approve; else no card.
 * The featured stop is the newest that needs the merchant, else the newest
 * that can go on, else the newest; one quiet row for the other stops, then
 * the translations to approve and the failed items, at most two rows.
 */
export function attentionVerdict(input: AttentionInput): AttentionModel | null {
  const stops = input.stops.filter((stop) => stopLook(stopGroup(stop.job.errorCode)) !== null);
  const needsYou = (stop: AttentionStop) => stop.facts.fixed !== true && stopLook(stopGroup(stop.job.errorCode)) === "needsYou";
  const reviewRow: QuietRow | null =
    input.drafts > 0
      ? {
          mark: { icon: "clock", tone: "info" },
          title: { key: "jobs.attention.review", vars: { count: input.drafts } },
          text: [{ key: "jobs.attention.reviewText" }],
          href: "/app/review",
        }
      : null;
  const failed = input.failed.count > 0 ? failedRow(input.failed) : null;
  const others: JobText[] =
    input.active > 0
      ? [{ key: "jobs.attention.others", vars: { count: input.active, running: { key: "jobs.cluster.count", vars: { count: input.active } } } }]
      : [{ key: "jobs.attention.idle" }];
  const rows = (...candidates: Array<QuietRow | null>) => candidates.filter((row): row is QuietRow => row !== null).slice(0, 2);

  if (stops.length) {
    const featured = stops.find(needsYou) ?? stops.find((stop) => stop.facts.fixed === true) ?? stops[0];
    const rest = stops.filter((stop) => stop !== featured);
    const count = Math.max(input.stopCount, stops.length);
    const restCount = count - 1;
    let stopRow: QuietRow | null = null;
    if (restCount === 1 && rest[0]?.facts.fixed === true) {
      stopRow = { mark: { icon: "pause-circle", tone: "warning" }, ...resumableWords(rest[0]), href: jobHref(rest[0].job.id) };
    } else if (restCount > 0) {
      const tone = rest.some(needsYou) || restCount > rest.length ? "critical" : "warning";
      stopRow = {
        mark: { icon: "pause-circle", tone },
        title: { key: "jobs.attention.moreStops", vars: { count: restCount } },
        text: [{ key: "jobs.attention.moreText" }],
        href: "/app/jobs?status=problems",
      };
    }
    const anyNeedsYou = stops.some(needsYou);
    return {
      verdict: anyNeedsYou ? "needsYou" : "waits",
      mark: { icon: "pause-circle", tone: anyNeedsYou ? "critical" : "warning" },
      heading: { key: "jobs.attention.stopped", vars: { count } },
      text: others,
      headAction: null,
      featured: featuredStop(featured),
      rows: rows(stopRow, reviewRow, failed),
    };
  }
  if (failed) {
    return {
      verdict: "failed",
      mark: { icon: "alert-circle", tone: "critical" },
      heading: { key: "jobs.attention.failedHeading" },
      text: others,
      headAction: null,
      featured: null,
      rows: rows(reviewRow, failed),
    };
  }
  if (input.workerDown) {
    return {
      verdict: "delayed",
      mark: { icon: "clock", tone: "caution" },
      heading: { key: "jobs.attention.delayed" },
      text: [{ key: "jobs.attention.delayedText" }],
      headAction: null,
      featured: null,
      rows: rows(reviewRow),
    };
  }
  if (input.drafts > 0) {
    return {
      verdict: "review",
      mark: { icon: "clock", tone: "info" },
      heading: { key: "jobs.attention.review", vars: { count: input.drafts } },
      text: [{ key: "jobs.attention.reviewText" }, { key: "jobs.attention.reviewOnly" }],
      headAction: { kind: "link", href: "/app/review", label: { key: "language.next.review.action" } },
      featured: null,
      rows: [],
    };
  }
  return null;
}

// ─── The list's address ──────────────────────────────────────────────────────

/** The list's tabs (tab "all": the live group, then the history). */
export const JOB_TABS = ["all", "active", "problems", "completed", "cancelled"] as const;
export type JobTab = (typeof JOB_TABS)[number];
/** "Gestartet": you or your team (also older jobs without a starter), automatic translation, the smart schedule (JOB_ORIGINS on the server). */
export const JOB_BY = ["you", "auto", "smart"] as const;
export type JobBy = (typeof JOB_BY)[number];
/** "Zeitraum", from the start of a store-zone day (JOB_SINCE on the server). */
export const JOB_PERIODS = ["today", "7d", "30d", "older"] as const;
export type JobPeriod = (typeof JOB_PERIODS)[number];
/** A search term is cut to this length. */
export const JOB_SEARCH_MAX = 100;

/** The list's address, every part checked (unknown values are left out). */
export interface JobsQuery {
  status: JobTab;
  lang: string | null;
  area: CategoryId | null;
  /** Legacy: one exact type (`type=<T>`); an area wins. */
  type: string | null;
  by: JobBy | null;
  since: JobPeriod | null;
  q: string | null;
  /** Keyset cursors: the page after a job, or the page before one. */
  after: string | null;
  before: string | null;
  /** The page's number, display only (the keyset decides the rows); 1 without a cursor. */
  page: number;
  /** Jobs just started by one click (the multi-job redirect): a toast, once. */
  started: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | null => (value !== null && (values as readonly string[]).includes(value) ? (value as T) : null);

function wholeNumber(value: string | null, max: number): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= max ? n : null;
}

export function parseJobsQuery(url: URL | URLSearchParams | string): JobsQuery {
  const params = url instanceof URLSearchParams ? url : (typeof url === "string" ? new URL(url, "https://app.invalid") : url).searchParams;
  const get = (name: string) => params.get(name);
  const status = get("status");
  const lang = get("lang");
  const area = get("area");
  const type = get("type");
  const q = get("q")?.trim().slice(0, JOB_SEARCH_MAX) || null;
  const cursor = (name: string) => {
    const id = get(name);
    return id && UUID.test(id) ? id.toLowerCase() : null;
  };
  const after = cursor("after");
  // Both cursors: the page after wins (listJobsPage's rule).
  const before = after ? null : cursor("before");
  return {
    // Old links (?status=failed) open the problems.
    status: status === "failed" ? "problems" : (oneOf(JOB_TABS, status) ?? "all"),
    lang: lang && lang.length <= 35 && LOCALE.test(lang) ? lang : null,
    area: area && isCategoryId(area) ? area : null,
    type: oneOf(JOB_TYPES, type),
    by: oneOf(JOB_BY, get("by")),
    since: oneOf(JOB_PERIODS, get("since")),
    q,
    after,
    before,
    page: after || before ? (wholeNumber(get("p"), 10_000) ?? 1) : 1,
    started: wholeNumber(get("started"), 1_000),
  };
}

/** A change of the list's address: a tab, filters, the search, or a page (a cursor and its number). */
export type JobsChange = Partial<Omit<JobsQuery, "started">>;

/**
 * The list's address after a change, with only what is set. A tab, a filter
 * or the search starts on the first page (no cursor, no number); choosing an
 * area replaces a legacy type; `started` is never carried on.
 */
export function jobsHref(query: JobsQuery, change: JobsChange = {}): string {
  const next = { ...query, ...change };
  // A page names one cursor: the other one goes.
  if (change.after) next.before = null;
  if (change.before) next.after = null;
  const type = "area" in change && !("type" in change) ? null : next.type;
  const paging = "after" in change || "before" in change || "page" in change;
  const params = new URLSearchParams();
  if (next.status !== "all") params.set("status", next.status);
  if (next.lang) params.set("lang", next.lang);
  if (next.area) params.set("area", next.area);
  else if (type) params.set("type", type);
  if (next.by) params.set("by", next.by);
  if (next.since) params.set("since", next.since);
  if (next.q) params.set("q", next.q);
  if (paging && (next.after || next.before)) {
    if (next.after) params.set("after", next.after);
    else if (next.before) params.set("before", next.before);
    if (next.page > 1) params.set("p", String(next.page));
  }
  const search = params.toString();
  return search ? `/app/jobs?${search}` : "/app/jobs";
}

/** The filters set (the phone's "Filter (2)"): language, content, starter, period. */
export function filterCount(query: JobsQuery): number {
  return [query.lang, query.area ?? query.type, query.by, query.since].filter(Boolean).length;
}

/** The query's filters as the list's server functions take them (listJobsPage, jobCounts, listActiveJobs). */
export function jobsFilter(query: JobsQuery): { locale: string | null; types: string[] | null; origin: JobBy | null; since: JobPeriod | null } {
  const types = query.area ? [...CATEGORIES[query.area].types] : query.type ? [query.type] : null;
  return { locale: query.lang, types, origin: query.by, since: query.since };
}
