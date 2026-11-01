/**
 * The engine router (app/.server/providers/engine-router.ts): consent first,
 * one allowed engine is exactly that engine's call, failover on quota, auth,
 * outages, unsupported languages and too large segments, never on rate
 * limits, rests shared across instances, and one error with every engine's
 * partial bill on total failure. Fake engines only: no network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { classifyError } from "../../app/.server/jobs/errors";
import { DeepLProvider } from "../../app/.server/providers/deepl";
import { clearDeepLKeyPauses, DeepLKeyPool } from "../../app/.server/providers/deepl-pool";
import { plannedEngine } from "../../app/.server/providers/index";
import {
  AUTH_REST_MS,
  clearEngineRests,
  EngineRouter,
  engineRest,
  engineStateSizes,
  isEngineRouter,
  LANGUAGE_REFUSAL_MS,
  LIST_FAILURE_MS,
  MAX_OUTAGE_REST_MS,
  MAX_OWN_STATE,
  OUTAGE_REST_MS,
  QUOTA_REST_MS,
  TOKEN_GRANT_REST_MS,
  type RoutedEngine,
} from "../../app/.server/providers/engine-router";
import {
  TranslationProviderError,
  type EngineCapabilities,
  type ProviderErrorReason,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "../../app/.server/providers/types";
import type { EngineId } from "../../app/lib/engines";

type Step = "ok" | { kind: TranslationProviderError["kind"]; reason?: ProviderErrorReason; status?: number; retryAfterMs?: number; billed?: number } | Error;

/** A fake engine: answers in turn from `steps` (the last repeats), logs every call and its arguments. */
class FakeEngine implements TranslationProvider {
  readonly calls: Array<{ request: TranslationRequest; signal: AbortSignal | undefined }> = [];
  supportCalls = 0;
  constructor(
    readonly id: EngineId,
    private readonly steps: Step[] = ["ok"],
    private readonly languages: readonly string[] | "fail" | null = null,
    readonly capabilities?: EngineCapabilities,
  ) {}

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    this.calls.push({ request, signal });
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)]!;
    if (step instanceof Error) throw step;
    if (step !== "ok") {
      const error = new TranslationProviderError(this.id, step.kind, "fake", step.status, step.retryAfterMs);
      if (step.reason) error.reason = step.reason;
      if (step.billed) error.billedCharacters = step.billed;
      throw error;
    }
    return { translations: request.segments.map((s) => `${this.id}:${s}`), billedCharacters: request.segments.join("").length, provider: this.id };
  }

  async targetSupport(locales: readonly string[]): Promise<Map<string, boolean>> {
    this.supportCalls++;
    if (this.languages === "fail") throw new TranslationProviderError(this.id, "retryable", "list down");
    const listed = this.languages;
    return new Map(locales.map((l) => [l, listed === null || listed.includes(l)]));
  }
}

const ALL = ["deepl", "azure", "google"];
const request = (extra: Partial<TranslationRequest> = {}): TranslationRequest => ({ segments: ["Hello", "World"], sourceLocale: "en", targetLocale: "de", engines: ALL, ...extra });
const router = (members: FakeEngine[], now = () => 1_000_000) => new EngineRouter(members.map((m): RoutedEngine => ({ id: m.id, provider: m })), { now });
const caught = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as TranslationProviderError;
  }
  throw new Error("expected a failure");
};

beforeEach(() => {
  clearEngineRests();
  clearDeepLKeyPauses();
});

describe("construction", () => {
  it("needs two distinct engines with DeepL first, and names itself after the first", () => {
    expect(() => router([new FakeEngine("deepl")])).toThrow(/two/);
    expect(() => router([new FakeEngine("deepl"), new FakeEngine("deepl")])).toThrow(/once/);
    expect(() => router([new FakeEngine("azure"), new FakeEngine("deepl")])).toThrow(/DeepL/);
    const r = router([new FakeEngine("deepl"), new FakeEngine("azure"), new FakeEngine("google")]);
    expect(r.id).toBe("deepl");
    expect(r.label).toBe("deepl+azure+google");
    expect(r.engines).toEqual(["deepl", "azure", "google"]);
    expect(isEngineRouter(r)).toBe(true);
    expect(isEngineRouter(new FakeEngine("deepl"))).toBe(false);
    expect(isEngineRouter(null)).toBe(false);
  });

  it("reports what each engine applies; DeepL declares nothing and applies everything", () => {
    const r = router([new FakeEngine("deepl"), new FakeEngine("azure", ["ok"], null, { formality: false, context: false })]);
    expect(r.capabilitiesOf("deepl")).toEqual({ formality: true, context: true });
    expect(r.capabilitiesOf("azure")).toEqual({ formality: false, context: false });
  });
});

