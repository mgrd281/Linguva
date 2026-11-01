/**
 * Microsoft Azure AI Translator, Text Translation v3.0 (api-version=3.0).
 *
 * - Key and region in headers only, never in a URL (proxies and fetch errors
 *   log URLs). The default endpoint is Microsoft's EU one: texts are
 *   processed in France Central or West Europe and refused rather than
 *   routed outside the EU.
 * - Segments with inline codes go in HTML mode, the rest as plain text
 *   (html-transport.ts). Azure has no form of address and no context field:
 *   a request that carries them reports them in `dropped`.
 * - Azure bills every character of each text, markup included; the merchant
 *   is counted the text without inline codes (`billedCharacters`), the same
 *   unit whichever engine answers.
 * - Nothing is logged; error messages carry the HTTP status, Azure's numeric
 *   code and the request id, never the body (it can echo input).
 */
import { randomUUID } from "node:crypto";
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
import type { WireMode } from "./html-transport";
import { parseRetryAfter, type RetryOptions } from "./retry";
import type {
  ProviderErrorKind,
  ProviderErrorReason,
  TranslationProvider,
  TranslationRequest,
  TranslationResult,
} from "./types";

export const AZURE_EU_ENDPOINT = "https://api-eur.cognitive.microsofttranslator.com"; // default
export const AZURE_GLOBAL_ENDPOINT = "https://api.cognitive.microsofttranslator.com";
/** The documented host for the language list (no key, no merchant data). */
export const AZURE_LANGUAGES_URL = "https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation";

export interface AzureOptions {
  key: string;
  /** Resource region for Ocp-Apim-Subscription-Region (e.g. "westeurope"); omit only for a Global resource. */
  region?: string;
  endpoint?: typeof AZURE_EU_ENDPOINT | typeof AZURE_GLOBAL_ENDPOINT;
  fetch?: typeof fetch;
  /** Default 30_000. */
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  now?: () => number;
}

// Conservative batching. Azure's limits are 1,000 elements and 50,000
// characters per request, markup counted; small requests keep a failure cheap.
const MAX_TEXTS_PER_REQUEST = 100;
/** Wire String.length, Azure's own count (a surrogate pair is 2). */
const MAX_CHARS_PER_REQUEST = 10_000;
const MAX_CHARS_PER_TEXT = 50_000;
const KEY_CHECK_TIMEOUT_MS = 5_000;
const REGION = /^[a-z0-9]{2,32}$/;

const LANGUAGE_CACHE_MS = 24 * 60 * 60 * 1000;
/** A failed list read is remembered, so a dead languages endpoint doesn't slow every translation. */
const LANGUAGE_FAILURE_MS = 5 * 60 * 1000;

/**
 * One entry per process: the list URL has no key and no endpoint variant.
 * Codes by lower-cased key → the code as Azure writes it ("zh-hans" → "zh-Hans").
 */
let languageCache: { at: number; codes: ReadonlyMap<string, string>; etag?: string } | null = null;
let languageFailure: { at: number; status?: number } | null = null;
let languagePending: Promise<ReadonlyMap<string, string>> | null = null;

export function clearAzureLanguageCache(): void {
  languageCache = null;
  languageFailure = null;
  languagePending = null;
}

const UNSUPPORTED_LANGUAGE_CODES = new Set([400003, 400019, 400023, 400035, 400036]);
const TOO_LARGE_CODES = new Set([400050, 400072, 400077]);

/** HTTP status + Azure's 6-digit code (error.code, only when it starts with the status) → how to treat the failure. Pure. */
export function classifyAzureError(status: number, code: number | undefined): { kind: ProviderErrorKind; reason?: ProviderErrorReason } {
  if (status === 400 && code !== undefined && UNSUPPORTED_LANGUAGE_CODES.has(code)) return { kind: "invalid", reason: "UNSUPPORTED_LANGUAGE" };
  if (status === 400 && code !== undefined && TOO_LARGE_CODES.has(code)) return { kind: "invalid", reason: "REQUEST_TOO_LARGE" };
  // 401000/401015: bad key, wrong region, or a Speech key.
  if (status === 401) return { kind: "auth" };
  // 403001: the free tier's monthly characters are used up.
  if (status === 403) return code === 403001 ? { kind: "quota" } : { kind: "auth" };
  if (status === 408) return { kind: "retryable" };
  if (status === 429) return { kind: "retryable", reason: "RATE_LIMITED" };
  if (status >= 500) return { kind: "retryable" };
  if (status >= 400) return { kind: "invalid" };
  return { kind: "retryable" };
}

