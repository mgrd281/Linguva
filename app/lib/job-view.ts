/**
 * The Jobs pages' vocabulary (/app/jobs and /app/jobs/:id), pure and shared by
 * the server and the pages: no I/O, no texts (the pages name things through
 * the catalogues). Tested in tests/unit/job-view.test.ts.
 *
 * - Which failed items a new try can fix (retryHelps): the retry step, the
 *   problem groups and retryJobItems re-queue only those.
 * - Why a job stopped (stopGroup), how the stop looks (stopLook: it needs the
 *   merchant, or it goes on by itself) and where its fix is (STOP_FIX_HREF,
 *   stopFixHref with the way back to the job). Whether the cause is fixed by
 *   now is a cheap server check (app/.server/jobs/stop-fix.ts).
 */

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
