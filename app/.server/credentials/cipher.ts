/**
 * Encryption of merchant engine keys (Own key plan): the same keyring as
 * sessions (TOKEN_ENCRYPTION_KEYS, the first entry encrypts), with an AAD
 * context binding each envelope to its shop, engine, data location and
 * region, and a keyed fingerprint as the process state key of a credential
 * (docs/SECURITY_MODEL.md §3).
 */
import type { EngineId } from "../../lib/engines";
import { getConfig, type AppConfig } from "../lib/config";
import { TokenCipher } from "../lib/crypto";

let memo: { keyring: string; cipher: TokenCipher } | undefined;

/** One cipher for merchant keys, from TOKEN_ENCRYPTION_KEYS (the same keyring as sessions). */
export function credentialCipher(config: Pick<AppConfig, "TOKEN_ENCRYPTION_KEYS"> = getConfig()): TokenCipher {
  if (memo?.keyring !== config.TOKEN_ENCRYPTION_KEYS) {
    memo = { keyring: config.TOKEN_ENCRYPTION_KEYS, cipher: TokenCipher.fromKeyring(config.TOKEN_ENCRYPTION_KEYS) };
  }
  return memo.cipher;
}

/** AAD context: a row copied to another shop, engine, endpoint or region doesn't decrypt. */
export function credentialContext(row: { shopId: string; engine: EngineId; dataLocation: "eu" | "global"; region: string | null }): string {
  return ["engine-credential", row.shopId, row.engine, row.dataLocation, row.region ?? ""].join("\u0000");
}

/**
 * What a credential's fingerprint is made of (the caller passes the key it holds): DeepL and Google
 * the key; Azure the key, region and endpoint (a key used in another region or endpoint is another
 * account state).
 */
export function stateMaterial(engine: EngineId, key: string, azure?: { region: string | null; endpoint: string }): string {
  return engine === "azure" && azure ? [key, azure.region ?? "", azure.endpoint].join("\u0000") : key;
}

/** Process state key of a merchant credential: never the key. */
export function ownStateKey(engine: EngineId, material: string, cipher: TokenCipher = credentialCipher()): string {
  return `own:${engine}:${cipher.fingerprint("engine-credential", `${engine}\u0000${material}`)}`;
}
