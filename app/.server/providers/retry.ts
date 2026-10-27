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
