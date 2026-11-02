/**
 * The Own key plan's stop codes in words (app/i18n/labels.ts,
 * app/lib/job-display.ts): OWN_KEY_QUOTA_<ENGINE> names the merchant's
 * service by its brand name in every interface language, OWN_KEY_AUTH_<ENGINE>
 * has one text per engine that names only that engine's set-up (a DeepL key
 * never gets Google's or Azure's hints), OWN_KEY_MISSING says to add a key,
 * an item the stopped job didn't reach says only that the job stopped (the
 * job's page folds these texts), and the English fallbacks are the English
 * catalogue's words.
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
      expect(auth, locale).toBe(i18n.t("common.jobError.OWN_KEY_AUTH_GOOGLE"));
      expect(jobErrorMessage(i18n, "OWN_KEY_MISSING"), locale).toBe(i18n.t("common.jobError.OWN_KEY_MISSING"));
      for (const engine of ENGINE_IDS) {
        for (const kind of ["quota", "auth"] as const) expect(jobErrorMessage(i18n, ownKeyStopCode(kind, engine)), `${locale} ${kind} ${engine}`).toContain(ENGINE_NAMES[engine]);
      }
    }
  });

  it("give a refused key the set-up of its own engine only, in every language", () => {
    const others = { deepl: ["Google", "Azure"], azure: ["DeepL", "Google"], google: ["DeepL", "Azure"] } as const;
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      for (const engine of ENGINE_IDS) {
        const code = ownKeyStopCode("auth", engine);
        const text = jobErrorMessage(i18n, code)!;
        expect(text, `${locale} ${code}`).toBe(i18n.t(`common.jobError.${code}` as "common.jobError.OWN_KEY_AUTH_DEEPL"));
        expect(text, `${locale} ${code}`).toContain(ENGINE_NAMES[engine]);
        for (const other of others[engine]) expect(text, `${locale} ${code}`).not.toContain(other);
        // No longer the generic text with the engine filled in.
        expect(text, `${locale} ${code}`).not.toBe(i18n.t("common.jobError.OWN_KEY_AUTH", { engine: ENGINE_NAMES[engine] }));
      }
    }
  });

  it("leave an item the stopped job didn't reach to the job's page: it says only that the job stopped", () => {
    const de = translator("de");
    for (const code of ["OWN_KEY_QUOTA_DEEPL", "OWN_KEY_AUTH_AZURE", "OWN_KEY_MISSING"]) {
      expect(itemOutcome(de, "CANCELLED", code), code).toBe(de.t("jobs.outcome.STOPPED"));
    }
    // The job's page folds the stop's own text under "What happened?" (jobErrorMessage).
    expect(jobErrorMessage(de, "OWN_KEY_QUOTA_DEEPL")).toBe(de.t("common.jobError.OWN_KEY_QUOTA", { engine: "DeepL" }));
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
    // The same words as the English catalogue: per engine for a refused key.
    const en = translator("en");
    for (const engine of ENGINE_IDS) {
      const code = ownKeyStopCode("auth", engine);
      expect(ownKeyJobError(code), code).toBe(en.t(`common.jobError.${code}` as "common.jobError.OWN_KEY_AUTH_DEEPL"));
      expect(JOB_ERROR_MESSAGES[code], code).toBe(en.t(`common.jobError.${code}` as "common.jobError.OWN_KEY_AUTH_DEEPL"));
    }
    expect(ownKeyJobError("OWN_KEY_QUOTA_GOOGLE")).toBe(en.t("common.jobError.OWN_KEY_QUOTA", { engine: "Google Cloud" }));
  });
});
