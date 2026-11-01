/**
 * Google Cloud Translation, two ways in one adapter:
 *
 * - simple: v2 (Basic) with an API key (GOOGLE_TRANSLATE_API_KEY). Always
 *   processed globally.
 * - professional: v3 (Advanced) with a service account
 *   (GOOGLE_TRANSLATE_CREDENTIALS), always on the EU endpoint
 *   translate-eu.googleapis.com with locations/europe-west1, where data and
 *   processing stay in the EU. v3 accepts no API keys.
 *
 * Both use NMT (the only model on the EU endpoint), have no form of address
 * and no context field, and bill every code point including markup; the
 * merchant is counted the text without inline codes. Keys and tokens go in
 * headers only, never in a URL. Error messages carry the HTTP status, the
 * rpc status name and a reason code, never the body (it can echo input).
 */
import {
  ENGINE_RETRY,
  engineFetch,
  errorJson,
  planSegments,
  providerError,
  runBatches,
  safeToken,
  type WireItem,
} from "./engine-http";
import { GoogleTokenSource, type ServiceAccountCredentials } from "./google-auth";
import type { WireMode } from "./html-transport";
import { parseRetryAfter, type RetryOptions } from "./retry";
import {
  TranslationProviderError,
  type ProviderErrorKind,
  type ProviderErrorReason,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./types";

export type GoogleAuth =
  | { kind: "apiKey"; apiKey: string } // v2 Basic, global
  | { kind: "serviceAccount"; credentials: ServiceAccountCredentials }; // v3 Advanced, EU endpoint

export interface GoogleOptions {
  auth: GoogleAuth;
  fetch?: typeof fetch;
  /** Default 30_000. */
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  now?: () => number;
}

const V2_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
const V3_HOST = "https://translate-eu.googleapis.com";
const V3_LOCATION = "europe-west1";

// v2 allows 128 strings and 100 KB, v3 1,024 strings and 30,000 code points;
// 5,000 code points is Google's recommended request size (latency grows with it).
const MAX_TEXTS_PER_REQUEST = 100;
const TARGET_CODEPOINTS_PER_REQUEST = 5_000;
const MAX_REQUEST_BYTES = 90 * 1024;
const MAX_CODEPOINTS_PER_TEXT = 30_000;
/** JSON around the texts (keys, languages, format). */
const BODY_OVERHEAD_BYTES = 256;
const CHECK_TIMEOUT_MS = 5_000;

const LANGUAGE_CACHE_MS = 24 * 60 * 60 * 1000;
const LANGUAGE_FAILURE_MS = 5 * 60 * 1000;

interface LanguageLists {
  /** Lower-cased code → the code as Google writes it. */
  targets: ReadonlyMap<string, string>;
  sources: ReadonlyMap<string, string>;
}

/** By googleEndpoints().cacheKey: never a key or a token. */
const languageCache = new Map<string, { at: number; lists: LanguageLists }>();
const languageFailures = new Map<string, { at: number; error: TranslationProviderError }>();
const languagePending = new Map<string, Promise<LanguageLists>>();

export function clearGoogleLanguageCache(): void {
  languageCache.clear();
  languageFailures.clear();
  languagePending.clear();
}

/** Where each auth path goes. Pure. */
export function googleEndpoints(auth: GoogleAuth): { translate: string; languages: string; cacheKey: string } {
  if (auth.kind === "apiKey") {
    return { translate: V2_TRANSLATE_URL, languages: `${V2_TRANSLATE_URL}/languages?model=nmt`, cacheKey: "google:v2" };
  }
  const projectId = auth.credentials.projectId;
  // Legacy domain-scoped ids ("example.com:proj-123") hold a colon.
  const parent = `${V3_HOST}/v3/projects/${encodeURIComponent(projectId)}/locations/${V3_LOCATION}`;
  return { translate: `${parent}:translateText`, languages: `${parent}/supportedLanguages`, cacheKey: `google:v3:${projectId}` };
}

/** The translate call for one batch: what the adapter (and the contract harness) sends. Pure. */
export function googleTranslateRequest(
  auth: GoogleAuth,
  token: string | null,
  texts: readonly string[],
  mode: WireMode,
  from: string,
  to: string,
): { url: string; init: RequestInit } {
  const { translate } = googleEndpoints(auth);
  if (auth.kind === "apiKey") {
    return {
      url: translate,
      init: {
        method: "POST",
        headers: { "X-goog-api-key": auth.apiKey, "Content-Type": "application/json; charset=utf-8" },
        // The source is always sent: detection can fail with 500 on short texts.
        body: JSON.stringify({ q: texts, source: from, target: to, format: mode === "html" ? "html" : "text", model: "nmt" }),
      },
    };
  }
  if (!token) throw new Error("Google v3 needs an access token");
  return {
    url: translate,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      // No model: NMT, the only model on the EU endpoint.
      body: JSON.stringify({
        contents: texts,
        mimeType: mode === "html" ? "text/html" : "text/plain",
        sourceLanguageCode: from,
        targetLanguageCode: to,
      }),
    },
  };
}

