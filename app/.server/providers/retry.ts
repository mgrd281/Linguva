import { TranslationProviderError } from "./types";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry-After as milliseconds: delta-seconds ("7", "1.5") or an HTTP date.
 * Undefined when absent or unreadable; never negative (a date in the past is 0).
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  // HTTP dates start with a day name ("Wed, 21 Oct 2026 07:28:00 GMT"); this
  // keeps Date.parse from reading "-5" or "2026" as a date.
  if (!/^[A-Za-z]{3}/.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/**
 * Retries retryable provider errors with exponential backoff and full
 * jitter, honouring Retry-After when the provider sends one. Other errors
 * (quota, auth, invalid) fail immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable =
        error instanceof TranslationProviderError && error.kind === "retryable";
      if (!retryable || attempt >= options.retries) throw error;
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      const delay = error.retryAfterMs ?? Math.round(random() * backoff);
      await sleep(Math.min(delay, options.maxDelayMs));
    }
  }
}
