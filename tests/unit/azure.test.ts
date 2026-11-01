import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AZURE_EU_ENDPOINT,
  AZURE_GLOBAL_ENDPOINT,
  AZURE_LANGUAGES_URL,
  AzureTranslatorProvider,
  azureGuessedCode,
  azureLanguageCandidates,
  azureTranslateRequest,
  classifyAzureError,
  clearAzureLanguageCache,
  resolveAzureLanguage,
  type AzureOptions,
} from "../../app/.server/providers/azure";
import { encodeSegment, UNMAPPABLE_SEGMENT } from "../../app/.server/providers/html-transport";
import { TranslationProviderError, type TranslationRequest } from "../../app/.server/providers/types";

/** Fictional key and the only hosts a fake may see in this file. */
const KEY = "uiazurekey0004fictional0000000000";
const HOSTS = new Set([
  "api-eur.cognitive.microsofttranslator.com",
  "api.cognitive.microsofttranslator.com",
  "westeurope.api.cognitive.microsoft.com",
  "api.cognitive.microsoft.com",
]);
const SOURCE = 'Buy <g id="1">two</g> and save <x id="2"/>';
const LANGUAGES = ["de", "en", "es", "fr", "fr-ca", "ja", "zh-Hans", "zh-Hant", "pt", "pt-pt", "nb", "sr-Cyrl", "sr-Latn", "mn-Cyrl", "fil", "he", "kmr", "ku", "th"];
const noSleep = { sleep: async () => undefined };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>;

const allCalls: Call[] = [];

function languageList(codes: readonly string[] = LANGUAGES, init?: ResponseInit) {
  return Response.json({ translation: Object.fromEntries(codes.map((c) => [c, { name: c, nativeName: c, dir: "ltr" }])) }, init);
}

/** Echoes every text with a prefix, as Azure's response shape. */
function echo(call: Call) {
  const texts = (call.body as Array<{ text: string }>).map((t) => t.text);
  return Response.json(texts.map((text) => ({ translations: [{ text: `DE ${text}`, to: "de" }] })));
}

function fakeFetch(translate: Responder = echo, languages: Responder = () => languageList()) {
  const calls: Call[] = [];
  const impl = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    allCalls.push(call);
    return call.url.startsWith(AZURE_LANGUAGES_URL) ? languages(call, init.signal ?? undefined) : translate(call, init.signal ?? undefined);
  }) as unknown as typeof fetch;
  const translateCalls = () => calls.filter((c) => c.url.includes("/translate?"));
  return { impl, calls, translateCalls };
}

function provider(fetchImpl: typeof fetch, options: Partial<AzureOptions> = {}) {
  return new AzureTranslatorProvider({ key: KEY, region: "westeurope", fetch: fetchImpl, retry: noSleep, ...options });
}

const request = (segments: string[], extra: Partial<TranslationRequest> = {}): TranslationRequest => ({
  segments,
  sourceLocale: "en",
  targetLocale: "de",
  ...extra,
});

const azureError = (status: number, code?: number, headers: Record<string, string> = {}) => () =>
  Response.json({ error: { code, message: "Request echoes SECRET-INPUT from the body" } }, { status, headers: { "X-RequestId": "req-1234.abc", ...headers } });

beforeEach(() => {
  clearAzureLanguageCache();
  allCalls.length = 0;
});

afterEach(() => {
  // Every request of this file went to a fake, and only for Microsoft's documented hosts.
  for (const call of allCalls) expect(HOSTS.has(new URL(call.url).hostname)).toBe(true);
  // A key never travels in a URL.
  for (const call of allCalls) expect(call.url).not.toContain(KEY);
});