/** Azure's numeric code from an error body, if it is 6 digits that begin with the status. */
function azureErrorCode(body: unknown, status: number): number | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  const text = typeof code === "number" || typeof code === "string" ? String(code) : "";
  return /^\d{6}$/.test(text) && text.startsWith(String(status)) ? Number(text) : undefined;
}

/** The translate call for one batch: what the adapter (and the contract harness) sends. Pure apart from the trace id. */
export function azureTranslateRequest(
  options: AzureOptions,
  texts: readonly string[],
  mode: WireMode,
  from: string,
  to: string,
): { url: string; init: RequestInit } {
  const params = new URLSearchParams({ "api-version": "3.0", from, to, textType: mode === "html" ? "html" : "plain" });
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": options.key,
    "Content-Type": "application/json; charset=UTF-8",
    // Microsoft support asks for it with X-RequestId when errors persist.
    "X-ClientTraceId": randomUUID(),
  };
  if (options.region) headers["Ocp-Apim-Subscription-Region"] = options.region;
  return {
    url: `${options.endpoint ?? AZURE_EU_ENDPOINT}/translate?${params}`,
    init: { method: "POST", headers, body: JSON.stringify(texts.map((text) => ({ text }))) },
  };
}

/**
 * Shopify locale → Azure codes to try, in order (matched case-insensitively
 * against the live list). Azure's "pt" is Brazilian, "ku" is Central Kurdish,
 * and there is no bare "zh", "no" or "sr".
 */
const AZURE_TABLE: Record<string, string[]> = {
  zh: ["zh-Hans"],
  "zh-cn": ["zh-Hans"],
  "zh-sg": ["zh-Hans"],
  "zh-hans": ["zh-Hans"],
  "zh-tw": ["zh-Hant"],
  "zh-hk": ["zh-Hant"],
  "zh-mo": ["zh-Hant"],
  "zh-hant": ["zh-Hant"],
  "pt-br": ["pt"],
  // Same rule as deeplTargetLang: a bare "pt" is European Portuguese.
  pt: ["pt-pt"],
  "pt-pt": ["pt-pt"],
  no: ["nb"],
  nb: ["nb"],
  nn: ["nb"],
  sr: ["sr-Cyrl"],
  "sr-cyrl": ["sr-Cyrl"],
  "sr-latn": ["sr-Latn"],
  mn: ["mn-Cyrl"],
  "fr-ca": ["fr-ca", "fr"],
  fil: ["fil"],
  tl: ["fil"],
  he: ["he"],
  iw: ["he"],
  ku: ["kmr"], // Shopify's ku is Kurmanji (Northern Kurdish)
  ckb: ["ku"], // Sorani: Azure's ku is Central Kurdish
};

/** Pure. */
export function azureLanguageCandidates(locale: string): string[] {
  const lower = locale.toLowerCase();
  const row = AZURE_TABLE[lower];
  if (row) return [...row];
  const base = lower.split("-")[0]!;
  return base === lower ? [lower] : [lower, base];
}

/** The code sent when the language list can't be read: the table row, else the base language (en-GB → en). Pure. */
export function azureGuessedCode(locale: string): string {
  const lower = locale.toLowerCase();
  return AZURE_TABLE[lower]?.[0] ?? lower.split("-")[0]!;
}

/** The code as Azure writes it, or null when Azure doesn't list the language. Pure. */
export function resolveAzureLanguage(codes: ReadonlyMap<string, string>, locale: string): string | null {
  for (const candidate of azureLanguageCandidates(locale)) {
    const code = codes.get(candidate.toLowerCase());
    if (code) return code;
  }
  return null;
}