/** Shopify locale → Google codes to try, in order (matched case-insensitively against the live list). */
const GOOGLE_TABLE: Record<string, string[]> = {
  zh: ["zh-CN", "zh"],
  "zh-cn": ["zh-CN", "zh"],
  "zh-sg": ["zh-CN", "zh"],
  "zh-hans": ["zh-CN", "zh"],
  "zh-tw": ["zh-TW"],
  "zh-hk": ["zh-TW"],
  "zh-mo": ["zh-TW"],
  "zh-hant": ["zh-TW"],
  "pt-br": ["pt-BR", "pt"],
  // Which variant Google's bare "pt" is isn't documented (possibly Brazilian): no fallback.
  pt: ["pt-PT"],
  "pt-pt": ["pt-PT"],
  no: ["no", "nb"],
  nb: ["no", "nb"],
  nn: ["no", "nb"],
  he: ["he", "iw"],
  iw: ["he", "iw"],
  fil: ["fil", "tl"],
  tl: ["fil", "tl"],
  jv: ["jw", "jv"],
  sr: ["sr"],
  "sr-cyrl": ["sr"],
  // No fallback to "sr": that is Cyrillic.
  "sr-latn": ["sr-Latn"],
  mni: ["mni-Mtei"],
  ku: ["ku"],
  ckb: ["ckb"],
  "fr-ca": ["fr-CA", "fr"],
};

/** Pure. */
export function googleLanguageCandidates(locale: string): string[] {
  const row = GOOGLE_TABLE[locale.toLowerCase()];
  if (row) return [...row];
  const base = locale.split("-")[0]!;
  return base === locale ? [locale] : [locale, base];
}

/** The code sent when the language list can't be read: the table row's first code, else the base language. */
function googleGuessedCode(locale: string): string {
  return GOOGLE_TABLE[locale.toLowerCase()]?.[0] ?? locale.split("-")[0]!.toLowerCase();
}

/** The code as Google writes it, or null when Google doesn't list the language. Pure. */
export function resolveGoogleLanguage(codes: ReadonlyMap<string, string>, locale: string): string | null {
  for (const candidate of googleLanguageCandidates(locale)) {
    const code = codes.get(candidate.toLowerCase());
    if (code) return code;
  }
  return null;
}

interface GoogleErrorBody {
  error?: {
    status?: unknown;
    details?: Array<{ "@type"?: unknown; reason?: unknown; metadata?: { quota_limit?: unknown }; fieldViolations?: Array<{ field?: unknown }> }>;
    errors?: Array<{ reason?: unknown }>;
  };
}

