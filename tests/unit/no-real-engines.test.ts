import { describe, expect, it } from "vitest";
import { guardFetch, refusedEngineHost, TestGuardError } from "../support/no-real-engines";

const ENGINE_URLS = [
  "https://api.deepl.com/v2/translate",
  "https://api-free.deepl.com/v2/usage",
  "https://api-eur.cognitive.microsofttranslator.com/translate?api-version=3.0",
  "https://api.cognitive.microsofttranslator.com/languages?api-version=3.0",
  "https://westeurope.api.cognitive.microsoft.com/sts/v1.0/issueToken",
  "https://api.cognitive.microsoft.com/sts/v1.0/issueToken",
  "https://fictional-resource.cognitiveservices.azure.com/translator/text/v3.0/translate",
  "https://translation.googleapis.com/language/translate/v2",
  "https://translate-eu.googleapis.com/v3/projects/p/locations/europe-west1:translateText",
  "https://oauth2.googleapis.com/token",
  "HTTPS://API.DEEPL.COM./v2/translate",
];

describe("test guard against real translation engines", () => {
  it("is installed on globalThis.fetch for this suite and refuses every engine host without a request", async () => {
    for (const url of ENGINE_URLS) {
      await expect(globalThis.fetch(url)).rejects.toThrow(TestGuardError);
      await expect(globalThis.fetch(new URL(url))).rejects.toThrow(/\[test-guard\] refused /);
      await expect(globalThis.fetch(new Request(url, { method: "POST", body: "x" }))).rejects.toThrow(/\[test-guard\] refused /);
    }
    await expect(globalThis.fetch("https://api.deepl.com/v2/usage")).rejects.toThrow("[test-guard] refused api.deepl.com");
  });

  it("names the host and lets every other host through to the wrapped fetch", async () => {
    const seen: string[] = [];
    const guarded = guardFetch((async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("ok");
    }) as typeof fetch);
    for (const url of ["https://linguva.test/x", "https://shop.myshopify.com/admin", "https://deepl.com.example.org/", "https://notgoogleapis.com/"]) {
      expect(await (await guarded(url)).text()).toBe("ok");
    }
    await expect(guarded("https://translate.googleapis.com/v3")).rejects.toMatchObject({ name: "TestGuardError" });
    expect(seen).toHaveLength(4);
    expect(refusedEngineHost("https://x.cognitive.microsoft.com/")).toBe("x.cognitive.microsoft.com");
    expect(refusedEngineHost("not a url")).toBeNull();
    // Wrapping twice keeps one guard.
    expect(guardFetch(guarded)).toBe(guarded);
  });
});
