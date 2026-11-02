/**
 * Which translation engines a shop's AI consent covers (docs/AI_ENGINES.md,
 * docs/LEGAL_FACTS.md). The stored consent version encodes the consent
 * tokens the merchant was shown, so adding an engine never invalidates a
 * consent: the shop keeps translating with what it accepted and is asked to
 * allow the new engine too.
 *
 * DeepL only keeps the version every shop accepted before engines could be
 * combined, so KARINEX never has to consent again.
 *
 * The Own key plan sends texts through the merchant's own keys, under its own
 * contract with each service: a different notice, so a separate version family
 * (`OWN_KEY_NOTICE:<tokens>`, payer "merchant"). A consent to one notice never
 * covers the other, so a plan change in either direction asks once again.
 */
import { CONSENT_TOKENS, isConsentToken, type ConsentToken } from "../../lib/engines";

export const LEGACY_DEEPL_CONSENT = "2026-10-deepl-v1";
/** Bump when the multi-engine notice text changes (shops then allow their other engines again). */
export const ENGINES_NOTICE = "2026-11-engines-v1";

const ENGINES_VERSION = /^(\d{4}-\d{2}-engines-v\d+):([a-z,-]+)$/;

/** Who the texts go to under: Linguva's engines and notice, or the merchant's own keys (Own key plan) and its notice. */
export type ConsentPayer = "linguva" | "merchant";
/** Bump when the own-key notice text changes (own-key shops are then asked again). */
export const OWN_KEY_NOTICE = "2026-11-ownkey-v1";
const OWN_KEY_VERSION = /^(\d{4}-\d{2}-ownkey-v\d+):([a-z,-]+)$/;

/**
 * Payer "linguva" (default): ["deepl"] → LEGACY_DEEPL_CONSENT; any other set →
 * `${ENGINES_NOTICE}:${sorted tokens joined by ","}`. Payer "merchant": always
 * `${OWN_KEY_NOTICE}:${sorted tokens}`, also for ["deepl"].
 */
export function consentVersionFor(tokens: readonly ConsentToken[], payer: ConsentPayer = "linguva"): string {
  const unique = [...new Set(tokens)].sort();
  if (payer === "merchant") return `${OWN_KEY_NOTICE}:${unique.join(",")}`;
  if (unique.length === 1 && unique[0] === "deepl") return LEGACY_DEEPL_CONSENT;
  return `${ENGINES_NOTICE}:${unique.join(",")}`;
}

/** Tokens of a current own-key version; an outdated or unknown one → null (asked again). */
function ownKeyConsentTokens(version: string | null): ConsentToken[] | null {
  const match = version ? OWN_KEY_VERSION.exec(version) : null;
  if (!match || match[1] !== OWN_KEY_NOTICE) return null;
  const tokens = match[2]!.split(",");
  if (!tokens.every(isConsentToken)) return null;
  return CONSENT_TOKENS.filter((t) => tokens.includes(t));
}

/**
 * The tokens a stored version covers. Legacy → ["deepl"]. Current notice →
 * its tokens. An outdated `…-engines-vN:<tokens>` → ["deepl"] when its list
 * contains deepl (DeepL's notice didn't change; lawyer to confirm), else
 * null. Unknown → null.
 *
 * Only a version of the same payer counts: an own-key version covers nothing
 * for "linguva" (ENGINES_VERSION doesn't match it), a legacy or engines
 * version nothing for "merchant", and an outdated own-key version nothing.
 */
export function consentTokens(version: string | null, payer: ConsentPayer = "linguva"): ConsentToken[] | null {
  if (payer === "merchant") return ownKeyConsentTokens(version);
  if (version === LEGACY_DEEPL_CONSENT) return ["deepl"];
  const match = version ? ENGINES_VERSION.exec(version) : null;
  if (!match) return null;
  const tokens = match[2]!.split(",");
  if (tokens.length === 0 || !tokens.every(isConsentToken)) return null;
  const known = CONSENT_TOKENS.filter((t) => tokens.includes(t));
  if (match[1] === ENGINES_NOTICE) return known;
  return known.includes("deepl") ? ["deepl"] : null;
}
