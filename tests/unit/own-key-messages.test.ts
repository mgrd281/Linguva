/**
 * The Own key plan's stop codes in words (app/i18n/labels.ts,
 * app/lib/job-display.ts): OWN_KEY_QUOTA_<ENGINE> and OWN_KEY_AUTH_<ENGINE>
 * name the merchant's service by its brand name in every interface
 * language, OWN_KEY_MISSING says to add a key, an item's outcome falls
 * through to them, and the English fallback fills the engine too.
 */
import { describe, expect, it } from "vitest";
import { APP_LOCALES, translator } from "../../app/i18n/i18n";
import { itemOutcome, jobErrorMessage } from "../../app/i18n/labels";
import { ENGINE_IDS, ENGINE_NAMES } from "../../app/lib/engines";
import { JOB_ERROR_MESSAGES, ownKeyJobError } from "../../app/lib/job-display";
import { ownKeyStopCode } from "../../app/lib/own-keys";

describe("own-key stop messages", () => {
  it("name the engine of the key in every language", () => {
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const quota = jobErrorMessage(i18n, "OWN_KEY_QUOTA_AZURE");
      expect(quota, locale).toBe(i18n.t("common.jobError.OWN_KEY_QUOTA", { engine: "Microsoft Azure" }));
      expect(quota, locale).toContain("Microsoft Azure");
      expect(quota, locale).not.toContain("{engine}");
      const auth = jobErrorMessage(i18n, "OWN_KEY_AUTH_GOOGLE");
      expect(auth, locale).toBe(i18n.t("common.jobError.OWN_KEY_AUTH", { engine: "Google Cloud" }));
      expect(jobErrorMessage(i18n, "OWN_KEY_MISSING"), locale).toBe(i18n.t("common.jobError.OWN_KEY_MISSING"));
      for (const engine of ENGINE_IDS) {
        for (const kind of ["quota", "auth"] as const) expect(jobErrorMessage(i18n, ownKeyStopCode(kind, engine)), `${locale} ${kind} ${engine}`).toContain(ENGINE_NAMES[engine]);
      }
    }
  });

  it("an item's outcome falls through to them", () => {
    const de = translator("de");
    expect(itemOutcome(de, "CANCELLED", "OWN_KEY_QUOTA_DEEPL")).toBe(de.t("common.jobError.OWN_KEY_QUOTA", { engine: "DeepL" }));
    expect(itemOutcome(de, "CANCELLED", "OWN_KEY_MISSING")).toBe(de.t("common.jobError.OWN_KEY_MISSING"));
  });

  it("leave other codes as they were", () => {
    const en = translator("en");
    expect(jobErrorMessage(en, "QUOTA_EXCEEDED")).toBe(en.t("common.jobError.QUOTA_EXCEEDED"));
    expect(jobErrorMessage(en, "OWN_KEY_QUOTA_ACME")).toBeNull();
    expect(jobErrorMessage(en, "")).toBeNull();
  });

  it("have English fallbacks with the engine filled in", () => {
    expect(ownKeyJobError("OWN_KEY_QUOTA_DEEPL")).toBe(JOB_ERROR_MESSAGES.OWN_KEY_QUOTA!.replaceAll("{engine}", "DeepL"));
    expect(ownKeyJobError("OWN_KEY_AUTH_AZURE")).toContain("Microsoft Azure refused your key");
    expect(ownKeyJobError("OWN_KEY_MISSING")).toBe("No working translation key. Add one in Settings, then resume.");
    expect(ownKeyJobError("PROVIDER_QUOTA")).toBeNull();
    // The same words as the English catalogue.
    const en = translator("en");
    expect(ownKeyJobError("OWN_KEY_AUTH_GOOGLE")).toBe(en.t("common.jobError.OWN_KEY_AUTH", { engine: "Google Cloud" }));
  });
});
