/**
 * What a translation charges the shop (app/.server/usage/engine-charge.ts):
 * the answering engine's count only; a failure charges what the engines
 * billed, never more than was reserved, in the order they were tried.
 */
import { describe, expect, it } from "vitest";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { chargedChars, chargeForFailure, chargeForResult, lostChars } from "../../app/.server/usage/engine-charge";

const failure = (billed?: number, byEngine?: Record<string, number>) => {
  const error = new TranslationProviderError("router", "retryable", "fake");
  if (billed !== undefined) error.billedCharacters = billed;
  if (byEngine) error.billedByEngine = byEngine;
  return error;
};

describe("chargeForResult", () => {
  it("charges the answering engine; earlier engines' partials are lost (platform only)", () => {
    expect(chargeForResult({ provider: "deepl", billedCharacters: 120 })).toEqual({ byEngine: { deepl: 120 }, lost: {} });
    const charge = chargeForResult({ provider: "azure", billedCharacters: 90, lostByEngine: { deepl: 40 } });
    expect(charge).toEqual({ byEngine: { azure: 90 }, lost: { deepl: 40 } });
    expect(chargedChars(charge)).toBe(90);
    expect(lostChars(charge)).toBe(40);
  });
});

describe("chargeForFailure", () => {
  it("charges a bare provider's partial bill to the planned engine, as before", () => {
    expect(chargeForFailure(failure(30), 100, "deepl")).toEqual({ byEngine: { deepl: 30 }, lost: {} });
    expect(chargeForFailure(failure(), 100, "deepl")).toEqual({ byEngine: {}, lost: {} });
    expect(chargeForFailure(new Error("other"), 100, "deepl")).toEqual({ byEngine: {}, lost: {} });
  });

  it("charges a router's partials in the order tried, up to the reservation; the rest is lost", () => {
    expect(chargeForFailure(failure(70, { deepl: 40, azure: 30 }), 100, "deepl")).toEqual({ byEngine: { deepl: 40, azure: 30 }, lost: {} });
    const capped = chargeForFailure(failure(150, { deepl: 80, azure: 70 }), 100, "deepl");
    expect(capped).toEqual({ byEngine: { deepl: 80, azure: 20 }, lost: { azure: 50 } });
    expect(chargedChars(capped)).toBe(100);
    expect(chargeForFailure(failure(0, { deepl: 0 }), 100, "deepl")).toEqual({ byEngine: {}, lost: {} });
  });
});
