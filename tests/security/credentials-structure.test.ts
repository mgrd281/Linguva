/**
 * Static guards for the Own key plan's credentials module
 * (app/.server/credentials): it never reaches Linguva's own engine keys or
 * their settings, never prints anything to the console, and reveals a
 * merchant key only where an outgoing request is built or the key is
 * encrypted (docs/SECURITY_MODEL.md §3).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "app", ".server", "credentials");
const FILES = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));

describe("credentials module structure", () => {
  it("has the reviewed files", () => {
    expect(FILES.map((f) => f.name).sort()).toEqual(["checker.ts", "cipher.ts", "deepl-quota.ts", "formats.ts", "maintenance.ts", "service.ts", "store.ts"]);
  });

  it("never touches the operator's engine keys or settings", () => {
    const OPERATOR = /\b(routedEngines|deeplApiKeys|azureTranslatorSettings|googleTranslateSettings|getTranslationProvider|engineConsentTokens)\b|DEEPL_API_URL|DEEPL_API_KEY|AZURE_TRANSLATOR_|GOOGLE_TRANSLATE_|process\.env/;
    expect(FILES.filter((f) => OPERATOR.test(f.text)).map((f) => `${f.name}: ${OPERATOR.exec(f.text)![0]}`)).toEqual([]);
  });

  it("writes nothing to the console", () => {
    expect(FILES.filter((f) => /\bconsole\./.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it("reveals a key only where a request is built (the check, the DeepL figure) or the key is encrypted (the store)", () => {
    expect(FILES.filter((f) => /\.reveal\(\)/.test(f.text)).map((f) => f.name).sort()).toEqual(["checker.ts", "deepl-quota.ts", "store.ts"]);
  });

  it("never logs a key: log lines carry engines, key ids, shop ids and counts", () => {
    const calls = FILES.flatMap((f) => [...f.text.matchAll(/\blog(?:ger)?\.(?:info|warn|error)\(\{([^}]*)\}/g)].map((m) => `${f.name}: ${m[1]!.trim()}`));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call, call).not.toMatch(/apiKey|secret|hint|plaintext|reveal|stateKey/);
  });
});
