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
}

export interface TranslationResult {
  translations: string[];
  /** Characters the provider billed for this request. */
  billedCharacters: number;
  provider: string;
}

export interface TranslationProvider {
  readonly id: string;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
}

export type ProviderErrorKind =
  | "retryable" // rate limit, overload, timeout, 5xx
  | "quota" // provider account quota exhausted
  | "auth" // invalid or unauthorised key
  | "invalid"; // rejected request (unsupported language, bad input)

export class TranslationProviderError extends Error {
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
