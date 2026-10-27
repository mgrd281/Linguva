import { getConfig } from "../lib/config";
import { DeepLProvider } from "./deepl";
import type { TranslationProvider } from "./types";

/** The configured machine translation provider, or null if none is set up. */
export function getTranslationProvider(): TranslationProvider | null {
  const config = getConfig();
  if (!config.DEEPL_API_KEY) return null;
  return new DeepLProvider({ apiKey: config.DEEPL_API_KEY, baseUrl: config.DEEPL_API_URL });
}
