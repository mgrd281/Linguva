import {
  GraphqlQueryError,
  HttpInternalError,
  HttpMaxRetriesError,
  HttpRequestError,
  HttpResponseError,
  HttpThrottlingError,
  InvalidSession,
} from "@shopify/shopify-api";
import { TranslationProviderError } from "../providers/types";
import { QuotaExceededError } from "../usage/usage-ledger";
import { AiConsentRequiredError } from "../translation/product-translation-service";

/** Stops the whole job (remaining items are cancelled), e.g. quota used up. */
export class JobStopError extends Error {
  constructor(readonly code: string) {
    super(`Job stopped: ${code}`);
    this.name = "JobStopError";
  }
}

/** Fails this item without retrying, e.g. an unsupported language pair. */
export class ItemPermanentError extends Error {
  constructor(readonly code: string) {
    super(`Item failed: ${code}`);
    this.name = "ItemPermanentError";
  }
}

/** Not a failure: try again after `waitMs` without spending an attempt. */
export class RateLimitedError extends Error {
  constructor(readonly waitMs: number) {
    super(`Rate limited for ${waitMs}ms`);
    this.name = "RateLimitedError";
  }
}

export type ErrorClass =
  | { kind: "rate-limited"; waitMs: number }
  | { kind: "retryable"; code: string }
  | { kind: "item-permanent"; code: string }
  | { kind: "job-stop"; code: string };

const DEFAULT_THROTTLE_WAIT_MS = 2_000;

/** Maps any error raised while processing an item to how the queue reacts. */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof RateLimitedError) return { kind: "rate-limited", waitMs: error.waitMs };
  if (error instanceof JobStopError) return { kind: "job-stop", code: error.code };
  if (error instanceof ItemPermanentError) return { kind: "item-permanent", code: error.code };
  if (error instanceof AiConsentRequiredError) return { kind: "job-stop", code: "CONSENT_REQUIRED" };
  if (error instanceof QuotaExceededError) return { kind: "job-stop", code: "QUOTA_EXCEEDED" };

  if (error instanceof TranslationProviderError) {
    switch (error.kind) {
      case "retryable":
        return error.retryAfterMs
          ? { kind: "rate-limited", waitMs: error.retryAfterMs }
          : { kind: "retryable", code: "PROVIDER_UNAVAILABLE" };
      case "quota":
        return { kind: "job-stop", code: "PROVIDER_QUOTA" };
      case "auth":
        return { kind: "job-stop", code: "PROVIDER_AUTH" };
      default:
        return { kind: "item-permanent", code: "PROVIDER_REJECTED" };
    }
  }

  if (error instanceof HttpThrottlingError) {
    const retryAfter = Number(error.response.retryAfter);
    return {
      kind: "rate-limited",
      waitMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_THROTTLE_WAIT_MS,
    };
  }
  if (error instanceof InvalidSession) return { kind: "job-stop", code: "SHOP_AUTH" };
  if (error instanceof HttpResponseError && (error.response.code === 401 || error.response.code === 403)) {
    return { kind: "job-stop", code: "SHOP_AUTH" };
  }
  if (
    error instanceof HttpInternalError ||
    error instanceof HttpRequestError ||
    error instanceof HttpMaxRetriesError ||
    error instanceof HttpResponseError
  ) {
    return { kind: "retryable", code: "SHOPIFY_UNAVAILABLE" };
  }
  if (error instanceof GraphqlQueryError) {
    return JSON.stringify(error.body ?? error.message).includes("THROTTLED")
      ? { kind: "rate-limited", waitMs: DEFAULT_THROTTLE_WAIT_MS }
      : { kind: "item-permanent", code: "SHOPIFY_QUERY_ERROR" };
  }
  return { kind: "retryable", code: "UNEXPECTED_ERROR" };
}
