import {
  GraphqlQueryError,
  HttpInternalError,
  HttpResponseError,
  HttpThrottlingError,
  InvalidSession,
} from "@shopify/shopify-api";
import { describe, expect, it } from "vitest";
import {
  classifyError,
  ItemPermanentError,
  JobStopError,
  RateLimitedError,
} from "../../app/.server/jobs/errors";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { AiConsentRequiredError } from "../../app/.server/translation/product-translation-service";
import { QuotaExceededError } from "../../app/.server/usage/usage-ledger";

const http = { message: "x", code: 500, statusText: "x", body: {}, headers: {} };

describe("classifyError", () => {
  it.each([
    [new RateLimitedError(1500), { kind: "rate-limited", waitMs: 1500 }],
    [new JobStopError("X"), { kind: "job-stop", code: "X" }],
    [new ItemPermanentError("Y"), { kind: "item-permanent", code: "Y" }],
    [new AiConsentRequiredError(), { kind: "job-stop", code: "CONSENT_REQUIRED" }],
    [new QuotaExceededError(1, 2, 2), { kind: "job-stop", code: "QUOTA_EXCEEDED" }],
    [new TranslationProviderError("deepl", "retryable", "x"), { kind: "retryable", code: "PROVIDER_UNAVAILABLE" }],
    [new TranslationProviderError("deepl", "retryable", "x", 429, 3000), { kind: "rate-limited", waitMs: 3000 }],
    [new TranslationProviderError("deepl", "quota", "x"), { kind: "job-stop", code: "PROVIDER_QUOTA" }],
    [new TranslationProviderError("deepl", "auth", "x"), { kind: "job-stop", code: "PROVIDER_AUTH" }],
    [new TranslationProviderError("deepl", "invalid", "x"), { kind: "item-permanent", code: "PROVIDER_REJECTED" }],
    [new HttpThrottlingError({ ...http, code: 429, retryAfter: 4 }), { kind: "rate-limited", waitMs: 4000 }],
    [new HttpInternalError(http), { kind: "retryable", code: "SHOPIFY_UNAVAILABLE" }],
    [new HttpResponseError({ ...http, code: 401 }), { kind: "job-stop", code: "SHOP_AUTH" }],
    [new InvalidSession("expired"), { kind: "job-stop", code: "SHOP_AUTH" }],
    [
      new GraphqlQueryError({ message: "Throttled", response: {}, body: { errors: [{ extensions: { code: "THROTTLED" } }] } }),
      { kind: "rate-limited", waitMs: 2000 },
    ],
    [
      new GraphqlQueryError({ message: "Access denied", response: {}, body: { errors: [{ message: "ACCESS_DENIED" }] } }),
      { kind: "item-permanent", code: "SHOPIFY_QUERY_ERROR" },
    ],
    [new Error("boom"), { kind: "retryable", code: "UNEXPECTED_ERROR" }],
  ])("classifies %s", (error, expected) => {
    expect(classifyError(error)).toEqual(expected);
  });
});
