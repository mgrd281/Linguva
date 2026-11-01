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
import { QUOTA_CODES, QuotaExceededError } from "../usage/usage-ledger";
import { AiConsentRequiredError, EngineConsentRequiredError } from "../translation/product-translation-service";

/**
 * Stops the whole job (remaining items are cancelled), e.g. quota used up. `scope` "language":
 * only this language's engines are used up or refused (no shop-wide pause), as the router says.
 */
export class JobStopError extends Error {
  /** Set only when given: a stop without it has no such property, as before. */
  declare readonly scope?: "language";

  constructor(
    readonly code: string,
    scope?: "language",
  ) {
    super(`Job stopped: ${code}`);
    this.name = "JobStopError";
    if (scope) this.scope = scope;
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
  /** scope "language": only this language's engines are used up or refused (the router); no shop-wide pause. */
  | { kind: "job-stop"; code: string; scope?: "language" };

const DEFAULT_THROTTLE_WAIT_MS = 2_000;

/** Maps any error raised while processing an item to how the queue reacts. */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof RateLimitedError) return { kind: "rate-limited", waitMs: error.waitMs };
  if (error instanceof JobStopError) return { kind: "job-stop", code: error.code, ...(error.scope ? { scope: error.scope } : {}) };
  if (error instanceof ItemPermanentError) return { kind: "item-permanent", code: error.code };
  if (error instanceof AiConsentRequiredError) return { kind: "job-stop", code: "CONSENT_REQUIRED" };
  // Only this language waits for the merchant to allow its engine: no shop-wide pause.
  if (error instanceof EngineConsentRequiredError) return { kind: "job-stop", code: "ENGINE_CONSENT", scope: "language" };
  if (error instanceof QuotaExceededError) {
    // One item that alone needs more than the limit fails by itself; the others still fit.
    if (error.requested > error.limit) return { kind: "item-permanent", code: "TOO_LARGE_FOR_LIMIT" };
    return { kind: "job-stop", code: QUOTA_CODES[error.scope] };
  }

  if (error instanceof TranslationProviderError) {
    switch (error.kind) {
      case "retryable":
        return error.retryAfterMs
          ? { kind: "rate-limited", waitMs: error.retryAfterMs }
          : { kind: "retryable", code: "PROVIDER_UNAVAILABLE" };
      case "quota":
        return { kind: "job-stop", code: "PROVIDER_QUOTA", ...(error.scope ? { scope: error.scope } : {}) };
      case "auth":
        return { kind: "job-stop", code: "PROVIDER_AUTH", ...(error.scope ? { scope: error.scope } : {}) };
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
