import { getConfig } from "../lib/config";
import { EngineRouter, isEngineRouter } from "./engine-router";
import { routedEngines } from "./engines";
import { MockTranslationProvider } from "./mock";
import type { TranslationProvider } from "./types";
import type { EngineId } from "../../lib/engines";

/**
 * The configured machine translation provider, or null if none is set up.
 * One engine (DeepL only, as in production today): exactly that engine's
 * object, as before engines could be combined. Two or more: a router.
 */
export function getTranslationProvider(): TranslationProvider | null {
  const config = getConfig();
  if (config.TRANSLATION_PROVIDER === "mock") return new MockTranslationProvider();
  const engines = routedEngines(config);
  if (engines.length === 0) return null;
  if (engines.length === 1) return engines[0]!.provider;
  return new EngineRouter(engines);
}

/**
 * The engine a request for this language goes to first (the usage
 * reservation's provider). No I/O for a non-router (its id) or a router with
 * one allowed engine (that id), so DeepL-only never gets a /v2/languages call
 * before reserveUsage. Otherwise the router's plan; its first engine when no
 * allowed engine serves the language (the request then fails without a call).
 * `sourceLocale`: the text's language, so an engine that recently refused the
 * pair is skipped here as translate() skips it.
 */
export async function plannedEngine(provider: TranslationProvider, targetLocale: string, engines: readonly string[], sourceLocale?: string): Promise<string> {
  if (!isEngineRouter(provider)) return provider.id;
  const allowed = provider.engines.filter((id) => engines.includes(id));
  if (allowed.length === 0) return provider.id;
  if (allowed.length === 1) return allowed[0]!;
  const plan = (await provider.plan([targetLocale], allowed, sourceLocale)).get(targetLocale);
  return plan?.next ?? allowed[0]!;
}

/**
 * The engine a shop would have to allow for this language, when no engine its consent covers
 * serves it but another configured one does (the Languages page's "once you allow it"): the
 * caller refuses before any text is sent, naming that engine. Null otherwise, without I/O for a
 * single engine (DeepL alone is unchanged) or a consent that covers every configured engine. A
 * list that can't be read counts as serving the language (the request goes ahead as before).
 */
export async function consentGap(provider: TranslationProvider | null, targetLocale: string, engines: readonly string[]): Promise<EngineId | null> {
  if (!isEngineRouter(provider)) return null;
  const allowed = provider.engines.filter((id) => engines.includes(id));
  if (allowed.length === 0 || allowed.length === provider.engines.length) return null;
  const plan = (await provider.plan([targetLocale], allowed)).get(targetLocale);
  if (!plan || plan.servedBy !== null) return null;
  return plan.blocked.find((id) => !plan.unknown.includes(id)) ?? null;
}

/**
 * The signal a caller passes to translate: its stop signal joined with the
 * deadline, for a router only (it checks it between engines). A bare
 * provider gets undefined, exactly as before.
 */
export function routerSignal(provider: TranslationProvider, stop: AbortSignal | undefined, deadlineMs: number): AbortSignal | undefined {
  if (!isEngineRouter(provider)) return undefined;
  const deadline = AbortSignal.timeout(deadlineMs);
  return stop ? AbortSignal.any([stop, deadline]) : deadline;
}

/** For logs and the heartbeat: the router's label ("deepl+azure"), else the id, else "none". */
export function providerLabel(provider: TranslationProvider | null | undefined): string {
  if (!provider) return "none";
  return isEngineRouter(provider) ? provider.label : provider.id;
}
