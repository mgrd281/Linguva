/**
 * Which target languages AI translation covers, for the Languages page and
 * the editor: read from the configured engines (each engine's own list),
 * never assumed. "unknown" when the provider couldn't be asked; "none"
 * without a provider.
 */
import { logger } from "../lib/logger";
import { isEngineId, type EngineId } from "../../lib/engines";
import { isEngineRouter } from "./engine-router";
import type { TranslationProvider } from "./types";

export type AiSupport = "supported" | "unsupported" | "unknown" | "none";

export async function aiLanguageSupport(provider: TranslationProvider | null, locales: readonly string[]): Promise<Record<string, AiSupport>> {
  if (!provider) return Object.fromEntries(locales.map((l) => [l, "none" as const]));
  if (!provider.targetSupport) return Object.fromEntries(locales.map((l) => [l, "supported" as const]));
  try {
    const support = await provider.targetSupport(locales);
    return Object.fromEntries(locales.map((l) => [l, support.get(l) ? ("supported" as const) : ("unsupported" as const)]));
  } catch (error) {
    logger.warn({ provider: provider.id, err: (error as Error).name }, "couldn't read the provider's languages");
    return Object.fromEntries(locales.map((l) => [l, "unknown" as const]));
  }
}

export interface AiCoverage {
  state: AiSupport | "needsConsent";
  /** supported: the engine that serves it first; needsConsent: the engine that would. */
  engine: EngineId | null;
}

/**
 * Per locale: supported (and by which engine), needsConsent (only an engine
 * outside `allowed` serves it, and which), unsupported, unknown, none.
 * Router: its plan(); a single engine: its targetSupport and id.
 */
export async function aiLanguageCoverage(
  provider: TranslationProvider | null,
  locales: readonly string[],
  allowed: readonly string[],
): Promise<Record<string, AiCoverage>> {
  if (!isEngineRouter(provider)) {
    const support = await aiLanguageSupport(provider, locales);
    const engine = provider && isEngineId(provider.id) ? provider.id : null;
    return Object.fromEntries(locales.map((l) => [l, { state: support[l]!, engine: support[l] === "supported" ? engine : null }]));
  }
  const plans = await provider.plan(locales, allowed);
  return Object.fromEntries(
    locales.map((l): [string, AiCoverage] => {
      const plan = plans.get(l);
      if (plan?.servedBy) {
        // Supported only if some candidate's own list says so. The engine is named only when the one
        // tried first is known to serve it: with DeepL's list unreadable, DeepL still gets the
        // language first, so naming the next engine would be wrong.
        if (plan.candidates.every((id) => plan.unknown.includes(id))) return [l, { state: "unknown", engine: null }];
        return [l, { state: "supported", engine: plan.unknown.includes(plan.servedBy) ? null : plan.servedBy }];
      }
      // Needs consent only for an engine whose own list says it serves the language.
      const consent = plan?.blocked.find((id) => !plan.unknown.includes(id));
      if (consent) return [l, { state: "needsConsent", engine: consent }];
      if (plan?.blocked.length) return [l, { state: "unknown", engine: null }];
      return [l, { state: "unsupported", engine: null }];
    }),
  );
}

/**
 * For the form of address in Settings: the engine that translates each target first and the
 * engines that can't set a form. Several engines: the router's plan (only among `allowed`). One
 * engine without a form of address (Azure or Google alone): it serves every language. DeepL alone
 * (and the mock) declare no capabilities: null and [], today's choice for every language.
 */
export async function formalityEngines(
  provider: TranslationProvider | null,
  targets: readonly string[],
  allowed: readonly string[],
): Promise<{ servedBy: Record<string, EngineId | null> | null; noFormality: EngineId[] }> {
  if (isEngineRouter(provider)) {
    const plans = await provider.plan(targets, allowed);
    return {
      servedBy: Object.fromEntries(targets.map((l) => [l, plans.get(l)?.servedBy ?? null])),
      noFormality: provider.engines.filter((id) => !provider.capabilitiesOf(id).formality),
    };
  }
  if (provider && provider.capabilities?.formality === false && isEngineId(provider.id)) {
    const id = provider.id;
    return { servedBy: Object.fromEntries(targets.map((l) => [l, id])), noFormality: [id] };
  }
  return { servedBy: null, noFormality: [] };
}
