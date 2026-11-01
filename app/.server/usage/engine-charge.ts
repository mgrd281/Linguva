/**
 * What a translation charges the shop, per engine (docs/COST_MODEL.md). Only
 * the answering engine's count is charged; what engines that failed before
 * billed (lost to failover) counts for the platform only. The merchant never
 * pays twice for one request.
 */
import { billedBeforeFailure, TranslationProviderError, type TranslationResult } from "../providers/types";

export interface EngineCharge {
  /** Characters charged to the shop, per engine (ledger rows). */
  byEngine: Readonly<Record<string, number>>;
  /** Characters engines billed that the shop isn't charged (failover): platform counter only. */
  lost: Readonly<Record<string, number>>;
}

/** Success: { [result.provider]: result.billedCharacters }, lost = result.lostByEngine ?? {}. */
export function chargeForResult(result: Pick<TranslationResult, "provider" | "billedCharacters" | "lostByEngine">): EngineCharge {
  return { byEngine: { [result.provider]: result.billedCharacters }, lost: { ...(result.lostByEngine ?? {}) } };
}

/**
 * Failure. Without billedByEngine (a bare provider): { [planned]: billedBeforeFailure(error) },
 * as before engines could be combined. With it (a router): min(Σ partials, reservedChars),
 * allocated to the engines in the order tried; the rest is lost.
 */
export function chargeForFailure(error: unknown, reservedChars: number, planned: string): EngineCharge {
  const partials = error instanceof TranslationProviderError ? error.billedByEngine : undefined;
  if (!partials) {
    const billed = billedBeforeFailure(error);
    return { byEngine: billed > 0 ? { [planned]: billed } : {}, lost: {} };
  }
  const byEngine: Record<string, number> = {};
  const lost: Record<string, number> = {};
  let left = Math.max(0, reservedChars);
  for (const [engine, chars] of Object.entries(partials)) {
    if (chars <= 0) continue;
    const charged = Math.min(chars, left);
    left -= charged;
    if (charged > 0) byEngine[engine] = charged;
    if (chars > charged) lost[engine] = chars - charged;
  }
  return { byEngine, lost };
}

/** Characters charged to the shop in total. */
export function chargedChars(charge: EngineCharge): number {
  return Object.values(charge.byEngine).reduce((sum, chars) => sum + chars, 0);
}

/** Characters lost to failover in total. */
export function lostChars(charge: EngineCharge): number {
  return Object.values(charge.lost).reduce((sum, chars) => sum + chars, 0);
}
