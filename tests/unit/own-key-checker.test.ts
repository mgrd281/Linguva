/**
 * The Own key plan's key check (app/.server/credentials/checker.ts): one free
 * request per engine with the merchant's key, read the way translation reads
 * an answer (a rate limit or a used-up quota is never "refused"), on the
 * engine's own hosts only. Every response comes from a fake fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveKeyChecker, mockKeyChecker } from "../../app/.server/credentials/checker";
import type { EngineKeyInput } from "../../app/.server/credentials/formats";
import { resetConfigCache } from "../../app/.server/lib/config";
import { SecretValue } from "../../app/.server/lib/secret";
import { AzureTranslatorProvider } from "../../app/.server/providers/azure";
import { GoogleTranslateProvider } from "../../app/.server/providers/google";
import { fakeEngineFetch } from "../support/fake-engines";
import { ownAzureKey, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";

type Call = { url: URL; headers: Headers };

/** A fetch that answers every request with `status` and `body`, recording what was sent. */
function answering(status: number, body: unknown = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const deepl = (key: string): EngineKeyInput => ({ engine: "deepl", apiKey: new SecretValue(key) });
const azure = (key: string, location: "eu" | "global" = "eu", region?: string): EngineKeyInput => ({
  engine: "azure",
  apiKey: new SecretValue(key),
  location,
  ...(region ? { region } : {}),
});
const google = (key: string): EngineKeyInput => ({ engine: "google", apiKey: new SecretValue(key) });
const errorInfo = (reason: string) => ({ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetConfigCache();
});

describe("live key check: DeepL", () => {
  it("asks the key's own host (api-free for :fx), never DEEPL_API_URL", async () => {
    vi.stubEnv("DEEPL_API_URL", "https://deepl-proxy.example.com");
    resetConfigCache();
    const free = ownDeepLKey(1);
    const pro = ownDeepLKey(2, false);
    const fake = fakeEngineFetch({ deepl: { [free]: "ok", [pro]: "ok" } });
    const check = liveKeyChecker({ fetch: fake.fetch });
    expect(await check(deepl(free))).toEqual({ state: "ok", deepl: { plan: "free", used: 1_234, limit: 500_000 } });
    expect(await check(deepl(pro))).toMatchObject({ state: "ok", deepl: { plan: "pro" } });
    expect(fake.calls.map((c) => [c.host, c.path, c.authHeader])).toEqual([
      ["api-free.deepl.com", "/v2/usage", `DeepL-Auth-Key ${free}`],
      ["api.deepl.com", "/v2/usage", `DeepL-Auth-Key ${pro}`],
    ]);
  });

  it("reads usage: used up → quota, no limit → limit null", async () => {
    const key = ownDeepLKey(3);
    const at = (count: number, limit: number) => liveKeyChecker({ fetch: fakeEngineFetch({ deepl: { [key]: { usage: { count, limit } } } }).fetch })(deepl(key));
    expect(await at(500_000, 500_000)).toEqual({ state: "quota", deepl: { plan: "free", used: 500_000, limit: 500_000 } });
    expect(await at(600_000, 500_000)).toMatchObject({ state: "quota" });
    expect(await at(499_999, 500_000)).toMatchObject({ state: "ok" });
    expect(await at(9_000_000, 0)).toEqual({ state: "ok", deepl: { plan: "free", used: 9_000_000, limit: null } });
    expect(await at(9_000_000, 1e12)).toEqual({ state: "ok", deepl: { plan: "free", used: 9_000_000, limit: null } });
  });

  it("refused only for 401/403; rate limits, outages and network errors are unreachable", async () => {
    const key = ownDeepLKey(4);
    for (const [status, state] of [
      [401, "refused"],
      [403, "refused"],
      [429, "unreachable"],
      [456, "unreachable"],
      [500, "unreachable"],
      [503, "unreachable"],
    ] as const) {
      expect(await liveKeyChecker({ fetch: answering(status).fetch })(deepl(key)), String(status)).toEqual({ state });
    }
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await liveKeyChecker({ fetch: throwing })(deepl(key))).toEqual({ state: "unreachable" });
    // A 200 that isn't JSON is no answer either.
    const garbage = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    expect(await liveKeyChecker({ fetch: garbage })(deepl(key))).toEqual({ state: "unreachable" });
  });
});

