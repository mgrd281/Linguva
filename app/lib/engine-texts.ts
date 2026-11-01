/**
 * Which consent and data-processing texts a page shows (docs/AI_ENGINES.md).
 * DeepL alone keeps today's texts word for word; any other set of engines
 * gets the `.multi` texts that name every service in use. Pure and
 * client-safe.
 */
import type { I18n } from "../i18n/i18n";
import { ENGINE_NAMES, engineOfToken, type ConsentToken } from "./engines";
import { engineList } from "./name-lists";

/**
 * The tokens a page's texts are about: what the shop's current consent
 * covers among the engines in use, else every engine in use (before any
 * consent the merchant reads about all of them).
 */
export function textTokens(configured: readonly ConsentToken[], consented: readonly ConsentToken[] | null): ConsentToken[] {
  if (consented && consented.length) return configured.filter((t) => consented.includes(t));
  return [...configured];
}

/** True when the texts are today's DeepL-only ones. */
export function isDeepLOnly(tokens: readonly ConsentToken[]): boolean {
  return tokens.length === 0 || (tokens.length === 1 && tokens[0] === "deepl");
}

/** Legal names of the processors, in routing order: "DeepL SE (Germany) and Microsoft Ireland Operations Ltd. (…)". */
export function processorsText(i18n: I18n, tokens: readonly ConsentToken[]): string {
  return engineList(i18n, tokens.map((t) => i18n.t(`common.engine.legal.${t}`)));
}

/** Brand names in routing order: "DeepL and Microsoft Azure". */
export function enginesText(i18n: I18n, tokens: readonly ConsentToken[]): string {
  return engineList(i18n, [...new Set(tokens.map((t) => ENGINE_NAMES[engineOfToken(t)]))]);
}

/** {first} and {next} of the order sentence: "DeepL" and "Microsoft Azure, then Google Cloud". */
export function orderTexts(i18n: I18n, tokens: readonly ConsentToken[]): { first: string; next: string } {
  const names = [...new Set(tokens.map((t) => ENGINE_NAMES[engineOfToken(t)]))];
  const next = names.slice(1).reduce((a, b) => (a ? i18n.t("common.engine.then", { a, b }) : b), "");
  return { first: names[0] ?? "", next };
}

/** The lead sentence of the AI permission: today's for DeepL only, else the processors and their order. */
export function consentLead(i18n: I18n, tokens: readonly ConsentToken[]): string {
  if (isDeepLOnly(tokens)) return i18n.t("settings.ai.lead");
  if (tokens.length === 1) return i18n.t("settings.ai.lead.multiOne", { processors: processorsText(i18n, tokens) });
  return i18n.t("settings.ai.lead.multi", { processors: processorsText(i18n, tokens), ...orderTexts(i18n, tokens) });
}
