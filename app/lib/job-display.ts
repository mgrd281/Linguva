type Tone = "info" | "success" | "warning" | "critical" | "neutral";

export const JOB_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Queued", tone: "info" },
  DISCOVERING: { label: "Finding products", tone: "info" },
  RUNNING: { label: "Translating", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  FAILED: { label: "Stopped", tone: "critical" },
};

export const JOB_ERROR_MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED: "This month's AI translation allowance is used up.",
  CONSENT_REQUIRED: "AI processing was not allowed. Allow it under Settings, then resume.",
  AI_NOT_CONFIGURED: "AI translation isn't configured for this app.",
  PROVIDER_QUOTA: "The translation service quota is exhausted.",
  PROVIDER_AUTH: "The translation service rejected our credentials.",
  SHOP_AUTH: "Shopify rejected the app's access. Open the app again to re-authorise it.",
  SHOP_INACTIVE: "The app is no longer installed on this store.",
  SHOP_UNINSTALLED: "The app was uninstalled.",
  DISCOVERY_FAILED: "Shopify didn't return the product list. Please resume later.",
};

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
