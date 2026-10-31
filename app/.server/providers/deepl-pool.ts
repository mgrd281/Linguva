import { createHash } from "node:crypto";

import { DeepLProvider, type DeepLOptions } from "./deepl";
import { TranslationProviderError, type TranslationProvider, type TranslationRequest, type TranslationResult } from "./types";

// A key whose quota is used up or that is refused is skipped for a while, then tried again.
const QUOTA_PAUSE_MS = 60 * 60 * 1000;
const AUTH_PAUSE_MS = 6 * 60 * 60 * 1000;

/** Paused keys, by a hash of the key (the key itself is never kept here). Shared by every pool in the process. */
const pausedUntil = new Map<string, number>();

export function clearDeepLKeyPauses(): void {
  pausedUntil.clear();
}

/** Whether the pool is skipping this key for now (its quota was used up or it was refused). */
export function isDeepLKeyResting(key: string, now = Date.now()): boolean {
  return (pausedUntil.get(slot(key)) ?? 0) > now;
}

function slot(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Several DeepL keys behind one provider: a request goes to the first key
 * that works. When a key's quota is used up (456) or the key is refused
 * (401/403), the same request moves to the next key and that key rests for a
 * while. Other errors (rate limits, bad input) are not a reason to switch.
 */
export class DeepLKeyPool implements TranslationProvider {
  readonly id = "deepl";
  private readonly members: Array<{ slot: string; provider: DeepLProvider }>;

  constructor(
    keys: readonly string[],
    options: Omit<DeepLOptions, "apiKey"> = {},
    private readonly now: () => number = Date.now,
  ) {
    if (keys.length === 0) throw new Error("At least one DeepL API key is required");
    this.members = keys.map((apiKey) => ({ slot: slot(apiKey), provider: new DeepLProvider({ ...options, apiKey }) }));
  }

  /** Keys not resting; if every key is resting, all of them (a limit may have been lifted). */
  private candidates() {
    const at = this.now();
    const ready = this.members.filter((m) => (pausedUntil.get(m.slot) ?? 0) <= at);
    return ready.length ? ready : this.members;
  }

  private rest(member: { slot: string }, error: TranslationProviderError): void {
    pausedUntil.set(member.slot, this.now() + (error.kind === "quota" ? QUOTA_PAUSE_MS : AUTH_PAUSE_MS));
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    let last: TranslationProviderError | undefined;
    for (const member of this.candidates()) {
      try {
        return await member.provider.translate(request, signal);
      } catch (error) {
        if (error instanceof TranslationProviderError && (error.kind === "quota" || error.kind === "auth")) {
          this.rest(member, error);
          last = error;
          continue;
        }
        throw error;
      }
    }
    throw last!;
  }

  async targetSupport(locales: readonly string[]): Promise<Map<string, boolean>> {
    let last: TranslationProviderError | undefined;
    for (const member of this.candidates()) {
      try {
        return await member.provider.targetSupport(locales);
      } catch (error) {
        if (error instanceof TranslationProviderError && (error.kind === "quota" || error.kind === "auth")) {
          this.rest(member, error);
          last = error;
          continue;
        }
        throw error;
      }
    }
    throw last!;
  }
}
