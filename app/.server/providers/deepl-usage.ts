import { DeepLProvider } from "./deepl";
import { isDeepLKeyResting } from "./deepl-pool";
import { TranslationProviderError } from "./types";

export type DeepLKeyState = "ok" | "resting" | "refused" | "unreachable";

export interface DeepLKeyUsage {
  /** 1 for DEEPL_API_KEY, then the next keys in the order they are used. */
  position: number;
  plan: "free" | "pro";
  /** The key's last four characters (before ":fx"), never more. */
  hint: string;
  used: number | null;
  /** null: no limit reported (paid plans). */
  limit: number | null;
  state: DeepLKeyState;
}

// DeepL's own figure moves only when translating: a short cache keeps page views from asking every time.
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; value: Omit<DeepLKeyUsage, "position" | "state"> & { state: "ok" | "refused" | "unreachable" } }>();

export function clearDeepLUsageCache(): void {
  cache.clear();
}

function hintOf(key: string): string {
  return key.replace(/:fx$/, "").slice(-4);
}

async function readOne(key: string, options: { baseUrl?: string; fetch?: typeof fetch }, now: number) {
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const plan: "free" | "pro" = key.endsWith(":fx") ? "free" : "pro";
  let value: Omit<DeepLKeyUsage, "position" | "state"> & { state: "ok" | "refused" | "unreachable" };
  try {
    const usage = await new DeepLProvider({ apiKey: key, baseUrl: options.baseUrl, fetch: options.fetch, timeoutMs: 5_000 }).getUsage();
    const unlimited = usage.characterLimit <= 0 || usage.characterLimit >= 1e12;
    value = { plan, hint: hintOf(key), used: usage.characterCount, limit: unlimited ? null : usage.characterLimit, state: "ok" };
  } catch (error) {
    const refused = error instanceof TranslationProviderError && error.kind === "auth";
    value = { plan, hint: hintOf(key), used: null, limit: null, state: refused ? "refused" : "unreachable" };
  }
  cache.set(key, { at: now, value });
  return value;
}

/** Each configured key's DeepL usage (GET /v2/usage), for the operator's own stores only. */
export async function deeplKeysUsage(
  keys: readonly string[],
  options: { baseUrl?: string; fetch?: typeof fetch; now?: () => number } = {},
): Promise<DeepLKeyUsage[]> {
  const now = (options.now ?? Date.now)();
  const values = await Promise.all(keys.map((key) => readOne(key, options, now)));
  return values.map((value, i) => ({
    ...value,
    position: i + 1,
    // Resting: the pool moved on after DeepL said its quota was used up.
    state: value.state === "ok" && isDeepLKeyResting(keys[i]!, now) ? "resting" : value.state,
  }));
}
