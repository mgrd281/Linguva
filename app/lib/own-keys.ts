/**
 * The Own key plan's saved engine keys as pages see them (client-safe: no
 * key, at most its last four characters), the consent token of a saved key
 * and the job stop codes that name a merchant's key (docs/AI_ENGINES.md).
 */
import { ENGINE_IDS, type ConsentToken, type EngineId } from "./engines";

/** RECHECK: not usable until a "Check again" succeeds (set only by the restore runbook, docs/DATABASE_SCHEMA.md). */
export type OwnKeyStatus = "OK" | "QUOTA" | "REFUSED" | "UNREADABLE" | "RECHECK";

/** What pages get about a saved key: never the key or more than its last four characters. */
export interface OwnKeySummary {
  engine: EngineId;
  /** Exactly four characters: the key's end (DeepL without ":fx"). */
  hint: string;
  status: OwnKeyStatus;
  dataLocation: "eu" | "global";
  /** Azure only. */
  region: string | null;
  /** DeepL only. */
  deeplPlan: "free" | "pro" | null;
  /** Last successful check (save or "Check again"), ISO. */
  verifiedAt: string;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

/** Brand names of DeepL's API plans (the same in every language). */
export const DEEPL_PLAN_NAMES = { free: "DeepL API Free", pro: "DeepL API Pro" } as const;

/** A key the provider is built from: accepted, possibly with its quota used up for now. */
export const usableOwnKey = (k: Pick<OwnKeySummary, "status">) => k.status === "OK" || k.status === "QUOTA";

/** Consent token of a saved key: DeepL "deepl"; Azure by its endpoint; Google API key "google-global". */
export function ownKeyToken(k: Pick<OwnKeySummary, "engine" | "dataLocation">): ConsentToken {
  if (k.engine === "deepl") return "deepl";
  if (k.engine === "azure") return k.dataLocation === "global" ? "azure-global" : "azure-eu";
  return "google-global";
}

const ENGINE_CODE: Record<EngineId, string> = { deepl: "DEEPL", azure: "AZURE", google: "GOOGLE" };

/** Job stop code naming the merchant's key: OWN_KEY_QUOTA_DEEPL, OWN_KEY_AUTH_GOOGLE, … (fits ^[A-Z_]{1,40}$). */
export function ownKeyStopCode(kind: "quota" | "auth", engine: EngineId): string {
  return `OWN_KEY_${kind === "quota" ? "QUOTA" : "AUTH"}_${ENGINE_CODE[engine]}`;
}

export type OwnKeyCode = { kind: "MISSING" } | { kind: "QUOTA" | "AUTH"; engine: EngineId };

export function parseOwnKeyCode(code: string | null | undefined): OwnKeyCode | null {
  if (code === "OWN_KEY_MISSING") return { kind: "MISSING" };
  const m = code ? /^OWN_KEY_(QUOTA|AUTH)_(DEEPL|AZURE|GOOGLE)$/.exec(code) : null;
  if (!m) return null;
  const engine = ENGINE_IDS.find((id) => ENGINE_CODE[id] === m[2])!;
  return { kind: m[1] as "QUOTA" | "AUTH", engine };
}

export const isOwnKeyCode = (code: string | null | undefined) => parseOwnKeyCode(code) !== null;
