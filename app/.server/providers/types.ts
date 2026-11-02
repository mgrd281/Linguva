import type { EngineId } from "../../lib/engines";

/** One of the merchant's own keys that was used up (quota) or refused (auth) during a request. Own-key routers only. */
export interface OwnKeyFailure {
  engine: EngineId;
  kind: "quota" | "auth";
}

export interface TranslationRequest {
  /** Segment markup (see translation/segment-markup.ts). */
  segments: readonly string[];
  /** Shopify locale codes, for example "de", "en-US", "pt-BR". */
  sourceLocale: string;
  targetLocale: string;
  /** Extra context that guides but isn't translated (for example a product title). */
  context?: string;
  /** Form of address: "more" formal (Sie, vous), "less" informal (du, tu). Ignored where a language has none. */
  formality?: "more" | "less";
  /**
   * Engines this request may use (the ids the shop's AI consent covers). The
   * router translates with none of them when it is absent or empty (fail
   * closed). Single-engine providers ignore it: the consent check before the
   * call already covers them.
   */
  engines?: readonly string[];
  /**
   * Per segment (same order): true = a line break in this segment is soft
   * whitespace (it comes from an HTML field), false/absent = a real line break.
   * Only HTML-transport engines read it; DeepL's wire format doesn't change.
   */
  softBreaks?: readonly boolean[];
}

/**
 * What an HTML-transport engine reports for one segment: ENGINE_MARKUP = the
 * output couldn't be mapped back to our codes (the segment is refused),
 * SPACING_CHANGED = a word separator next to a code was lost (kept, but the
 * field waits in Review).
 */
export type SegmentNoteCode = "ENGINE_MARKUP" | "SPACING_CHANGED";

export interface TranslationResult {
  translations: string[];
  /**
   * Characters charged to the shop's AI allowance: the answering engine's
   * count only. DeepL: what DeepL billed (it doesn't bill tags). Azure and
   * Google bill markup too; for them it is the text without inline codes, so a
   * merchant's count doesn't depend on which engine answered.
   */
  billedCharacters: number;
  /** The engine that produced every translation of this result. */
  provider: string;
  /** Router only: what engines that failed before billed (lost to failover; platform counter only). */
  lostByEngine?: Readonly<Record<string, number>>;
  /** Request options this engine couldn't apply; absent: everything was applied. */
  dropped?: ReadonlyArray<"formality" | "context">;
  /** HTML-transport engines: segments (by index) the decoder refused or flagged. */
  notes?: ReadonlyArray<{ index: number; code: SegmentNoteCode }>;
  /**
   * Own-key routers only: members that failed earlier in this request with quota or auth
   * before the answering one (retryable and invalid failures say nothing about a key and
   * aren't listed). Absent on every operator result.
   */
  failovers?: OwnKeyFailure[];
}

/** What an engine applies from a request. */
export interface EngineCapabilities {
  formality: boolean;
  context: boolean;
}

export interface TranslationProvider {
  readonly id: string;
  /** What the engine applies from a request. Absent: everything (DeepL, mock). The only place capabilities are defined. */
  readonly capabilities?: EngineCapabilities;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
  /**
   * Which Shopify locales the provider can translate into, read from the
   * provider itself (true / false per locale). Absent: every locale.
   */
  targetSupport?(locales: readonly string[]): Promise<Map<string, boolean>>;
}

export type ProviderErrorKind =
  | "retryable" // rate limit, overload, timeout, 5xx
  | "quota" // provider account quota exhausted
  | "auth" // invalid or unauthorised key
  | "invalid"; // rejected request (unsupported language, bad input)

/** Why an error happened, where the kind alone doesn't say enough to route it. */
export type ProviderErrorReason =
  | "UNSUPPORTED_LANGUAGE" // this engine doesn't translate the pair; another engine may
  | "REQUEST_TOO_LARGE" // a size limit; the adapter splits batches, a single segment can't be split
  | "RATE_LIMITED" // a rate limit (not an outage): never a reason to switch engines
  | "CONFIGURATION" // wrong project, API disabled, billing off, no consented engine: the owner must act
  | "TOKEN_GRANT"; // Google's token endpoint refused the signed assertion (often clock skew)

export class TranslationProviderError extends Error {
  /**
   * Characters the provider already billed for earlier parts of the same
   * request (DeepL sends long texts in batches): the caller meters them
   * instead of releasing the whole reservation.
   */
  billedCharacters?: number;
  /** Set after construction, like billedCharacters (the constructor stays as it is). */
  reason?: ProviderErrorReason;
  /** Router only: what each engine billed before the request failed, in the order tried. */
  billedByEngine?: Record<string, number>;
  /**
   * Router only, on quota or auth: used up or refused for this target language
   * only; another consented engine still works for other languages. Absent: no
   * engine is left (a single engine's quota, as with DeepL alone).
   */
  scope?: "language";
  /**
   * Own-key routers only: every member of the failed request that was used up or refused
   * (not only the one this error is about), so each of those keys can be marked. Declared
   * only: an operator error has no such property at all.
   */
  declare ownKeyFailures?: OwnKeyFailure[];

  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider} ${kind}: ${message}`);
    this.name = "TranslationProviderError";
  }
}

/** A new error with the same provider, kind, message, status, retry delay and reason: no billing, no scope. */
export function copyProviderError(error: TranslationProviderError): TranslationProviderError {
  const copy = new TranslationProviderError(error.provider, error.kind, "", error.status, error.retryAfterMs);
  copy.message = error.message;
  if (error.stack) copy.stack = error.stack;
  if (error.reason) copy.reason = error.reason;
  return copy;
}

/**
 * A copy of a provider error (its billing, scope and own-key failures too) with `fields` set on
 * the copy. Callers attach their request's billing or scope to a copy, never
 * to an error they didn't create: one error object can reach several requests
 * at once (a shared token refresh), and one request's bill would otherwise be
 * charged to another shop.
 */
export function withProviderFields(
  error: TranslationProviderError,
  fields: Partial<Pick<TranslationProviderError, "billedCharacters" | "billedByEngine" | "scope" | "ownKeyFailures">>,
): TranslationProviderError {
  const copy = copyProviderError(error);
  const billedCharacters = fields.billedCharacters ?? error.billedCharacters;
  const billedByEngine = fields.billedByEngine ?? error.billedByEngine;
  const scope = fields.scope ?? error.scope;
  const ownKeyFailures = fields.ownKeyFailures ?? error.ownKeyFailures;
  if (billedCharacters !== undefined) copy.billedCharacters = billedCharacters;
  if (billedByEngine) copy.billedByEngine = { ...billedByEngine };
  if (scope) copy.scope = scope;
  if (ownKeyFailures) copy.ownKeyFailures = ownKeyFailures.map((f) => ({ ...f }));
  return copy;
}

/** What a failed provider call still billed (earlier batches), or 0. */
export function billedBeforeFailure(error: unknown): number {
  return error instanceof TranslationProviderError ? (error.billedCharacters ?? 0) : 0;
}

/**
 * True for DeepL 429/529, Azure 429xxx and Google's rate-limit reasons: the
 * caller waits and tries the same engine again; it never switches engines.
 * Only retryable errors: Google also answers a used-up quota with HTTP 429
 * (RESOURCE_QUOTA_EXCEEDED, dailyLimitExceeded, a per-day limit: kind
 * "quota"), and that one must rest the engine and fail over.
 */
export function isRateLimit(error: TranslationProviderError): boolean {
  return error.kind === "retryable" && (error.reason === "RATE_LIMITED" || error.status === 429 || error.status === 529);
}
