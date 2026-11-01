import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearGoogleTokens, GOOGLE_TOKEN_URL, type ServiceAccountCredentials } from "../../app/.server/providers/google-auth";
import {
  classifyGoogleError,
  clearGoogleLanguageCache,
  googleEndpoints,
  googleLanguageCandidates,
  GoogleTranslateProvider,
  googleTranslateRequest,
  resolveGoogleLanguage,
  type GoogleAuth,
  type GoogleOptions,
} from "../../app/.server/providers/google";
import { encodeSegment, UNMAPPABLE_SEGMENT } from "../../app/.server/providers/html-transport";
import { TranslationProviderError, type TranslationRequest } from "../../app/.server/providers/types";
import { assertSameCodes, parseMarkup } from "../../app/.server/translation/segment-markup";

/** Fictional credentials and the only hosts a fake may see in this file. */
const API_KEY = "ui-google-key-0005-fictional0000";
const HOSTS = new Set(["translation.googleapis.com", "translate-eu.googleapis.com", "oauth2.googleapis.com"]);
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CREDENTIALS: ServiceAccountCredentials = {
  projectId: "linguva-fictional-01",
  clientEmail: "translator@linguva-fictional-01.iam.gserviceaccount.com",
  privateKey: PEM,
  privateKeyId: "0123456789abcdef",
};
const V2: GoogleAuth = { kind: "apiKey", apiKey: API_KEY };
const V3: GoogleAuth = { kind: "serviceAccount", credentials: CREDENTIALS };
const V2_URL = "https://translation.googleapis.com/language/translate/v2";
const V3_PARENT = "https://translate-eu.googleapis.com/v3/projects/linguva-fictional-01/locations/europe-west1";
const SOURCE = 'Buy <g id="1">two</g> and save <x id="2"/>';
const LANGUAGES = ["de", "en", "fr", "fr-CA", "ar", "ja", "zh-CN", "zh-TW", "pt-BR", "pt-PT", "no", "he", "fil", "jw", "sr", "sr-Latn", "mni-Mtei", "ku", "ckb", "es"];
const noSleep = { sleep: async () => undefined };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
  raw: RequestInit;
}
type Responder = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>;

const allCalls: Call[] = [];

function languageList(url: string, codes: readonly string[] = LANGUAGES) {
  return url.startsWith(V2_URL)
    ? Response.json({ data: { languages: codes.map((language) => ({ language })) } })
    : Response.json({ languages: codes.map((languageCode) => ({ languageCode, displayName: languageCode, supportSource: true, supportTarget: true })) });
}

/** Echoes every text with a prefix, in the shape of the version called. */
function echo(call: Call) {
  if (call.url === V2_URL) {
    return Response.json({ data: { translations: (call.body!.q as string[]).map((t) => ({ translatedText: `DE ${t}` })) } });
  }
  return Response.json({ translations: (call.body!.contents as string[]).map((t) => ({ translatedText: `DE ${t}` })) });
}

function fakeFetch(translate: Responder = echo, options: { languages?: Responder; token?: Responder } = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  const impl = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined,
      raw: init,
    };
    calls.push(call);
    allCalls.push(call);
    const signal = init.signal ?? undefined;
    if (call.url === GOOGLE_TOKEN_URL) {
      tokens++;
      return options.token ? options.token(call, signal) : Response.json({ access_token: `ya29.fictional-${tokens}`, expires_in: 3600 });
    }
    if (call.url.includes("/languages") || call.url.endsWith("/supportedLanguages")) {
      return options.languages ? options.languages(call, signal) : languageList(call.url);
    }
    return translate(call, signal);
  }) as unknown as typeof fetch;
  const translateCalls = () => calls.filter((c) => c.url === V2_URL || c.url.endsWith(":translateText"));
  const tokenCalls = () => calls.filter((c) => c.url === GOOGLE_TOKEN_URL);
  return { impl, calls, translateCalls, tokenCalls };
}

function provider(auth: GoogleAuth, fetchImpl: typeof fetch, options: Partial<GoogleOptions> = {}) {
  return new GoogleTranslateProvider({ auth, fetch: fetchImpl, retry: noSleep, ...options });
}

const request = (segments: string[], extra: Partial<TranslationRequest> = {}): TranslationRequest => ({
  segments,
  sourceLocale: "en",
  targetLocale: "de",
  ...extra,
});