describe("live key check: Microsoft Azure", () => {
  it("uses the endpoint of the chosen data location and sends the region only when given", async () => {
    const key = ownAzureKey(1);
    const fake = fakeEngineFetch({ azure: { [key]: "ok" } });
    const check = liveKeyChecker({ fetch: fake.fetch });
    expect(await check(azure(key, "eu", "westeurope"))).toEqual({ state: "ok" });
    expect(await check(azure(key, "global"))).toEqual({ state: "ok" });
    expect(fake.calls.map((c) => [c.host, c.path, c.authHeader, c.region])).toEqual([
      ["api-eur.cognitive.microsofttranslator.com", "/translate", key, "westeurope"],
      ["api.cognitive.microsofttranslator.com", "/translate", key, null],
    ]);
  });

  it("reads 403001 (free tier used up) as quota; 401 and other 403 refused; 400 ok; outages unreachable", async () => {
    const key = ownAzureKey(2);
    for (const [status, body, state] of [
      [200, [], "ok"],
      [400, { error: { code: 400036 } }, "ok"],
      [403, { error: { code: 403001 } }, "quota"],
      [401, { error: { code: 401000 } }, "refused"],
      [401, { error: { code: 401015 } }, "refused"],
      [403, { error: { code: 403000 } }, "refused"],
      [429, { error: { code: 429000 } }, "unreachable"],
      [500, {}, "unreachable"],
    ] as const) {
      expect(await liveKeyChecker({ fetch: answering(status, body).fetch })(azure(key)), `${status} ${JSON.stringify(body)}`).toEqual({ state });
    }
  });

  it("leaves the operator card's checkKey() as it was: 403001 still counts as accepted there", async () => {
    const operator = new AzureTranslatorProvider({ key: ownAzureKey(3), fetch: answering(403, { error: { code: 403001 } }).fetch });
    expect(await operator.checkKey()).toBe("ok");
  });
});

describe("live key check: Google Cloud", () => {
  it("sends the API key to the v2 host only (no OAuth token call)", async () => {
    const key = ownGoogleKey(1);
    const fake = fakeEngineFetch({ google: { [key]: "ok" } });
    expect(await liveKeyChecker({ fetch: fake.fetch })(google(key))).toEqual({ state: "ok" });
    expect(fake.calls.map((c) => [c.host, c.path, c.authHeader])).toEqual([["translation.googleapis.com", "/language/translate/v2/languages", key]]);
    expect(fake.calls.some((c) => c.host.includes("oauth2"))).toBe(false);
  });

  it("classifies like translation: daily quota → quota, rate limits → unreachable, configuration → refused", async () => {
    const key = ownGoogleKey(2);
    for (const [status, body, state] of [
      [400, { error: { status: "INVALID_ARGUMENT", details: [errorInfo("API_KEY_INVALID")] } }, "refused"],
      [401, { error: { status: "UNAUTHENTICATED" } }, "refused"],
      [403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }, "unreachable"],
      [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "unreachable"],
      [403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }, "quota"],
      [403, { error: { status: "PERMISSION_DENIED", details: [errorInfo("SERVICE_DISABLED")] } }, "refused"],
      [403, { error: { status: "PERMISSION_DENIED", details: [errorInfo("BILLING_DISABLED")] } }, "refused"],
      [404, {}, "refused"],
      [500, {}, "unreachable"],
      [503, {}, "unreachable"],
    ] as const) {
      expect(await liveKeyChecker({ fetch: answering(status, body).fetch })(google(key)), `${status} ${JSON.stringify(body)}`).toEqual({ state });
    }
  });

  it("leaves the operator card's checkCredentials() as it was", async () => {
    const operator = new GoogleTranslateProvider({ auth: { kind: "apiKey", apiKey: ownGoogleKey(3) }, fetch: answering(403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }).fetch });
    expect(await operator.checkCredentials()).toBe("refused");
  });
});

describe("mock key check (staging, development, tests)", () => {
  it("answers from the test key's name without any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("mock mode must not fetch");
    });
    expect(await mockKeyChecker(deepl("mock-deepl-1234:fx"))).toEqual({ state: "ok", deepl: { plan: "free", used: 1_234, limit: 500_000 } });
    expect(await mockKeyChecker(deepl("mock-deepl-1234"))).toEqual({ state: "ok", deepl: { plan: "pro", used: 1_234, limit: 500_000 } });
    expect(await mockKeyChecker(deepl("mock-deepl-quota:fx"))).toEqual({ state: "quota", deepl: { plan: "free", used: 500_000, limit: 500_000 } });
    expect(await mockKeyChecker(deepl("mock-deepl-refused"))).toEqual({ state: "refused" });
    expect(await mockKeyChecker(deepl("mock-deepl-down"))).toEqual({ state: "unreachable" });
    expect(await mockKeyChecker(azure("mock-azure-0062"))).toEqual({ state: "ok" });
    expect(await mockKeyChecker(azure("mock-azure-quota"))).toEqual({ state: "quota" });
    expect(await mockKeyChecker(google("mock-google-refused"))).toEqual({ state: "refused" });
    expect(await mockKeyChecker(google("mock-google-down"))).toEqual({ state: "unreachable" });
    expect(spy).not.toHaveBeenCalled();
  });
});
