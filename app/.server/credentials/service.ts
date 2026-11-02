/**
 * What routes call for the Own key plan's engine keys: save (with a live
 * check), check again, remove, the Settings view, and the bookkeeping of a
 * translation's result per key (docs/AI_ENGINES.md, docs/SECURITY_MODEL.md).
 * Cheap refusals come first, so no outbound call happens without the plan
 * and a well-formed key. Results are codes; keys never leave as strings.
 */
import type { PrismaClient } from "@prisma/client";
import { isEngineId, type EngineId } from "../../lib/engines";
import { ownKeyStopCode, usableOwnKey, type OwnKeyStatus, type OwnKeySummary } from "../../lib/own-keys";
import { isOwnKeyHandle, usesOwnKeys } from "../../lib/plans";
import type { BillingStatus } from "../billing/subscription";
import { getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { liftOwnKeyPause } from "../settings/shop-settings";
import { getOwnKeyUsage, periodKey } from "../usage/usage-ledger";
import { getKeyCheckBudget, getRequestLimiter, RequestRateLimitedError, type KeyCheckBudget, type RequestLimiter } from "../usage/request-limits";
import { liveKeyChecker, mockKeyChecker, type KeyChecker, type KeyCheckResult } from "./checker";
import { ownDeepLUsage, type OwnDeepLUsage } from "./deepl-quota";
import { ownKeyMode, parseEngineKeyForm, type EngineKeyInput, type OwnKeyMode } from "./formats";
import {
  deleteEngineKey,
  findEngineKey,
  hasEngineKey,
  insertOrReplaceEngineKey,
  isCurrentEngineKey,
  listEngineKeys,
  loadEngineKeys,
  markEngineKey,
  openEngineKey,
  reportUnknownKid,
  type OwnCredential,
} from "./store";

export type EngineKeyErrorCode =
  | "PLAN_OWN_KEY"
  | "ENGINE_UNKNOWN"
  | "KEY_FORMAT"
  | "REGION_FORMAT"
  | "KEY_MOCK_ONLY"
  | "KEY_REFUSED"
  | "KEY_UNREACHABLE"
  | "RATE_LIMITED"
  | "NO_KEY"
  | "KEY_UNREADABLE"
  | "KEY_CHANGED"
  | "SHOP_INACTIVE";

export interface EngineKeyDeps {
  client?: PrismaClient;
  config?: AppConfig;
  mode?: OwnKeyMode;
  checker?: KeyChecker;
  limiter?: RequestLimiter;
  budget?: KeyCheckBudget;
  now?: () => Date;
}

type Failure = { ok: false; error: EngineKeyErrorCode; retryAfterMs?: number };

type BillingFacts = Pick<BillingStatus, "state" | "entitlements" | "subscription">;

/** Who may manage keys: on the plan, or with a pending change to it (keys stored and checked, used from the switch). */
export type OwnKeyAccess = "plan" | "pending" | null;

export function ownKeyAccess(billing: BillingFacts | null | undefined): OwnKeyAccess {
  if (usesOwnKeys(billing?.entitlements)) return "plan";
  return billing?.state === "ACTIVE" && isOwnKeyHandle(billing.subscription?.pendingPlanHandle) ? "pending" : null;
}

function resolve(deps: EngineKeyDeps = {}) {
  const config = deps.config ?? getConfig();
  const mode = deps.mode ?? ownKeyMode(config);
  return {
    client: deps.client ?? defaultClient,
    mode,
    checker: deps.checker ?? (mode === "mock" ? mockKeyChecker : liveKeyChecker()),
    // Created only when a check is about to happen (Redis connection).
    limiter: () => deps.limiter ?? getRequestLimiter(),
    budget: () => deps.budget ?? getKeyCheckBudget(),
    now: deps.now ?? (() => new Date()),
  };
}

type Resolved = ReturnType<typeof resolve>;

/** The minute buckets, then (live mode only) the daily and hourly budget. */
async function consumeCheck(r: Resolved, shopId: string, actorId: string | null): Promise<Failure | null> {
  try {
    await r.limiter().consume(shopId, actorId, "key-check");
  } catch (error) {
    if (error instanceof RequestRateLimitedError) return { ok: false, error: "RATE_LIMITED", retryAfterMs: error.retryAfterMs };
    throw error;
  }
  if (r.mode === "live") {
    const allowed = await r.budget().allow(shopId);
    if (!allowed.ok) return { ok: false, error: "RATE_LIMITED", retryAfterMs: allowed.retryAfterMs };
  }
  return null;
}

/** INSERT only, outside withTenant (no RETURNING: the runtime role can't read AuditLog). Never a key or hint. */
async function audit(
  client: PrismaClient,
  entry: { shopId: string; actorId: string | null; action: string; engine: EngineId; metadata: Record<string, string> },
): Promise<void> {
  await client.auditLog.createMany({
    data: [
      {
        shopId: entry.shopId,
        actorType: "MERCHANT_USER",
        actorId: entry.actorId,
        action: entry.action,
        targetType: "engine",
        targetId: entry.engine,
        metadata: entry.metadata,
      },
    ],
  });
}

/** Adds a key or replaces the engine's key, after a live check (mock mode: offline). */
export async function saveEngineKey(
  input: {
    shopId: string;
    actorId: string | null;
    billing: BillingFacts;
    form: { engine: unknown; apiKey: unknown; region?: unknown; location?: unknown };
  },
  deps?: EngineKeyDeps,
): Promise<{ ok: true; summary: OwnKeySummary; replaced: boolean } | Failure> {
  const r = resolve(deps);
  const access = ownKeyAccess(input.billing);
  if (!access) return { ok: false, error: "PLAN_OWN_KEY" };
  const parsed = parseEngineKeyForm(input.form, r.mode);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const engine = parsed.input.engine;
  const limited = await consumeCheck(r, input.shopId, input.actorId);
  if (limited) return limited;

  const result = await r.checker(parsed.input);
  if (result.state === "refused" || result.state === "unreachable") {
    if (r.mode === "live") await r.budget().noteRefused(input.shopId);
    await audit(r.client, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: "engine_key.check_failed",
      engine,
      metadata: { engine, dataLocation: parsed.dataLocation, result: result.state },
    });
    return { ok: false, error: result.state === "refused" ? "KEY_REFUSED" : "KEY_UNREACHABLE" };
  }

  const now = r.now();
  const quota = result.state === "quota";
  const row = {
    engine,
    apiKey: parsed.input.apiKey,
    hint: parsed.hint,
    dataLocation: parsed.dataLocation,
    region: parsed.region,
    deeplPlan: parsed.deeplPlan,
    status: quota ? ("QUOTA" as const) : ("OK" as const),
    verifiedAt: now,
    lastErrorCode: quota ? ownKeyStopCode("quota", engine) : null,
    lastErrorAt: quota ? now : null,
  };
  const saved = await insertOrReplaceEngineKey(input.shopId, row, r.client);
  if (saved === "SHOP_INACTIVE") return { ok: false, error: "SHOP_INACTIVE" };
  await audit(r.client, {
    shopId: input.shopId,
    actorId: input.actorId,
    action: saved.replaced ? "engine_key.replaced" : "engine_key.saved",
    engine,
    metadata: { engine, dataLocation: parsed.dataLocation, result: result.state },
  });
  // Pending: the keys aren't used yet, so a pause of the current plan isn't theirs to lift.
  if (access === "plan") await liftOwnKeyPause(input.shopId, r.client);
  return {
    ok: true,
    replaced: saved.replaced,
    summary: {
      engine,
      hint: row.hint,
      status: row.status,
      dataLocation: row.dataLocation,
      region: row.region,
      deeplPlan: row.deeplPlan,
      verifiedAt: now.toISOString(),
      lastErrorCode: row.lastErrorCode,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    },
  };
}