const QUOTA_REASONS = new Set(["dailyLimitExceeded", "quotaExceeded", "RESOURCE_QUOTA_EXCEEDED"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);
const CONFIGURATION_REASONS = new Set(["SERVICE_DISABLED", "BILLING_DISABLED"]);

/**
 * HTTP status + error body → how to treat the failure. Only codes are read
 * (google.rpc status, ErrorInfo and legacy reasons, BadRequest field names),
 * each one a plain token; the message is never read. Pure.
 */
export function classifyGoogleError(
  status: number,
  body: unknown,
): { kind: ProviderErrorKind; reason?: ProviderErrorReason; detail: string } {
  const error = (body as GoogleErrorBody | null)?.error;
  const statusName = safeToken(error?.status);
  const details = Array.isArray(error?.details) ? error.details : [];
  const legacy = Array.isArray(error?.errors) ? error.errors : [];
  const infos = details.filter((d) => typeof d?.["@type"] === "string" && d["@type"].endsWith("google.rpc.ErrorInfo"));
  const reasons = [...infos.map((d) => safeToken(d.reason)), ...legacy.map((e) => safeToken(e?.reason))].filter((r): r is string => Boolean(r));
  // Service Infrastructure reports every rate quota as RATE_LIMIT_EXCEEDED (v3 has no legacy
  // errors[]): only the limit's name tells a per-day cap ("...PerDayPerProject", reset at
  // midnight Pacific) from a per-minute one. A used-up day is a quota: rest and fail over.
  // (quota_metric holds "/", so safeToken drops it; it never names the period anyway.)
  const perDay = infos.map((d) => safeToken(d.metadata?.quota_limit)).find((l) => l !== undefined && /PerDay/i.test(l));
  const fields = details
    .filter((d) => typeof d?.["@type"] === "string" && d["@type"].endsWith("google.rpc.BadRequest") && Array.isArray(d.fieldViolations))
    .flatMap((d) => d.fieldViolations!.map((v) => (typeof v?.field === "string" ? v.field.slice(0, 64) : "")));
  const has = (set: ReadonlySet<string>) => reasons.find((r) => set.has(r));

  let result: { kind: ProviderErrorKind; reason?: ProviderErrorReason; code?: string };
  if (status === 400) {
    const keyInvalid = reasons.find((r) => r === "API_KEY_INVALID" || r === "keyInvalid");
    if (keyInvalid) result = { kind: "auth", code: keyInvalid };
    else if (fields.some((f) => /target|source/i.test(f))) result = { kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" };
    else result = { kind: "invalid" };
  } else if (status === 401) {
    result = { kind: "auth" };
  } else if (status === 403) {
    const quota = has(QUOTA_REASONS);
    const rate = has(RATE_REASONS);
    const configuration = has(CONFIGURATION_REASONS);
    if (quota) result = { kind: "quota", code: quota };
    else if (perDay) result = { kind: "quota", code: perDay };
    else if (rate) result = { kind: "retryable", reason: "RATE_LIMITED", code: rate };
    else if (configuration) result = { kind: "auth", reason: "CONFIGURATION", code: configuration };
    else result = { kind: "auth" };
  } else if (status === 404) {
    // Usually a wrong project id.
    result = { kind: "auth", reason: "CONFIGURATION" };
  } else if (status === 408) {
    result = { kind: "retryable" };
  } else if (status === 429) {
    const quota = reasons.find((r) => r === "RESOURCE_QUOTA_EXCEEDED" || r === "dailyLimitExceeded");
    result = quota ? { kind: "quota", code: quota } : perDay ? { kind: "quota", code: perDay } : { kind: "retryable", reason: "RATE_LIMITED" };
  } else if (status >= 500) {
    result = { kind: "retryable" };
  } else if (status >= 400) {
    result = { kind: "invalid" };
  } else {
    result = { kind: "retryable" };
  }
  const code = result.code ?? reasons[0];
  const detail = [`HTTP ${status}`, statusName, code].filter(Boolean).join(" ");
  return { kind: result.kind, ...(result.reason ? { reason: result.reason } : {}), detail };
}

const codePoints = (text: string) => [...text].length;
const jsonBytes = (text: string) => Buffer.byteLength(JSON.stringify(text), "utf8") + 1;

/** Up to 100 strings, 5,000 code points and 90 KiB of JSON per request; a longer text goes alone. */
function googleBatches(items: readonly WireItem[]): WireItem[][] {
  const result: WireItem[][] = [];
  let current: WireItem[] = [];
  let points = 0;
  let bytes = BODY_OVERHEAD_BYTES;
  for (const item of items) {
    const p = codePoints(item.segment.wire);
    const b = jsonBytes(item.segment.wire);
    if (
      current.length &&
      (current.length >= MAX_TEXTS_PER_REQUEST || points + p > TARGET_CODEPOINTS_PER_REQUEST || bytes + b > MAX_REQUEST_BYTES)
    ) {
      result.push(current);
      current = [];
      points = 0;
      bytes = BODY_OVERHEAD_BYTES;
    }
    current.push(item);
    points += p;
    bytes += b;
  }
  if (current.length) result.push(current);
  return result;
}

export class GoogleTranslateProvider implements TranslationProvider {
  readonly id = "google";
  readonly capabilities = { formality: false, context: false } as const;
  private readonly now: () => number;
  private readonly tokens: GoogleTokenSource | null;

  constructor(private readonly options: GoogleOptions) {
    const { auth } = options;
    if (auth.kind === "apiKey" ? !auth.apiKey : !auth.credentials?.privateKey) throw new Error("Google Cloud Translation credentials are required");
    this.now = options.now ?? Date.now;
    // No network and no signing here: getTranslationProvider() is called per request.
    this.tokens =
      auth.kind === "serviceAccount"
        ? new GoogleTokenSource(auth.credentials, { fetch: options.fetch, now: this.now })
        : null;
  }

  // Read at call time, so the test guard (tests/support/no-real-engines.ts) applies.
  private get fetchImpl(): typeof fetch {
    return this.options.fetch ?? globalThis.fetch;
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  /** The auth header of a request: the key for v2, the access token for v3. */
  private authHeader(token: string | null): Record<string, string> {
    return this.options.auth.kind === "apiKey" ? { "X-goog-api-key": this.options.auth.apiKey } : { Authorization: `Bearer ${token}` };
  }

  private async failure(response: Response): Promise<TranslationProviderError> {
    const { kind, reason, detail } = classifyGoogleError(response.status, await errorJson(response));
    return providerError(this.id, kind, detail, {
      status: response.status,
      reason,
      retryAfterMs: kind === "retryable" ? parseRetryAfter(response.headers.get("retry-after"), this.now()) : undefined,
    });
  }

  /**
   * One API call; for v3 a 401 (UNAUTHENTICATED / ACCESS_TOKEN_EXPIRED) drops
   * the cached token and repeats the call once with a fresh one.
   */
  private async authorised(url: string, build: (token: string | null) => RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = this.tokens ? await this.tokens.token(signal) : null;
      const response = await engineFetch(this.fetchImpl, url, build(token), { engine: this.id, timeoutMs, signal });
      if (response.status === 401 && this.tokens && attempt === 0) {
        await response.body?.cancel().catch(() => undefined);
        this.tokens.invalidate();
        continue;
      }
      return response;
    }
  }

  /** Target codes (lower-cased key → code as Google writes it), cached per endpoint for 24 h. */
  async targetLanguages(now = this.now()): Promise<ReadonlyMap<string, string>> {
    return (await this.languageLists(now)).targets;
  }

  private async languageLists(now = this.now()): Promise<LanguageLists> {
    const { cacheKey } = googleEndpoints(this.options.auth);
    const cached = languageCache.get(cacheKey);
    if (cached && now - cached.at < LANGUAGE_CACHE_MS) return cached.lists;
    const failed = languageFailures.get(cacheKey);
    if (failed && now - failed.at < LANGUAGE_FAILURE_MS) {
      throw providerError(this.id, failed.error.kind, "language list unavailable", { status: failed.error.status, reason: failed.error.reason });
    }
    let pending = languagePending.get(cacheKey);
    if (!pending) {
      pending = this.fetchLanguages(cacheKey, now).finally(() => languagePending.delete(cacheKey));
      languagePending.set(cacheKey, pending);
    }
    return pending;
  }

  private async fetchLanguages(cacheKey: string, now: number): Promise<LanguageLists> {
    try {
      const { languages } = googleEndpoints(this.options.auth);
      const response = await this.authorised(languages, (token) => ({ headers: this.authHeader(token) }), this.timeoutMs);
      if (!response.ok) throw await this.failure(response);
      const body = (await response.json().catch(() => null)) as {
        data?: { languages?: Array<{ language?: unknown }> };
        languages?: Array<{ languageCode?: unknown; supportSource?: unknown; supportTarget?: unknown }>;
      } | null;
      const valid = (code: unknown): code is string => typeof code === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(code);
      const toMap = (codes: string[]) => new Map(codes.map((code) => [code.toLowerCase(), code]));
      let lists: LanguageLists;
      if (this.options.auth.kind === "apiKey") {
        // v2 lists languages that work in both directions.
        const codes = toMap((body?.data?.languages ?? []).map((l) => l?.language).filter(valid));
        lists = { targets: codes, sources: codes };
      } else {
        const entries = Array.isArray(body?.languages) ? body.languages : [];
        lists = {
          targets: toMap(entries.filter((l) => l?.supportTarget === true).map((l) => l.languageCode).filter(valid)),
          sources: toMap(entries.filter((l) => l?.supportSource === true).map((l) => l.languageCode).filter(valid)),
        };
      }
      if (lists.targets.size === 0) throw providerError(this.id, "retryable", "malformed language list", { status: response.status });
      languageCache.set(cacheKey, { at: now, lists });
      languageFailures.delete(cacheKey);
      return lists;
    } catch (error) {
      if (error instanceof TranslationProviderError) languageFailures.set(cacheKey, { at: now, error });
      throw error;
    }
  }

  async targetSupport(locales: readonly string[]): Promise<Map<string, boolean>> {
    const codes = await this.targetLanguages();
    return new Map(locales.map((l) => [l, resolveGoogleLanguage(codes, l) !== null]));
  }

  /** Source and target codes: from the lists, or the guessed codes when they can't be read. */
  private async languagePair(request: TranslationRequest): Promise<{ from: string; to: string }> {
    let lists: LanguageLists;
    try {
      lists = await this.languageLists();
    } catch {
      return { from: googleGuessedCode(request.sourceLocale), to: googleGuessedCode(request.targetLocale) };
    }
    const from = resolveGoogleLanguage(lists.sources, request.sourceLocale);
    const to = resolveGoogleLanguage(lists.targets, request.targetLocale);
    if (!from || !to) throw providerError(this.id, "invalid", "language not listed", { reason: "UNSUPPORTED_LANGUAGE" });
    return { from, to };
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const v2 = this.options.auth.kind === "apiKey";
    const plan = planSegments(
      this.id,
      request,
      // v3's hard limit, applied to v2 too; v2 also can't take more than its body limit in one text.
      (segment) => codePoints(segment.wire) > MAX_CODEPOINTS_PER_TEXT || (v2 && jsonBytes(segment.wire) + BODY_OVERHEAD_BYTES > MAX_REQUEST_BYTES),
    );
    if (plan.items.length === 0) return { translations: plan.translations, billedCharacters: 0, provider: this.id };
    signal?.throwIfAborted();
    const { from, to } = await this.languagePair(request);
    const result = await runBatches({
      engine: this.id,
      request,
      plan,
      retry: { ...ENGINE_RETRY, ...this.options.retry },
      signal,
      batches: googleBatches,
      send: (texts, mode, callSignal) => this.call(texts, mode, from, to, callSignal),
    });
    return { ...result, provider: this.id };
  }

  private async call(texts: string[], mode: WireMode, from: string, to: string, signal?: AbortSignal): Promise<Array<string | null>> {
    const { auth } = this.options;
    const response = await this.authorised(
      googleEndpoints(auth).translate,
      (token) => googleTranslateRequest(auth, token, texts, mode, from, to).init,
      this.timeoutMs,
      signal,
    );
    if (!response.ok) throw await this.failure(response);
    const body = (await response.json().catch(() => null)) as {
      data?: { translations?: Array<{ translatedText?: unknown }> };
      translations?: Array<{ translatedText?: unknown }>;
    } | null;
    const entries = auth.kind === "apiKey" ? body?.data?.translations : body?.translations;
    if (!Array.isArray(entries) || entries.length !== texts.length) throw providerError(this.id, "retryable", "malformed response");
    // v3: translatedText "might be excluded" when that text failed; that segment alone is refused.
    return entries.map((entry) => (typeof entry?.translatedText === "string" ? entry.translatedText : null));
  }

  /** Free credential check for the operator card: v2 = languages with the key; v3 = token + supportedLanguages. */
  async checkCredentials(): Promise<"ok" | "refused" | "unreachable"> {
    try {
      const response = await this.authorised(googleEndpoints(this.options.auth).languages, (token) => ({ headers: this.authHeader(token) }), CHECK_TIMEOUT_MS);
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) return "ok";
      return [400, 401, 403, 404].includes(response.status) ? "refused" : "unreachable";
    } catch (error) {
      // The token endpoint refused the service account.
      return error instanceof TranslationProviderError && error.kind === "auth" ? "refused" : "unreachable";
    }
  }
}
