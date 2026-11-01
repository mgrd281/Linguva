import { azureTranslatorSettings, deeplApiKeys, googleTranslateSettings, translationEngineOrder, type AppConfig } from "../lib/config";
import { AzureTranslatorProvider } from "./azure";
import { DeepLProvider } from "./deepl";
import { DeepLKeyPool } from "./deepl-pool";
import type { RoutedEngine } from "./engine-router";
import { GoogleTranslateProvider } from "./google";

/**
 * Engines in use, in routing order, each built exactly once from config (no
 * network, no signing: this runs per request). DeepL as today: one key →
 * DeepLProvider, several → DeepLKeyPool, with the same arguments.
 */
export function routedEngines(config: AppConfig, options: { fetch?: typeof fetch } = {}): RoutedEngine[] {
  const engines: RoutedEngine[] = [];
  for (const id of translationEngineOrder(config)) {
    if (id === "deepl") {
      const keys = deeplApiKeys(config);
      // `fetch` only when a test passes one: production DeepL objects are built exactly as before.
      const extra = options.fetch ? { fetch: options.fetch } : {};
      engines.push({
        id,
        provider:
          keys.length === 1
            ? new DeepLProvider({ apiKey: keys[0]!, baseUrl: config.DEEPL_API_URL, ...extra })
            : new DeepLKeyPool(keys, { baseUrl: config.DEEPL_API_URL, ...extra }),
      });
    } else if (id === "azure") {
      const azure = azureTranslatorSettings(config)!;
      engines.push({
        id,
        provider: new AzureTranslatorProvider({ key: azure.key, region: azure.region, endpoint: azure.endpoint, fetch: options.fetch }),
      });
    } else {
      const google = googleTranslateSettings(config)!;
      engines.push({
        id,
        provider: new GoogleTranslateProvider({
          auth: google.kind === "apiKey" ? { kind: "apiKey", apiKey: google.apiKey } : { kind: "serviceAccount", credentials: google.credentials },
          fetch: options.fetch,
        }),
      });
    }
  }
  return engines;
}