/** What the key check needs of a saved row. */
function checkInput(row: { engine: EngineId; dataLocation: string; region: string | null }, apiKey: OwnCredential["apiKey"]): EngineKeyInput {
  if (row.engine === "azure") return { engine: "azure", apiKey, ...(row.region ? { region: row.region } : {}), location: row.dataLocation === "global" ? "global" : "eu" };
  return { engine: row.engine, apiKey };
}

/**
 * "Check again": a live check of the saved key, its result written guarded by the keyVersion read.
 * Heals a row that was UNREADABLE (a fixed keyring) or RECHECK (after a restore) when it decrypts.
 */
export async function checkEngineKey(
  input: { shopId: string; actorId: string | null; billing: BillingFacts; engine: unknown },
  deps?: EngineKeyDeps,
): Promise<{ ok: true; summary: OwnKeySummary } | Failure> {
  const r = resolve(deps);
  const access = ownKeyAccess(input.billing);
  if (!access) return { ok: false, error: "PLAN_OWN_KEY" };
  if (typeof input.engine !== "string" || !isEngineId(input.engine)) return { ok: false, error: "ENGINE_UNKNOWN" };
  const engine = input.engine;
  if (!(await hasEngineKey(input.shopId, engine, r.client))) return { ok: false, error: "NO_KEY" };
  const limited = await consumeCheck(r, input.shopId, input.actorId);
  if (limited) return limited;

  const row = await findEngineKey(input.shopId, engine, r.client);
  if (!row) return { ok: false, error: "NO_KEY" };
  const ref = { id: row.id, shopId: input.shopId, keyVersion: row.keyVersion };
  const checked = (result: string) => audit(r.client, { shopId: input.shopId, actorId: input.actorId, action: "engine_key.checked", engine, metadata: { engine, result } });

  const opened = openEngineKey(row);
  if (opened.kind === "unknown-kid") {
    // A keyring difference, never the key's fault: nothing written; the log names the key id.
    reportUnknownKid(engine, opened.kid);
    await checked("unreachable");
    return { ok: false, error: "KEY_UNREACHABLE" };
  }
  if (opened.kind === "unreadable") {
    // Only a usable row (OK/QUOTA) is marked, as loadEngineKeys does: maintenance heals UNREADABLE
    // rows straight to OK, so marking a RECHECK or REFUSED row would make it usable without a
    // successful check once the keyring is fixed.
    if (usableOwnKey({ status: row.status as OwnKeyStatus })) {
      await markEngineKey(ref, { status: "UNREADABLE", lastErrorCode: "OWN_KEY_UNREADABLE", lastErrorAt: r.now() }, r.client);
    }
    logger.warn({ engine }, "own engine key unreadable");
    await checked("unreadable");
    return { ok: false, error: "KEY_UNREADABLE" };
  }

  const result: KeyCheckResult = await r.checker(checkInput({ engine, dataLocation: row.dataLocation, region: row.region }, opened.apiKey));
  if (result.state === "refused" || result.state === "unreachable") {
    if (r.mode === "live") await r.budget().noteRefused(input.shopId);
  }
  if (result.state === "unreachable") {
    await checked("unreachable");
    return { ok: false, error: "KEY_UNREACHABLE" };
  }
  const now = r.now();
  const mark =
    result.state === "refused"
      ? { status: "REFUSED" as const, lastErrorCode: ownKeyStopCode("auth", engine), lastErrorAt: now }
      : result.state === "quota"
        ? { status: "QUOTA" as const, lastErrorCode: ownKeyStopCode("quota", engine), lastErrorAt: now, verifiedAt: now }
        : { status: "OK" as const, lastErrorCode: null, lastErrorAt: null, verifiedAt: now };
  const count = await markEngineKey(ref, mark, r.client);
  if (count === 0) {
    // Replaced or removed during the check: the result belongs to the old key.
    await checked("changed");
    return { ok: false, error: "KEY_CHANGED" };
  }
  await checked(result.state);
  if (access === "plan" && result.state !== "refused") await liftOwnKeyPause(input.shopId, r.client);
  return {
    ok: true,
    summary: {
      engine,
      hint: row.hint,
      status: mark.status,
      dataLocation: row.dataLocation === "global" ? "global" : "eu",
      region: row.region,
      deeplPlan: row.deeplPlan === "free" || row.deeplPlan === "pro" ? row.deeplPlan : null,
      // A refusal isn't a successful check: the last one stays.
      verifiedAt: (result.state === "refused" ? row.verifiedAt : now).toISOString(),
      lastErrorCode: mark.lastErrorCode,
      lastErrorAt: mark.lastErrorAt?.toISOString() ?? null,
    },
  };
}

