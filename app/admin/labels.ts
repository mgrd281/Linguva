/**
 * The console's fixed vocabularies and their message keys, written out
 * (every key appears literally, which tests/unit/admin-ui-messages.test.ts
 * checks), and the look of plan and status badges.
 */
import { isOwnKeyHandle, PLANS } from "../lib/plans";
import type { AdminMessageKey } from "./messages";

export type ConsolePlan = "free" | "starter" | "pro" | "business" | "own-key" | "complimentary" | "unknown";
export const CONSOLE_PLANS: readonly ConsolePlan[] = ["free", "starter", "pro", "business", "own-key", "complimentary", "unknown"];

export const PLAN_LABEL: Record<ConsolePlan, AdminMessageKey> = {
  free: "plan.free",
  starter: "plan.starter",
  pro: "plan.pro",
  business: "plan.business",
  "own-key": "plan.ownKey",
  complimentary: "plan.complimentary",
  unknown: "plan.unknown",
};

export type Tone = "neutral" | "info" | "success" | "warning" | "critical" | "accent" | "violet" | "teal";

/** One colour per plan, the same everywhere (badges, bars); the name is always written next to it. */
export const PLAN_TONE: Record<ConsolePlan, Tone> = {
  free: "neutral",
  starter: "info",
  pro: "accent",
  business: "violet",
  "own-key": "teal",
  complimentary: "success",
  unknown: "warning",
};

/** Shopify's plan handles to the console's plans (an own-key alias is Own key; anything else: unknown). */
export function planOfHandle(handle: string | null): ConsolePlan | null {
  if (!handle) return null;
  if (isOwnKeyHandle(handle)) return "own-key";
  return Object.hasOwn(PLANS, handle) ? (handle as keyof typeof PLANS) : "unknown";
}

export const STATUS_LABEL: Record<"ACTIVE" | "UNINSTALLED", AdminMessageKey> = {
  ACTIVE: "status.ACTIVE",
  UNINSTALLED: "status.UNINSTALLED",
};

export const SUB_STATE_LABEL: Record<"ACTIVE" | "NONE", AdminMessageKey> = {
  ACTIVE: "subState.ACTIVE",
  NONE: "subState.NONE",
};

/** Shopify's billing intervals; another value is shown as Shopify sends it. */
export function periodLabel(period: string | null): AdminMessageKey | null {
  if (period === "EVERY_30_DAYS") return "period.monthly";
  if (period === "ANNUAL") return "period.yearly";
  return null;
}

export const ROLE_LABEL: Record<"OWNER" | "FINANCE" | "SUPPORT" | "READONLY", AdminMessageKey> = {
  OWNER: "role.OWNER",
  FINANCE: "role.FINANCE",
  SUPPORT: "role.SUPPORT",
  READONLY: "role.READONLY",
};

export const INSTALL_EVENT_LABEL: Record<string, AdminMessageKey> = {
  INSTALLED: "customer.event.INSTALLED",
  REINSTALLED: "customer.event.REINSTALLED",
  UNINSTALLED: "customer.event.UNINSTALLED",
  SCOPES_UPDATED: "customer.event.SCOPES_UPDATED",
};

export const JOB_STATUSES = ["PENDING", "DISCOVERING", "RUNNING", "COMPLETED", "CANCELLED", "FAILED"] as const;
export const JOB_STATUS_LABEL: Record<(typeof JOB_STATUSES)[number], AdminMessageKey> = {
  PENDING: "customer.job.PENDING",
  DISCOVERING: "customer.job.DISCOVERING",
  RUNNING: "customer.job.RUNNING",
  COMPLETED: "customer.job.COMPLETED",
  CANCELLED: "customer.job.CANCELLED",
  FAILED: "customer.job.FAILED",
};

export const PRICE_ERROR_LABEL: Record<string, AdminMessageKey> = {
  REQUIRED: "prices.error.REQUIRED",
  NOT_A_PRICE: "prices.error.NOT_A_PRICE",
  TOO_LOW: "prices.error.TOO_LOW",
  TOO_HIGH: "prices.error.TOO_HIGH",
  YEARLY_TOO_LOW: "prices.error.YEARLY_TOO_LOW",
  FREE_IS_FREE: "prices.error.FREE_IS_FREE",
  REASON_REQUIRED: "prices.error.REASON_REQUIRED",
  CODE_REQUIRED: "prices.error.CODE_REQUIRED",
  CODE_WRONG: "prices.error.CODE_WRONG",
};

export const REFRESH_RESULT_LABEL: Record<"OK" | "NOT_CONFIGURED" | "NO_GID" | "SHOPIFY_UNAVAILABLE" | "NOT_FOUND", AdminMessageKey> = {
  OK: "customer.refreshOk",
  NOT_CONFIGURED: "customer.refreshNotConfigured",
  NO_GID: "customer.refreshNoGid",
  SHOPIFY_UNAVAILABLE: "customer.refreshUnavailable",
  NOT_FOUND: "customer.refreshNotFound",
};
