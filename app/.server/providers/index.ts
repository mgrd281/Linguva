import { deeplApiKeys, getConfig } from "../lib/config";
import { DeepLProvider } from "./deepl";
import { DeepLKeyPool } from "./deepl-pool";
import { MockTranslationProvider } from "./mock";
import type { TranslationProvider } from "./types";

/** The configured machine translation provider, or null if none is set up. */
export function getTranslationProvider(): TranslationProvider | null {
  const config = getConfig();
  if (config.TRANSLATION_PROVIDER === "mock") return new MockTranslationProvider();
  const keys = deeplApiKeys(config);
  if (keys.length === 0) return null;
  if (keys.length === 1) return new DeepLProvider({ apiKey: keys[0]!, baseUrl: config.DEEPL_API_URL });
  return new DeepLKeyPool(keys, { baseUrl: config.DEEPL_API_URL });
}