describe("consent", () => {
  it("calls no engine without a list or with an empty one (fail closed)", async () => {
    const deepl = new FakeEngine("deepl");
    const azure = new FakeEngine("azure");
    for (const engines of [undefined, []]) {
      const error = await caught(router([deepl, azure]).translate(request({ engines })));
      expect(error).toBeInstanceOf(TranslationProviderError);
      expect(error.provider).toBe("router");
      expect(error.kind).toBe("invalid");
      expect(error.reason).toBe("CONFIGURATION");
    }
    expect(deepl.calls).toHaveLength(0);
    expect(azure.calls).toHaveLength(0);
    expect(deepl.supportCalls + azure.supportCalls).toBe(0);
  });

  it("uses only the engines the request allows", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }]);
    const azure = new FakeEngine("azure");
    const google = new FakeEngine("google");
    const result = await router([deepl, azure, google]).translate(request({ engines: ["deepl", "google"] }));
    expect(result.provider).toBe("google");
    expect(azure.calls).toHaveLength(0);
  });

  it("passes a single allowed engine's call straight through: same request object, no signal, no pre-check, error unwrapped, no rest", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", status: 456 }]);
    const azure = new FakeEngine("azure");
    const r = router([deepl, azure]);
    const req = request({ engines: ["deepl"] });
    const signal = new AbortController().signal;
    const error = await caught(r.translate(req, signal));
    expect(error.provider).toBe("deepl");
    expect(error.status).toBe(456);
    expect(deepl.calls).toHaveLength(1);
    expect(deepl.calls[0]!.request).toBe(req);
    expect(deepl.calls[0]!.signal).toBeUndefined();
    expect(deepl.supportCalls).toBe(0);
    expect(azure.calls).toHaveLength(0);
    expect(engineRest("deepl")).toBeNull();
  });

  it("makes the same DeepL calls as a bare key pool for a DeepL-only consent", async () => {
    const log = (calls: string[]) =>
      (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url} ${String(init?.body ?? "")}`);
        if (url.endsWith("/v2/translate")) {
          const body = JSON.parse(String(init!.body)) as { text: string[] };
          return Response.json({ translations: body.text.map((t) => ({ text: `DE:${t}`, billed_characters: t.length })) });
        }
        return Response.json([{ language: "DE" }]);
      }) as unknown as typeof fetch;
    const bareCalls: string[] = [];
    const routedCalls: string[] = [];
    const options = { baseUrl: "https://deepl.test", retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1 } };
    const bare = new DeepLKeyPool(["fictional-key-1", "fictional-key-2"], { ...options, fetch: log(bareCalls) });
    const member = new DeepLKeyPool(["fictional-key-1", "fictional-key-2"], { ...options, fetch: log(routedCalls) });
    const r = new EngineRouter([{ id: "deepl", provider: member }, { id: "azure", provider: new FakeEngine("azure") }]);
    const req = { segments: ["Hello"], sourceLocale: "en", targetLocale: "de", formality: "less" as const, context: "Store" };
    const a = await bare.translate(req);
    const b = await r.translate({ ...req, engines: ["deepl"] });
    expect(routedCalls).toEqual(bareCalls);
    expect(b).toEqual(a);
  });
});

describe("routing", () => {
  it("sends a language only one engine offers to that engine", async () => {
    const deepl = new FakeEngine("deepl", ["ok"], ["de", "fr"]);
    const azure = new FakeEngine("azure", ["ok"], ["de", "th"]);
    const result = await router([deepl, azure]).translate(request({ targetLocale: "th" }));
    expect(result.provider).toBe("azure");
    expect(deepl.calls).toHaveLength(0);
  });

  it("translates the whole request with one engine and asks later engines' lists only when needed", async () => {
    const deepl = new FakeEngine("deepl");
    const google = new FakeEngine("google");
    const result = await router([deepl, google]).translate(request());
    expect(result).toEqual({ translations: ["deepl:Hello", "deepl:World"], billedCharacters: 10, provider: "deepl" });
    expect(google.supportCalls).toBe(0);
  });

  it("fails over on DeepL's quota: Azure answers, DeepL rests an hour, only Azure's count is charged", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", status: 456, billed: 3 }]);
    const azure = new FakeEngine("azure");
    const req = request();
    const result = await router([deepl, azure]).translate(req);
    expect(result.provider).toBe("azure");
    expect(result.billedCharacters).toBe(10);
    expect(result.lostByEngine).toEqual({ deepl: 3 });
    // The next engine gets the whole request again, the same object.
    expect(azure.calls[0]!.request).toBe(req);
    expect(azure.calls[0]!.signal).toBeUndefined();
    expect(engineRest("deepl", 1_000_000)).toEqual({ kind: "quota", until: 1_000_000 + QUOTA_REST_MS });
  });

  it("rests a refused engine 6 hours, and 1 hour when Google's token grant was refused", async () => {
    await router([new FakeEngine("deepl", [{ kind: "auth", status: 403 }]), new FakeEngine("azure")]).translate(request());
    expect(engineRest("deepl", 1_000_000)?.until).toBe(1_000_000 + AUTH_REST_MS);
    // Azure doesn't offer the language: Google is asked, and its token grant is refused.
    await router([new FakeEngine("azure", ["ok"], ["fr"]), new FakeEngine("google", [{ kind: "auth", reason: "TOKEN_GRANT" }])])
      .translate(request())
      .catch(() => undefined);
    expect(engineRest("google", 1_000_000)?.until).toBe(1_000_000 + TOKEN_GRANT_REST_MS);
  });

  it("treats an outage as a reason to switch, resting 2 minutes doubling to 15, reset by a success", async () => {
    let now = 1_000_000;
    const clock = () => now;
    const deepl = new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]);
    const azure = new FakeEngine("azure");
    const r = router([deepl, azure], clock);
    const rests: number[] = [];
    for (let i = 0; i < 5; i++) {
      await r.translate(request());
      rests.push(engineRest("deepl", now)!.until - now);
      now = engineRest("deepl", now)!.until + 1;
    }
    expect(rests).toEqual([OUTAGE_REST_MS, OUTAGE_REST_MS * 2, OUTAGE_REST_MS * 4, MAX_OUTAGE_REST_MS, MAX_OUTAGE_REST_MS]);
    // A success clears the count: the next outage rests 2 minutes again.
    const healthy = new FakeEngine("deepl", ["ok", { kind: "retryable" }]);
    const r2 = router([healthy, azure], clock);
    await r2.translate(request());
    await r2.translate(request());
    expect(engineRest("deepl", now)!.until - now).toBe(OUTAGE_REST_MS);
  });

  it("counts failures of requests already in flight as one outage: 2 minutes, not 15", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]);
    const azure = new FakeEngine("azure");
    const r = router([deepl, azure]);
    // WORKER_CONCURRENCY=5: five items in flight during one short DeepL blip.
    const results = await Promise.all(Array.from({ length: 5 }, () => r.translate(request())));
    expect(results.map((x) => x.provider)).toEqual(["azure", "azure", "azure", "azure", "azure"]);
    expect(deepl.calls).toHaveLength(5);
    expect(engineRest("deepl", 1_000_000)!.until - 1_000_000).toBe(OUTAGE_REST_MS);
    // The next outage after this rest ended is the second one in a row: 4 minutes.
    const later = 1_000_000 + OUTAGE_REST_MS + 1;
    await router([deepl, azure], () => later).translate(request());
    expect(engineRest("deepl", later)!.until - later).toBe(OUTAGE_REST_MS * 2);
  });

  it("keeps an outage rest that another request set while a slower DeepL call was still running", async () => {
    let now = 1_000_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    let waited = false;
    const deepl = new (class extends FakeEngine {
      override async translate(req: TranslationRequest, signal?: AbortSignal) {
        if (!waited) {
          waited = true;
          entered();
          await gate;
        }
        return super.translate(req, signal);
      }
    })("deepl", [{ kind: "retryable", status: 503 }, "ok"]);
    const azure = new FakeEngine("azure");
    const r = router([deepl, azure], () => now);
    // A starts first and waits inside DeepL; B starts a second later and hits the outage.
    const slow = r.translate(request());
    await inside;
    now += 1_000;
    expect((await r.translate(request())).provider).toBe("azure");
    const rest = engineRest("deepl", now);
    expect(rest?.kind).toBe("outage");
    // A's late answer is older than B's outage: the breaker stays open.
    now += 1_000;
    release();
    expect((await slow).provider).toBe("deepl");
    expect(engineRest("deepl", now)).toEqual(rest);
  });

  for (const kind of ["quota", "auth"] as const) {
    it(`clears a ${kind} rest when the engine answers in pass 2, so the next request goes to DeepL again`, async () => {
      let now = 1_000_000;
      const deepl = new FakeEngine("deepl", [{ kind }, "ok"]);
      const azure = new FakeEngine("azure", [{ kind: "retryable", status: 503 }, "ok"]);
      const r = router([deepl, azure], () => now);
      await caught(r.translate(request()));
      expect(engineRest("deepl", now)?.kind).toBe(kind);
      // Azure rests for its outage, DeepL for its limit: pass 2 finds DeepL's limit lifted.
      now += 60_000;
      expect((await r.translate(request())).provider).toBe("deepl");
      expect(engineRest("deepl", now)).toBeNull();
      // After Azure's rest: DeepL first again, Azure not asked.
      now += 60_001;
      const azureCalls = azure.calls.length;
      expect((await r.translate(request())).provider).toBe("deepl");
      expect(azure.calls).toHaveLength(azureCalls);
    });
  }

  it("honours a Retry-After longer than the outage rest", async () => {
    await router([new FakeEngine("deepl", [{ kind: "retryable", status: 503, retryAfterMs: 10 * 60 * 1000 }]), new FakeEngine("azure")]).translate(request());
    expect(engineRest("deepl", 1_000_000)!.until).toBe(1_000_000 + 10 * 60 * 1000);
  });

  it("skips a resting engine in the next request (rests are shared by every router in the process)", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }, "ok"]);
    await router([deepl, new FakeEngine("azure")]).translate(request());
    const again = new FakeEngine("deepl");
    const azure = new FakeEngine("azure");
    const result = await router([again, azure]).translate(request());
    expect(result.provider).toBe("azure");
    expect(again.calls).toHaveLength(0);
  });
});

describe("rate limits never switch engines", () => {
  const cases: Array<[string, () => [FakeEngine, FakeEngine]]> = [
    ["DeepL 429", () => [new FakeEngine("deepl", [{ kind: "retryable", status: 429, retryAfterMs: 2_000 }]), new FakeEngine("azure")]],
    ["DeepL 529", () => [new FakeEngine("deepl", [{ kind: "retryable", status: 529 }]), new FakeEngine("azure")]],
    ["Azure 429", () => [new FakeEngine("azure", [{ kind: "retryable", status: 429, reason: "RATE_LIMITED" }]), new FakeEngine("google")]],
    ["Google 403 rate limit", () => [new FakeEngine("google", [{ kind: "retryable", status: 403, reason: "RATE_LIMITED" }]), new FakeEngine("azure")]],
  ];
  for (const [name, make] of cases) {
    it(`${name}: rethrown, the next engine not called, no rest`, async () => {
      const [first, next] = make();
      const error = await caught(router([first, next]).translate(request()));
      expect(error.provider).toBe(first.id);
      expect(next.calls).toHaveLength(0);
      expect(engineRest(first.id)).toBeNull();
      expect(classifyError(error).kind).toMatch(/^(retryable|rate-limited)$/);
    });
  }

  it("Google's quota answered with HTTP 429 is a quota, not a rate limit: Google rests an hour and Azure answers", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", status: 456 }]);
    const google = new FakeEngine("google", [{ kind: "quota", status: 429 }]);
    const azure = new FakeEngine("azure");
    // TRANSLATION_ENGINES=deepl,google,azure
    const result = await router([deepl, google, azure]).translate(request());
    expect(result.provider).toBe("azure");
    expect(azure.calls).toHaveLength(1);
    expect(engineRest("google", 1_000_000)).toEqual({ kind: "quota", until: 1_000_000 + QUOTA_REST_MS });
  });

  it("Google's HTTP 429 quota doesn't stop the job while DeepL is only down", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]);
    const azure = new FakeEngine("azure", [{ kind: "quota", status: 403 }]);
    const google = new FakeEngine("google", [{ kind: "quota", status: 429 }]);
    const error = await caught(router([deepl, azure, google]).translate(request()));
    expect(error.kind).toBe("retryable");
    expect(error.provider).toBe("deepl");
    expect(classifyError(error)).toEqual({ kind: "retryable", code: "PROVIDER_UNAVAILABLE" });
    expect(google.calls).toHaveLength(1);
  });

  it("keeps earlier engines' partial bills on the rethrown rate limit", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", billed: 4 }]);
    const azure = new FakeEngine("azure", [{ kind: "retryable", status: 429, reason: "RATE_LIMITED", billed: 2 }]);
    const google = new FakeEngine("google");
    const error = await caught(router([deepl, azure, google]).translate(request()));
    expect(error.provider).toBe("azure");
    expect(error.billedCharacters).toBe(6);
    expect(error.billedByEngine).toEqual({ deepl: 4, azure: 2 });
    expect(google.calls).toHaveLength(0);
  });
});

describe("invalid requests and languages", () => {
  it("doesn't switch on invalid input when the engine lists the language", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "invalid", status: 400 }], ["de"]);
    const azure = new FakeEngine("azure");
    const error = await caught(router([deepl, azure]).translate(request()));
    expect(error.provider).toBe("deepl");
    expect(azure.calls).toHaveLength(0);
  });

  it("switches on an unsupported language the list claimed, and refuses that pair on that engine for a day", async () => {
    let now = 1_000_000;
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" }, "ok"], ["de"]);
    const google = new FakeEngine("google");
    const r = router([azure, google], () => now);
    expect((await r.translate(request())).provider).toBe("google");
    expect((await r.translate(request())).provider).toBe("google");
    expect(azure.calls).toHaveLength(1);
    // Another source for the same target is still tried.
    await r.translate(request({ sourceLocale: "fr" }));
    expect(azure.calls).toHaveLength(2);
    // After a day, the pair is tried again.
    now += LANGUAGE_REFUSAL_MS + 1;
    await r.translate(request());
    expect(azure.calls).toHaveLength(3);
  });

  it("fails over when DeepL refuses the shop's source language (its source list is shorter), and refuses that pair on DeepL", async () => {
    // The real adapter: DeepL lists German as a target, then answers 400 for source_lang "HR".
    const translateCalls: string[] = [];
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/v2/languages?type=target")) return Response.json([{ language: "DE" }, { language: "FR" }]);
      translateCalls.push(url);
      return Response.json({ message: "Value for 'source_lang' not supported." }, { status: 400 });
    }) as unknown as typeof fetch;
    const deepl = new DeepLProvider({ apiKey: "fictional:fx", baseUrl: "https://deepl-source.example", fetch: fetchImpl, retry: { sleep: async () => undefined } });
    const azure = new FakeEngine("azure");
    const r = new EngineRouter([{ id: "deepl", provider: deepl }, { id: "azure", provider: azure }], { now: () => 1_000_000 });
    const result = await r.translate(request({ sourceLocale: "hr" }));
    expect(result.provider).toBe("azure");
    expect(translateCalls).toHaveLength(1);
    // Not asked again for that pair; from English, DeepL is still first.
    expect((await r.translate(request({ sourceLocale: "hr" }))).provider).toBe("azure");
    expect(translateCalls).toHaveLength(1);
    expect((await r.plan(["de"], ["deepl", "azure"], "hr")).get("de")?.next).toBe("azure");
    expect((await r.plan(["de"], ["deepl", "azure"], "en")).get("de")?.next).toBe("deepl");
  });

  it("switches without a refusal when the list couldn't be read (the adapter guessed the code)", async () => {
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" }], "fail");
    const google = new FakeEngine("google");
    const r = router([azure, google]);
    expect((await r.translate(request())).provider).toBe("google");
    await r.translate(request());
    expect(azure.calls).toHaveLength(2);
  });

  it("switches on a plain invalid when the list couldn't be read (Google v2's unstructured invalid language)", async () => {
    const first = new FakeEngine("azure", [{ kind: "invalid", status: 400 }], "fail");
    expect((await router([first, new FakeEngine("google")]).translate(request())).provider).toBe("google");
  });

  it("switches on a segment too large for an engine, without a refusal or rest", async () => {
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }]);
    const google = new FakeEngine("google");
    const r = router([azure, google]);
    expect((await r.translate(request())).provider).toBe("google");
    expect(engineRest("azure")).toBeNull();
    await r.translate(request());
    expect(azure.calls).toHaveLength(2);
  });

  it("fails without any call when no allowed engine offers the language", async () => {
    const deepl = new FakeEngine("deepl", ["ok"], ["fr"]);
    const azure = new FakeEngine("azure", ["ok"], ["fr"]);
    const error = await caught(router([deepl, azure]).translate(request()));
    expect(error.provider).toBe("router");
    expect(error.reason).toBe("UNSUPPORTED_LANGUAGE");
    expect(deepl.calls.length + azure.calls.length).toBe(0);
    expect(classifyError(error)).toMatchObject({ kind: "item-permanent", code: "PROVIDER_REJECTED" });
  });
});

describe("total failure", () => {
  it("prefers a retryable error, so a job waits while any engine is only down", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", billed: 5 }]);
    const azure = new FakeEngine("azure", [{ kind: "retryable", status: 503, billed: 2 }]);
    const google = new FakeEngine("google", [{ kind: "auth", status: 403 }]);
    const error = await caught(router([deepl, azure, google]).translate(request()));
    expect(error.provider).toBe("azure");
    expect(error.billedCharacters).toBe(7);
    expect(error.billedByEngine).toEqual({ deepl: 5, azure: 2 });
  });

  it("stops with quota (PROVIDER_QUOTA) only when every engine refused", async () => {
    const error = await caught(router([new FakeEngine("deepl", [{ kind: "auth" }]), new FakeEngine("azure", [{ kind: "quota" }])]).translate(request()));
    expect(error.kind).toBe("quota");
    expect(classifyError(error)).toMatchObject({ kind: "job-stop", code: "PROVIDER_QUOTA" });
  });

  it("DeepL resting for an outage, Azure used up, Google without the language: waits for DeepL's rest", async () => {
    let now = 1_000_000;
    // DeepL fails once: an outage rest of 2 minutes.
    await router([new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]), new FakeEngine("azure")], () => now).translate(request());
    now += 30_000;
    const deepl = new FakeEngine("deepl");
    const azure = new FakeEngine("azure", [{ kind: "quota" }]);
    const google = new FakeEngine("google", ["ok"], ["fr"]);
    const error = await caught(router([deepl, azure, google], () => now).translate(request()));
    expect(deepl.calls).toHaveLength(0);
    expect(error.provider).toBe("router");
    expect(error.kind).toBe("retryable");
    expect(error.retryAfterMs).toBe(OUTAGE_REST_MS - 30_000);
    expect(classifyError(error)).toMatchObject({ kind: "rate-limited" });
  });

  it("spends an attempt when the engine it tried is down too, even while another one rests for an outage", async () => {
    let now = 1_000_000;
    const t0 = now;
    // DeepL down first (rests until t0 + 2 min), then Azure a minute later (rests until t0 + 3 min).
    await router([new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]), new FakeEngine("azure")], () => now).translate(request());
    now = t0 + 60_000;
    await caught(router([new FakeEngine("deepl"), new FakeEngine("azure", [{ kind: "retryable", status: 503 }])], () => now).translate(request()));
    expect(engineRest("deepl", now)?.until).toBe(t0 + OUTAGE_REST_MS);
    expect(engineRest("azure", now)?.until).toBe(t0 + 60_000 + OUTAGE_REST_MS);

    // DeepL's rest is over, Azure's isn't: DeepL is tried and is still down.
    now = t0 + OUTAGE_REST_MS + 1_000;
    const azure = new FakeEngine("azure");
    const error = await caught(router([new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]), azure], () => now).translate(request()));
    expect(azure.calls).toHaveLength(0);
    expect(error.provider).toBe("deepl");
    expect(error.retryAfterMs).toBeUndefined();
    // Not a wait without an attempt (rate-limited): the item runs out of attempts like with DeepL alone.
    expect(classifyError(error)).toEqual({ kind: "retryable", code: "PROVIDER_UNAVAILABLE" });

    // And the other way round: Azure's rest is over, DeepL rests again.
    now = t0 + 60_000 + OUTAGE_REST_MS + 1_000;
    const deepl = new FakeEngine("deepl");
    const next = await caught(router([deepl, new FakeEngine("azure", [{ kind: "retryable", status: 503 }])], () => now).translate(request()));
    expect(deepl.calls).toHaveLength(0);
    expect(next.provider).toBe("azure");
    expect(classifyError(next).kind).toBe("retryable");
  });

  it("tries engines resting for quota or auth once the others failed (a limit may have been lifted)", async () => {
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure")]).translate(request());
    const deepl = new FakeEngine("deepl");
    const azure = new FakeEngine("azure", [{ kind: "retryable", status: 503 }]);
    const result = await router([deepl, azure]).translate(request());
    expect(result.provider).toBe("deepl");
    expect(azure.calls).toHaveLength(1);
  });

  it("still reaches an outage-resting engine when it is the only one for the language", async () => {
    let now = 1_000_000;
    await router([new FakeEngine("deepl", ["ok"], ["fr"]), new FakeEngine("azure", [{ kind: "retryable" }])], () => now).translate(request()).catch(() => undefined);
    expect(engineRest("azure", now)?.kind).toBe("outage");
    now += 1_000;
    const azure = new FakeEngine("azure");
    const result = await router([new FakeEngine("deepl", ["ok"], ["fr"]), azure], () => now).translate(request());
    expect(result.provider).toBe("azure");
  });

  it("fails only the item when the engine still serving the language finds a segment too large (no quota job stop)", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota", status: 456, billed: 3 }]);
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }, "ok"]);
    const r = router([deepl, azure]);
    const error = await caught(r.translate(request()));
    expect(error.reason).toBe("REQUEST_TOO_LARGE");
    expect(error.billedByEngine).toEqual({ deepl: 3 });
    expect(classifyError(error)).toEqual({ kind: "item-permanent", code: "PROVIDER_REJECTED" });
    // The next normal request goes to Azure.
    expect((await r.translate(request())).provider).toBe("azure");
  });

  it("fails only the item for DeepL refused + a segment too large for Azure", async () => {
    const error = await caught(router([new FakeEngine("deepl", [{ kind: "auth", status: 403 }]), new FakeEngine("azure", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }])]).translate(request()));
    expect(classifyError(error)).toEqual({ kind: "item-permanent", code: "PROVIDER_REJECTED" });
  });

  it("keeps the quota stop when the too-large engine was itself resting for quota (it proves nothing about its limit)", async () => {
    // Azure used up first (DeepL doesn't offer the language then).
    await caught(router([new FakeEngine("deepl", ["ok"], ["fr"]), new FakeEngine("azure", [{ kind: "quota" }])]).translate(request()));
    expect(engineRest("azure", 1_000_000)?.kind).toBe("quota");
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }]);
    const error = await caught(router([new FakeEngine("deepl", [{ kind: "quota" }]), azure]).translate(request()));
    expect(azure.calls).toHaveLength(1);
    expect(classifyError(error)).toMatchObject({ kind: "job-stop", code: "PROVIDER_QUOTA" });
  });

  it("still waits when DeepL is only down and the segment is too large for Azure", async () => {
    const error = await caught(router([new FakeEngine("deepl", [{ kind: "retryable", status: 503 }]), new FakeEngine("azure", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }])]).translate(request()));
    expect(error.kind).toBe("retryable");
    expect(classifyError(error).kind).toMatch(/^(retryable|rate-limited)$/);
  });

  it("marks a quota stop as this language's only while another consented engine still works", async () => {
    const deepl = new FakeEngine("deepl", ["ok"], ["de"]);
    const azure = new FakeEngine("azure", [{ kind: "quota", status: 403 }], ["de", "sw"]);
    const error = await caught(router([deepl, azure]).translate(request({ targetLocale: "sw" })));
    expect(deepl.calls).toHaveLength(0);
    expect(error.kind).toBe("quota");
    expect(error.scope).toBe("language");
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "PROVIDER_QUOTA", scope: "language" });
  });

  it("stops shop-wide when every consented engine is used up or refused", async () => {
    // DeepL used up for German first.
    await caught(router([new FakeEngine("deepl", [{ kind: "quota" }], ["de"]), new FakeEngine("azure", ["ok"], ["fr"])]).translate(request()));
    const error = await caught(router([new FakeEngine("deepl", ["ok"], ["de"]), new FakeEngine("azure", [{ kind: "quota" }], ["de", "sw"])]).translate(request({ targetLocale: "sw" })));
    expect(error.kind).toBe("quota");
    expect(error.scope).toBeUndefined();
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "PROVIDER_QUOTA" });
    // A DeepL-only consent (one allowed engine) never marks it.
    const single = await caught(router([new FakeEngine("deepl", [{ kind: "quota", status: 456 }]), new FakeEngine("azure")]).translate(request({ engines: ["deepl"] })));
    expect(single.scope).toBeUndefined();
  });

  it("attaches the bill and the scope to a copy, never to the engine's own error (it may be shared by other requests)", async () => {
    const shared = new TranslationProviderError("azure", "quota", "fake", 403);
    const azure: TranslationProvider = { id: "azure", translate: async () => Promise.reject(shared), targetSupport: async (l) => new Map(l.map((x) => [x, true])) };
    const deepl = new FakeEngine("deepl", [{ kind: "auth", status: 403, billed: 4 }], ["de"]);
    const r = new EngineRouter([{ id: "deepl", provider: deepl }, { id: "azure", provider: azure }], { now: () => 1_000_000 });
    const error = await caught(r.translate(request()));
    expect(error).not.toBe(shared);
    expect(error).toMatchObject({ provider: "azure", kind: "quota", status: 403, billedCharacters: 4, billedByEngine: { deepl: 4 } });
    expect(error.message).toBe(shared.message);
    expect(shared.billedCharacters).toBeUndefined();
    expect(shared.billedByEngine).toBeUndefined();
    expect(shared.scope).toBeUndefined();
    // A language-only stop, too, is marked on the copy.
    clearEngineRests();
    const sw = await caught(new EngineRouter([{ id: "deepl", provider: new FakeEngine("deepl", ["ok"], ["de"]) }, { id: "azure", provider: azure }], { now: () => 1_000_000 }).translate(request({ targetLocale: "sw" })));
    expect(sw.scope).toBe("language");
    expect(shared.scope).toBeUndefined();
  });

  it("never fails over on an error that isn't a provider error", async () => {
    const azure = new FakeEngine("azure");
    await expect(router([new FakeEngine("deepl", [new TypeError("bug")]), azure]).translate(request())).rejects.toThrow(TypeError);
    expect(azure.calls).toHaveLength(0);
  });
});

describe("stop and deadline", () => {
  it("calls no further engine once the caller stopped; the untried ones count as only down", async () => {
    const controller = new AbortController();
    const deepl = new (class extends FakeEngine {
      override async translate(req: TranslationRequest, signal?: AbortSignal) {
        controller.abort();
        return super.translate(req, signal);
      }
    })("deepl", [{ kind: "quota", billed: 3 }]);
    const azure = new FakeEngine("azure");
    const error = await caught(router([deepl, azure]).translate(request(), controller.signal));
    expect(azure.calls).toHaveLength(0);
    expect(error.kind).toBe("retryable");
    expect(error.billedCharacters).toBe(3);
    expect(classifyError(error)).toMatchObject({ kind: "retryable" });
  });

  it("calls nothing after an elapsed deadline", async () => {
    const deepl = new FakeEngine("deepl");
    const error = await caught(router([deepl, new FakeEngine("azure")]).translate(request(), AbortSignal.abort()));
    expect(deepl.calls).toHaveLength(0);
    expect(error.kind).toBe("retryable");
  });
});

describe("languages and plans", () => {
  it("unions the engines' lists, an unreadable list counting as unknown", async () => {
    const r = router([new FakeEngine("deepl", ["ok"], ["de"]), new FakeEngine("azure", ["ok"], "fail"), new FakeEngine("google", ["ok"], ["th"])]);
    expect(await r.targetSupport(["de", "th", "xx"])).toEqual(new Map([["de", true], ["th", true], ["xx", false]]));
    await expect(router([new FakeEngine("deepl", ["ok"], "fail"), new FakeEngine("azure", ["ok"], "fail")]).targetSupport(["de"])).rejects.toThrow();
  });

  it("plans candidates, blocked engines, unknown lists, the serving and the next engine", async () => {
    const r = router([new FakeEngine("deepl", ["ok"], ["de"]), new FakeEngine("azure", ["ok"], ["de", "th"]), new FakeEngine("google", ["ok"], "fail")]);
    const plans = await r.plan(["de", "th", "xx"], ["deepl", "google"]);
    expect(plans.get("de")).toEqual({ candidates: ["deepl", "google"], blocked: ["azure"], unknown: ["google"], servedBy: "deepl", next: "deepl" });
    expect(plans.get("th")).toEqual({ candidates: ["google"], blocked: ["azure"], unknown: ["google"], servedBy: "google", next: "google" });
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure")]).translate(request());
    expect((await r.plan(["de"], ALL)).get("de")).toMatchObject({ servedBy: "deepl", next: "azure" });
  });

  it("lists an engine with an unreadable list as unknown even when it isn't allowed", async () => {
    const r = router([new FakeEngine("deepl", ["ok"], ["de"]), new FakeEngine("azure", ["ok"], "fail")]);
    expect((await r.plan(["de"], ["deepl"])).get("de")).toEqual({ candidates: ["deepl"], blocked: ["azure"], unknown: ["azure"], servedBy: "deepl", next: "deepl" });
  });

  it("doesn't read a list again for 5 minutes after it failed (a hanging DeepL doesn't hold every item)", async () => {
    let now = 1_000_000;
    const deepl = new FakeEngine("deepl", [{ kind: "retryable", status: 503 }], "fail");
    const azure = new FakeEngine("azure");
    const r = router([deepl, azure], () => now);
    // DeepL is down: its list read fails and it rests for an outage.
    expect((await r.translate(request())).provider).toBe("azure");
    expect(deepl.supportCalls).toBe(1);
    expect(await plannedEngine(r, "de", ALL)).toBe("azure");
    expect(await plannedEngine(r, "de", ALL)).toBe("azure");
    expect((await r.plan(["de"], ALL)).get("de")).toMatchObject({ unknown: ["deepl"], next: "azure" });
    expect(deepl.supportCalls).toBe(1);
    now += LIST_FAILURE_MS + 1;
    await plannedEngine(r, "de", ALL);
    expect(deepl.supportCalls).toBe(2);
  });

  it("plans past an engine that refused the pair, as translate() does, when the source language is given", async () => {
    let now = 1_000_000;
    const azure = new FakeEngine("azure", [{ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" }, "ok"], ["de"]);
    const google = new FakeEngine("google");
    const r = router([azure, google], () => now);
    expect((await r.translate(request())).provider).toBe("google");
    expect((await r.plan(["de"], ALL, "en")).get("de")!.next).toBe("google");
    expect(await plannedEngine(r, "de", ALL, "en")).toBe("google");
    // Another source, or no source (the Languages page, Settings): unchanged.
    expect((await r.plan(["de"], ALL, "fr")).get("de")!.next).toBe("azure");
    expect((await r.plan(["de"], ALL)).get("de")).toMatchObject({ servedBy: "azure", next: "azure" });
    now += LANGUAGE_REFUSAL_MS + 1;
    expect((await r.plan(["de"], ALL, "en")).get("de")!.next).toBe("azure");
  });
});

// ---------------------------------------------------------------- Own key plan: state keys and the ownKeys option

/** A router over a merchant's keys: each member with its own state key. */
const ownRouter = (members: Array<[FakeEngine, string]>, consented: readonly EngineId[] = ["deepl", "azure", "google"], now = () => 1_000_000) =>
  new EngineRouter(
    members.map(([m, stateKey]): RoutedEngine => ({ id: m.id, provider: m, stateKey })),
    { now, ownKeys: { consented } },
  );

describe("own keys: state keys", () => {
  it.each([
    ["quota", { kind: "quota" as const, status: 456 }],
    ["auth", { kind: "auth" as const, status: 403 }],
    ["outage", { kind: "retryable" as const, status: 503 }],
  ])("a %s of one merchant's key rests neither another merchant's key of the same engine nor the operator's engine", async (kind, step) => {
    const result = await ownRouter([
      [new FakeEngine("deepl", [step]), "own:deepl:a"],
      [new FakeEngine("google"), "own:google:a"],
    ]).translate(request());
    expect(result.provider).toBe("google");
    expect(engineRest("own:deepl:a", 1_000_000)?.kind).toBe(kind);
    expect(engineRest("own:deepl:b", 1_000_000)).toBeNull();
    expect(engineRest("deepl", 1_000_000)).toBeNull();

    // Merchant B's DeepL key is asked first, as if nothing had happened.
    const deeplB = new FakeEngine("deepl");
    const googleB = new FakeEngine("google");
    expect((await ownRouter([[deeplB, "own:deepl:b"], [googleB, "own:google:b"]]).translate(request())).provider).toBe("deepl");
    expect(googleB.calls).toHaveLength(0);
    // And so is the operator's DeepL.
    const operatorDeepL = new FakeEngine("deepl");
    expect((await router([operatorDeepL, new FakeEngine("google")]).translate(request())).provider).toBe("deepl");
  });

  it("an operator rest never makes a merchant's key of that engine wait", async () => {
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure")]).translate(request());
    expect(engineRest("deepl", 1_000_000)?.kind).toBe("quota");
    const ownDeepL = new FakeEngine("deepl");
    const ownAzure = new FakeEngine("azure");
    expect((await ownRouter([[ownDeepL, "own:deepl:x"], [ownAzure, "own:azure:x"]]).translate(request())).provider).toBe("deepl");
    expect(ownAzure.calls).toHaveLength(0);
    // The operator's rest is still there.
    expect(engineRest("deepl", 1_000_000)?.kind).toBe("quota");
  });

  it("a success clears only its own key's rest", async () => {
    for (const key of ["own:deepl:a", "own:deepl:b"]) {
      await ownRouter([[new FakeEngine("deepl", [{ kind: "quota" }]), key], [new FakeEngine("google"), `own:google:${key.at(-1)}`]]).translate(request());
    }
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("google")]).translate(request());
    // A's key answers again (pass 2: its limit was lifted).
    const result = await ownRouter([[new FakeEngine("deepl"), "own:deepl:a"], [new FakeEngine("google", [{ kind: "retryable", status: 503 }]), "own:google:a"]]).translate(request());
    expect(result.provider).toBe("deepl");
    expect(engineRest("own:deepl:a", 1_000_000)).toBeNull();
    expect(engineRest("own:deepl:b", 1_000_000)?.kind).toBe("quota");
    expect(engineRest("deepl", 1_000_000)?.kind).toBe("quota");
  });

  it("keeps language list failures and language refusals per key", async () => {
    // A's DeepL list can't be read: remembered for A's key only.
    const deeplA = new FakeEngine("deepl", ["ok"], "fail");
    await ownRouter([[deeplA, "own:deepl:a"], [new FakeEngine("google"), "own:google:a"]]).plan(["de"], ALL);
    const deeplB = new FakeEngine("deepl", ["ok"], ["de"]);
    const planB = (await ownRouter([[deeplB, "own:deepl:b"], [new FakeEngine("google"), "own:google:b"]]).plan(["de"], ALL)).get("de")!;
    expect(deeplB.supportCalls).toBe(1);
    expect(planB).toMatchObject({ unknown: [], servedBy: "deepl" });
    const operatorDeepL = new FakeEngine("deepl", ["ok"], ["de"]);
    await router([operatorDeepL, new FakeEngine("google")]).plan(["de"], ALL);
    expect(operatorDeepL.supportCalls).toBe(1);
    // A's own key: still remembered, its list isn't asked again.
    await ownRouter([[deeplA, "own:deepl:a"], [new FakeEngine("google"), "own:google:a"]]).plan(["de"], ALL);
    expect(deeplA.supportCalls).toBe(1);

    // A's Azure refused the pair although its list named it: only A's key skips the pair.
    const azureA = new FakeEngine("azure", [{ kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" }], ["de"]);
    expect((await ownRouter([[azureA, "own:azure:a"], [new FakeEngine("google"), "own:google:a"]]).translate(request())).provider).toBe("google");
    const azureB = new FakeEngine("azure", ["ok"], ["de"]);
    expect((await ownRouter([[azureB, "own:azure:b"], [new FakeEngine("google"), "own:google:b"]]).translate(request())).provider).toBe("azure");
    const operatorAzure = new FakeEngine("azure", ["ok"], ["de"]);
    expect((await router([operatorAzure, new FakeEngine("google")]).translate(request())).provider).toBe("azure");
    const azureAgain = new FakeEngine("azure", ["ok"], ["de"]);
    expect((await ownRouter([[azureAgain, "own:azure:a"], [new FakeEngine("google"), "own:google:a"]]).translate(request())).provider).toBe("google");
    expect(azureAgain.calls).toHaveLength(0);
    expect(await plannedEngine(ownRouter([[new FakeEngine("azure", ["ok"], ["de"]), "own:azure:a"], [new FakeEngine("google"), "own:google:a"]]), "de", ALL, "en")).toBe("google");
  });

  it("decides the language scope from the merchant's own keys only", async () => {
    // The operator's Google is refused (rests for auth) …
    await router([new FakeEngine("deepl"), new FakeEngine("google", [{ kind: "auth" }])]).translate(request({ engines: ["google"] })).catch(() => undefined);
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("google", [{ kind: "auth" }])]).translate(request()).catch(() => undefined);
    expect(engineRest("google", 1_000_000)?.kind).toBe("auth");
    // … but the merchant's Google key works (it doesn't serve German): its used-up DeepL key stops only this language.
    const error = await caught(ownRouter([[new FakeEngine("deepl", [{ kind: "quota" }]), "own:deepl:s"], [new FakeEngine("google", ["ok"], ["fr"]), "own:google:s"]]).translate(request()));
    expect(error.kind).toBe("quota");
    expect(error.scope).toBe("language");
    // Every own key used up or refused: shop-wide, whatever the operator's engines do.
    const all = await caught(ownRouter([[new FakeEngine("deepl", [{ kind: "quota" }]), "own:deepl:t"], [new FakeEngine("google", [{ kind: "auth" }]), "own:google:t"]]).translate(request()));
    expect(all.scope).toBeUndefined();
  });

  it("names its state keys in plans: a resting own key isn't the next engine, an operator rest doesn't matter", async () => {
    await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure")]).translate(request());
    const r = ownRouter([[new FakeEngine("deepl"), "own:deepl:p"], [new FakeEngine("azure"), "own:azure:p"]]);
    expect((await r.plan(["de"], ALL)).get("de")!.next).toBe("deepl");
    await ownRouter([[new FakeEngine("deepl", [{ kind: "quota" }]), "own:deepl:p"], [new FakeEngine("azure"), "own:azure:p"]]).translate(request());
    expect((await r.plan(["de"], ALL)).get("de")!.next).toBe("azure");
  });
});

describe("own keys: the ownKeys option", () => {
  it("allows one member (and only then), keeping the other construction rules", () => {
    const deepl = new FakeEngine("deepl");
    const single = new EngineRouter([{ id: "deepl", provider: deepl, stateKey: "own:deepl:1" }], { ownKeys: { consented: ["deepl"] } });
    expect(single.engines).toEqual(["deepl"]);
    expect(single.label).toBe("deepl");
    expect(isEngineRouter(single)).toBe(true);
    expect(() => new EngineRouter([], { ownKeys: { consented: [] } })).toThrow(/one/);
    expect(() => new EngineRouter([{ id: "deepl", provider: deepl }])).toThrow(/two/);
    expect(() => ownRouter([[new FakeEngine("google"), "own:google:1"], [new FakeEngine("deepl"), "own:deepl:1"]])).toThrow(/DeepL/);
    expect(() => ownRouter([[new FakeEngine("google"), "own:google:1"], [new FakeEngine("google"), "own:google:2"]])).toThrow(/once/);
  });

  it("translates through a single member exactly as that engine's call", async () => {
    const google = new FakeEngine("google", [{ kind: "auth", status: 401 }]);
    const r = new EngineRouter([{ id: "google", provider: google, stateKey: "own:google:1" }], { ownKeys: { consented: ["google"] } });
    const error = await caught(r.translate(request()));
    expect(error.provider).toBe("google");
    expect(error.kind).toBe("auth");
    expect(google.calls).toHaveLength(1);
    expect(engineRest("own:google:1", 1_000_000)).toBeNull();
  });

  it("never uses an engine the stored consent doesn't cover, even when the request lists it", async () => {
    const deepl = new FakeEngine("deepl", [{ kind: "quota" }]);
    const google = new FakeEngine("google");
    const r = ownRouter([[deepl, "own:deepl:c"], [google, "own:google:c"]], ["deepl"]);
    const error = await caught(r.translate(request({ engines: ["deepl", "google"] })));
    expect(error.kind).toBe("quota");
    expect(google.calls).toHaveLength(0);
    expect(google.supportCalls).toBe(0);
    // Plans: the engine without consent is blocked, never a candidate.
    expect((await r.plan(["de"], ["deepl", "google"])).get("de")).toMatchObject({ candidates: ["deepl"], blocked: ["google"], servedBy: "deepl" });
    expect(await plannedEngine(r, "de", ["deepl", "google"])).toBe("deepl");
  });

  it("calls nothing when the request's engines cover no consented member", async () => {
    const deepl = new FakeEngine("deepl");
    const azure = new FakeEngine("azure");
    for (const [consented, engines] of [
      [[], ALL],
      [["azure"], ["deepl"]],
    ] as const) {
      const error = await caught(ownRouter([[deepl, "own:deepl:n"], [azure, "own:azure:n"]], consented).translate(request({ engines })));
      expect(error.provider).toBe("router");
      expect(error.kind).toBe("invalid");
      expect(error.reason).toBe("CONFIGURATION");
      expect(error.message).toContain("no consented engine");
    }
    expect(deepl.calls.length + azure.calls.length).toBe(0);
    expect(deepl.supportCalls + azure.supportCalls).toBe(0);
  });

  it("lists the keys used up or refused before the answer in `failovers`, never retryable or invalid failures", async () => {
    const result = await ownRouter([
      [new FakeEngine("deepl", [{ kind: "quota", status: 456 }]), "own:deepl:f"],
      [new FakeEngine("azure", [{ kind: "retryable", status: 503 }]), "own:azure:f"],
      [new FakeEngine("google"), "own:google:f"],
    ]).translate(request());
    expect(result.provider).toBe("google");
    expect(result.failovers).toEqual([{ engine: "deepl", kind: "quota" }]);

    const refused = await ownRouter([
      [new FakeEngine("azure", [{ kind: "auth", status: 401 }]), "own:azure:g"],
      [new FakeEngine("google"), "own:google:g"],
    ]).translate(request());
    expect(refused.failovers).toEqual([{ engine: "azure", kind: "auth" }]);

    const tooLarge = await ownRouter([
      [new FakeEngine("deepl", [{ kind: "invalid", reason: "REQUEST_TOO_LARGE" }]), "own:deepl:h"],
      [new FakeEngine("google"), "own:google:h"],
    ]).translate(request());
    expect(tooLarge).not.toHaveProperty("failovers");
    // No failure at all: no field.
    expect(await ownRouter([[new FakeEngine("deepl"), "own:deepl:i"], [new FakeEngine("google"), "own:google:i"]]).translate(request())).not.toHaveProperty("failovers");
  });

  it("never adds `failovers` to an operator router's result", async () => {
    clearEngineRests();
    const result = await router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("azure", [{ kind: "auth" }]), new FakeEngine("google")]).translate(request());
    expect(result.provider).toBe("google");
    expect(result).not.toHaveProperty("failovers");
    expect(Object.keys(result).sort()).toEqual(["billedCharacters", "provider", "translations"]);
  });

  it("on total failure attaches every used-up or refused key to the error (`ownKeyFailures`), and an operator router never does", async () => {
    const error = await caught(
      ownRouter([
        [new FakeEngine("deepl", [{ kind: "quota", status: 456, billed: 3 }]), "own:deepl:t1"],
        [new FakeEngine("google", [{ kind: "auth", status: 400 }]), "own:google:t1"],
      ]).translate(request()),
    );
    expect(error.kind).toBe("quota");
    expect(error.ownKeyFailures).toEqual([
      { engine: "deepl", kind: "quota" },
      { engine: "google", kind: "auth" },
    ]);
    expect(error.billedByEngine).toEqual({ deepl: 3 });
    expect(classifyError(error)).toMatchObject({ kind: "job-stop", code: "PROVIDER_QUOTA" });

    // A retryable winner still carries the refused key, so it can be marked.
    const waiting = await caught(
      ownRouter([
        [new FakeEngine("deepl", [{ kind: "auth" }]), "own:deepl:t2"],
        [new FakeEngine("azure", [{ kind: "retryable", status: 503 }]), "own:azure:t2"],
      ]).translate(request()),
    );
    expect(waiting.kind).toBe("retryable");
    expect(waiting.ownKeyFailures).toEqual([{ engine: "deepl", kind: "auth" }]);

    const operator = await caught(router([new FakeEngine("deepl", [{ kind: "quota" }]), new FakeEngine("google", [{ kind: "auth" }])]).translate(request()));
    expect(operator.kind).toBe("quota");
    expect(operator.ownKeyFailures).toBeUndefined();
    expect(operator).not.toHaveProperty("ownKeyFailures");
  });
});

describe("own keys: bounded process state", () => {
  const failing = new FakeEngine("deepl", [{ kind: "quota" }]);
  const answering = new FakeEngine("google");
  const restOwnKey = (n: number | string, now: () => number) => ownRouter([[failing, `own:deepl:${n}`], [answering, "own:google:always"]], ["deepl", "google"], now).translate(request());

  it("drops the oldest own-key rests above MAX_OWN_STATE, never the operator's", async () => {
    // The operator's rest is the oldest entry of the map.
    await router([new FakeEngine("deepl", [{ kind: "auth" }]), new FakeEngine("google")]).translate(request());
    for (let i = 0; i < MAX_OWN_STATE + 5; i++) await restOwnKey(i, () => 1_000_000);
    const sizes = engineStateSizes();
    expect(sizes.rests).toBeLessThanOrEqual(MAX_OWN_STATE);
    expect(sizes.restSeq).toBeLessThanOrEqual(sizes.rests);
    expect(sizes.outages).toBeLessThanOrEqual(sizes.rests);
    expect(engineRest("deepl", 1_000_000)?.kind).toBe("auth");
    // The newest own keys are still resting, the oldest were dropped.
    expect(engineRest(`own:deepl:${MAX_OWN_STATE + 4}`, 1_000_000)?.kind).toBe("quota");
    expect(engineRest("own:deepl:0", 1_000_000)).toBeNull();
  });

  it("drops own-key rests that ended over an hour ago first, keeping current ones", async () => {
    const t0 = 1_000_000;
    let now = t0;
    for (let i = 0; i < MAX_OWN_STATE / 2; i++) await restOwnKey(`old-${i}`, () => now);
    now = t0 + QUOTA_REST_MS + 60 * 60 * 1000 + 1;
    for (let i = 0; i < MAX_OWN_STATE / 2; i++) await restOwnKey(`new-${i}`, () => now);
    expect(engineStateSizes().rests).toBe(MAX_OWN_STATE);
    await restOwnKey("last", () => now);
    // Every expired entry went, every current one stayed.
    expect(engineStateSizes().rests).toBe(MAX_OWN_STATE / 2 + 1);
    expect(engineRest("own:deepl:new-0", now)?.kind).toBe("quota");
    expect(engineRest("own:deepl:last", now)?.kind).toBe("quota");
  });

  it("bounds language list failures the same way, never dropping the operator's", async () => {
    const operatorDeepL = new FakeEngine("deepl", ["ok"], "fail");
    await router([operatorDeepL, new FakeEngine("google")]).plan(["de"], ALL);
    const down = new FakeEngine("deepl", ["ok"], "fail");
    for (let i = 0; i < MAX_OWN_STATE + 5; i++) await new EngineRouter([{ id: "deepl", provider: down, stateKey: `own:deepl:list-${i}` }], { now: () => 1_000_000, ownKeys: { consented: ["deepl"] } }).plan(["de"], ALL);
    expect(engineStateSizes().listFailures).toBeLessThanOrEqual(MAX_OWN_STATE);
    // The operator's failed list is still remembered: not asked again.
    await router([operatorDeepL, new FakeEngine("google")]).plan(["de"], ALL);
    expect(operatorDeepL.supportCalls).toBe(1);
  });
});