const googleError = (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}) => () =>
  Response.json({ error: { code: status, message: "Echoes SECRET-INPUT from the request", ...error } }, { status, headers });
const errorInfo = (reason: string) => ({ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" });
/** Service Infrastructure's rate-quota answer: the limit's name is the only sign of a per-day cap. */
const quotaInfo = (quotaLimit: string) => ({
  ...errorInfo("RATE_LIMIT_EXCEEDED"),
  metadata: { quota_limit: quotaLimit, quota_metric: "translate.googleapis.com/default", consumer: "projects/000000000000" },
});

beforeEach(() => {
  clearGoogleLanguageCache();
  clearGoogleTokens();
  allCalls.length = 0;
});

afterEach(() => {
  // Every request of this file went to a fake, and only for Google's documented hosts.
  for (const call of allCalls) expect(HOSTS.has(new URL(call.url).hostname)).toBe(true);
  // The key never travels in a URL (no ?key=).
  for (const call of allCalls) {
    expect(call.url).not.toContain(API_KEY);
    expect(call.url).not.toMatch(/[?&]key=/);
  }
});

describe("Google v2 (API key) request shape", () => {
  it("posts JSON with the key in a header, the source always set, the format by wire mode and NMT", async () => {
    const { impl, calls } = fakeFetch();
    const result = await provider(V2, impl).translate(request([SOURCE, "Blue jacket"]));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", `${V2_URL}/languages?model=nmt`],
      ["POST", V2_URL],
      ["POST", V2_URL],
    ]);
    expect(calls[0]!.headers).toEqual({ "X-goog-api-key": API_KEY });
    expect(calls[1]!.headers).toEqual({ "X-goog-api-key": API_KEY, "Content-Type": "application/json; charset=utf-8" });
    expect(calls[1]!.body).toEqual({ q: ['Buy <span id="lg1">two</span> and save <img id="lx2"/>'], source: "en", target: "de", format: "html", model: "nmt" });
    expect(calls[2]!.body).toEqual({ q: ["Blue jacket"], source: "en", target: "de", format: "text", model: "nmt" });
    expect(result).toEqual({
      translations: ['DE Buy <g id="1">two</g> and save <x id="2"/>', "DE Blue jacket"],
      billedCharacters: "Buy two and save ".length + "Blue jacket".length,
      provider: "google",
    });
  });

  it("sends exactly what googleTranslateRequest builds", async () => {
    const { impl, translateCalls } = fakeFetch();
    await provider(V2, impl).translate(request([SOURCE]));
    const built = googleTranslateRequest(V2, null, [encodeSegment(SOURCE).wire], "html", "en", "de");
    expect(translateCalls()[0]!.url).toBe(built.url);
    expect(translateCalls()[0]!.raw.headers).toEqual(built.init.headers);
    expect(translateCalls()[0]!.raw.body).toBe(built.init.body);
  });
});

describe("Google v3 (service account) request shape", () => {
  it("gets a token, then uses the EU endpoint and europe-west1 with a Bearer header and no model", async () => {
    const { impl, calls } = fakeFetch();
    const result = await provider(V3, impl).translate(request([SOURCE, "Blue jacket"]));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", GOOGLE_TOKEN_URL],
      ["GET", `${V3_PARENT}/supportedLanguages`],
      ["POST", `${V3_PARENT}:translateText`],
      ["POST", `${V3_PARENT}:translateText`],
    ]);
    expect(calls[1]!.headers).toEqual({ Authorization: "Bearer ya29.fictional-1" });
    expect(calls[2]!.headers).toEqual({ Authorization: "Bearer ya29.fictional-1", "Content-Type": "application/json; charset=utf-8" });
    expect(calls[2]!.body).toEqual({
      contents: ['Buy <span id="lg1">two</span> and save <img id="lx2"/>'],
      mimeType: "text/html",
      sourceLanguageCode: "en",
      targetLanguageCode: "de",
    });
    expect(calls[3]!.body).toMatchObject({ contents: ["Blue jacket"], mimeType: "text/plain" });
    expect(result.translations).toEqual(['DE Buy <g id="1">two</g> and save <x id="2"/>', "DE Blue jacket"]);
  });

  it("URL-encodes a domain-scoped project id, and keeps keys and tokens out of the cache keys", () => {
    const scoped: GoogleAuth = { kind: "serviceAccount", credentials: { ...CREDENTIALS, projectId: "example.com:proj-123" } };
    expect(googleEndpoints(scoped)).toEqual({
      translate: "https://translate-eu.googleapis.com/v3/projects/example.com%3Aproj-123/locations/europe-west1:translateText",
      languages: "https://translate-eu.googleapis.com/v3/projects/example.com%3Aproj-123/locations/europe-west1/supportedLanguages",
      cacheKey: "google:v3:example.com:proj-123",
    });
    expect(googleEndpoints(V2).cacheKey).toBe("google:v2");
    expect(JSON.stringify(googleEndpoints(V2))).not.toContain(API_KEY);
    expect(() => googleTranslateRequest(V3, null, ["a"], "plain", "en", "de")).toThrow();
  });

  it("shares one language list per endpoint between providers", async () => {
    const { impl, calls } = fakeFetch();
    await provider(V2, impl).targetSupport(["de"]);
    await provider({ kind: "apiKey", apiKey: "other-google-key-0006-fictional" }, impl).targetSupport(["fr"]);
    expect(calls.filter((c) => c.url.includes("/languages"))).toHaveLength(1);
  });

  it("does no network and no signing at construction", () => {
    const { impl, calls } = fakeFetch();
    provider(V3, impl);
    provider(V2, impl);
    expect(calls).toHaveLength(0);
    expect(() => new GoogleTranslateProvider({ auth: { kind: "apiKey", apiKey: "" } })).toThrow();
  });
});

