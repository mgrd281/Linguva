/**
 * What the HTML-transport engines (Azure, Google) share: fetch with a
 * timeout and the caller's stop signal, error bodies read for codes only,
 * retries that honour a stop, and running a request's segments as batches.
 *
 * Nothing here logs, and no message carries text from a response body: the
 * body can echo the merchant's input, and TranslationProviderError messages
 * are logged as they are (logger.ts PLAIN_MESSAGE_ERRORS).
 */
import { markupToPlainText } from "../translation/segment-markup";
import { decodeSegment, encodeSegment, UNMAPPABLE_SEGMENT, type WireMode, type WireSegment } from "./html-transport";
import { withRetry, type RetryOptions } from "./retry";
import {
  TranslationProviderError,
  withProviderFields,
  type SegmentNoteCode,
  type TranslationRequest,
  type TranslationResult,
} from "./types";

export interface EngineCallOptions {
  /** "azure" | "google": the error's provider. */
  engine: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Same budget as DeepL's. */
export const ENGINE_RETRY: RetryOptions = { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

const MAX_ERROR_BYTES = 16 * 1024;

/** A value from an error body, only if it is a plain token ([A-Za-z0-9_.-], 1..64 chars). */
export function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/**
 * fetch with a timeout joined to the caller's signal (AbortSignal.any). A network
 * failure or timeout becomes a retryable TranslationProviderError ("network error:
 * <error name>"); the caller's own abort is rethrown as is (no retry).
 */
export async function engineFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: EngineCallOptions,
): Promise<Response> {
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Only the error's name: a fetch error's message can quote the URL.
    const name = safeToken(error instanceof Error ? error.name : undefined) ?? "Error";
    throw new TranslationProviderError(options.engine, "retryable", `network error: ${name}`);
  }
}

/** The error body as JSON, reading at most 16 KiB; null if it isn't JSON. Callers take codes from it only: never logged, never in a message. */
export async function errorJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= MAX_ERROR_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => undefined);
  }
  if (size > MAX_ERROR_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return null;
  }
}

/**
 * Retries a call with withRetry, checking the caller's signal before every
 * attempt (withRetry's sleep isn't abortable). Rate-limited errors are
 * retried like today's DeepL ones.
 */
export function retrying<T>(fn: () => Promise<T>, retry: RetryOptions, signal?: AbortSignal): Promise<T> {
  return withRetry(() => {
    signal?.throwIfAborted();
    return fn();
  }, retry);
}

/** An error with a reason, in one expression. */
export function providerError(
  engine: string,
  kind: TranslationProviderError["kind"],
  message: string,
  extra: { status?: number; retryAfterMs?: number; reason?: TranslationProviderError["reason"] } = {},
): TranslationProviderError {
  const error = new TranslationProviderError(engine, kind, message, extra.status, extra.retryAfterMs);
  if (extra.reason) error.reason = extra.reason;
  return error;
}

// ---------------------------------------------------------------- segments and batches

export interface WireItem {
  /** Position in the request. */
  index: number;
  segment: WireSegment;
}

export interface WirePlan {
  /** One slot per request segment; filled already for segments that aren't sent. */
  translations: string[];
  items: WireItem[];
}

/**
 * Encodes a request's segments. A segment without text (empty, spaces, only
 * codes) comes back unchanged without being sent: Google bills even an empty
 * query. A segment the engine can't take (`tooLarge`) fails the request
 * before any call, so the router can try the next engine.
 */
export function planSegments(engine: string, request: TranslationRequest, tooLarge: (segment: WireSegment) => boolean): WirePlan {
  const translations = [...request.segments];
  const items: WireItem[] = [];
  request.segments.forEach((source, index) => {
    if (!markupToPlainText(source).trim()) return;
    const segment = encodeSegment(source, { softBreaks: request.softBreaks?.[index] === true });
    if (tooLarge(segment)) {
      throw providerError(engine, "invalid", "segment too large", { reason: "REQUEST_TOO_LARGE" });
    }
    items.push({ index, segment });
  });
  return { translations, items };
}

export interface BatchRun {
  engine: string;
  request: TranslationRequest;
  plan: WirePlan;
  retry: RetryOptions;
  signal?: AbortSignal;
  /** Splits the items of one wire mode into requests (order kept). */
  batches(items: readonly WireItem[]): WireItem[][];
  /** One request: a translation per text, in order; null where the engine returned none. */
  send(texts: string[], mode: WireMode, signal?: AbortSignal): Promise<Array<string | null>>;
}

/**
 * Runs the batches one after another (order and partial billing stay simple)
 * and decodes every answer. Segments are grouped by wire mode (an engine's
 * HTML/plain switch is per request). A batch the engine refuses as too large
 * is split in halves; rejected requests aren't billed. A failure after
 * earlier batches carries what those batches counted (billedCharacters), as
 * in deepl.ts.
 */
export async function runBatches(run: BatchRun): Promise<Omit<TranslationResult, "provider">> {
  const { plan, request, signal } = run;
  const translations = [...plan.translations];
  const notes: Array<{ index: number; code: SegmentNoteCode }> = [];
  let billedCharacters = 0;

  const sendBatch = async (batch: WireItem[]): Promise<void> => {
    signal?.throwIfAborted();
    let outputs: Array<string | null>;
    try {
      outputs = await retrying(() => run.send(batch.map((item) => item.segment.wire), batch[0]!.segment.mode, signal), run.retry, signal);
    } catch (error) {
      if (error instanceof TranslationProviderError && error.reason === "REQUEST_TOO_LARGE" && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await sendBatch(batch.slice(0, half));
        await sendBatch(batch.slice(half));
        return;
      }
      throw error;
    }
    batch.forEach((item, i) => {
      billedCharacters += item.segment.textChars;
      const output = outputs[i];
      // No text for this entry (Google: "might be excluded" on error): refused, the rest of the batch kept.
      const decoded =
        typeof output === "string"
          ? decodeSegment(output, item.segment, request.targetLocale)
          : { text: UNMAPPABLE_SEGMENT, note: "ENGINE_MARKUP" as const };
      translations[item.index] = decoded.text;
      if (decoded.note) notes.push({ index: item.index, code: decoded.note });
    });
  };

  const byMode = (mode: WireMode) => plan.items.filter((item) => item.segment.mode === mode);
  const batches = [...run.batches(byMode("html")), ...run.batches(byMode("plain"))]
    .filter((batch) => batch.length > 0)
    .sort((a, b) => a[0]!.index - b[0]!.index);
  try {
    for (const batch of batches) await sendBatch(batch);
  } catch (error) {
    // Earlier batches were billed: the caller meters them rather than releasing everything. On a
    // copy: the error may be shared with other requests (a token refresh they all waited for).
    if (billedCharacters > 0 && error instanceof TranslationProviderError) throw withProviderFields(error, { billedCharacters });
    throw error;
  }

  // Neither HTML-transport engine has a form of address or a context field.
  const dropped: Array<"formality" | "context"> = [];
  if (request.formality) dropped.push("formality");
  if (request.context) dropped.push("context");
  return {
    translations,
    billedCharacters,
    ...(dropped.length ? { dropped } : {}),
    ...(notes.length ? { notes: notes.sort((a, b) => a.index - b.index) } : {}),
  };
}
