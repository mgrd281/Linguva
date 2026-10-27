import { withRetry, type RetryOptions } from "./retry";
import {
  TranslationProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./types";

export interface DeepLOptions {
  apiKey: string;
  /** Defaults to the free endpoint for keys ending in ":fx", else Pro. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
}

// Conservative batching below DeepL's documented 128 KiB request limit.
const MAX_REQUEST_BYTES = 100 * 1024;
const MAX_TEXTS_PER_REQUEST = 50;

/** DeepL source languages are base codes ("EN", "PT", "ZH"). */
export function deeplSourceLang(locale: string): string {
  return locale.split("-")[0]!.toUpperCase();
}

/** DeepL target codes; some languages need a regional variant. */
export function deeplTargetLang(locale: string): string {
  const [lang, region] = locale.toLowerCase().split("-") as [string, string | undefined];
  switch (lang) {
    case "en":
      return region === "gb" ? "EN-GB" : "EN-US";
    case "pt":
      return region === "br" ? "PT-BR" : "PT-PT";
    case "zh":
      return region === "tw" || region === "hk" || region === "hant" ? "ZH-HANT" : "ZH-HANS";
    case "no":
    case "nn":
      return "NB";
    default:
      return lang.toUpperCase();
  }
}

function batches(texts: readonly string[]): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const text of texts) {
    const size = Buffer.byteLength(text, "utf8") + 16;
    if (current.length && (bytes + size > MAX_REQUEST_BYTES || current.length >= MAX_TEXTS_PER_REQUEST)) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(text);
    bytes += size;
  }
  if (current.length) result.push(current);
  return result;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export class DeepLProvider implements TranslationProvider {
  readonly id = "deepl";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepLOptions) {
    if (!options.apiKey) throw new Error("DeepL API key is required");
    this.baseUrl =
      options.baseUrl ??
      (options.apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Account usage (GET /v2/usage). Used to verify a key and to show the
   * remaining provider quota to the operator.
   */
  async getUsage(): Promise<{ characterCount: number; characterLimit: number }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v2/usage`, {
        headers: { Authorization: `DeepL-Auth-Key ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new TranslationProviderError(this.id, "retryable", `network error: ${(error as Error).name}`);
    }
    if (!response.ok) {
      throw new TranslationProviderError(
        this.id,
        response.status === 401 || response.status === 403 ? "auth" : "retryable",
        `HTTP ${response.status}`,
        response.status,
      );
    }
    const body = (await response.json()) as { character_count?: number; character_limit?: number };
    return { characterCount: body.character_count ?? 0, characterLimit: body.character_limit ?? 0 };
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    const translations: string[] = [];
    let billedCharacters = 0;
    for (const batch of batches(request.segments)) {
      const result = await withRetry(() => this.call(batch, request, signal), {
        retries: 3,
        baseDelayMs: 500,
        maxDelayMs: 8_000,
        ...this.options.retry,
      });
      translations.push(...result.texts);
      billedCharacters += result.billed;
    }
    return { translations, billedCharacters, provider: this.id };
  }

  private async call(texts: string[], request: TranslationRequest, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v2/translate`, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: texts,
          source_lang: deeplSourceLang(request.sourceLocale),
          target_lang: deeplTargetLang(request.targetLocale),
          tag_handling: "xml",
          // Inline codes never split a sentence; <x/> holds no translatable text.
          non_splitting_tags: ["g", "x"],
          ignore_tags: ["x"],
          show_billed_characters: true,
          ...(request.context ? { context: request.context } : {}),
          // prefer_*: falls back to the default for languages without formal/informal forms.
          ...(request.formality ? { formality: `prefer_${request.formality}` } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TranslationProviderError(this.id, "retryable", `network error: ${(error as Error).name}`);
    }

    if (!response.ok) {
      const status = response.status;
      const kind =
        status === 429 || status === 529 || status >= 500
          ? "retryable"
          : status === 456
            ? "quota"
            : status === 401 || status === 403
              ? "auth"
              : "invalid";
      // The body may echo request details; only the status is surfaced.
      throw new TranslationProviderError(
        this.id,
        kind,
        `HTTP ${status}`,
        status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    const body = (await response.json()) as {
      translations?: Array<{ text: string; billed_characters?: number }>;
    };
    if (!body.translations || body.translations.length !== texts.length) {
      throw new TranslationProviderError(this.id, "retryable", "malformed response");
    }
    return {
      texts: body.translations.map((t) => t.text),
      billed: body.translations.reduce(
        (sum, t, i) => sum + (t.billed_characters ?? texts[i]!.length),
        0,
      ),
    };
  }
}