describe("Azure request shape", () => {
  it("posts each wire mode to the EU endpoint with key, region, content type and a trace id", async () => {
    const { impl, calls } = fakeFetch();
    const result = await provider(impl).translate(request([SOURCE, "Blue jacket"]));
    expect(calls.map((c) => c.url)).toEqual([
      AZURE_LANGUAGES_URL,
      `${AZURE_EU_ENDPOINT}/translate?api-version=3.0&from=en&to=de&textType=html`,
      `${AZURE_EU_ENDPOINT}/translate?api-version=3.0&from=en&to=de&textType=plain`,
    ]);
    const [, html, plain] = calls;
    expect(html!.method).toBe("POST");
    expect(html!.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": KEY,
      "Ocp-Apim-Subscription-Region": "westeurope",
      "Content-Type": "application/json; charset=UTF-8",
    });
    expect(html!.headers["X-ClientTraceId"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(html!.body).toEqual([{ text: 'Buy <span id="lg1">two</span> and save <img id="lx2"/>' }]);
    expect(plain!.body).toEqual([{ text: "Blue jacket" }]);
    expect(result).toEqual({
      translations: ['DE Buy <g id="1">two</g> and save <x id="2"/>', "DE Blue jacket"],
      billedCharacters: "Buy two and save ".length + "Blue jacket".length,
      provider: "azure",
    });
  });

  it("sends no region header without a region, and the global endpoint when chosen", async () => {
    const { impl, translateCalls } = fakeFetch();
    await provider(impl, { region: undefined, endpoint: AZURE_GLOBAL_ENDPOINT }).translate(request(["Hello"]));
    expect(translateCalls()[0]!.url).toBe(`${AZURE_GLOBAL_ENDPOINT}/translate?api-version=3.0&from=en&to=de&textType=plain`);
    expect(translateCalls()[0]!.headers).not.toHaveProperty("Ocp-Apim-Subscription-Region");
  });

  it("sends exactly what azureTranslateRequest builds", async () => {
    const { impl, translateCalls } = fakeFetch();
    const options = { key: KEY, region: "westeurope" };
    await provider(impl).translate(request([SOURCE]));
    const built = azureTranslateRequest(options, [encodeSegment(SOURCE).wire], "html", "en", "de");
    const sent = translateCalls()[0]!;
    expect(sent.url).toBe(built.url);
    expect(sent.body).toEqual(JSON.parse(built.init.body as string));
    // Equal apart from the trace id, which is new per request.
    const withoutTrace = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "X-ClientTraceId"));
    expect(withoutTrace(sent.headers)).toEqual(withoutTrace(built.init.headers as Record<string, string>));
    expect(Object.keys(sent.headers)).toContain("X-ClientTraceId");
  });

  it("reads the language list from the documented global URL for both endpoints, without a key", async () => {
    for (const endpoint of [AZURE_EU_ENDPOINT, AZURE_GLOBAL_ENDPOINT] as const) {
      clearAzureLanguageCache();
      const { impl, calls } = fakeFetch();
      await provider(impl, { endpoint }).targetLanguages();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(AZURE_LANGUAGES_URL);
      expect(calls[0]!.method).toBe("GET");
      expect(Object.keys(calls[0]!.headers)).not.toContain("Ocp-Apim-Subscription-Key");
      expect(JSON.stringify(calls[0]!.headers)).not.toContain(KEY);
    }
  });

  it("refreshes the list after a day with If-None-Match, and a 304 keeps it for another day", async () => {
    let now = 1_000_000;
    const answers = [languageList(LANGUAGES, { headers: { ETag: 'W/"v1"' } }), new Response(null, { status: 304 })];
    const { impl, calls } = fakeFetch(echo, () => answers.shift()!);
    const azure = provider(impl, { now: () => now });
    expect((await azure.targetLanguages()).get("zh-hans")).toBe("zh-Hans");
    now += 25 * 60 * 60 * 1000;
    expect((await azure.targetLanguages()).get("zh-hans")).toBe("zh-Hans");
    expect(calls[1]!.headers).toEqual({ "If-None-Match": 'W/"v1"' });
    now += 23 * 60 * 60 * 1000;
    await azure.targetLanguages();
    expect(calls).toHaveLength(2);
  });

  it("shares one list fetch between providers with different keys", async () => {
    const { impl, calls } = fakeFetch();
    await provider(impl).targetSupport(["de"]);
    await provider(impl, { key: "otherazurekey0006fictional000000000" }).targetSupport(["fr"]);
    await Promise.all([provider(impl).translate(request(["a"])), provider(impl).translate(request(["b"]))]);
    expect(calls.filter((c) => c.url === AZURE_LANGUAGES_URL)).toHaveLength(1);
  });

  it("returns empty and code-only segments unchanged without a call", async () => {
    const { impl, calls } = fakeFetch();
    const result = await provider(impl).translate(request(["", "   ", '<x id="1"/>', '<g id="1"><x id="2"/></g>']));
    expect(result).toEqual({ translations: ["", "   ", '<x id="1"/>', '<g id="1"><x id="2"/></g>'], billedCharacters: 0, provider: "azure" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty key, another endpoint and a malformed region at construction, without network", () => {
    const { impl, calls } = fakeFetch();
    expect(() => new AzureTranslatorProvider({ key: "", fetch: impl })).toThrow(/key is required/);
    expect(() => new AzureTranslatorProvider({ key: KEY, endpoint: "https://evil.example" as typeof AZURE_EU_ENDPOINT, fetch: impl })).toThrow(/endpoint/);
    expect(() => new AzureTranslatorProvider({ key: KEY, region: "west europe", fetch: impl })).toThrow(/region/);
    new AzureTranslatorProvider({ key: KEY, fetch: impl });
    expect(calls).toHaveLength(0);
  });
});

describe("Azure batching", () => {
  it("sends at most 100 texts per request and keeps the order", async () => {
    const { impl, translateCalls } = fakeFetch();
    const segments = Array.from({ length: 250 }, (_, i) => `text ${i}`);
    const result = await provider(impl).translate(request(segments));
    expect(translateCalls().map((c) => (c.body as unknown[]).length)).toEqual([100, 100, 50]);
    expect(result.translations).toEqual(segments.map((s) => `DE ${s}`));
  });

  it("keeps a request at 10,000 characters and sends a longer segment alone", async () => {
    const { impl, translateCalls } = fakeFetch();
    const big = "a".repeat(4_000);
    await provider(impl).translate(request([big, big, big]));
    expect(translateCalls().map((c) => (c.body as unknown[]).length)).toEqual([2, 1]);
    const long = "b".repeat(10_001);
    const { impl: impl2, translateCalls: calls2 } = fakeFetch();
    await provider(impl2).translate(request(["short", long, "tail"]));
    expect(calls2().map((c) => (c.body as Array<{ text: string }>).map((t) => t.text.length))).toEqual([[5], [10_001], [4]]);
  });

  it("restores the order across plain and HTML requests", async () => {
    const { impl, translateCalls } = fakeFetch();
    const result = await provider(impl).translate(request([SOURCE, "one", 'Get <g id="1">it</g>', "two"]));
    expect(translateCalls()).toHaveLength(2);
    expect(result.translations).toEqual(['DE Buy <g id="1">two</g> and save <x id="2"/>', "DE one", 'DE Get <g id="1">it</g>', "DE two"]);
  });

  it("refuses a segment over 50,000 characters before any call", async () => {
    const { impl, calls } = fakeFetch();
    const failure = await provider(impl).translate(request(["ok", "c".repeat(50_001)])).catch((e: unknown) => e);
    expect(failure).toMatchObject({ provider: "azure", kind: "invalid", reason: "REQUEST_TOO_LARGE" });
    expect(calls).toHaveLength(0);
  });

  it("splits a batch Azure refuses as too large into halves", async () => {
    const { impl, translateCalls } = fakeFetch((call) =>
      (call.body as unknown[]).length > 2 ? azureError(400, 400050)() : echo(call),
    );
    const segments = ["one", "two", "three", "four"];
    const result = await provider(impl).translate(request(segments));
    expect(translateCalls().map((c) => (c.body as unknown[]).length)).toEqual([4, 2, 2]);
    expect(result.translations).toEqual(segments.map((s) => `DE ${s}`));
    // The refused request isn't billed.
    expect(result.billedCharacters).toBe(segments.join("").length);
  });

  it("fails a single segment Azure refuses as too large with that reason", async () => {
    const { impl, translateCalls } = fakeFetch(azureError(400, 400077));
    await expect(provider(impl).translate(request(["one"]))).rejects.toMatchObject({ kind: "invalid", reason: "REQUEST_TOO_LARGE" });
    expect(translateCalls()).toHaveLength(1);
  });
});

describe("Azure language codes", () => {
  const codes = new Map(LANGUAGES.map((c) => [c.toLowerCase(), c]));

  it.each([
    ["zh", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans", "zh-Hans"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["pt-BR", "pt"],
    ["pt", "pt-pt"],
    ["pt-PT", "pt-pt"],
    ["no", "nb"],
    ["nb", "nb"],
    ["nn", "nb"],
    ["sr", "sr-Cyrl"],
    ["sr-Cyrl", "sr-Cyrl"],
    ["sr-Latn", "sr-Latn"],
    ["mn", "mn-Cyrl"],
    ["fr-CA", "fr-ca"],
    ["fil", "fil"],
    ["tl", "fil"],
    ["he", "he"],
    ["iw", "he"],
    ["ku", "kmr"],
    ["ckb", "ku"],
    ["en-GB", "en"],
    ["de", "de"],
  ])("%s → %s", (locale, code) => {
    expect(resolveAzureLanguage(codes, locale)).toBe(code);
  });

  it("tries the full locale, then its base, and matches case-insensitively", () => {
    expect(azureLanguageCandidates("en-GB")).toEqual(["en-gb", "en"]);
    expect(azureLanguageCandidates("es-419")).toEqual(["es-419", "es"]);
    expect(azureLanguageCandidates("fr-CA")).toEqual(["fr-ca", "fr"]);
    expect(azureLanguageCandidates("de")).toEqual(["de"]);
    // fr-CA falls back to French when the list has no Canadian French.
    expect(resolveAzureLanguage(new Map([["fr", "fr"]]), "fr-CA")).toBe("fr");
    expect(resolveAzureLanguage(new Map([["fr-ca", "FR-CA"]]), "fr-ca")).toBe("FR-CA");
    expect(resolveAzureLanguage(codes, "ga")).toBeNull();
    // No fallback from Portugal to Azure's Brazilian "pt".
    expect(resolveAzureLanguage(new Map([["pt", "pt"]]), "pt-PT")).toBeNull();
  });

  it("guesses the table row or the base language, never the full locale", () => {
    expect(azureGuessedCode("en-GB")).toBe("en");
    expect(azureGuessedCode("es-419")).toBe("es");
    expect(azureGuessedCode("zh-TW")).toBe("zh-Hant");
    expect(azureGuessedCode("pt-BR")).toBe("pt");
    expect(azureGuessedCode("fr-CA")).toBe("fr-ca");
  });

  it("sends the guessed codes when the list is unavailable", async () => {
    const sent: string[] = [];
    const { impl } = fakeFetch(
      (call) => {
        sent.push(new URL(call.url).searchParams.get("to")!);
        return echo(call);
      },
      () => new Response(null, { status: 503 }),
    );
    for (const target of ["en-GB", "es-419", "zh-TW"]) await provider(impl).translate(request(["Hallo"], { sourceLocale: "de", targetLocale: target }));
    expect(sent).toEqual(["en", "es", "zh-Hant"]);
  });

  it("answers targetSupport from the list and refuses an unlisted pair without a translate call", async () => {
    const { impl, translateCalls } = fakeFetch();
    const azure = provider(impl);
    expect(await azure.targetSupport(["de", "zh-TW", "ga", "nn"])).toEqual(new Map([["de", true], ["zh-TW", true], ["ga", false], ["nn", true]]));
    await expect(azure.translate(request(["Hello"], { targetLocale: "ga" }))).rejects.toMatchObject({ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" });
    expect(translateCalls()).toHaveLength(0);
  });
});

describe("Azure errors", () => {
  it.each([
    [400, 400003, "invalid", "UNSUPPORTED_LANGUAGE"],
    [400, 400019, "invalid", "UNSUPPORTED_LANGUAGE"],
    [400, 400023, "invalid", "UNSUPPORTED_LANGUAGE"],
    [400, 400035, "invalid", "UNSUPPORTED_LANGUAGE"],
    [400, 400036, "invalid", "UNSUPPORTED_LANGUAGE"],
    [400, 400050, "invalid", "REQUEST_TOO_LARGE"],
    [400, 400072, "invalid", "REQUEST_TOO_LARGE"],
    [400, 400077, "invalid", "REQUEST_TOO_LARGE"],
    [400, 400000, "invalid", undefined],
    [400, undefined, "invalid", undefined],
    [415, 415000, "invalid", undefined],
    [404, undefined, "invalid", undefined],
    [401, 401000, "auth", undefined],
    [401, 401015, "auth", undefined],
    [401, undefined, "auth", undefined],
    [403, 403001, "quota", undefined],
    [403, 403000, "auth", undefined],
    [403, undefined, "auth", undefined],
    [408, 408001, "retryable", undefined],
    [408, 408002, "retryable", undefined],
    [429, 429000, "retryable", "RATE_LIMITED"],
    [429, 429001, "retryable", "RATE_LIMITED"],
    [429, 429002, "retryable", "RATE_LIMITED"],
    [429, undefined, "retryable", "RATE_LIMITED"],
    [500, 500000, "retryable", undefined],
    [502, undefined, "retryable", undefined],
    [503, 503000, "retryable", undefined],
    [504, undefined, "retryable", undefined],
  ] as const)("HTTP %i %s → %s %s", async (status, code, kind, reason) => {
    expect(classifyAzureError(status, code)).toEqual(reason ? { kind, reason } : { kind });
    const { impl, translateCalls } = fakeFetch(azureError(status, code));
    const failure = (await provider(impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one"])).catch((e: unknown) => e)) as TranslationProviderError;
    expect(failure).toBeInstanceOf(TranslationProviderError);
    expect(failure).toMatchObject({ provider: "azure", kind, status });
    expect(failure.reason).toBe(reason);
    expect(failure.message).toBe(`azure ${kind}: HTTP ${status}${code ? ` ${code}` : ""} (request req-1234.abc)`);
    expect(failure.message).not.toContain("SECRET-INPUT");
    expect(translateCalls()).toHaveLength(1);
  });

  it("uses a body code only when its first three digits are the status, and a request id only when it is a plain token", async () => {
    expect(classifyAzureError(400, undefined)).toEqual({ kind: "invalid" });
    const { impl } = fakeFetch(() =>
      Response.json({ error: { code: 403001, message: "x" } }, { status: 400, headers: { "X-RequestId": "has spaces <and> SECRET-INPUT" } }),
    );
    const failure = await provider(impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one"])).catch((e: unknown) => e);
    expect((failure as Error).message).toBe("azure invalid: HTTP 400");
  });

  it("never puts body text in the message, even when the body isn't JSON", async () => {
    const { impl } = fakeFetch(() => new Response("SECRET-INPUT plain text", { status: 500 }));
    const failure = await provider(impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one"])).catch((e: unknown) => e);
    expect((failure as Error).message).toBe("azure retryable: HTTP 500");
  });

  it("honours Retry-After as seconds or as an HTTP date", async () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const delays: number[] = [];
    const answers = [
      azureError(429, 429001, { "Retry-After": "2" })(),
      azureError(503, 503000, { "Retry-After": "Sun, 01 Nov 2026 12:00:05 GMT" })(),
    ];
    const { impl } = fakeFetch((call) => answers.shift() ?? echo(call));
    const azure = provider(impl, { now: () => now, retry: { sleep: async (ms) => void delays.push(ms) } });
    expect((await azure.translate(request(["one"]))).translations).toEqual(["DE one"]);
    expect(delays).toEqual([2000, 5000]);
  });

  it("retries server errors, then fails with what earlier batches counted", async () => {
    let calls = 0;
    const { impl, translateCalls } = fakeFetch((call) => (++calls === 1 ? echo(call) : azureError(503, 503000)()));
    const segments = Array.from({ length: 101 }, (_, i) => `t${i}`);
    const failure = (await provider(impl).translate(request(segments)).catch((e: unknown) => e)) as TranslationProviderError;
    expect(failure).toMatchObject({ kind: "retryable", status: 503 });
    expect(failure.billedCharacters).toBe(segments.slice(0, 100).join("").length);
    // One answered batch, then the second one tried 1 + 3 times.
    expect(translateCalls()).toHaveLength(5);
  });

  it("treats a wrong number of results or a result without text as a malformed (retryable) response", async () => {
    for (const body of [[], [{ translations: [] }], [{ translations: [{ to: "de" }] }], { error: "x" }]) {
      const { impl } = fakeFetch(() => Response.json(body));
      await expect(provider(impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one"]))).rejects.toMatchObject({
        kind: "retryable",
        message: "azure retryable: malformed response",
      });
    }
  });
});

describe("Azure stop and timeout", () => {
  it("rethrows the caller's abort before a call, without any request", async () => {
    const { impl, calls } = fakeFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(provider(impl).translate(request(["one"]), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });

  it("rethrows the caller's abort during a call and doesn't retry", async () => {
    const controller = new AbortController();
    const { impl, translateCalls } = fakeFetch(
      (_call, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason));
          controller.abort();
        }),
    );
    await expect(provider(impl).translate(request(["one"]), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(translateCalls()).toHaveLength(1);
  });

  it("turns its own timeout into a retryable network error", async () => {
    const { impl, translateCalls } = fakeFetch(
      (_call, signal) => new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason))),
    );
    const failure = await provider(impl, { timeoutMs: 5, retry: { ...noSleep, retries: 1 } }).translate(request(["one"])).catch((e: unknown) => e);
    expect(failure).toMatchObject({ provider: "azure", kind: "retryable", message: "azure retryable: network error: TimeoutError" });
    expect(translateCalls()).toHaveLength(2);
  });
});

describe("Azure billing, dropped options and notes", () => {
  it("counts the text without inline codes and reports formality and context as not applied", async () => {
    const { impl } = fakeFetch();
    const result = await provider(impl).translate(request([SOURCE], { formality: "more", context: "Product: Jacket" }));
    expect(result.billedCharacters).toBe("Buy two and save ".length);
    expect(result.dropped).toEqual(["formality", "context"]);
    const plainOnly = await provider(impl).translate(request([SOURCE], { formality: "less" }));
    expect(plainOnly.dropped).toEqual(["formality"]);
    expect(provider(impl).capabilities).toEqual({ formality: false, context: false });
  });

  it("refuses a segment whose markup can't be mapped and flags glued words, keeping the others", async () => {
    const outputs = ['Kaufe <b>zwei</b> und spare <img id="lx2"/>', 'Kaufe<span id="lg1">zwei</span>jetzt', "Hallo"];
    const { impl } = fakeFetch((call) => Response.json((call.body as unknown[]).map((_, i) => ({ translations: [{ text: outputs.shift() ?? `x${i}`, to: "de" }] }))));
    const result = await provider(impl).translate(request([SOURCE, 'Buy <g id="1">two</g> now', "Hello"]));
    expect(result.translations).toEqual([UNMAPPABLE_SEGMENT, 'Kaufe<g id="1">zwei</g>jetzt', "Hallo"]);
    expect(result.notes).toEqual([
      { index: 0, code: "ENGINE_MARKUP" },
      { index: 1, code: "SPACING_CHANGED" },
    ]);
  });

  it("remembers a failed list read for 5 minutes and asks again after that", async () => {
    let now = 5_000_000;
    let languageCalls = 0;
    const { impl, translateCalls } = fakeFetch(echo, () => {
      languageCalls++;
      return new Response("down", { status: 503 });
    });
    const azure = provider(impl, { now: () => now });
    await azure.translate(request(["one"]));
    await azure.translate(request(["two"]));
    await expect(azure.targetSupport(["de"])).rejects.toMatchObject({ kind: "retryable" });
    expect(languageCalls).toBe(1);
    expect(translateCalls()).toHaveLength(2);
    now += 5 * 60 * 1000 + 1;
    await azure.targetSupport(["de"]).catch(() => undefined);
    expect(languageCalls).toBe(2);
  });
});

describe("Azure key check", () => {
  it("makes an empty translate call through the configured endpoint, with the key and region a translation sends", async () => {
    const { impl, calls } = fakeFetch(() => Response.json([{ translations: [{ text: "", to: "de" }] }]));
    expect(await provider(impl).checkKey()).toBe("ok");
    expect(await provider(impl, { endpoint: AZURE_GLOBAL_ENDPOINT, region: undefined }).checkKey()).toBe("ok");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", `${AZURE_EU_ENDPOINT}/translate?api-version=3.0&from=en&to=de&textType=plain`],
      ["POST", `${AZURE_GLOBAL_ENDPOINT}/translate?api-version=3.0&from=en&to=de&textType=plain`],
    ]);
    expect(calls[0]!.headers).toMatchObject({ "Ocp-Apim-Subscription-Key": KEY, "Ocp-Apim-Subscription-Region": "westeurope" });
    expect(calls[1]!.headers).not.toHaveProperty("Ocp-Apim-Subscription-Region");
    // No merchant text: one empty element (metered at 0 characters).
    expect(calls[0]!.body).toEqual([{ text: "" }]);
  });

  it.each([
    [401, { error: { code: 401015, message: "The credentials provided are for the Speech API" } }, "refused"],
    [401, { error: { code: 401000 } }, "refused"],
    [403, { error: { code: 403000 } }, "refused"],
    [403, null, "refused"],
    // The free tier's characters are used up: the key itself is valid.
    [403, { error: { code: 403001 } }, "ok"],
    [400, { error: { code: 400000 } }, "ok"],
    [500, null, "unreachable"],
    [404, null, "unreachable"],
  ] as const)("HTTP %i %j → %s", async (status, body, outcome) => {
    const { impl } = fakeFetch(() => (body ? Response.json(body, { status }) : new Response(null, { status })));
    expect(await provider(impl).checkKey()).toBe(outcome);
  });

  it("is unreachable on a network error", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await provider(impl).checkKey()).toBe("unreachable");
  });
});