/** Removes the engine's key: on any plan (keys must be removable after a downgrade), no rate limit. */
export async function removeEngineKey(
  input: { shopId: string; actorId: string | null; engine: unknown },
  deps?: Pick<EngineKeyDeps, "client">,
): Promise<{ ok: true; removed: boolean } | Failure> {
  const client = deps?.client ?? defaultClient;
  if (typeof input.engine !== "string" || !isEngineId(input.engine)) return { ok: false, error: "ENGINE_UNKNOWN" };
  const engine = input.engine;
  const removed = await deleteEngineKey(input.shopId, engine, client);
  if (removed) await audit(client, { shopId: input.shopId, actorId: input.actorId, action: "engine_key.removed", engine, metadata: { engine } });
  return { ok: true, removed };
}

/** The Settings card "Your translation keys" (null: nothing to show for this shop). */
export interface OwnKeysView {
  /** "plan": on Own key; "pending": a change to Own key waits for the end of the cycle (manage keys, not used yet); "off": other plan with saved keys (Remove only). */
  access: "plan" | "pending" | "off";
  plan: boolean;
  /** Pending only: when Shopify switches (subscription.currentPeriodEnd), ISO, or null when unknown. */
  startsOn: string | null;
  mode: OwnKeyMode;
  /** ENGINE_IDS order, saved ones only. */
  keys: OwnKeySummary[];
  usage: { total: number; byEngine: Partial<Record<EngineId, number>> };
  /** Only when on the plan with a usable DeepL key. */
  deepl: OwnDeepLUsage | null;
}

