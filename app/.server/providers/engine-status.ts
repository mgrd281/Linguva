/**
 * The translation services card for the operator's own stores (OPERATOR_SHOPS
 * only, with an engine beside DeepL): order, state, data location and how
 * many of the store's languages each engine serves for this store (only the
 * engines its consent covers translate for it). Free checks only: the
 * DeepL keys' usage, Azure's key check (an empty translate call, 0
 * characters), Google's language list (and token): never a billed
 * translation, so the card costs nothing. Rests are this
 * process's view (like the DeepL key pool's); a separate worker keeps its own.
 * No ledger query and nothing about other shops.
 */
import { createHash } from "node:crypto";
import { azureTranslatorSettings, deeplApiKeys, googleTranslateSettings, type AppConfig } from "../lib/config";
import type { EngineId } from "../../lib/engines";
import { AzureTranslatorProvider } from "./azure";
import { deeplKeysUsage, type DeepLKeyUsage } from "./deepl-usage";
import { engineRest, type EngineRestKind } from "./engine-router";
import { routedEngines } from "./engines";
import { GoogleTranslateProvider } from "./google";

export type EngineState = "ok" | "resting" | "refused" | "unreachable";

export interface EngineTile {
  id: "azure" | "google";
  /** 1-based place in the order. */
  position: number;
  state: EngineState;
  /** ISO time, from engineRest(). */
  rest?: { kind: EngineRestKind; until: string };
  /** Last four characters of the key; Google service account: the project id. Never more. */
  hint: string;
  access: { kind: "region"; region: string } | { kind: "globalResource" } | { kind: "apiKey" } | { kind: "serviceAccount" };
  dataLocation: "eu" | "global";
  /** Shop target languages this engine serves first (among the engines the store allowed). */
  firstChoice: number;
  /** Languages where it is a later candidate. */
  canStepIn: number;
  /** The store's AI consent covers it: until then it translates nothing for this store. */
  allowed: boolean;
}

export interface EnginesCard {
  order: EngineId[];
  totalLanguages: number;
  deepl: { position: number; keys: DeepLKeyUsage[]; firstChoice: number; canStepIn: number; allowed: boolean } | null;
  tiles: EngineTile[];
}

// The checks' answers change rarely: a short cache keeps page views from asking every time.
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; state: "ok" | "refused" | "unreachable" }>();

export function clearEngineStatusCache(): void {
  cache.clear();
}

/** Cache slot by engine and a hash of its credential (the credential itself is never kept here). */
function slot(id: EngineId, credential: string): string {
  return `${id}:${createHash("sha256").update(credential).digest("hex").slice(0, 16)}`;
}

async function checked(key: string, now: number, check: () => Promise<"ok" | "refused" | "unreachable">) {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.state;
  const state = await check();
  cache.set(key, { at: now, state });
  return state;
}

/**
 * For the operator's own stores. `allowed`: the engines the store's AI consent covers
 * (consentedEngines); the counts are among those only, as the store's requests are. None (no
 * consent yet): every configured engine, as the texts before a consent describe all of them.
 */
export async function operatorEngines(
  config: AppConfig,
  targetLocales: readonly string[],
  options: { fetch?: typeof fetch; now?: () => number; allowed?: readonly EngineId[] } = {},
): Promise<EnginesCard> {
  const now = (options.now ?? Date.now)();
  const engines = routedEngines(config, options.fetch ? { fetch: options.fetch } : {});
  const order = engines.map((e) => e.id);
  const consented = order.filter((id) => options.allowed?.includes(id));
  const allowed = new Set(consented.length ? consented : order);

  // Which engines would translate each language, in order (an unreadable list: still a candidate).
  const supports = await Promise.all(
    engines.map(async (e) => {
      if (!e.provider.targetSupport) return null;
      try {
        return await e.provider.targetSupport(targetLocales);
      } catch {
        return null;
      }
    }),
  );
  const firstChoice = new Map<EngineId, number>(order.map((id) => [id, 0]));
  const canStepIn = new Map<EngineId, number>(order.map((id) => [id, 0]));
  for (const locale of targetLocales) {
    const candidates = order.filter((id, i) => allowed.has(id) && supports[i]?.get(locale) !== false);
    candidates.forEach((id, i) => (i === 0 ? firstChoice : canStepIn).set(id, (i === 0 ? firstChoice : canStepIn).get(id)! + 1));
  }

  const position = (id: EngineId) => order.indexOf(id) + 1;
  const overlay = (id: EngineId, state: "ok" | "refused" | "unreachable"): Pick<EngineTile, "state" | "rest"> => {
    const rest = engineRest(id, now);
    if (!rest) return { state };
    return { state: rest.kind === "auth" ? "refused" : "resting", rest: { kind: rest.kind, until: new Date(rest.until).toISOString() } };
  };

  const tiles: Array<Promise<EngineTile>> = [];
  const azure = azureTranslatorSettings(config);
  if (azure && order.includes("azure")) {
    tiles.push(
      (async () => {
        const provider = new AzureTranslatorProvider({ key: azure.key, region: azure.region, endpoint: azure.endpoint, fetch: options.fetch });
        const state = await checked(slot("azure", `${azure.key}:${azure.region ?? ""}`), now, () => provider.checkKey());
        return {
          id: "azure" as const,
          position: position("azure"),
          ...overlay("azure", state),
          hint: azure.key.slice(-4),
          access: azure.region ? { kind: "region" as const, region: azure.region } : { kind: "globalResource" as const },
          dataLocation: azure.dataLocation,
          firstChoice: firstChoice.get("azure") ?? 0,
          canStepIn: canStepIn.get("azure") ?? 0,
          allowed: allowed.has("azure"),
        };
      })(),
    );
  }
  const google = googleTranslateSettings(config);
  if (google && order.includes("google")) {
    tiles.push(
      (async () => {
        const auth = google.kind === "apiKey" ? { kind: "apiKey" as const, apiKey: google.apiKey } : { kind: "serviceAccount" as const, credentials: google.credentials };
        const provider = new GoogleTranslateProvider({ auth, fetch: options.fetch });
        const credential = google.kind === "apiKey" ? google.apiKey : `${google.credentials.clientEmail}:${google.credentials.privateKeyId ?? ""}`;
        const state = await checked(slot("google", credential), now, () => provider.checkCredentials());
        return {
          id: "google" as const,
          position: position("google"),
          ...overlay("google", state),
          hint: google.kind === "apiKey" ? google.apiKey.slice(-4) : google.credentials.projectId,
          access: { kind: google.kind },
          dataLocation: google.dataLocation,
          firstChoice: firstChoice.get("google") ?? 0,
          canStepIn: canStepIn.get("google") ?? 0,
          allowed: allowed.has("google"),
        };
      })(),
    );
  }
  const deeplKeys = deeplApiKeys(config);
  const [deepl, ...resolved] = await Promise.all([
    order.includes("deepl") ? deeplKeysUsage(deeplKeys, { baseUrl: config.DEEPL_API_URL, fetch: options.fetch, now: options.now }) : Promise.resolve(null),
    ...tiles,
  ]);
  return {
    order,
    totalLanguages: targetLocales.length,
    deepl: deepl
      ? { position: position("deepl"), keys: deepl, firstChoice: firstChoice.get("deepl") ?? 0, canStepIn: canStepIn.get("deepl") ?? 0, allowed: allowed.has("deepl") }
      : null,
    tiles: resolved.sort((a, b) => a.position - b.position),
  };
}
