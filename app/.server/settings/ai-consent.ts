/**
 * Which translation engines a shop's AI consent covers (docs/AI_ENGINES.md,
 * docs/LEGAL_FACTS.md). The stored consent version encodes the consent
 * tokens the merchant was shown, so adding an engine never invalidates a
 * consent: the shop keeps translating with what it accepted and is asked to
 * allow the new engine too.
 *
 * DeepL only keeps the version every shop accepted before engines could be
 * combined, so KARINEX never has to consent again.
 */
import { CONSENT_TOKENS, isConsentToken, type ConsentToken } from "../../lib/engines";

export const LEGACY_DEEPL_CONSENT = "2026-10-deepl-v1";
/** Bump when the multi-engine notice text changes (shops then allow their other engines again). */
export const ENGINES_NOTICE = "2026-11-engines-v1";

const ENGINES_VERSION = /^(\d{4}-\d{2}-engines-v\d+):([a-z,-]+)$/;

/** ["deepl"] → LEGACY_DEEPL_CONSENT; any other set → `${ENGINES_NOTICE}:${sorted tokens joined by ","}`. */
export function consentVersionFor(tokens: readonly ConsentToken[]): string {
  const unique = [...new Set(tokens)].sort();
  if (unique.length === 1 && unique[0] === "deepl") return LEGACY_DEEPL_CONSENT;
  return `${ENGINES_NOTICE}:${unique.join(",")}`;
}

/**
 * The tokens a stored version covers. Legacy → ["deepl"]. Current notice →
 * its tokens. An outdated `…-engines-vN:<tokens>` → ["deepl"] when its list
 * contains deepl (DeepL's notice didn't change; lawyer to confirm), else
 * null. Unknown → null.
 */
export function consentTokens(version: string | null): ConsentToken[] | null {
  if (version === LEGACY_DEEPL_CONSENT) return ["deepl"];
  const match = version ? ENGINES_VERSION.exec(version) : null;
  if (!match) return null;
  const tokens = match[2]!.split(",");
  if (tokens.length === 0 || !tokens.every(isConsentToken)) return null;
  const known = CONSENT_TOKENS.filter((t) => tokens.includes(t));
  if (match[1] === ENGINES_NOTICE) return known;
  return known.includes("deepl") ? ["deepl"] : null;
}