describe("Google batching", () => {
  it("sends at most 100 strings per request and keeps the order across modes", async () => {
    const { impl, translateCalls } = fakeFetch();
    const segments = Array.from({ length: 250 }, (_, i) => (i === 120 ? SOURCE : `text ${i}`));
    const result = await provider(V2, impl).translate(request(segments));
    // Batches go in the order of their first segment: the HTML one (index 120) before the last plain one.
    expect(translateCalls().map((c) => [(c.body!.q as unknown[]).length, c.body!.format])).toEqual([[100, "text"], [100, "text"], [1, "html"], [49, "text"]]);
    expect(result.translations[120]).toBe('DE Buy <g id="1">two</g> and save <x id="2"/>');
    expect(result.translations[249]).toBe("DE text 249");
  });

  it("aims at 5,000 code points per request, counting an emoji once", async () => {
    const { impl, translateCalls } = fakeFetch();
    // 2,500 code points each (5,000 UTF-16 units).
    const emoji = "😀".repeat(2_500);
    await provider(V2, impl).translate(request([emoji, emoji, emoji]));
    expect(translateCalls().map((c) => (c.body!.q as unknown[]).length)).toEqual([2, 1]);
  });

  it("refuses a text over 30,000 code points before any call, and on v2 one over its 100 KB body limit", async () => {
    for (const auth of [V2, V3]) {
      const { impl, calls } = fakeFetch();
      await expect(provider(auth, impl).translate(request(["ok", "x".repeat(30_001)]))).rejects.toMatchObject({ kind: "invalid", reason: "REQUEST_TOO_LARGE" });
      expect(calls).toHaveLength(0);
    }
    // 25,000 code points, 100,000 bytes of JSON.
    const heavy = "😀".repeat(25_000);
    const v2 = fakeFetch();
    await expect(provider(V2, v2.impl).translate(request([heavy]))).rejects.toMatchObject({ reason: "REQUEST_TOO_LARGE" });
    expect(v2.calls).toHaveLength(0);
    const v3 = fakeFetch();
    await provider(V3, v3.impl).translate(request([heavy]));
    expect(v3.translateCalls()).toHaveLength(1);
  });

  it("returns empty segments unchanged without sending them (Google bills an empty query)", async () => {
    const { impl, calls } = fakeFetch();
    expect(await provider(V2, impl).translate(request(["", " "]))).toEqual({ translations: ["", " "], billedCharacters: 0, provider: "google" });
    expect(calls).toHaveLength(0);
  });
});

