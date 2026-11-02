/**
 * The Own key plan's job errors (app/.server/credentials/errors.ts): a
 * merchant key's quota or refusal becomes the stop that names its engine,
 * keeping the router's language scope; outages, rejected requests and every
 * other error are left as they are; every key a failed request used up or
 * refused is listed for marking.
 */
import { describe, expect, it } from "vitest";
import { OwnKeyUnavailableError, ownKeyFailure, toOwnKeyError } from "../../app/.server/credentials/errors";
import { classifyError, JobStopError } from "../../app/.server/jobs/errors";
import { TranslationProviderError, withProviderFields } from "../../app/.server/providers/types";

const providerError = (provider: string, kind: TranslationProviderError["kind"]) => new TranslationProviderError(provider, kind, "fake");

describe("toOwnKeyError", () => {
  it("names the engine of a used-up or refused key", () => {
    for (const [engine, code] of [["deepl", "DEEPL"], ["azure", "AZURE"], ["google", "GOOGLE"]] as const) {
      expect(toOwnKeyError(providerError(engine, "quota"), "deepl")).toEqual(new JobStopError(`OWN_KEY_QUOTA_${code}`));
      expect(toOwnKeyError(providerError(engine, "auth"), "deepl")).toEqual(new JobStopError(`OWN_KEY_AUTH_${code}`));
    }
  });

  it("keeps the router's language scope (no shop-wide pause)", () => {
    const scoped = withProviderFields(providerError("azure", "quota"), { scope: "language" });
    const stop = toOwnKeyError(scoped, "deepl") as JobStopError;
    expect(stop).toBeInstanceOf(JobStopError);
    expect(classifyError(stop)).toEqual({ kind: "job-stop", code: "OWN_KEY_QUOTA_AZURE", scope: "language" });
    expect(classifyError(toOwnKeyError(providerError("google", "auth"), "deepl"))).toEqual({ kind: "job-stop", code: "OWN_KEY_AUTH_GOOGLE" });
  });

  it("falls back to the planned engine when the error doesn't name one", () => {
    expect(toOwnKeyError(providerError("router", "quota"), "google")).toEqual(new JobStopError("OWN_KEY_QUOTA_GOOGLE"));
    expect(toOwnKeyError(providerError("router", "auth"), "router")).toEqual(new JobStopError("OWN_KEY_AUTH_DEEPL"));
  });

  it("leaves retryable, invalid and non-provider errors unchanged", () => {
    for (const error of [providerError("deepl", "retryable"), providerError("deepl", "invalid"), new Error("other"), new JobStopError("CONSENT_REQUIRED"), "text"]) {
      expect(toOwnKeyError(error, "deepl")).toBe(error);
    }
  });
});

describe("ownKeyFailure", () => {
  it("lists every key of the router's failed request", () => {
    const error = withProviderFields(providerError("deepl", "quota"), {
      ownKeyFailures: [
        { engine: "deepl", kind: "quota" },
        { engine: "google", kind: "auth" },
      ],
    });
    expect(ownKeyFailure(error)).toEqual([
      { engine: "deepl", kind: "quota" },
      { engine: "google", kind: "auth" },
    ]);
  });

  it("is the error itself for a single key, and nothing for anything else", () => {
    expect(ownKeyFailure(providerError("azure", "auth"))).toEqual([{ engine: "azure", kind: "auth" }]);
    expect(ownKeyFailure(providerError("router", "quota"))).toEqual([]);
    expect(ownKeyFailure(providerError("deepl", "retryable"))).toEqual([]);
    expect(ownKeyFailure(new Error("x"))).toEqual([]);
  });
});

describe("OwnKeyUnavailableError", () => {
  it("carries a reason only, never a key", () => {
    expect(new OwnKeyUnavailableError("changed").message).toBe("Own key unavailable: changed");
    expect(new OwnKeyUnavailableError("unknown-key-id").name).toBe("OwnKeyUnavailableError");
  });
});
