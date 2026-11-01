/**
 * The key form of the Own key plan, validated without any outbound call:
 * which engine, a key in that engine's shape, Azure's region and data
 * location (docs/AI_ENGINES.md). Pure. Returns codes only, never a message
 * that could repeat what was typed, and wraps the key in a SecretValue at
 * once (the raw form string is not kept).
 */
import { ENGINE_IDS, type EngineId } from "../../lib/engines";
import { azureRegion, pasted, type AppConfig } from "../lib/config";
import { SecretValue } from "../lib/secret";

export type OwnKeyMode = "live" | "mock";

/**
 * Mock everywhere but a production build outside staging: local development (`pnpm dev`, where
 * TRANSLATION_PROVIDER defaults to "deepl" and .env.example sets it), every test suite, the mock
 * provider and staging. No outbound check, no real key accepted. Tests that exercise the live
 * checker or live members pass mode "live" and a fake fetch through EngineKeyDeps /
 * openShopTranslation options, never through env.
 */
export function ownKeyMode(config: Pick<AppConfig, "NODE_ENV" | "TRANSLATION_PROVIDER" | "LINGUVA_STAGE">): OwnKeyMode {
  return config.NODE_ENV !== "production" || config.TRANSLATION_PROVIDER === "mock" || config.LINGUVA_STAGE === "staging" ? "mock" : "live";
}

export type EngineKeyInput =
  | { engine: "deepl"; apiKey: SecretValue }
  | { engine: "azure"; apiKey: SecretValue; region?: string; location: "eu" | "global" }
  | { engine: "google"; apiKey: SecretValue };

export type EngineKeyFormError = "ENGINE_UNKNOWN" | "KEY_FORMAT" | "REGION_FORMAT" | "KEY_MOCK_ONLY";

export type ParsedEngineKey = {
  ok: true;
  input: EngineKeyInput;
  /** Exactly four characters of [A-Za-z0-9._-] (the database CHECK enforces it). */
  hint: string;
  dataLocation: "eu" | "global";
  region: string | null;
  deeplPlan: "free" | "pro" | null;
};

/** Longest input looked at: anything longer isn't a key (checked before any regex runs). */
const MAX_INPUT = 4096;

const LIVE_KEY: Record<EngineId, RegExp> = {
  // A UUID-like key, ":fx" for DeepL API Free.
  deepl: /^[A-Za-z0-9][A-Za-z0-9-]{15,99}(:fx)?$/,
  // The same rule as the operator's Translator key (config.ts).
  azure: /^[A-Za-z0-9]{16,128}$/,
  // The same rule as the operator's Google Cloud API key (config.ts).
  google: /^[A-Za-z0-9._-]{20,200}$/,
};
/** Test keys, the only ones mock mode accepts (staging, development, tests). */
const MOCK_KEY = /^mock-[a-z0-9-]{1,60}(:fx)?$/;
const REGION = /^[a-z0-9]{2,32}$/;

export function isEngineIdValue(value: unknown): value is EngineId {
  return typeof value === "string" && (ENGINE_IDS as readonly string[]).includes(value);
}

/** The key's last four characters (DeepL without ":fx"). */
export function keyHint(engine: EngineId, key: string): string {
  return (engine === "deepl" ? key.replace(/:fx$/, "") : key).slice(-4);
}

export function parseEngineKeyForm(
  raw: { engine: unknown; apiKey: unknown; region?: unknown; location?: unknown },
  mode: OwnKeyMode,
): ParsedEngineKey | { ok: false; error: EngineKeyFormError } {
  const engine = raw.engine;
  if (!isEngineIdValue(engine)) return { ok: false, error: "ENGINE_UNKNOWN" };
  if (typeof raw.apiKey !== "string" || raw.apiKey.length > MAX_INPUT) return { ok: false, error: "KEY_FORMAT" };
  const key = pasted(raw.apiKey);
  if (typeof key !== "string") return { ok: false, error: "KEY_FORMAT" };
  if (mode === "mock") {
    if (!MOCK_KEY.test(key)) return { ok: false, error: "KEY_MOCK_ONLY" };
    // ":fx" marks a DeepL API Free key; another engine's key never ends in it.
    if (engine !== "deepl" && key.endsWith(":fx")) return { ok: false, error: "KEY_FORMAT" };
  } else if (!LIVE_KEY[engine].test(key)) {
    return { ok: false, error: "KEY_FORMAT" };
  }
  const apiKey = new SecretValue(key);
  const hint = keyHint(engine, key);
  if (engine === "deepl") {
    return { ok: true, input: { engine, apiKey }, hint, dataLocation: "eu", region: null, deeplPlan: key.endsWith(":fx") ? "free" : "pro" };
  }
  if (engine === "google") {
    return { ok: true, input: { engine, apiKey }, hint, dataLocation: "global", region: null, deeplPlan: null };
  }
  const location = raw.location === undefined || raw.location === null || raw.location === "" ? "eu" : raw.location;
  if (location !== "eu" && location !== "global") return { ok: false, error: "KEY_FORMAT" };
  if (raw.region !== undefined && raw.region !== null && typeof raw.region !== "string") return { ok: false, error: "REGION_FORMAT" };
  if (typeof raw.region === "string" && raw.region.length > MAX_INPUT) return { ok: false, error: "REGION_FORMAT" };
  const region = azureRegion(raw.region ?? undefined);
  if (region !== undefined && (typeof region !== "string" || !REGION.test(region))) return { ok: false, error: "REGION_FORMAT" };
  return {
    ok: true,
    input: { engine, apiKey, ...(region ? { region } : {}), location },
    hint,
    dataLocation: location,
    region: region ?? null,
    deeplPlan: null,
  };
}