describe("Google answers", () => {
  it("refuses only the segment whose translatedText is missing", async () => {
    const { impl } = fakeFetch(() => Response.json({ translations: [{ translatedText: "DE eins" }, {}, { translatedText: "DE drei" }] }));
    const result = await provider(V3, impl).translate(request(["one", "two", "three"]));
    expect(result.translations).toEqual(["DE eins", UNMAPPABLE_SEGMENT, "DE drei"]);
    expect(result.notes).toEqual([{ index: 1, code: "ENGINE_MARKUP" }]);
    expect(result.billedCharacters).toBe("onetwothree".length);
  });

  it("treats a wrong number of entries as a malformed (retryable) response", async () => {
    const { impl } = fakeFetch(() => Response.json({ data: { translations: [{ translatedText: "x" }] } }));
    await expect(provider(V2, impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one", "two"]))).rejects.toMatchObject({
      kind: "retryable",
      message: "google retryable: malformed response",
    });
  });

  it("round-trips markup with a right-to-left style and an apostrophe entity", async () => {
    const { impl } = fakeFetch((call) =>
      Response.json({
        data: {
          translations: (call.body!.q as string[]).map(() => ({
            translatedText: 'L&#39;achat <span id="lg1" style=";text-align:right;direction:rtl">اثنين</span> و <img id="lx2" style=";text-align:right;direction:rtl"/>',
          })),
        },
      }),
    );
    const result = await provider(V2, impl).translate(request([SOURCE], { targetLocale: "ar" }));
    expect(result.translations).toEqual(['L\'achat <g id="1">اثنين</g> و <x id="2"/>']);
    assertSameCodes(parseMarkup(result.translations[0]!), new Map([[1, "g"], [2, "x"]]));
    expect(result.notes).toBeUndefined();
  });

  it("reports formality and context as not applied", async () => {
    const { impl } = fakeFetch();
    const google = provider(V2, impl);
    expect((await google.translate(request(["Hello"], { formality: "more", context: "Product: Shoe" }))).dropped).toEqual(["formality", "context"]);
    expect((await google.translate(request(["Hello"]))).dropped).toBeUndefined();
    expect(google.capabilities).toEqual({ formality: false, context: false });
  });
});

