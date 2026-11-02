/**
 * Own key plan test helpers: a key saved the way the Settings action saves it (saveEngineKey with
 * the real cipher and keyring), with a fixed check result instead of an engine, and generous
 * in-memory limits so seeding never runs into the key-check rate limit.
 */
import type { PrismaClient } from "@prisma/client";
import { OWN_KEY_PLAN } from "../../app/lib/plans";
import type { KeyChecker, KeyCheckResult } from "../../app/.server/credentials/checker";
import { saveEngineKey, type EngineKeyDeps } from "../../app/.server/credentials/service";
import { KeyCheckBudget, MemoryBucket, MemoryCounters, RequestLimiter } from "../../app/.server/usage/request-limits";

export const fixedChecker = (result: KeyCheckResult | KeyCheckResult["state"]): KeyChecker => {
  const answer = typeof result === "string" ? { state: result } : result;
  return async () => answer;
};

export const okChecker = fixedChecker("ok");

/** Billing of a shop on the Own key plan. */
export const OWN_KEY_BILLING = { state: "ACTIVE" as const, entitlements: OWN_KEY_PLAN, subscription: null };

/** Limits high enough never to refuse (tests of the limits build their own). */
export function generousLimits(): Pick<EngineKeyDeps, "limiter" | "budget"> {
  const big = { "ai-translate": 1000, "memory-suggest": 1000, "key-check": 1000 };
  return {
    limiter: new RequestLimiter({ userPerMinute: big, shopPerMinute: big }, "lv:test", (capacity, refill) => new MemoryBucket(capacity, refill)),
    budget: new KeyCheckBudget(new MemoryCounters(), "lv:test"),
  };
}

export async function seedOwnKey(
  shopId: string,
  form: { engine: string; apiKey: string; region?: string; location?: string },
  options: { checker?: KeyChecker; client?: PrismaClient; mode?: EngineKeyDeps["mode"] } = {},
) {
  const result = await saveEngineKey(
    { shopId, actorId: "seed", billing: OWN_KEY_BILLING, form },
    { checker: options.checker ?? okChecker, mode: options.mode ?? "live", ...(options.client ? { client: options.client } : {}), ...generousLimits() },
  );
  if (!result.ok) throw new Error(`seedOwnKey: ${result.error}`);
  return result;
}
