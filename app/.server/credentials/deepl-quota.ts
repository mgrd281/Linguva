/**
 * The merchant's own DeepL usage for the Settings keys card (Own key plan):
 * /v2/usage with the merchant's key, cached two minutes per credential. Azure
 * and Google have no usage API on a key. Settings only; any error shows no
 * figure.
 */
import { DeepLProvider } from "../providers/deepl";
import { deeplLimit } from "./checker";
import type { OwnKeyMode } from "./formats";
import type { OwnCredential } from "./store";

export interface OwnDeepLUsage {
  plan: "free" | "pro";
  used: number;
  /** null: no limit. */
  limit: number | null;
}

const CACHE_MS = 2 * 60_000;
const MAX_ENTRIES = 1_000;
/** By the credential's state key (never the key); two shops with one key share one account's usage. */
const cache = new Map<string, { at: number; usage: OwnDeepLUsage }>();

/** Tests only. */
export function clearOwnDeepLUsageCache(): void {
  cache.clear();
}

export async function ownDeepLUsage(
  shopId: string,
  credential: Pick<OwnCredential, "engine" | "apiKey" | "stateKey">,
  options: { fetch?: typeof fetch; mode: OwnKeyMode; now?: () => number },
): Promise<OwnDeepLUsage | null> {
  if (credential.engine !== "deepl") return null;
  const key = credential.apiKey.reveal();
  const plan = key.endsWith(":fx") ? "free" : "pro";
  if (options.mode === "mock") return { plan, used: 1_234, limit: 500_000 };
  const now = (options.now ?? Date.now)();
  const cached = cache.get(credential.stateKey);
  if (cached && now - cached.at < CACHE_MS) return cached.usage;
  try {
    const usage = await new DeepLProvider({ apiKey: key, timeoutMs: 3_000, ...(options.fetch ? { fetch: options.fetch } : {}) }).getUsage();
    const result: OwnDeepLUsage = { plan, used: usage.characterCount, limit: deeplLimit(usage.characterLimit) };
    cache.delete(credential.stateKey);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(credential.stateKey, { at: now, usage: result });
    return result;
  } catch {
    return null;
  }
}