describe("Google errors", () => {
  it.each([
    [400, { status: "INVALID_ARGUMENT", details: [errorInfo("API_KEY_INVALID")] }, "auth", undefined, "HTTP 400 INVALID_ARGUMENT API_KEY_INVALID"],
    [400, { errors: [{ reason: "keyInvalid", message: "x" }] }, "auth", undefined, "HTTP 400 keyInvalid"],
    [400, { status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "target", description: "SECRET-INPUT" }] }] }, "invalid", "UNSUPPORTED_LANGUAGE", "HTTP 400 INVALID_ARGUMENT"],
    [400, { status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "sourceLanguageCode" }] }] }, "invalid", "UNSUPPORTED_LANGUAGE", "HTTP 400 INVALID_ARGUMENT"],
    [400, { status: "INVALID_ARGUMENT" }, "invalid", undefined, "HTTP 400 INVALID_ARGUMENT"],
    [400, { status: "FAILED_PRECONDITION" }, "invalid", undefined, "HTTP 400 FAILED_PRECONDITION"],
    [400, { status: "OUT_OF_RANGE" }, "invalid", undefined, "HTTP 400 OUT_OF_RANGE"],
    // v2's invalid-language answer has no structured field: plain invalid.
    [400, { message: "Invalid Value", errors: [{ reason: "invalid", message: "Invalid Value" }] }, "invalid", undefined, "HTTP 400 invalid"],
    [400, { errors: [{ reason: "badRequest" }] }, "invalid", undefined, "HTTP 400 badRequest"],
    [401, { status: "UNAUTHENTICATED", details: [errorInfo("ACCESS_TOKEN_EXPIRED")] }, "auth", undefined, "HTTP 401 UNAUTHENTICATED ACCESS_TOKEN_EXPIRED"],
    [403, { errors: [{ reason: "dailyLimitExceeded" }] }, "quota", undefined, "HTTP 403 dailyLimitExceeded"],
    [403, { errors: [{ reason: "quotaExceeded" }] }, "quota", undefined, "HTTP 403 quotaExceeded"],
    [403, { status: "PERMISSION_DENIED", details: [errorInfo("RESOURCE_QUOTA_EXCEEDED")] }, "quota", undefined, "HTTP 403 PERMISSION_DENIED RESOURCE_QUOTA_EXCEEDED"],
    [403, { errors: [{ reason: "rateLimitExceeded" }] }, "retryable", "RATE_LIMITED", "HTTP 403 rateLimitExceeded"],
    [403, { errors: [{ reason: "userRateLimitExceeded" }] }, "retryable", "RATE_LIMITED", "HTTP 403 userRateLimitExceeded"],
    [403, { status: "PERMISSION_DENIED", details: [errorInfo("RATE_LIMIT_EXCEEDED")] }, "retryable", "RATE_LIMITED", "HTTP 403 PERMISSION_DENIED RATE_LIMIT_EXCEEDED"],
    // A daily character cap (reset at midnight Pacific) is a quota, a per-minute one a rate limit.
    [403, { status: "PERMISSION_DENIED", details: [quotaInfo("DefaultPerDayPerProject")] }, "quota", undefined, "HTTP 403 PERMISSION_DENIED DefaultPerDayPerProject"],
    [403, { status: "PERMISSION_DENIED", details: [quotaInfo("DefaultPerMinutePerProject")] }, "retryable", "RATE_LIMITED", "HTTP 403 PERMISSION_DENIED RATE_LIMIT_EXCEEDED"],
    [403, { status: "PERMISSION_DENIED", details: [{ ...errorInfo("RATE_LIMIT_EXCEEDED"), metadata: { quota_limit: "Per/Day secret" } }] }, "retryable", "RATE_LIMITED", "HTTP 403 PERMISSION_DENIED RATE_LIMIT_EXCEEDED"],
    [403, { status: "PERMISSION_DENIED", details: [errorInfo("API_KEY_SERVICE_BLOCKED")] }, "auth", undefined, "HTTP 403 PERMISSION_DENIED API_KEY_SERVICE_BLOCKED"],
    [403, { status: "PERMISSION_DENIED", details: [errorInfo("SERVICE_DISABLED")] }, "auth", "CONFIGURATION", "HTTP 403 PERMISSION_DENIED SERVICE_DISABLED"],
    [403, { status: "PERMISSION_DENIED", details: [errorInfo("BILLING_DISABLED")] }, "auth", "CONFIGURATION", "HTTP 403 PERMISSION_DENIED BILLING_DISABLED"],
    [403, { errors: [{ reason: "accessNotConfigured" }] }, "auth", undefined, "HTTP 403 accessNotConfigured"],
    [403, { status: "PERMISSION_DENIED" }, "auth", undefined, "HTTP 403 PERMISSION_DENIED"],
    [404, { status: "NOT_FOUND" }, "auth", "CONFIGURATION", "HTTP 404 NOT_FOUND"],
    [408, {}, "retryable", undefined, "HTTP 408"],
    [429, { status: "RESOURCE_EXHAUSTED", details: [errorInfo("RESOURCE_QUOTA_EXCEEDED")] }, "quota", undefined, "HTTP 429 RESOURCE_EXHAUSTED RESOURCE_QUOTA_EXCEEDED"],
    [429, { errors: [{ reason: "dailyLimitExceeded" }] }, "quota", undefined, "HTTP 429 dailyLimitExceeded"],
    [429, { status: "RESOURCE_EXHAUSTED", details: [errorInfo("RATE_LIMIT_EXCEEDED")] }, "retryable", "RATE_LIMITED", "HTTP 429 RESOURCE_EXHAUSTED RATE_LIMIT_EXCEEDED"],
    [429, { status: "RESOURCE_EXHAUSTED", details: [quotaInfo("DefaultPerDayPerProject")] }, "quota", undefined, "HTTP 429 RESOURCE_EXHAUSTED DefaultPerDayPerProject"],
    [429, { status: "RESOURCE_EXHAUSTED", details: [quotaInfo("DefaultPerMinutePerProject")] }, "retryable", "RATE_LIMITED", "HTTP 429 RESOURCE_EXHAUSTED RATE_LIMIT_EXCEEDED"],
    [429, { status: "RESOURCE_EXHAUSTED" }, "retryable", "RATE_LIMITED", "HTTP 429 RESOURCE_EXHAUSTED"],
    [500, { status: "INTERNAL" }, "retryable", undefined, "HTTP 500 INTERNAL"],
    [502, {}, "retryable", undefined, "HTTP 502"],
    [503, { status: "UNAVAILABLE" }, "retryable", undefined, "HTTP 503 UNAVAILABLE"],
    [504, { status: "DEADLINE_EXCEEDED" }, "retryable", undefined, "HTTP 504 DEADLINE_EXCEEDED"],
    [409, { status: "ABORTED" }, "invalid", undefined, "HTTP 409 ABORTED"],
  ] as const)("HTTP %i %j → %s %s", async (status, error, kind, reason, detail) => {
    const body = { error: { code: status, message: "SECRET-INPUT", ...error } };
    expect(classifyGoogleError(status, body)).toEqual({ kind, ...(reason ? { reason } : {}), detail });
    const { impl } = fakeFetch(googleError(status, error));
    const failure = (await provider(V2, impl, { retry: { ...noSleep, retries: 0 } }).translate(request(["one"])).catch((e: unknown) => e)) as TranslationProviderError;
    expect(failure).toBeInstanceOf(TranslationProviderError);
    expect(failure).toMatchObject({ provider: "google", kind, status, message: `google ${kind}: ${detail}` });
    expect(failure.reason).toBe(reason);
    expect(failure.message).not.toContain("SECRET-INPUT");
  });

  it("reads only plain tokens from the body, never its message", () => {
    expect(classifyGoogleError(403, { error: { status: "PERMISSION DENIED <b>", details: [errorInfo("has spaces SECRET-INPUT")], message: "SECRET-INPUT" } })).toEqual({ kind: "auth", detail: "HTTP 403" });
    expect(classifyGoogleError(500, null)).toEqual({ kind: "retryable", detail: "HTTP 500" });
    expect(classifyGoogleError(400, "not json")).toEqual({ kind: "invalid", detail: "HTTP 400" });
  });

  it("honours Retry-After on a rate limit", async () => {
    const delays: number[] = [];
    const answers = [googleError(429, { status: "RESOURCE_EXHAUSTED" }, { "Retry-After": "3" })()];
    const { impl } = fakeFetch((call) => answers.shift() ?? echo(call));
    const result = await provider(V2, impl, { retry: { sleep: async (ms) => void delays.push(ms) } }).translate(request(["one"]));
    expect(result.translations).toEqual(["DE one"]);
    expect(delays).toEqual([3000]);
  });

  it("v3: after a 401 drops the token and repeats the call once with a fresh one", async () => {
    let first = true;
    const { impl, tokenCalls, translateCalls } = fakeFetch((call) => {
      if (first) {
        first = false;
        return googleError(401, { status: "UNAUTHENTICATED", details: [errorInfo("ACCESS_TOKEN_EXPIRED")] })();
      }
      return echo(call);
    });
    const result = await provider(V3, impl).translate(request(["one"]));
    expect(result.translations).toEqual(["DE one"]);
    expect(tokenCalls()).toHaveLength(2);
    expect(translateCalls().map((c) => c.headers.Authorization)).toEqual(["Bearer ya29.fictional-1", "Bearer ya29.fictional-2"]);
  });

  it("v3: a second 401 is an auth error", async () => {
    const { impl, tokenCalls, translateCalls } = fakeFetch(googleError(401, { status: "UNAUTHENTICATED" }));
    await expect(provider(V3, impl).translate(request(["one"]))).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(tokenCalls()).toHaveLength(2);
    expect(translateCalls()).toHaveLength(2);
  });

  it("v3: a refused token grant fails the request as auth TOKEN_GRANT", async () => {
    const { impl, translateCalls } = fakeFetch(echo, { token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(provider(V3, impl).translate(request(["one"]))).rejects.toMatchObject({ kind: "auth", reason: "TOKEN_GRANT" });
    expect(translateCalls()).toHaveLength(0);
  });

  it("rethrows the caller's abort without a request", async () => {
    const { impl, calls } = fakeFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(provider(V2, impl).translate(request(["one"]), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
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
    await expect(provider(V2, impl).translate(request(["one"]), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(translateCalls()).toHaveLength(1);
  });
});

describe("Google language codes", () => {
  const codes = new Map(LANGUAGES.map((c) => [c.toLowerCase(), c]));

  it.each([
    ["zh", "zh-CN"],
    ["zh-CN", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-MO", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["pt-BR", "pt-BR"],
    ["pt", "pt-PT"],
    ["pt-PT", "pt-PT"],
    ["no", "no"],
    ["nb", "no"],
    ["nn", "no"],
    ["he", "he"],
    ["iw", "he"],
    ["fil", "fil"],
    ["tl", "fil"],
    ["jv", "jw"],
    ["sr", "sr"],
    ["sr-Cyrl", "sr"],
    ["sr-Latn", "sr-Latn"],
    ["mni", "mni-Mtei"],
    ["ku", "ku"],
    ["ckb", "ckb"],
    ["fr-CA", "fr-CA"],
    ["es-419", "es"],
    ["de", "de"],
  ])("%s → %s", (locale, code) => {
    expect(resolveGoogleLanguage(codes, locale)).toBe(code);
  });

  it("uses whichever alias the live list has, and doesn't fall back where the variant differs", () => {
    expect(resolveGoogleLanguage(new Map([["iw", "iw"]]), "he")).toBe("iw");
    expect(resolveGoogleLanguage(new Map([["tl", "tl"]]), "fil")).toBe("tl");
    expect(resolveGoogleLanguage(new Map([["jv", "jv"]]), "jv")).toBe("jv");
    expect(resolveGoogleLanguage(new Map([["zh", "zh"]]), "zh-CN")).toBe("zh");
    expect(resolveGoogleLanguage(new Map([["pt", "pt"]]), "pt-PT")).toBeNull();
    expect(resolveGoogleLanguage(new Map([["sr", "sr"]]), "sr-Latn")).toBeNull();
    expect(resolveGoogleLanguage(new Map([["fr", "fr"]]), "fr-CA")).toBe("fr");
    expect(googleLanguageCandidates("en-GB")).toEqual(["en-GB", "en"]);
  });

  it("sends the first table code or the base language when the list is unavailable", async () => {
    const sent: string[] = [];
    const { impl } = fakeFetch(
      (call) => {
        sent.push(String(call.body!.target));
        return echo(call);
      },
      { languages: () => new Response(null, { status: 503 }) },
    );
    for (const target of ["zh-TW", "en-GB", "pt", "nb", "jv"]) await provider(V2, impl).translate(request(["Hallo"], { sourceLocale: "de", targetLocale: target }));
    expect(sent).toEqual(["zh-TW", "en", "pt-PT", "no", "jw"]);
  });

  it("v3 reads target support from supportTarget and refuses an unlisted pair without a translate call", async () => {
    const { impl, translateCalls } = fakeFetch(echo, {
      languages: () =>
        Response.json({
          languages: [
            { languageCode: "en", supportSource: true, supportTarget: true },
            { languageCode: "de", supportSource: true, supportTarget: true },
            { languageCode: "la", supportSource: true, supportTarget: false },
          ],
        }),
    });
    const google = provider(V3, impl);
    expect(await google.targetSupport(["de", "la", "ga"])).toEqual(new Map([["de", true], ["la", false], ["ga", false]]));
    await expect(google.translate(request(["Hello"], { targetLocale: "la" }))).rejects.toMatchObject({ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" });
    expect(translateCalls()).toHaveLength(0);
  });
});

describe("Google credential check", () => {
  it.each([
    [200, "ok"],
    [400, "refused"],
    [403, "refused"],
    [500, "unreachable"],
  ] as const)("v2 languages HTTP %i → %s", async (status, outcome) => {
    const { impl, calls } = fakeFetch(echo, {
      languages: (call) => (status === 200 ? languageList(call.url) : googleError(status, { status: "INVALID_ARGUMENT", details: [errorInfo("API_KEY_INVALID")] })()),
    });
    expect(await provider(V2, impl).checkCredentials()).toBe(outcome);
    expect(calls.map((c) => [c.url, c.headers])).toEqual([[`${V2_URL}/languages?model=nmt`, { "X-goog-api-key": API_KEY }]]);
  });

  it("v3: token and supportedLanguages; a refused grant is refused, an unreachable one unreachable", async () => {
    const ok = fakeFetch();
    expect(await provider(V3, ok.impl).checkCredentials()).toBe("ok");
    expect(ok.calls.map((c) => c.url)).toEqual([GOOGLE_TOKEN_URL, `${V3_PARENT}/supportedLanguages`]);
    clearGoogleTokens();
    const denied = fakeFetch(echo, { languages: googleError(403, { status: "PERMISSION_DENIED" }) });
    expect(await provider(V3, denied.impl).checkCredentials()).toBe("refused");
    clearGoogleTokens();
    const grant = fakeFetch(echo, { token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    expect(await provider(V3, grant.impl).checkCredentials()).toBe("refused");
    clearGoogleTokens();
    const down = fakeFetch(echo, { token: () => new Response(null, { status: 503 }) });
    expect(await provider(V3, down.impl).checkCredentials()).toBe("unreachable");
  });
});