/** Up to 100 texts and 10,000 characters per request; a longer text goes alone. */
function azureBatches(items: readonly WireItem[]): WireItem[][] {
  const result: WireItem[][] = [];
  let current: WireItem[] = [];
  let chars = 0;
  for (const item of items) {
    const size = item.segment.wire.length;
    if (current.length && (current.length >= MAX_TEXTS_PER_REQUEST || chars + size > MAX_CHARS_PER_REQUEST)) {
      result.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += size;
  }
  if (current.length) result.push(current);
  return result;
}

export class AzureTranslatorProvider implements TranslationProvider {
  readonly id = "azure";
  readonly capabilities = { formality: false, context: false } as const;
  private readonly now: () => number;

  constructor(private readonly options: AzureOptions) {
    if (!options.key) throw new Error("Azure Translator key is required");
    // Never send the key anywhere but Microsoft's two documented hosts.
    const endpoint: string = options.endpoint ?? AZURE_EU_ENDPOINT;
    if (endpoint !== AZURE_EU_ENDPOINT && endpoint !== AZURE_GLOBAL_ENDPOINT) throw new Error("Azure Translator endpoint is not allowed");
    if (options.region !== undefined && options.region !== "" && !REGION.test(options.region)) {
      throw new Error("Azure region must be lower-case letters and digits");
    }
    this.now = options.now ?? Date.now;
  }

  // Read at call time, so the test guard (tests/support/no-real-engines.ts) applies.
  private get fetchImpl(): typeof fetch {
    return this.options.fetch ?? globalThis.fetch;
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  /** Codes from AZURE_LANGUAGES_URL (lower-cased key → code as Azure writes it), cached per process for 24 h. */
  async targetLanguages(now = this.now()): Promise<ReadonlyMap<string, string>> {
    if (languageCache && now - languageCache.at < LANGUAGE_CACHE_MS) return languageCache.codes;
    if (languageFailure && now - languageFailure.at < LANGUAGE_FAILURE_MS) {
      throw providerError(this.id, "retryable", "language list unavailable", { status: languageFailure.status });
    }
    // Callers at the same moment share one request.
    languagePending ??= this.fetchLanguages(now).finally(() => {
      languagePending = null;
    });
    return languagePending;
  }

  private async fetchLanguages(now: number): Promise<ReadonlyMap<string, string>> {
    const previous = languageCache;
    let status: number | undefined;
    try {
      // No key header: the list needs none, so it can't leak from this call.
      const headers: Record<string, string> = previous?.etag ? { "If-None-Match": previous.etag } : {};
      const response = await engineFetch(this.fetchImpl, AZURE_LANGUAGES_URL, { headers }, { engine: this.id, timeoutMs: this.timeoutMs });
      status = response.status;
      if (response.status === 304 && previous) {
        languageCache = { ...previous, at: now };
        languageFailure = null;
        return previous.codes;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw providerError(this.id, "retryable", `languages HTTP ${response.status}`, { status: response.status });
      }
      const body = (await response.json().catch(() => null)) as { translation?: Record<string, unknown> } | null;
      const listed = body?.translation && typeof body.translation === "object" ? Object.keys(body.translation) : [];
      const codes = new Map(listed.filter((code) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(code)).map((code) => [code.toLowerCase(), code]));
      if (codes.size === 0) throw providerError(this.id, "retryable", "malformed language list", { status: response.status });
      const etag = response.headers.get("etag") ?? undefined;
      languageCache = { at: now, codes, ...(etag ? { etag } : {}) };
      languageFailure = null;
      return codes;
    } catch (error) {
      languageFailure = { at: now, status };
      throw error;
    }
  }

  async targetSupport(locales: readonly string[]): Promise<Map<string, boolean>> {
    const codes = await this.targetLanguages();
    return new Map(locales.map((l) => [l, resolveAzureLanguage(codes, l) !== null]));
  }

  /** Source and target codes: from the list, or the guessed codes when it can't be read (never the full locale). */
  private async languagePair(request: TranslationRequest): Promise<{ from: string; to: string }> {
    let codes: ReadonlyMap<string, string>;
    try {
      codes = await this.targetLanguages();
    } catch {
      return { from: azureGuessedCode(request.sourceLocale), to: azureGuessedCode(request.targetLocale) };
    }
    const from = resolveAzureLanguage(codes, request.sourceLocale);
    const to = resolveAzureLanguage(codes, request.targetLocale);
    if (!from || !to) throw providerError(this.id, "invalid", "language not listed", { reason: "UNSUPPORTED_LANGUAGE" });
    return { from, to };
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const plan = planSegments(this.id, request, (segment) => segment.wire.length > MAX_CHARS_PER_TEXT);
    if (plan.items.length === 0) return { translations: plan.translations, billedCharacters: 0, provider: this.id };
    signal?.throwIfAborted();
    // One target per request, and the source always sent (no auto-detection).
    const { from, to } = await this.languagePair(request);
    const result = await runBatches({
      engine: this.id,
      request,
      plan,
      retry: { ...ENGINE_RETRY, ...this.options.retry },
      signal,
      batches: azureBatches,
      send: (texts, mode, callSignal) => this.call(texts, mode, from, to, callSignal),
    });
    return { ...result, provider: this.id };
  }

  private async call(texts: string[], mode: WireMode, from: string, to: string, signal?: AbortSignal): Promise<string[]> {
    const { url, init } = azureTranslateRequest(this.options, texts, mode, from, to);
    const response = await engineFetch(this.fetchImpl, url, init, { engine: this.id, timeoutMs: this.timeoutMs, signal });
    if (!response.ok) {
      const status = response.status;
      const code = azureErrorCode(await errorJson(response), status);
      const { kind, reason } = classifyAzureError(status, code);
      const requestId = safeToken(response.headers.get("x-requestid"));
      throw providerError(this.id, kind, `HTTP ${status}${code ? ` ${code}` : ""}${requestId ? ` (request ${requestId})` : ""}`, {
        status,
        reason,
        retryAfterMs: kind === "retryable" ? parseRetryAfter(response.headers.get("retry-after"), this.now()) : undefined,
      });
    }
    const body = (await response.json().catch(() => null)) as Array<{ translations?: Array<{ text?: unknown }> }> | null;
    const outputs = Array.isArray(body) ? body.map((entry) => entry?.translations?.[0]?.text) : [];
    if (outputs.length !== texts.length || outputs.some((text) => typeof text !== "string")) {
      throw providerError(this.id, "retryable", "malformed response");
    }
    return outputs as string[];
  }

  /**
   * Free key check for the operator card: an empty translate call through the real endpoint,
   * key and region, exactly as a translation sends them (0 characters metered, no merchant
   * data). Microsoft's token service (STS) would also accept a Speech or any other Cognitive
   * Services key of the region, and can't see a region that doesn't match the key on api-eur.
   * The answer is never read.
   */
  async checkKey(): Promise<"ok" | "refused" | "unreachable"> {
    try {
      const { url, init } = azureTranslateRequest(this.options, [""], "plain", "en", "de");
      const response = await engineFetch(this.fetchImpl, url, init, { engine: this.id, timeoutMs: KEY_CHECK_TIMEOUT_MS });
      const status = response.status;
      const code = status === 403 ? azureErrorCode(await errorJson(response), status) : undefined;
      await response.body?.cancel().catch(() => undefined);
      // 2xx, a 400 about the request itself, or 403001 (the free tier's characters are used up:
      // the key is valid, the quota rest shows the rest): Translator accepted the key.
      if (response.ok || status === 400 || code === 403001) return "ok";
      // 401000/401015 (wrong key, wrong region, a Speech key) and any other 403.
      if (status === 401 || status === 403) return "refused";
      return "unreachable";
    } catch {
      return "unreachable";
    }
  }

  /**
   * The same check as checkKey(), read the way a translation is (Own key plan's key check):
   * 403001 (the free tier's characters are used up) is "quota", not "ok", so a key saved with
   * it shows as used up rather than accepted. Everything else answers as checkKey() does.
   */
  async checkKeyDetailed(): Promise<"ok" | "quota" | "refused" | "unreachable"> {
    try {
      const { url, init } = azureTranslateRequest(this.options, [""], "plain", "en", "de");
      const response = await engineFetch(this.fetchImpl, url, init, { engine: this.id, timeoutMs: KEY_CHECK_TIMEOUT_MS });
      const status = response.status;
      const code = status === 403 ? azureErrorCode(await errorJson(response), status) : undefined;
      await response.body?.cancel().catch(() => undefined);
      if (code === 403001) return "quota";
      if (response.ok || status === 400) return "ok";
      if (status === 401 || status === 403) return "refused";
      return "unreachable";
    } catch {
      return "unreachable";
    }
  }
}
