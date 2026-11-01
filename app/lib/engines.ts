/**
 * The machine translation engines Linguva can use, shared by the server and
 * the pages (client-safe: names and ids only, no configuration).
 *
 * Two vocabularies:
 * - engine ids ("deepl", "azure", "google"): routing, ledger rows, drafts;
 * - consent tokens: the engine plus where it processes ("azure-eu",
 *   "google-global", …). Consent, legal texts, page blocks and preflight all
 *   speak this one; a change of data location is a change of token, so it
 *   needs the merchant's consent again.
 */

/** Also the default routing order. */
export const ENGINE_IDS = ["deepl", "azure", "google"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Brand names, the same in every interface language. */
export const ENGINE_NAMES: Record<EngineId, string> = { deepl: "DeepL", azure: "Microsoft Azure", google: "Google Cloud" };

export function isEngineId(value: string): value is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * The one vocabulary for consent, legal texts, page blocks and preflight: the
 * engine plus where it processes. Pages additionally accept the engine id for
 * an engine's shared block.
 */
export const CONSENT_TOKENS = ["deepl", "azure-eu", "azure-global", "google-eu", "google-global"] as const;
export type ConsentToken = (typeof CONSENT_TOKENS)[number];

export function isConsentToken(value: string): value is ConsentToken {
  return (CONSENT_TOKENS as readonly string[]).includes(value);
}

export function engineOfToken(token: ConsentToken): EngineId {
  return token.split("-")[0] as EngineId;
}