export async function ownKeysView(
  shopId: string,
  billing: BillingFacts,
  options: { client?: PrismaClient; config?: AppConfig; now?: () => Date; mode?: OwnKeyMode; fetch?: typeof fetch } = {},
): Promise<OwnKeysView | null> {
  const client = options.client ?? defaultClient;
  const mode = options.mode ?? ownKeyMode(options.config ?? getConfig());
  const now = (options.now ?? (() => new Date()))();
  const granted = ownKeyAccess(billing);
  let keys = await listEngineKeys(shopId, client);
  if (!granted && keys.length === 0) return null;
  const access = granted ?? "off";
  let deepl: OwnDeepLUsage | null = null;
  if (access === "plan" && keys.some((k) => k.engine === "deepl" && usableOwnKey(k))) {
    // Decrypts (the DeepL figure needs the key); the summaries come from the same read.
    const loaded = await loadEngineKeys(shopId, client);
    keys = loaded.summaries;
    const credential = loaded.credentials.find((c) => c.engine === "deepl");
    deepl = credential ? await ownDeepLUsage(shopId, credential, { mode, ...(options.fetch ? { fetch: options.fetch } : {}) }) : null;
  }
  return {
    access,
    plan: access === "plan",
    startsOn: access === "pending" ? (billing.subscription?.currentPeriodEnd?.toISOString() ?? null) : null,
    mode,
    keys,
    usage: await getOwnKeyUsage(shopId, periodKey(now), client),
    deepl,
  };
}

export type OwnKeyOutcome = { answeredBy?: string; failed: Array<{ engine: string; kind: "quota" | "auth" }> };

/**
 * After a translation through the merchant's keys: a key that answered quota or auth is marked
 * QUOTA / REFUSED, a QUOTA key that answered goes back to OK. Every write is guarded by the
 * keyVersion the provider was built with, and nothing is written when nothing changed (the common
 * case). Returns stale: true when a failure belonged to a key that was replaced or removed after it
 * was read (nothing was marked for it): the caller retries with the current key, never stops or
 * pauses. Best effort for the writes: a failure is logged as the engine only.
 */
export async function noteOwnKeyResult(
  shopId: string,
  used: readonly OwnCredential[],
  outcome: OwnKeyOutcome,
  client: PrismaClient = defaultClient,
): Promise<{ stale: boolean }> {
  let stale = false;
  const now = new Date();
  const seen = new Set<string>();
  for (const failure of outcome.failed) {
    const credential = used.find((c) => c.engine === failure.engine);
    if (!credential || seen.has(credential.engine)) continue;
    seen.add(credential.engine);
    const ref = { id: credential.id, shopId, keyVersion: credential.keyVersion };
    const status = failure.kind === "quota" ? "QUOTA" : "REFUSED";
    try {
      if (credential.status === status) {
        // Nothing to write; a read tells whether the failure was the current key's.
        if (!(await isCurrentEngineKey(ref, client))) stale = true;
        continue;
      }
      const count = await markEngineKey(ref, { status, lastErrorCode: ownKeyStopCode(failure.kind, credential.engine), lastErrorAt: now }, client);
      if (count === 0) stale = true;
    } catch {
      logger.warn({ engine: credential.engine }, "own engine key result not recorded");
    }
  }
  const answered = outcome.answeredBy ? used.find((c) => c.engine === outcome.answeredBy) : undefined;
  if (answered?.status === "QUOTA" && !seen.has(answered.engine)) {
    try {
      // A late success with an old key never flips a new key's QUOTA: guarded the same way.
      await markEngineKey({ id: answered.id, shopId, keyVersion: answered.keyVersion }, { status: "OK", lastErrorCode: null, lastErrorAt: null }, client);
    } catch {
      logger.warn({ engine: answered.engine }, "own engine key result not recorded");
    }
  }
  return { stale };
}
