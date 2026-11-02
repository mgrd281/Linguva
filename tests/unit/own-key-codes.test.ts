/**
 * The Own key plan's client-safe vocabulary (app/lib/own-keys.ts): the job
 * stop codes that name a merchant's key, the consent token of a saved key,
 * and which statuses a provider is built from.
 */
import { describe, expect, it } from "vitest";
import { ENGINE_IDS, ENGINE_NAMES } from "../../app/lib/engines";
import { DEEPL_PLAN_NAMES, isOwnKeyCode, ownKeyStopCode, ownKeyToken, parseOwnKeyCode, usableOwnKey, type OwnKeyStatus } from "../../app/lib/own-keys";

describe("own-key stop codes", () => {
  it("round-trips every engine and kind", () => {
    const codes: string[] = [];
    for (const engine of ENGINE_IDS) {
      for (const kind of ["quota", "auth"] as const) {
        const code = ownKeyStopCode(kind, engine);
        codes.push(code);
        expect(parseOwnKeyCode(code)).toEqual({ kind: kind === "quota" ? "QUOTA" : "AUTH", engine });
        expect(isOwnKeyCode(code)).toBe(true);
        // Job rows, pause reasons and the credential's lastErrorCode: codes only (database CHECKs).
        expect(code).toMatch(/^[A-Z_]{1,40}$/);
      }
    }
    expect(codes).toEqual([
      "OWN_KEY_QUOTA_DEEPL",
      "OWN_KEY_AUTH_DEEPL",
      "OWN_KEY_QUOTA_AZURE",
      "OWN_KEY_AUTH_AZURE",
      "OWN_KEY_QUOTA_GOOGLE",
      "OWN_KEY_AUTH_GOOGLE",
    ]);
  });

  it("knows OWN_KEY_MISSING and nothing else", () => {
    expect(parseOwnKeyCode("OWN_KEY_MISSING")).toEqual({ kind: "MISSING" });
    expect("OWN_KEY_MISSING").toMatch(/^[A-Z_]{1,40}$/);
    for (const code of [null, undefined, "", "QUOTA_EXCEEDED", "PROVIDER_AUTH", "OWN_KEY_QUOTA", "OWN_KEY_AUTH_OPENAI", "own_key_quota_deepl", "OWN_KEY_QUOTA_DEEPL ", "OWN_KEY_UNREADABLE", "OWN_KEY_RECHECK", "OWN_KEY_UNAVAILABLE"]) {
      expect(parseOwnKeyCode(code), String(code)).toBeNull();
      expect(isOwnKeyCode(code), String(code)).toBe(false);
    }
  });
});

describe("own-key consent tokens and usable statuses", () => {
  it("maps a saved key to the token of where it processes", () => {
    expect(ownKeyToken({ engine: "deepl", dataLocation: "eu" })).toBe("deepl");
    expect(ownKeyToken({ engine: "azure", dataLocation: "eu" })).toBe("azure-eu");
    expect(ownKeyToken({ engine: "azure", dataLocation: "global" })).toBe("azure-global");
    // A Google API key means v2, which processes globally.
    expect(ownKeyToken({ engine: "google", dataLocation: "global" })).toBe("google-global");
  });

  it("builds providers only from OK and QUOTA keys", () => {
    const statuses: OwnKeyStatus[] = ["OK", "QUOTA", "REFUSED", "UNREADABLE", "RECHECK"];
    expect(statuses.filter((status) => usableOwnKey({ status }))).toEqual(["OK", "QUOTA"]);
  });

  it("names DeepL's API plans as brands (the same in every language)", () => {
    expect(DEEPL_PLAN_NAMES).toEqual({ free: "DeepL API Free", pro: "DeepL API Pro" });
    expect(ENGINE_NAMES.deepl).toBe("DeepL");
  });
});
