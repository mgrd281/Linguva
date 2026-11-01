/**
 * The key check of the Own key plan: one free request per engine with the
 * merchant's key (DeepL /v2/usage, an empty Azure translation, Google v2's
 * language list), read the way translation reads an answer, so a rate limit
 * or a used-up quota is never "refused" (docs/AI_ENGINES.md). The fake-able
 * seam: tests inject a checker or a fake fetch, never env.
 */
import { getConfig, type AppConfig } from "../lib/config";
import { AzureTranslatorProvider } from "../providers/azure";
import { DeepLProvider } from "../providers/deepl";
import { GoogleTranslateProvider } from "../providers/google";
import { TranslationProviderError } from "../providers/types";
import { credentialCipher, ownStateKey } from "./cipher";
import { ownKeyMode, type EngineKeyInput } from "./formats";
import { azureEndpointFor } from "./store";

export interface KeyCheckResult {
  state: "ok" | "quota" | "refused" | "unreachable";
  /** DeepL only, from /v2/usage of the merchant's key. limit null = unlimited. */
  deepl?: { plan: "free" | "pro"; used: number; limit: number | null };
}

export type KeyChecker = (input: EngineKeyInput) => Promise<KeyCheckResult>;

const CHECK_TIMEOUT_MS = 5_000;

/** DeepL's character_limit: 0 or a huge number (Pro without a cost limit) means no limit. */
export function deeplLimit(limit: number): number | null {
  return limit <= 0 || limit >= 1e12 ? null : limit;
}

/** Free checks through the real adapters, 5 s each. `fetch` only in tests. */
export function liveKeyChecker(options: { fetch?: typeof fetch } = {}): KeyChecker {
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  return async (input) => {
    const key = input.apiKey.reveal();
    if (input.engine === "deepl") {
      try {
        // No baseUrl: the key picks the host (":fx" → api-free.deepl.com), never the operator's DeepL address.
        const usage = await new DeepLProvider({ apiKey: key, timeoutMs: CHECK_TIMEOUT_MS, ...fetchOption }).getUsage();
        const limit = deeplLimit(usage.characterLimit);
        const deepl = { plan: key.endsWith(":fx") ? ("free" as const) : ("pro" as const), used: usage.characterCount, limit };
        return { state: limit !== null && usage.characterCount >= limit ? "quota" : "ok", deepl };
      } catch (error) {
        if (error instanceof TranslationProviderError && error.kind === "auth") return { state: "refused" };
        if (error instanceof TranslationProviderError && error.kind === "quota") return { state: "quota" };
        return { state: "unreachable" };
      }
    }
    if (input.engine === "azure") {
      const provider = new AzureTranslatorProvider({
        key,
        ...(input.region ? { region: input.region } : {}),
        endpoint: azureEndpointFor(input.location),
        ...fetchOption,
      });
      return { state: await provider.checkKeyDetailed() };
    }
    const provider = new GoogleTranslateProvider({
      auth: { kind: "apiKey", apiKey: key },
      cacheScope: ownStateKey("google", key, credentialCipher()),
      ...fetchOption,
    });
    return { state: await provider.checkCredentialsDetailed() };
  };
}

/**
 * Offline (mock mode): "-refused" → refused, "-down" → unreachable, "-quota" → quota, else ok;
 * DeepL usage 1,234 of 500,000 (all of it with "-quota"). Never calls fetch.
 */
export const mockKeyChecker: KeyChecker = async (input) => {
  const key = input.apiKey.reveal();
  const state: KeyCheckResult["state"] = key.includes("-refused") ? "refused" : key.includes("-down") ? "unreachable" : key.includes("-quota") ? "quota" : "ok";
  if (input.engine !== "deepl" || state === "refused" || state === "unreachable") return { state };
  return { state, deepl: { plan: key.endsWith(":fx") ? "free" : "pro", used: state === "quota" ? 500_000 : 1_234, limit: 500_000 } };
};

export function defaultKeyChecker(config: AppConfig = getConfig()): KeyChecker {
  return ownKeyMode(config) === "mock" ? mockKeyChecker : liveKeyChecker();
}
