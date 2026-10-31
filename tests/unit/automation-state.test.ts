/**
 * Settings' states for translating changes and publishing: "On" and
 * "Automatic" only when the work really runs (plan, installation,
 * permission, pause, languages), and the form-of-address choice only for
 * languages where DeepL can set it.
 */
import { describe, expect, it } from "vitest";
import { basicState, changesMode, effectivePublishMode, smartState } from "../../app/lib/automation-state";
import { formalityPronouns, supportsFormality } from "../../app/lib/formality";

const running = { enabled: true, planIncludes: true, available: true, consent: true, paused: false, activeLanguages: 2 };

describe("translating changes", () => {
  it("has one mode: the smart schedule wins over translating shortly after saving (the server never keeps both on)", () => {
    expect(changesMode({ basicEnabled: false, smartEnabled: false })).toBe("manual");
    expect(changesMode({ basicEnabled: true, smartEnabled: false })).toBe("basic");
    expect(changesMode({ basicEnabled: false, smartEnabled: true })).toBe("smart");
    expect(changesMode({ basicEnabled: true, smartEnabled: true })).toBe("smart");
  });

  it("reads On only when translating shortly after saving really runs", () => {
    expect(basicState(running)).toBe("on");
    expect(basicState({ ...running, enabled: false })).toBe("off");
  });

  it("names the first reason it doesn't run, in the order the merchant can act on", () => {
    // A downgrade stops it whatever else holds; the plan is named first.
    expect(basicState({ ...running, planIncludes: false, consent: false, paused: true })).toBe("plan");
    expect(basicState({ ...running, available: false, consent: false })).toBe("unavailable");
    expect(basicState({ ...running, consent: false, paused: true })).toBe("consent");
    expect(basicState({ ...running, paused: true, activeLanguages: 0 })).toBe("paused");
    // Chosen languages that the plan no longer includes: nothing is translated (never "On").
    expect(basicState({ ...running, activeLanguages: 0 })).toBe("noLanguage");
  });

  it("shows the smart schedule stopped by the plan as its own state, and off as off", () => {
    expect(smartState({ status: { state: "on" }, entitled: true })).toBe("on");
    expect(smartState({ status: { state: "paused", reason: "MANUAL", until: null }, entitled: true })).toBe("paused");
    expect(smartState({ status: { state: "waiting", reason: "CONSENT" }, entitled: true })).toBe("waiting");
    // After a move to a plan without it: kept, and stopped (its status waits for the plan).
    expect(smartState({ status: { state: "waiting", reason: "PLAN" }, entitled: false })).toBe("plan");
    expect(smartState({ status: { state: "off" }, entitled: false })).toBe("off");
  });
});

describe("publishing", () => {
  it("is automatic only while the plan includes it", () => {
    expect(effectivePublishMode({ mode: "AUTO_PUBLISH", inPlan: true })).toBe("AUTO_PUBLISH");
    // Switched on under a bigger plan: everything waits in Review now, as the job processor does.
    expect(effectivePublishMode({ mode: "AUTO_PUBLISH", inPlan: false })).toBe("DRAFT");
    expect(effectivePublishMode({ mode: "DRAFT", inPlan: true })).toBe("DRAFT");
  });
});

describe("form of address", () => {
  it("is offered for the languages DeepL can set it for, by base language", () => {
    for (const locale of ["de", "fr", "it", "es", "nl", "pl", "pt-BR", "pt-PT", "ja", "ru", "de-CH"]) expect(supportsFormality(locale), locale).toBe(true);
    for (const locale of ["en", "ar", "da", "sv", "zh-CN", "ko"]) expect(supportsFormality(locale), locale).toBe(false);
  });

  it("names both forms by their pronouns where they are clear, otherwise not at all", () => {
    expect(formalityPronouns("de")).toEqual({ formal: "Sie", informal: "du" });
    expect(formalityPronouns("fr")).toEqual({ formal: "vous", informal: "tu" });
    expect(formalityPronouns("es")).toEqual({ formal: "usted", informal: "tú" });
    expect(formalityPronouns("it")).toEqual({ formal: "Lei", informal: "tu" });
    expect(formalityPronouns("nl")).toEqual({ formal: "u", informal: "jij" });
    expect(formalityPronouns("pl")).toEqual({ formal: "Pan/Pani", informal: "ty" });
    expect(formalityPronouns("pt-BR")).toEqual({ formal: "você", informal: "tu" });
    expect(formalityPronouns("ja")).toBeNull();
    expect(formalityPronouns("ru")).toBeNull();
  });
});
