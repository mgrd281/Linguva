/**
 * The engine variables (app/.server/lib/config.ts, docs/AI_ENGINES.md): pasted
 * values cleaned up, only Microsoft's two hosts, credentials as JSON or
 * base64, the order with DeepL first, and a value that doesn't validate
 * turning its engine off with a warning instead of stopping the start.
 * Fictional values only.
 */
import { describe, expect, it } from "vitest";
import {
  azureTranslatorSettings,
  configWarnings,
  costRatePerMillion,
  costRates,
  costRatesFromEnv,
  engineConfigProblems,
  engineConsentTokens,
  getConfig,
  googleTranslateSettings,
  parseEngineList,
  translationEngineOrder,
} from "../../app/.server/lib/config";
import { AZURE_EU_ENDPOINT, AZURE_GLOBAL_ENDPOINT } from "../../app/.server/providers/azure";
import { BASE_ENV, FAKE_AZURE_KEY, FAKE_GOOGLE_KEY, fakeServiceAccount } from "../support/engine-fixtures";

const config = (env: Record<string, string>) => getConfig({ ...BASE_ENV, ...env } as NodeJS.ProcessEnv);
const azure = { AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" };
const SERVICE_ACCOUNT = fakeServiceAccount();

describe("Azure Translator variables", () => {
  it("turns Azure on with a key, on the EU endpoint by default", () => {
    expect(azureTranslatorSettings(config(azure))).toEqual({ key: FAKE_AZURE_KEY, region: "westeurope", endpoint: AZURE_EU_ENDPOINT, dataLocation: "eu" });
    expect(azureTranslatorSettings(config({}))).toBeNull();
  });

  it("cleans pasted values: quotes, spaces, the portal's region name, a /translate path or a query", () => {
    const pasted = config({
      AZURE_TRANSLATOR_KEY: `  "${FAKE_AZURE_KEY}"  `,
      AZURE_TRANSLATOR_REGION: "West Europe",
      AZURE_TRANSLATOR_ENDPOINT: `${AZURE_GLOBAL_ENDPOINT}/translate?api-version=3.0`,
    });
    expect(azureTranslatorSettings(pasted)).toEqual({ key: FAKE_AZURE_KEY, region: "westeurope", endpoint: AZURE_GLOBAL_ENDPOINT, dataLocation: "global" });
    expect(azureTranslatorSettings(config({ ...azure, AZURE_TRANSLATOR_ENDPOINT: `${AZURE_EU_ENDPOINT}/` }))?.endpoint).toBe(AZURE_EU_ENDPOINT);
    // "global" is a Global resource: no region header.
    expect(azureTranslatorSettings(config({ ...azure, AZURE_TRANSLATOR_REGION: "global" }))?.region).toBeUndefined();
    expect(azureTranslatorSettings(config({ AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "" }))?.region).toBeUndefined();
  });

  it("sends the key nowhere but Microsoft's two endpoints, https only", () => {
    for (const endpoint of ["http://api-eur.cognitive.microsofttranslator.com", "https://my-resource.cognitiveservices.azure.com", "https://evil.example"]) {
      const c = config({ ...azure, AZURE_TRANSLATOR_ENDPOINT: endpoint });
      expect(azureTranslatorSettings(c), endpoint).toBeNull();
      expect(engineConfigProblems({ ...azure, AZURE_TRANSLATOR_ENDPOINT: endpoint }).map((p) => p.variable)).toEqual(["AZURE_TRANSLATOR_ENDPOINT"]);
    }
  });

  it("turns Azure off, without refusing the start, when a variable doesn't validate", () => {
    for (const env of [{ AZURE_TRANSLATOR_KEY: "short" }, { ...azure, AZURE_TRANSLATOR_REGION: "west europe!" }, { AZURE_TRANSLATOR_KEY: "not a key with spaces 123456" }]) {
      expect(() => config(env)).not.toThrow();
      expect(azureTranslatorSettings(config(env))).toBeNull();
    }
  });
});

describe("Google Cloud variables", () => {
  it("uses the API key (v2, global) or the service account (v3, EU), which wins", () => {
    expect(googleTranslateSettings(config({ GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY }))).toEqual({ kind: "apiKey", apiKey: FAKE_GOOGLE_KEY, dataLocation: "global" });
    const both = googleTranslateSettings(config({ GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, GOOGLE_TRANSLATE_CREDENTIALS: SERVICE_ACCOUNT }));
    expect(both).toMatchObject({ kind: "serviceAccount", dataLocation: "eu", credentials: { projectId: "fictional-proj-1" } });
    expect(configWarnings(config({ GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, GOOGLE_TRANSLATE_CREDENTIALS: SERVICE_ACCOUNT }))).toContain(
      "GOOGLE_TRANSLATE_API_KEY and GOOGLE_TRANSLATE_CREDENTIALS are both set: the service account is used",
    );
  });

  it("accepts the key file as JSON or base64, and turns Google off for anything else", () => {
    expect(googleTranslateSettings(config({ GOOGLE_TRANSLATE_CREDENTIALS: Buffer.from(SERVICE_ACCOUNT).toString("base64") }))?.kind).toBe("serviceAccount");
    const invalid = { GOOGLE_TRANSLATE_CREDENTIALS: '{"type":"service_account","project_id":"x"}' };
    expect(googleTranslateSettings(config(invalid))).toBeNull();
    expect(engineConfigProblems(invalid)).toEqual([{ variable: "GOOGLE_TRANSLATE_CREDENTIALS", message: "must be the service account's JSON key file, or that file in base64" }]);
    expect(googleTranslateSettings(config({ GOOGLE_TRANSLATE_API_KEY: "short" }))).toBeNull();
  });

  it("keeps Google off when the key file doesn't validate, even with an API key set (no switch to global processing)", () => {
    // A truncated paste during key rotation.
    const env = { DEEPL_API_KEY: "fictional:fx", GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, GOOGLE_TRANSLATE_CREDENTIALS: SERVICE_ACCOUNT.slice(0, 200) };
    const c = config(env);
    expect(googleTranslateSettings(c)).toBeNull();
    expect(translationEngineOrder(c)).toEqual(["deepl"]);
    expect(engineConsentTokens(c)).toEqual(["deepl"]);
    const warnings = configWarnings(c, { ...BASE_ENV, ...env });
    // "that engine is off" is true now.
    expect(warnings).toContain("GOOGLE_TRANSLATE_CREDENTIALS must be the service account's JSON key file, or that file in base64: it is ignored, that engine is off");
    expect(warnings.some((w) => w.startsWith("Google Cloud uses the API key (v2)"))).toBe(false);
    expect(warnings.some((w) => w.includes("are both set"))).toBe(false);
    // An empty key file is "not set": the API key works as before.
    expect(googleTranslateSettings(config({ GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, GOOGLE_TRANSLATE_CREDENTIALS: "  " }))?.kind).toBe("apiKey");
  });
});

describe("TRANSLATION_ENGINES and the order", () => {
  it("defaults to DeepL, Microsoft Azure, Google Cloud, configured ones only", () => {
    expect(translationEngineOrder(config({ DEEPL_API_KEY: "fictional:fx", ...azure, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY }))).toEqual(["deepl", "azure", "google"]);
    expect(translationEngineOrder(config({ GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, DEEPL_API_KEY: "fictional:fx" }))).toEqual(["deepl", "google"]);
    expect(translationEngineOrder(config({ TRANSLATION_PROVIDER: "mock", DEEPL_API_KEY: "fictional:fx" }))).toEqual([]);
  });

  it("selects and orders the others, ignores unknown names and always puts DeepL first", () => {
    expect(parseEngineList("google, azure deepl;bing google")).toEqual({ engines: ["deepl", "google", "azure"], unknown: ["bing"], repeated: ["google"], deeplMoved: true });
    const c = config({ DEEPL_API_KEY: "fictional:fx", ...azure, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY, TRANSLATION_ENGINES: "google,deepl" });
    expect(translationEngineOrder(c)).toEqual(["deepl", "google"]);
    const warnings = configWarnings(c);
    expect(warnings).toContain("Microsoft Azure has credentials but TRANSLATION_ENGINES doesn't list it: it isn't used");
    expect(warnings).toContain("TRANSLATION_ENGINES: DeepL always comes first (it is moved to the front)");
    expect(configWarnings(config({ TRANSLATION_ENGINES: "deepl,azure,bing" }))).toEqual(
      expect.arrayContaining(["TRANSLATION_ENGINES lists deepl without its credentials: it is skipped", 'TRANSLATION_ENGINES: "bing" isn\'t an engine: ignored']),
    );
  });

  it("never echoes an entry that may be a pasted key, not even in part", () => {
    // Synthetic 32-character hex value, as an Azure key looks.
    const pasted = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const warnings = configWarnings(config({ DEEPL_API_KEY: "fictional:fx", TRANSLATION_ENGINES: `deepl,${pasted},fictional:fx` }));
    for (const warning of warnings) {
      expect(warning).not.toContain(pasted.slice(0, 8));
      expect(warning).not.toContain("fictional");
    }
    expect(warnings).toContain("TRANSLATION_ENGINES has 2 entries that aren't engine names (not shown, it may be a key): ignored");
    expect(configWarnings(config({ DEEPL_API_KEY: "fictional:fx", TRANSLATION_ENGINES: `deepl,${pasted}` }))).toContain(
      "TRANSLATION_ENGINES has 1 entry that isn't an engine name (not shown, it may be a key): ignored",
    );
  });

  it("never turns AI off with a list that names no engine (a typo): the default order is used, with a warning", () => {
    const c = config({ DEEPL_API_KEY: "fictional:fx", TRANSLATION_ENGINES: "depl" });
    expect(translationEngineOrder(c)).toEqual(["deepl"]);
    expect(configWarnings(c)).toContain("TRANSLATION_ENGINES names no engine (deepl, azure, google): the default order is used");
  });

  it("reads TRANSLATION_PROVIDER=engines as the older deepl", () => {
    expect(config({ TRANSLATION_PROVIDER: "engines" }).TRANSLATION_PROVIDER).toBe("deepl");
    expect(config({}).TRANSLATION_PROVIDER).toBe("deepl");
  });

  it("names the consent tokens by data location; mock or none is DeepL's", () => {
    expect(engineConsentTokens(config({ DEEPL_API_KEY: "fictional:fx", ...azure, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY }))).toEqual(["deepl", "azure-eu", "google-global"]);
    expect(engineConsentTokens(config({ ...azure, AZURE_TRANSLATOR_ENDPOINT: AZURE_GLOBAL_ENDPOINT, GOOGLE_TRANSLATE_CREDENTIALS: SERVICE_ACCOUNT }))).toEqual(["azure-global", "google-eu"]);
    expect(engineConsentTokens(config({ TRANSLATION_PROVIDER: "mock", ...azure }))).toEqual(["deepl"]);
    expect(engineConsentTokens(config({}))).toEqual(["deepl"]);
  });
});

describe("warnings and problems", () => {
  it("names the variable and the rule, never the value", () => {
    const env = { AZURE_TRANSLATOR_KEY: "SECRET-VALUE-0001", AZURE_TRANSLATOR_REGION: "SECRET REGION!", GOOGLE_TRANSLATE_API_KEY: "SECRET!", GOOGLE_TRANSLATE_CREDENTIALS: "SECRET-JSON" };
    const problems = engineConfigProblems(env);
    expect(problems.map((p) => p.variable).sort()).toEqual(["AZURE_TRANSLATOR_KEY", "AZURE_TRANSLATOR_REGION", "GOOGLE_TRANSLATE_API_KEY", "GOOGLE_TRANSLATE_CREDENTIALS"]);
    const warnings = configWarnings(config(env), { ...BASE_ENV, ...env });
    expect(warnings.filter((w) => w.endsWith("it is ignored, that engine is off"))).toHaveLength(4);
    expect(JSON.stringify([problems, warnings])).not.toMatch(/SECRET/);
  });

  it("warns about global processing and a missing region; nothing for DeepL alone", () => {
    expect(configWarnings(config({ DEEPL_API_KEY: "fictional:fx" }), { ...BASE_ENV, DEEPL_API_KEY: "fictional:fx" })).toEqual([]);
    const warnings = configWarnings(config({ AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_ENDPOINT: AZURE_GLOBAL_ENDPOINT, GOOGLE_TRANSLATE_API_KEY: FAKE_GOOGLE_KEY }));
    expect(warnings.some((w) => w.startsWith("Microsoft Azure uses the global endpoint"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("AZURE_TRANSLATOR_REGION is empty"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("Google Cloud uses the API key (v2)"))).toBe(true);
  });
});

describe("cost rates", () => {
  it("defaults to the list prices and keeps DeepL's rate for rows without an engine", () => {
    const c = config({ AI_COST_USD_PER_MILLION_CHARS: "27.5" });
    expect(costRates(c)).toEqual({ deepl: 27.5, azure: 10, google: 20 });
    expect(costRatePerMillion(c, null)).toBe(27.5);
    expect(costRatePerMillion(c, "mock")).toBe(27.5);
    expect(costRatePerMillion(config({ AI_COST_USD_PER_MILLION_CHARS_AZURE: " 9.5 " }), "azure")).toBe(9.5);
  });

  it("reads the rates on their own, without the app's other variables (the operator's report)", () => {
    // ops:complimentary report runs with MIGRATION_DATABASE_URL only: no DATABASE_URL or encryption keys.
    const only = { MIGRATION_DATABASE_URL: "postgresql://owner:pw@localhost:5432/db" };
    expect(() => getConfig(only as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(costRatesFromEnv(only)).toEqual({ deepl: 25, azure: 10, google: 20 });
    // The same values and validation as the app's.
    const set = { ...only, AI_COST_USD_PER_MILLION_CHARS: "27.5", AI_COST_USD_PER_MILLION_CHARS_AZURE: " 9.5 ", AI_COST_USD_PER_MILLION_CHARS_GOOGLE: "" };
    expect(costRatesFromEnv(set)).toEqual(costRates(config(set)));
    expect(costRatesFromEnv(set)).toEqual({ deepl: 27.5, azure: 9.5, google: 20 });
    expect(() => costRatesFromEnv({ AI_COST_USD_PER_MILLION_CHARS: "-1" })).toThrow();
  });
});
