/**
 * The Own key plan's key form (app/.server/credentials/formats.ts): codes
 * only, the key wrapped in a SecretValue at once, hints of exactly four
 * characters, and only mock- keys outside a production build. Every key here
 * is fictional and built at runtime.
 */
import { describe, expect, it } from "vitest";
import { parseEngineKeyForm, type ParsedEngineKey } from "../../app/.server/credentials/formats";
import { SecretValue } from "../../app/.server/lib/secret";
import { ownAzureKey, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";

const HINT = /^[A-Za-z0-9._-]{4}$/;

function accepted(result: ReturnType<typeof parseEngineKeyForm>): ParsedEngineKey {
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result;
}

describe("parseEngineKeyForm (live mode)", () => {
  it("accepts a DeepL key as pasted, with its plan, hint and location", () => {
    const free = ownDeepLKey(1);
    const parsed = accepted(parseEngineKeyForm({ engine: "deepl", apiKey: `  "${free}"\n` }, "live"));
    expect(parsed.input.engine).toBe("deepl");
    expect(parsed.input.apiKey).toBeInstanceOf(SecretValue);
    expect(parsed.input.apiKey.reveal()).toBe(free);
    expect(parsed).toMatchObject({ dataLocation: "eu", region: null, deeplPlan: "free" });
    // The hint drops ":fx": the key's own last four characters.
    expect(parsed.hint).toBe(free.replace(/:fx$/, "").slice(-4));
    expect(parsed.hint).toMatch(HINT);
    const pro = accepted(parseEngineKeyForm({ engine: "deepl", apiKey: ownDeepLKey(2, false) }, "live"));
    expect(pro).toMatchObject({ deeplPlan: "pro", hint: ownDeepLKey(2, false).slice(-4) });
    expect(accepted(parseEngineKeyForm({ engine: "deepl", apiKey: `'${ownDeepLKey(3)}'` }, "live")).input.apiKey.reveal()).toBe(ownDeepLKey(3));
  });

  it("refuses DeepL keys with spaces, line breaks, colons, the wrong suffix or too much text", () => {
    const key = ownDeepLKey(4);
    for (const apiKey of [
      key.replace("-", " "),
      `${key.slice(0, 10)}\n${key.slice(10)}`,
      `${key.slice(0, 10)}\r${key.slice(10)}`,
      key.replace(":fx", ":xx"),
      `${key}:fx`,
      `-${key}`,
      "a".repeat(15),
      "a".repeat(5 * 1024),
      `${"a".repeat(5 * 1024)}:fx`,
      "",
      "   ",
    ]) {
      expect(parseEngineKeyForm({ engine: "deepl", apiKey }, "live"), JSON.stringify(apiKey.slice(0, 40))).toEqual({ ok: false, error: "KEY_FORMAT" });
    }
    for (const apiKey of [undefined, null, 42, { key }, [key]]) {
      expect(parseEngineKeyForm({ engine: "deepl", apiKey }, "live")).toEqual({ ok: false, error: "KEY_FORMAT" });
    }
  });

  it("validates Azure's key, region and data location", () => {
    const key = ownAzureKey(1);
    const eu = accepted(parseEngineKeyForm({ engine: "azure", apiKey: key, region: "West Europe" }, "live"));
    expect(eu.input).toMatchObject({ engine: "azure", region: "westeurope", location: "eu" });
    expect(eu).toMatchObject({ dataLocation: "eu", region: "westeurope", deeplPlan: null, hint: key.slice(-4) });
    const global = accepted(parseEngineKeyForm({ engine: "azure", apiKey: key, region: "global", location: "global" }, "live"));
    expect(global.input).toEqual({ engine: "azure", apiKey: global.input.apiKey, location: "global" });
    expect(global).toMatchObject({ dataLocation: "global", region: null });
    for (const region of [undefined, null, "", "  "]) {
      expect(accepted(parseEngineKeyForm({ engine: "azure", apiKey: key, region }, "live"))).toMatchObject({ region: null, dataLocation: "eu" });
    }
    for (const region of ["west europe!", "w", "a".repeat(33), "west-europe", "x".repeat(5000), 7]) {
      expect(parseEngineKeyForm({ engine: "azure", apiKey: key, region }, "live")).toEqual({ ok: false, error: "REGION_FORMAT" });
    }
    for (const location of ["us", "EU", "https://api.example.com", 1]) {
      expect(parseEngineKeyForm({ engine: "azure", apiKey: key, location }, "live")).toEqual({ ok: false, error: "KEY_FORMAT" });
    }
    for (const apiKey of ["a".repeat(15), `${key}-`, `${key}.x`, "a".repeat(129)]) {
      expect(parseEngineKeyForm({ engine: "azure", apiKey }, "live")).toEqual({ ok: false, error: "KEY_FORMAT" });
    }
  });

  it("validates a Google API key (processed globally)", () => {
    const key = ownGoogleKey(1);
    const parsed = accepted(parseEngineKeyForm({ engine: "google", apiKey: key, region: "ignored", location: "eu" }, "live"));
    expect(parsed.input).toEqual({ engine: "google", apiKey: parsed.input.apiKey });
    expect(parsed).toMatchObject({ dataLocation: "global", region: null, deeplPlan: null, hint: key.slice(-4) });
    for (const apiKey of ["g".repeat(19), `${key} x`, `${key}:fx`, "g".repeat(201), '{"type":"service_account"}']) {
      expect(parseEngineKeyForm({ engine: "google", apiKey }, "live")).toEqual({ ok: false, error: "KEY_FORMAT" });
    }
  });

  it("names an unknown engine without repeating anything", () => {
    for (const engine of ["openai", "DeepL", "", undefined, null, 1, ["deepl"]]) {
      expect(parseEngineKeyForm({ engine, apiKey: ownDeepLKey(5) }, "live")).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    }
  });

  it("never returns or prints the key: refusals are codes, the input is a SecretValue", () => {
    const key = ownGoogleKey(2);
    const parsed = accepted(parseEngineKeyForm({ engine: "google", apiKey: key }, "live"));
    expect(JSON.stringify(parsed)).not.toContain(key);
    expect(JSON.stringify(parsed)).not.toContain(key.slice(0, 20));
    expect(JSON.stringify(parseEngineKeyForm({ engine: "google", apiKey: `${key} ` + "x" }, "live"))).toBe('{"ok":false,"error":"KEY_FORMAT"}');
  });
});

describe("parseEngineKeyForm (mock mode: staging, development, tests)", () => {
  it("accepts only mock- test keys, on every engine", () => {
    const deepl = accepted(parseEngineKeyForm({ engine: "deepl", apiKey: "mock-deepl-1234:fx" }, "mock"));
    expect(deepl).toMatchObject({ hint: "1234", deeplPlan: "free", dataLocation: "eu" });
    expect(accepted(parseEngineKeyForm({ engine: "deepl", apiKey: "mock-deepl-5555" }, "mock"))).toMatchObject({ hint: "5555", deeplPlan: "pro" });
    expect(accepted(parseEngineKeyForm({ engine: "azure", apiKey: "mock-azure-0000", region: "West Europe" }, "mock"))).toMatchObject({
      hint: "0000",
      region: "westeurope",
      dataLocation: "eu",
    });
    expect(accepted(parseEngineKeyForm({ engine: "google", apiKey: "mock-google-9" }, "mock"))).toMatchObject({ hint: "le-9", dataLocation: "global" });
    // The shortest test key still has a four-character hint.
    expect(accepted(parseEngineKeyForm({ engine: "google", apiKey: "mock-a" }, "mock")).hint).toBe("ck-a");
  });

  it("refuses every real-looking key with KEY_MOCK_ONLY (a real key is never stored in staging or development)", () => {
    for (const [engine, apiKey] of [
      ["deepl", ownDeepLKey(6)],
      ["azure", ownAzureKey(6)],
      ["google", ownGoogleKey(6)],
      ["deepl", ["sk", "real", "looking", "key", "1234567890"].join("-")],
      ["deepl", "Mock-deepl-1"],
      ["deepl", "mock-"],
      ["deepl", "mock-UPPER"],
      ["deepl", `mock-${"a".repeat(61)}`],
    ] as const) {
      expect(parseEngineKeyForm({ engine, apiKey }, "mock"), apiKey).toEqual({ ok: false, error: "KEY_MOCK_ONLY" });
    }
  });

  it("keeps the engine's own rules for the suffix and the region", () => {
    // ":fx" marks DeepL API Free; another engine's key never has it (and its hint would hold a colon).
    expect(parseEngineKeyForm({ engine: "azure", apiKey: "mock-azure:fx" }, "mock")).toEqual({ ok: false, error: "KEY_FORMAT" });
    expect(parseEngineKeyForm({ engine: "google", apiKey: "mock-google:fx" }, "mock")).toEqual({ ok: false, error: "KEY_FORMAT" });
    expect(parseEngineKeyForm({ engine: "azure", apiKey: "mock-azure-1", region: "west europe!" }, "mock")).toEqual({ ok: false, error: "REGION_FORMAT" });
  });

  it("gives every accepted key a hint of exactly four allowed characters", () => {
    const keys = [
      ["deepl", ownDeepLKey(7), "live"],
      ["deepl", ownDeepLKey(8, false), "live"],
      ["azure", ownAzureKey(7), "live"],
      ["google", ownGoogleKey(7), "live"],
      ["deepl", "mock-x:fx", "mock"],
      ["azure", "mock-z", "mock"],
      ["google", "mock-g-g", "mock"],
    ] as const;
    for (const [engine, apiKey, mode] of keys) expect(accepted(parseEngineKeyForm({ engine, apiKey }, mode)).hint, apiKey).toMatch(HINT);
  });
});
