/**
 * Which engines a shop's AI consent covers (app/.server/settings/ai-consent.ts,
 * shop-settings.ts): DeepL alone keeps the version every shop accepted, so
 * KARINEX never has to consent again; any other set records its tokens, and
 * an engine is used only once a consent covers it.
 */
import { describe, expect, it } from "vitest";
import { consentTokens, consentVersionFor, ENGINES_NOTICE, LEGACY_DEEPL_CONSENT } from "../../app/.server/settings/ai-consent";
import { AI_CONSENT_VERSION, consentedEngines, hasAiConsentFor, missingConsent, textConsentTokens } from "../../app/.server/settings/shop-settings";

const at = new Date("2026-11-01T10:00:00Z");
const consent = (version: string | null, date: Date | null = at) => ({ aiDataProcessingConsentAt: date, consentVersion: version });

describe("consent versions", () => {
  it("keeps DeepL alone at the version shops accepted before", () => {
    expect(LEGACY_DEEPL_CONSENT).toBe("2026-10-deepl-v1");
    expect(AI_CONSENT_VERSION).toBe(LEGACY_DEEPL_CONSENT);
    expect(consentVersionFor(["deepl"])).toBe("2026-10-deepl-v1");
    expect(consentTokens("2026-10-deepl-v1")).toEqual(["deepl"]);
  });

  it("records any other set, sorted, and reads it back", () => {
    const version = consentVersionFor(["google-global", "deepl", "azure-eu"]);
    expect(version).toBe(`${ENGINES_NOTICE}:azure-eu,deepl,google-global`);
    expect(consentTokens(version)).toEqual(["deepl", "azure-eu", "google-global"]);
    expect(consentVersionFor(["azure-eu"])).toBe(`${ENGINES_NOTICE}:azure-eu`);
  });

  it("keeps DeepL for an outdated engines notice that listed it, and nothing for one that didn't", () => {
    expect(consentTokens("2026-09-engines-v0:azure-eu,deepl")).toEqual(["deepl"]);
    expect(consentTokens("2026-09-engines-v0:azure-eu")).toBeNull();
  });

  it("covers nothing for unknown or malformed versions", () => {
    for (const version of [null, "", "2026-01-deepl-v0", `${ENGINES_NOTICE}:bing`, `${ENGINES_NOTICE}:`, "random"]) expect(consentTokens(version), String(version)).toBeNull();
  });
});

describe("what a shop may use", () => {
  it("is today's rule with DeepL only or the mock provider", () => {
    expect(hasAiConsentFor(consent("2026-10-deepl-v1"), ["deepl"])).toBe(true);
    expect(hasAiConsentFor(consent("2026-10-deepl-v1", null), ["deepl"])).toBe(false);
    expect(hasAiConsentFor(consent(null), ["deepl"])).toBe(false);
    expect(hasAiConsentFor(consent("2026-09-deepl-v0"), ["deepl"])).toBe(false);
  });

  it("keeps DeepL for a DeepL-only consent when other engines are added, and asks for those", () => {
    const configured = ["deepl", "azure-eu", "google-global"] as const;
    const legacy = consent("2026-10-deepl-v1");
    expect(hasAiConsentFor(legacy, configured)).toBe(true);
    expect(consentedEngines(legacy, configured)).toEqual(["deepl"]);
    expect(missingConsent(legacy, configured)).toEqual(["azure-eu", "google-global"]);
    expect(textConsentTokens(legacy, configured)).toEqual(["deepl"]);
    const all = consent(consentVersionFor([...configured]));
    expect(consentedEngines(all, configured)).toEqual(["deepl", "azure", "google"]);
    expect(missingConsent(all, configured)).toEqual([]);
  });

  it("needs new consent when an engine's data location changes", () => {
    const eu = consent(consentVersionFor(["deepl", "azure-eu"]));
    expect(consentedEngines(eu, ["deepl", "azure-global"])).toEqual(["deepl"]);
    expect(missingConsent(eu, ["deepl", "azure-global"])).toEqual(["azure-global"]);
    const azureOnly = consent(consentVersionFor(["azure-eu"]));
    expect(hasAiConsentFor(azureOnly, ["azure-global"])).toBe(false);
  });

  it("names every engine in use before any consent, and only the consented ones after", () => {
    expect(textConsentTokens(consent(null), ["deepl", "azure-eu"])).toEqual(["deepl", "azure-eu"]);
    expect(textConsentTokens(consent(null), ["deepl"])).toEqual(["deepl"]);
    expect(consentedEngines(consent(null), ["deepl", "azure-eu"])).toEqual([]);
  });

  it("keeps DeepL running after the notice changes, but stops the others until allowed again", () => {
    const outdated = consent("2026-09-engines-v0:azure-eu,deepl");
    expect(consentedEngines(outdated, ["deepl", "azure-eu"])).toEqual(["deepl"]);
    expect(missingConsent(outdated, ["deepl", "azure-eu"])).toEqual(["azure-eu"]);
    expect(hasAiConsentFor(consent("2026-09-engines-v0:azure-eu"), ["deepl", "azure-eu"])).toBe(false);
  });
});
