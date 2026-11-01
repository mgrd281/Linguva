import { ENGINE_NAMES } from "./engines";
import { parseOwnKeyCode } from "./own-keys";

type Tone = "info" | "success" | "warning" | "critical" | "neutral";

export const JOB_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Queued", tone: "info" },
  DISCOVERING: { label: "Finding content", tone: "info" },
  RUNNING: { label: "Translating", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  FAILED: { label: "Stopped", tone: "critical" },
};

export const JOB_ERROR_MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED: "This month's AI translation allowance is used up.",
  PLAN_REQUIRED: "Your plan doesn't include bulk translation any more. See Plan to change it, then resume.",
  DAILY_LIMIT: "Today's AI translation allowance is used up. Resume the job tomorrow (after midnight UTC).",
  PLATFORM_LIMIT: "The app's AI translation limit for today is reached. Resume the job tomorrow (after midnight UTC).",
  CONSENT_REQUIRED: "AI processing was not allowed. Allow it under Settings, then resume.",
  ENGINE_CONSENT: "Only a translation service your store hasn't allowed yet translates this language. Allow it under Settings, then resume.",
  AI_NOT_CONFIGURED: "AI translation isn't configured for this app.",
  PROVIDER_QUOTA: "The translation service quota is exhausted.",
  PROVIDER_AUTH: "The translation service rejected our credentials.",
  SHOP_AUTH: "Shopify rejected the app's access. Open the app again to re-authorise it.",
  SHOP_INACTIVE: "The app is no longer installed on this store.",
  SHOP_UNINSTALLED: "The app was uninstalled.",
  DISCOVERY_FAILED: "Shopify didn't return the list of items. Please resume later.",
  // The Own key plan: OWN_KEY_QUOTA_<ENGINE> and OWN_KEY_AUTH_<ENGINE> read these with the engine's name (ownKeyJobError).
  OWN_KEY_MISSING: "No working translation key. Add one in Settings, then resume.",
  OWN_KEY_QUOTA: "Your {engine} key's quota is used up. Translation stopped; Linguva didn't switch to its own services. Check your {engine} account, then resume.",
  OWN_KEY_AUTH:
    "{engine} refused your key, or the service isn't set up for it (Google: Cloud Translation API enabled and billing on; Azure: the right region). Translation stopped. Fix it in your {engine} account and click Check again in Settings, or replace the key; then resume.",
};

/**
 * The English text of an own-key stop (OWN_KEY_MISSING, OWN_KEY_QUOTA_DEEPL, OWN_KEY_AUTH_GOOGLE, …)
 * with the engine's name filled in; null for any other code. The fallback where no catalogue has it.
 */
export function ownKeyJobError(code: string): string | null {
  const own = parseOwnKeyCode(code);
  if (!own) return null;
  if (own.kind === "MISSING") return JOB_ERROR_MESSAGES.OWN_KEY_MISSING!;
  return JOB_ERROR_MESSAGES[`OWN_KEY_${own.kind}`]!.replaceAll("{engine}", ENGINE_NAMES[own.engine]);
}

export const ITEM_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_REJECTED: "The translation service rejected this content.",
  PROVIDER_UNAVAILABLE: "The translation service was unavailable.",
  SHOPIFY_UNAVAILABLE: "Shopify was unavailable.",
  SHOPIFY_QUERY_ERROR: "Shopify refused the request.",
  UNEXPECTED_ERROR: "Unexpected error.",
};

export function jobProgress(job: {
  totalItems: number;
  succeededItems: number;
  skippedItems: number;
  failedItems: number;
  discoveryDone: boolean;
}) {
  const done = job.succeededItems + job.skippedItems + job.failedItems;
  return {
    total: job.totalItems,
    done,
    percent: job.totalItems ? Math.min(100, Math.round((done / job.totalItems) * 100)) : job.discoveryDone ? 100 : 0,
  };
}
