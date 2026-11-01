/**
 * The Own key plan's engine keys end to end against the test database and
 * Redis (app/.server/credentials): save with a live check (a fake checker or
 * a fake engine fetch, injected through deps, never env), check again,
 * remove, the guarded writes and their races, the rate limits and daily
 * budget, unknown key ids, unreadable rows, and the Settings view. Every key
 * is fictional and built at runtime; no request leaves the process.
 */
import { PrismaClient, type ShopSubscription } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "../../app/lib/plans";
import { liveKeyChecker, type KeyChecker, type KeyCheckResult } from "../../app/.server/credentials/checker";
import { credentialContext } from "../../app/.server/credentials/cipher";
import { checkEngineKey, noteOwnKeyResult, ownKeysView, removeEngineKey, saveEngineKey, type EngineKeyDeps } from "../../app/.server/credentials/service";
import { listEngineKeys, loadEngineKeys, markEngineKey, resetUnknownKidReports } from "../../app/.server/credentials/store";
import { getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { logger } from "../../app/.server/lib/logger";
import { reserveUsage, settleUsage } from "../../app/.server/usage/usage-ledger";
import { createRedisRequestLimiter, KeyCheckBudget, RedisCounters } from "../../app/.server/usage/request-limits";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { ownAzureKey, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { fakeEngineFetch } from "../support/fake-engines";
import { fixedChecker, generousLimits, OWN_KEY_BILLING, seedOwnKey } from "../support/own-keys";
import { deletePrefix, testPrefix, testRedis } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const prefix = testPrefix();
const ENVELOPE = /^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const OLD_KEYRING = `old:${Buffer.alloc(32, 9).toString("base64")}`;

beforeEach(async () => {
  await resetDatabase();
  resetUnknownKidReports();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await deletePrefix(redis, prefix);
  await redis.quit();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function newShop(domain = "keys.myshopify.com") {
  return (await upsertInstalledShop({ shopDomain: domain }, app)).shop;
}

const NOW = new Date("2026-11-01T10:00:00Z");
const subscription = (planHandle: string, pendingPlanHandle: string | null): ShopSubscription => ({
  shopId: "00000000-0000-4000-8000-000000000001",
  state: "ACTIVE",
  planHandle,
  pendingPlanHandle,
  billingPeriod: "EVERY_30_DAYS",
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: new Date("2026-11-29T00:00:00Z"),
  checkedAt: NOW,
  updatedAt: NOW,
});
const PRO = { state: "ACTIVE" as const, entitlements: PLANS.pro, subscription: subscription("pro", null) };
const PENDING = { state: "ACTIVE" as const, entitlements: PLANS.pro, subscription: subscription("pro", "own-key") };

/** Live mode with a checker (or a fake engine fetch) and limits that never refuse. */
const live = (checker: KeyChecker, extra: Partial<EngineKeyDeps> = {}): EngineKeyDeps => ({ client: app, mode: "live", checker, ...generousLimits(), ...extra });

const rows = (shopId: string) => withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);
const auditRows = () => ownerDb.auditLog.findMany({ where: { action: { startsWith: "engine_key." } }, orderBy: { createdAt: "asc" } });

/** A checker that waits until `release` is called (to hold a check open while something else runs). */
function blockingChecker(result: KeyCheckResult["state"]) {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const started = new Promise<void>((r) => (entered = r));
  const checker: KeyChecker = async () => {
    entered();
    await gate;
    return { state: result };
  };
  return { checker, release, started };
}

describe("saving a key (live mode, fake checks)", () => {
  it("stores only the envelope and a four-character hint, and audits without the key", async () => {
    const shop = await newShop();
    const key = ownDeepLKey(1);
    const fake = fakeEngineFetch({ deepl: { [key]: "ok" } });
    const result = await saveEngineKey(
      { shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ` ${key} ` } },
      live(liveKeyChecker({ fetch: fake.fetch })),
    );
    expect(result).toMatchObject({ ok: true, replaced: false, summary: { engine: "deepl", hint: key.replace(/:fx$/, "").slice(-4), status: "OK", deeplPlan: "free", dataLocation: "eu", lastErrorCode: null } });
    expect(fake.calls.map((c) => [c.host, c.path])).toEqual([["api-free.deepl.com", "/v2/usage"]]);

    const [row] = await rows(shop.id);
    expect(row).toMatchObject({ engine: "deepl", status: "OK", keyVersion: 1, region: null, deeplPlan: "free" });
    expect(row!.secret).toMatch(ENVELOPE);
    expect(row!.secret).not.toContain(key);
    expect(row!.secret).not.toContain(key.slice(0, 12));
    const cipher = TokenCipher.fromKeyring(getConfig().TOKEN_ENCRYPTION_KEYS);
    expect(JSON.parse(cipher.decrypt(row!.secret, credentialContext({ shopId: shop.id, engine: "deepl", dataLocation: "eu", region: null })))).toEqual({ v: 1, apiKey: key });
    expect(JSON.stringify(result)).not.toContain(key);

    const audit = await auditRows();
    expect(audit.map((a) => [a.action, a.actorType, a.actorId, a.targetType, a.targetId, a.metadata])).toEqual([
      ["engine_key.saved", "MERCHANT_USER", "staff-1", "engine", "deepl", { engine: "deepl", dataLocation: "eu", result: "ok" }],
    ]);
    expect(JSON.stringify(audit)).not.toContain(row!.hint);
  });

  it("saves a used-up key as QUOTA, Azure with its region and endpoint, Google as global", async () => {
    const shop = await newShop();
    const azureKey = ownAzureKey(1);
    const googleKey = ownGoogleKey(1);
    const fake = fakeEngineFetch({ azure: { [azureKey]: "quota" }, google: { [googleKey]: "ok" } });
    const deps = live(liveKeyChecker({ fetch: fake.fetch }));
    const azure = await saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "azure", apiKey: azureKey, region: "West Europe", location: "global" } }, deps);
    expect(azure).toMatchObject({ ok: true, summary: { status: "QUOTA", region: "westeurope", dataLocation: "global", lastErrorCode: "OWN_KEY_QUOTA_AZURE" } });
    const google = await saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "google", apiKey: googleKey } }, deps);
    expect(google).toMatchObject({ ok: true, summary: { status: "OK", dataLocation: "global", region: null } });
    expect(fake.calls.map((c) => [c.host, c.region])).toEqual([
      ["api.cognitive.microsofttranslator.com", "westeurope"],
      ["translation.googleapis.com", null],
    ]);
    const stored = await rows(shop.id);
    expect(stored.map((r) => [r.engine, r.status, r.dataLocation, r.region, r.lastErrorCode, r.lastErrorAt instanceof Date])).toEqual([
      ["azure", "QUOTA", "global", "westeurope", "OWN_KEY_QUOTA_AZURE", true],
      ["google", "OK", "global", null, null, false],
    ]);
  });

  it("writes nothing for a refused or unreachable key and keeps the key it would have replaced", async () => {
    const shop = await newShop();
    const first = ownDeepLKey(2);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: first }, { client: app });
    const before = await rows(shop.id);
    for (const [state, error] of [
      ["refused", "KEY_REFUSED"],
      ["unreachable", "KEY_UNREACHABLE"],
    ] as const) {
      const result = await saveEngineKey({ shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(3) } }, live(fixedChecker(state)));
      expect(result).toEqual({ ok: false, error });
    }
    expect(await rows(shop.id)).toEqual(before);
    const failed = (await auditRows()).filter((a) => a.action === "engine_key.check_failed");
    expect(failed.map((a) => a.metadata)).toEqual([
      { engine: "deepl", dataLocation: "eu", result: "refused" },
      { engine: "deepl", dataLocation: "eu", result: "unreachable" },
    ]);
    // Never a key or hint in the audit log.
    expect(JSON.stringify(failed)).not.toContain(ownDeepLKey(3).slice(-8, -3));
  });

  it("refuses badly formed keys and regions before any request", async () => {
    const shop = await newShop();
    const fake = fakeEngineFetch({});
    const deps = live(liveKeyChecker({ fetch: fake.fetch }));
    const save = (form: { engine: unknown; apiKey: unknown; region?: unknown; location?: unknown }) => saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form }, deps);
    expect(await save({ engine: "deepl", apiKey: "not a key" })).toEqual({ ok: false, error: "KEY_FORMAT" });
    expect(await save({ engine: "azure", apiKey: ownAzureKey(2), region: "west europe!" })).toEqual({ ok: false, error: "REGION_FORMAT" });
    expect(await save({ engine: "azure", apiKey: ownAzureKey(2), location: "us" })).toEqual({ ok: false, error: "KEY_FORMAT" });
    expect(await save({ engine: "openai", apiKey: ownDeepLKey(4) })).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    expect(fake.calls).toEqual([]);
    expect(await rows(shop.id)).toEqual([]);
  });

  it("refuses a shop that isn't on the plan with zero requests (no oracle for stolen keys)", async () => {
    const shop = await newShop();
    const key = ownDeepLKey(5);
    const fake = fakeEngineFetch({ deepl: { [key]: "ok" } });
    for (const billing of [PRO, { ...PRO, entitlements: PLANS.business }, { state: "NONE" as const, entitlements: PLANS.free, subscription: null }]) {
      const result = await saveEngineKey({ shopId: shop.id, actorId: null, billing, form: { engine: "deepl", apiKey: key } }, live(liveKeyChecker({ fetch: fake.fetch })));
      expect(result).toEqual({ ok: false, error: "PLAN_OWN_KEY" });
      expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing, engine: "deepl" }, live(liveKeyChecker({ fetch: fake.fetch })))).toEqual({ ok: false, error: "PLAN_OWN_KEY" });
    }
    expect(fake.calls).toEqual([]);
    expect(await rows(shop.id)).toEqual([]);
  });

  it("accepts only mock- keys outside a production build, without a request (test env, mock provider, staging)", async () => {
    const shop = await newShop();
    const spy = vi.spyOn(globalThis, "fetch");
    const base = { client: app, ...generousLimits() };
    const save = (apiKey: string, extra: Partial<EngineKeyDeps> = {}) =>
      saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey } }, { ...base, ...extra });
    // The default mode in the test environment (NODE_ENV=test) is mock.
    expect(await save(ownDeepLKey(6))).toEqual({ ok: false, error: "KEY_MOCK_ONLY" });
    expect(await save(["sk", "real", "looking", "key", "1234567890"].join("-"))).toEqual({ ok: false, error: "KEY_MOCK_ONLY" });
    const production = getConfig();
    const mockProvider = { ...production, NODE_ENV: "production" as const, TRANSLATION_PROVIDER: "mock" as const };
    const staging = { ...production, NODE_ENV: "production" as const, LINGUVA_STAGE: "staging" as const };
    expect(await save(ownDeepLKey(6), { config: mockProvider })).toEqual({ ok: false, error: "KEY_MOCK_ONLY" });
    expect(await save(ownDeepLKey(6), { config: staging })).toEqual({ ok: false, error: "KEY_MOCK_ONLY" });
    // Test keys go through the offline checker.
    expect(await save("mock-deepl-1234:fx", { config: staging })).toMatchObject({ ok: true, summary: { hint: "1234", status: "OK" } });
    expect(await save("mock-deepl-refused")).toEqual({ ok: false, error: "KEY_REFUSED" });
    expect(await save("mock-deepl-quota")).toMatchObject({ ok: true, replaced: true, summary: { status: "QUOTA", deeplPlan: "pro" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("replaces a key: keyVersion + 1, audited as replaced", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "google", apiKey: ownGoogleKey(2) }, { client: app });
    const result = await saveEngineKey({ shopId: shop.id, actorId: "staff-2", billing: OWN_KEY_BILLING, form: { engine: "google", apiKey: ownGoogleKey(3) } }, live(fixedChecker("ok")));
    expect(result).toMatchObject({ ok: true, replaced: true, summary: { hint: ownGoogleKey(3).slice(-4) } });
    const [row] = await rows(shop.id);
    expect(row).toMatchObject({ keyVersion: 2, hint: ownGoogleKey(3).slice(-4) });
    const loaded = await loadEngineKeys(shop.id, app);
    expect(loaded.credentials.map((c) => c.apiKey.reveal())).toEqual([ownGoogleKey(3)]);
    expect((await auditRows()).map((a) => a.action)).toEqual(["engine_key.saved", "engine_key.replaced"]);
  });

  it("two first saves of the same engine at once make one row, never a unique-index error", async () => {
    const shop = await newShop();
    const results = await Promise.all(
      [ownDeepLKey(7), ownDeepLKey(8)].map((apiKey) => saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey } }, live(fixedChecker("ok")))),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => (r.ok ? r.replaced : null)).sort()).toEqual([false, true]);
    const stored = await rows(shop.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.keyVersion).toBe(2);
  });

  it("refuses to save for a shop that isn't active (nothing written)", async () => {
    const shop = await newShop();
    await markShopUninstalled(shop.shopDomain, app);
    const result = await saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(9) } }, live(fixedChecker("ok")));
    expect(result).toEqual({ ok: false, error: "SHOP_INACTIVE" });
    expect(await rows(shop.id)).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});

describe("pending change to Own key", () => {
  it("lets the shop save, check and remove keys (live checks counted) without lifting the current plan's pause", async () => {
    const shop = await newShop();
    const until = new Date(Date.now() + 86_400_000);
    await withTenant(shop.id, (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoTranslateNew: true, autoPausedUntil: until, autoPauseReason: "OWN_KEY_AUTH_DEEPL" } }), app);
    const budget = new KeyCheckBudget(new RedisCounters(redis), `${prefix}:pending`);
    const allow = vi.spyOn(budget, "allow");
    const deps = live(fixedChecker("ok"), { budget });
    expect(await saveEngineKey({ shopId: shop.id, actorId: null, billing: PENDING, form: { engine: "deepl", apiKey: ownDeepLKey(10) } }, deps)).toMatchObject({ ok: true });
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: PENDING, engine: "deepl" }, deps)).toMatchObject({ ok: true, summary: { status: "OK" } });
    expect(allow).toHaveBeenCalledTimes(2);
    const settings = await withTenant(shop.id, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    expect(settings).toMatchObject({ autoPausedUntil: until, autoPauseReason: "OWN_KEY_AUTH_DEEPL" });
    expect(await removeEngineKey({ shopId: shop.id, actorId: null, engine: "deepl" }, { client: app })).toEqual({ ok: true, removed: true });
    expect(await rows(shop.id)).toEqual([]);
  });

  it("shows the keys card with the switch date (and only for shops that have something to show)", async () => {
    const shop = await newShop();
    expect(await ownKeysView(shop.id, PRO, { client: app })).toBeNull();
    const pending = await ownKeysView(shop.id, PENDING, { client: app });
    expect(pending).toEqual({ access: "pending", plan: false, startsOn: "2026-11-29T00:00:00.000Z", mode: "mock", keys: [], usage: { total: 0, byEngine: {} }, deepl: null });
    await seedOwnKey(shop.id, { engine: "azure", apiKey: ownAzureKey(3), region: "westeurope" }, { client: app });
    // Off the plan with saved keys: Remove only.
    expect(await ownKeysView(shop.id, PRO, { client: app })).toMatchObject({ access: "off", plan: false, startsOn: null, keys: [{ engine: "azure", region: "westeurope" }], deepl: null });
  });
});

describe("Settings view on the plan", () => {
  it("lists the keys, the month's characters through them and the merchant's own DeepL usage", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: "mock-deepl-1234:fx" }, { client: app, mode: "mock", checker: fixedChecker("ok") });
    await seedOwnKey(shop.id, { engine: "google", apiKey: "mock-google-1" }, { client: app, mode: "mock", checker: fixedChecker("ok") });
    const reservation = await reserveUsage({ shopId: shop.id, key: "own-1", chars: 300, limit: 0, provider: "deepl", payer: "merchant" }, app);
    await settleUsage(reservation, 250, app);
    const view = await ownKeysView(shop.id, OWN_KEY_BILLING, { client: app });
    expect(view).toMatchObject({ access: "plan", plan: true, startsOn: null, mode: "mock", usage: { total: 250, byEngine: { deepl: 250 } }, deepl: { plan: "free", used: 1_234, limit: 500_000 } });
    expect(view!.keys.map((k) => [k.engine, k.hint, k.status])).toEqual([
      ["deepl", "1234", "OK"],
      ["google", "le-1", "OK"],
    ]);
    expect(JSON.stringify(view)).not.toContain("mock-deepl-1234");
    // The DeepL figure from the merchant's own /v2/usage in live mode.
    const key = ownDeepLKey(11);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: key }, { client: app });
    const fake = fakeEngineFetch({ deepl: { [key]: { usage: { count: 77, limit: 100 } } } });
    expect((await ownKeysView(shop.id, OWN_KEY_BILLING, { client: app, mode: "live", fetch: fake.fetch }))!.deepl).toEqual({ plan: "free", used: 77, limit: 100 });
  });

  it("never selects the envelope when it only lists keys", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(12) }, { client: app });
    const logged = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    const queries: string[] = [];
    logged.$on("query", (event) => queries.push(event.query));
    try {
      const keys = await listEngineKeys(shop.id, logged);
      expect(keys).toHaveLength(1);
      const reads = queries.filter((q) => q.includes("ShopEngineCredential"));
      expect(reads.length).toBeGreaterThan(0);
      for (const q of reads) expect(q).not.toMatch(/"secret"/);
    } finally {
      await logged.$disconnect();
    }
  });
});

describe("check again", () => {
  it("goes OK → REFUSED → OK, each result guarded and audited", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(13) }, { client: app });
    const check = (state: KeyCheckResult["state"]) => checkEngineKey({ shopId: shop.id, actorId: "staff-3", billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker(state)));
    expect(await check("refused")).toMatchObject({ ok: true, summary: { status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL" } });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL", keyVersion: 1 });
    expect(await check("unreachable")).toEqual({ ok: false, error: "KEY_UNREACHABLE" });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "REFUSED" });
    expect(await check("quota")).toMatchObject({ ok: true, summary: { status: "QUOTA", lastErrorCode: "OWN_KEY_QUOTA_DEEPL" } });
    expect(await check("ok")).toMatchObject({ ok: true, summary: { status: "OK", lastErrorCode: null, lastErrorAt: null } });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "OK", lastErrorCode: null, lastErrorAt: null, keyVersion: 1 });
    const checked = (await auditRows()).filter((a) => a.action === "engine_key.checked");
    expect(checked.map((a) => a.metadata)).toEqual([
      { engine: "deepl", result: "refused" },
      { engine: "deepl", result: "unreachable" },
      { engine: "deepl", result: "quota" },
      { engine: "deepl", result: "ok" },
    ]);
  });

  it("answers NO_KEY and ENGINE_UNKNOWN without a request", async () => {
    const shop = await newShop();
    const fake = fakeEngineFetch({});
    const deps = live(liveKeyChecker({ fetch: fake.fetch }));
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, deps)).toEqual({ ok: false, error: "NO_KEY" });
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "openai" }, deps)).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    expect(fake.calls).toEqual([]);
  });

  it("racing a replace: KEY_CHANGED, and the new key's status stays as the replace wrote it", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(14) }, { client: app });
    const held = blockingChecker("refused");
    const checking = checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(held.checker));
    await held.started;
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(15) }, { client: app });
    held.release();
    expect(await checking).toEqual({ ok: false, error: "KEY_CHANGED" });
    const [row] = await rows(shop.id);
    expect(row).toMatchObject({ status: "OK", keyVersion: 2, lastErrorCode: null });
    expect((await loadEngineKeys(shop.id, app)).credentials[0]!.apiKey.reveal()).toBe(ownDeepLKey(15));
  });

  it("heals an UNREADABLE or RECHECK row once it decrypts, and marks a tampered one UNREADABLE", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(16) }, { client: app });
    for (const status of ["UNREADABLE", "RECHECK"]) {
      await withTenant(shop.id, (tx) => tx.shopEngineCredential.updateMany({ data: { status, lastErrorCode: `OWN_KEY_${status}`, lastErrorAt: new Date() } }), app);
      expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("ok")))).toMatchObject({ ok: true, summary: { status: "OK" } });
      expect((await rows(shop.id))[0]).toMatchObject({ status: "OK", lastErrorCode: null });
    }
    // Another shop's envelope (authentication fails under a known key id): enter it again.
    const other = await newShop("other.myshopify.com");
    await seedOwnKey(other.id, { engine: "deepl", apiKey: ownDeepLKey(17) }, { client: app });
    const [foreign] = await rows(other.id);
    await withTenant(shop.id, (tx) => tx.shopEngineCredential.updateMany({ data: { secret: foreign!.secret } }), ownerDb);
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("ok")))).toEqual({ ok: false, error: "KEY_UNREADABLE" });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "UNREADABLE", lastErrorCode: "OWN_KEY_UNREADABLE" });
  });
});

describe("rate limits and the daily budget (live mode)", () => {
  it("refuses the 4th check of a staff member in a minute", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(18) }, { client: app });
    const limiter = createRedisRequestLimiter(redis, `${prefix}:minute`, {
      userPerMinute: { "ai-translate": 10, "memory-suggest": 10, "key-check": 3 },
      shopPerMinute: { "ai-translate": 10, "memory-suggest": 10, "key-check": 6 },
    });
    const deps = live(fixedChecker("ok"), { limiter });
    for (let i = 0; i < 3; i++) expect(await checkEngineKey({ shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, engine: "deepl" }, deps)).toMatchObject({ ok: true });
    const refused = await checkEngineKey({ shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, engine: "deepl" }, deps);
    expect(refused).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    expect((refused as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    // A save counts as a check too.
    expect(await saveEngineKey({ shopId: shop.id, actorId: "staff-1", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(19) } }, deps)).toMatchObject({ error: "RATE_LIMITED" });
  });

  it("refuses the 21st live check of a day, and the 11th refused one", async () => {
    const shop = await newShop();
    const budget = new KeyCheckBudget(new RedisCounters(redis), `${prefix}:day`);
    const fake = fakeEngineFetch({});
    const deps = live(liveKeyChecker({ fetch: fake.fetch }), { budget });
    // Ten refused checks (every key is refused by the fake), then the cap.
    for (let i = 0; i < 10; i++) {
      expect(await saveEngineKey({ shopId: shop.id, actorId: `s${i}`, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(100 + i) } }, deps)).toEqual({ ok: false, error: "KEY_REFUSED" });
    }
    expect(await saveEngineKey({ shopId: shop.id, actorId: "s10", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(110) } }, deps)).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    expect(fake.calls).toHaveLength(10);

    const other = await newShop("budget-b.myshopify.com");
    const ok = live(fixedChecker("ok"), { budget });
    for (let i = 0; i < 20; i++) {
      expect(await saveEngineKey({ shopId: other.id, actorId: `t${i}`, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(200 + i) } }, ok)).toMatchObject({ ok: true });
    }
    const capped = await saveEngineKey({ shopId: other.id, actorId: "t20", billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: ownDeepLKey(220) } }, ok);
    expect(capped).toMatchObject({ ok: false, error: "RATE_LIMITED" });
    expect((capped as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    expect((capped as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(86_400_000);
  });

  it("never asks the budget in mock mode (no outbound call)", async () => {
    const shop = await newShop();
    const budget = new KeyCheckBudget(new RedisCounters(redis), `${prefix}:mock`);
    const allow = vi.spyOn(budget, "allow");
    const noted = vi.spyOn(budget, "noteRefused");
    const deps = { client: app, mode: "mock" as const, ...generousLimits(), budget };
    await saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: "mock-deepl-1" } }, deps);
    await saveEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, form: { engine: "deepl", apiKey: "mock-deepl-refused" } }, deps);
    await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, deps);
    expect(allow).not.toHaveBeenCalled();
    expect(noted).not.toHaveBeenCalled();
  });
});

describe("own-key pauses", () => {
  it("a save or an accepted check lifts an OWN_KEY_* pause and leaves every other reason", async () => {
    const shop = await newShop();
    const pause = (reason: string) =>
      withTenant(shop.id, (tx) => tx.shopSettings.update({ where: { shopId: shop.id }, data: { autoTranslateNew: true, autoPausedUntil: new Date(Date.now() + 3_600_000), autoPauseReason: reason } }), app);
    const settings = () => withTenant(shop.id, (tx) => tx.shopSettings.findUniqueOrThrow({ where: { shopId: shop.id } }), app);
    await pause("OWN_KEY_QUOTA_DEEPL");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(20) }, { client: app });
    expect(await settings()).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
    await pause("QUOTA_EXCEEDED");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(21) }, { client: app });
    expect(await settings()).toMatchObject({ autoPauseReason: "QUOTA_EXCEEDED" });
    await pause("OWN_KEY_AUTH_DEEPL");
    await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("refused")));
    expect(await settings()).toMatchObject({ autoPauseReason: "OWN_KEY_AUTH_DEEPL" });
    await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("ok")));
    expect(await settings()).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
  });
});

describe("removing a key", () => {
  it("works on any plan (after a downgrade too), audited only when a row went", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "google", apiKey: ownGoogleKey(4) }, { client: app });
    expect(await removeEngineKey({ shopId: shop.id, actorId: "staff-4", engine: "google" }, { client: app })).toEqual({ ok: true, removed: true });
    expect(await removeEngineKey({ shopId: shop.id, actorId: "staff-4", engine: "google" }, { client: app })).toEqual({ ok: true, removed: false });
    expect(await removeEngineKey({ shopId: shop.id, actorId: "staff-4", engine: "nope" }, { client: app })).toEqual({ ok: false, error: "ENGINE_UNKNOWN" });
    expect(await rows(shop.id)).toEqual([]);
    const removed = (await auditRows()).filter((a) => a.action === "engine_key.removed");
    expect(removed.map((a) => [a.actorType, a.actorId, a.targetId, a.metadata])).toEqual([["MERCHANT_USER", "staff-4", "google", { engine: "google" }]]);
  });
});

describe("loading keys: unknown key ids and unreadable rows", () => {
  async function insertUnder(shopId: string, cipher: TokenCipher, apiKey: string, extra: Record<string, unknown> = {}) {
    const ctx = { shopId, engine: "deepl" as const, dataLocation: "eu" as const, region: null };
    const secret = typeof extra.secret === "string" ? extra.secret : cipher.encrypt(JSON.stringify({ v: 1, apiKey }), credentialContext(ctx));
    return withTenant(
      shopId,
      (tx) => tx.shopEngineCredential.create({ data: { shopId, engine: "deepl", dataLocation: "eu", deeplPlan: "free", hint: apiKey.slice(-7, -3), verifiedAt: new Date(), ...extra, secret } }),
      app,
    );
  }

  it("an envelope under a key id this process doesn't have is skipped: nothing written, one error log naming the kid", async () => {
    const shop = await newShop();
    const key = ownDeepLKey(22);
    const row = await insertUnder(shop.id, TokenCipher.fromKeyring(OLD_KEYRING), key);
    const error = vi.spyOn(logger, "error");
    const first = await loadEngineKeys(shop.id, app);
    expect(first).toMatchObject({ credentials: [], transient: ["deepl"], summaries: [{ engine: "deepl", status: "OK" }] });
    await loadEngineKeys(shop.id, app);
    expect(error.mock.calls.filter((c) => c[1] === "own engine key under a key id this process doesn't have")).toEqual([
      [{ engine: "deepl", kid: "old" }, "own engine key under a key id this process doesn't have"],
    ]);
    const [after] = await rows(shop.id);
    expect(after).toEqual(row);
    // "Check again" says try later, and writes nothing either.
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("ok")))).toEqual({ ok: false, error: "KEY_UNREACHABLE" });
    expect((await rows(shop.id))[0]).toEqual(row);

    // The key id comes back (the keyring is fixed): the same row works again.
    const both = TokenCipher.fromKeyring(`${getConfig().TOKEN_ENCRYPTION_KEYS},${OLD_KEYRING}`);
    const healed = await loadEngineKeys(shop.id, app, both);
    expect(healed.transient).toEqual([]);
    expect(healed.credentials.map((c) => [c.engine, c.apiKey.reveal(), c.keyVersion, c.status])).toEqual([["deepl", key, 1, "OK"]]);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `${getConfig().TOKEN_ENCRYPTION_KEYS},${OLD_KEYRING}`);
    resetConfigCache();
    expect(await checkEngineKey({ shopId: shop.id, actorId: null, billing: OWN_KEY_BILLING, engine: "deepl" }, live(fixedChecker("ok")))).toMatchObject({ ok: true, summary: { status: "OK" } });
  });

  it("an authentication failure under a known key id, a malformed envelope or payload is UNREADABLE (guarded by keyVersion)", async () => {
    const shop = await newShop();
    const cipher = TokenCipher.fromKeyring(getConfig().TOKEN_ENCRYPTION_KEYS);
    const otherShop = "33333333-3333-4333-8333-333333333333";
    const wrongContext = cipher.encrypt(JSON.stringify({ v: 1, apiKey: ownDeepLKey(23) }), credentialContext({ shopId: otherShop, engine: "deepl", dataLocation: "eu", region: null }));
    const ctx = credentialContext({ shopId: shop.id, engine: "deepl", dataLocation: "eu", region: null });
    const warn = vi.spyOn(logger, "warn");
    for (const secret of [wrongContext, cipher.encrypt("not json", ctx), cipher.encrypt(JSON.stringify({ v: 2, apiKey: "x" }), ctx), cipher.encrypt(JSON.stringify({ v: 1, apiKey: "" }), ctx)]) {
      await withTenant(shop.id, (tx) => tx.shopEngineCredential.deleteMany({}), app);
      await insertUnder(shop.id, cipher, ownDeepLKey(24), { secret });
      const loaded = await loadEngineKeys(shop.id, app);
      expect(loaded).toMatchObject({ credentials: [], transient: [], summaries: [{ status: "UNREADABLE", lastErrorCode: "OWN_KEY_UNREADABLE" }] });
      expect((await rows(shop.id))[0]).toMatchObject({ status: "UNREADABLE", lastErrorCode: "OWN_KEY_UNREADABLE", secret });
    }
    expect(warn).toHaveBeenCalledWith({ engine: "deepl" }, "own engine key unreadable");
    // The merchant enters the key again; a late mark about the old row never lands on it.
    const [old] = await rows(shop.id);
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(25) }, { client: app });
    expect(await markEngineKey({ id: old!.id, shopId: shop.id, keyVersion: old!.keyVersion }, { status: "UNREADABLE", lastErrorCode: "OWN_KEY_UNREADABLE", lastErrorAt: new Date() }, app)).toBe(0);
    expect((await rows(shop.id))[0]).toMatchObject({ status: "OK", keyVersion: old!.keyVersion + 1 });
  });

  it("decrypts only usable rows: a REFUSED or RECHECK row is listed, never opened or marked", async () => {
    const shop = await newShop();
    const cipher = TokenCipher.fromKeyring(getConfig().TOKEN_ENCRYPTION_KEYS);
    const broken = cipher.encrypt("not json", credentialContext({ shopId: shop.id, engine: "deepl", dataLocation: "eu", region: null }));
    await insertUnder(shop.id, cipher, ownDeepLKey(26), { secret: broken, status: "RECHECK", lastErrorCode: "OWN_KEY_RECHECK", lastErrorAt: new Date() });
    const loaded = await loadEngineKeys(shop.id, app);
    expect(loaded).toMatchObject({ credentials: [], transient: [], summaries: [{ status: "RECHECK" }] });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "RECHECK" });
  });

  it("loads usable keys in engine order with their state keys and versions, and prints none of them", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "google", apiKey: ownGoogleKey(5) }, { client: app });
    await seedOwnKey(shop.id, { engine: "azure", apiKey: ownAzureKey(5), region: "westeurope" }, { client: app, checker: fixedChecker("quota") });
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(27) }, { client: app });
    const loaded = await loadEngineKeys(shop.id, app);
    expect(loaded.credentials.map((c) => [c.engine, c.status, c.keyVersion, c.region, c.endpoint ?? null])).toEqual([
      ["deepl", "OK", 1, null, null],
      ["azure", "QUOTA", 1, "westeurope", "https://api-eur.cognitive.microsofttranslator.com"],
      ["google", "OK", 1, null, null],
    ]);
    for (const c of loaded.credentials) expect(c.stateKey).toMatch(new RegExp(`^own:${c.engine}:[A-Za-z0-9_-]{22}$`));
    const printed = JSON.stringify(loaded);
    for (const key of [ownGoogleKey(5), ownAzureKey(5), ownDeepLKey(27)]) expect(printed).not.toContain(key);
  });
});

describe("noteOwnKeyResult: what a translation says about the keys it used", () => {
  it("marks quota and auth, puts an answering QUOTA key back to OK, and writes nothing otherwise", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(28) }, { client: app });
    await seedOwnKey(shop.id, { engine: "google", apiKey: ownGoogleKey(6) }, { client: app });
    let used = (await loadEngineKeys(shop.id, app)).credentials;
    expect(await noteOwnKeyResult(shop.id, used, { answeredBy: "google", failed: [{ engine: "deepl", kind: "quota" }] }, app)).toEqual({ stale: false });
    expect((await rows(shop.id)).map((r) => [r.engine, r.status, r.lastErrorCode])).toEqual([
      ["deepl", "QUOTA", "OWN_KEY_QUOTA_DEEPL"],
      ["google", "OK", null],
    ]);
    used = (await loadEngineKeys(shop.id, app)).credentials;
    const before = await rows(shop.id);
    // Nothing changed: no write at all.
    expect(await noteOwnKeyResult(shop.id, used, { answeredBy: "google", failed: [] }, app)).toEqual({ stale: false });
    expect(await noteOwnKeyResult(shop.id, used, { failed: [{ engine: "deepl", kind: "quota" }] }, app)).toEqual({ stale: false });
    expect(await rows(shop.id)).toEqual(before);
    expect(await noteOwnKeyResult(shop.id, used, { answeredBy: "deepl", failed: [{ engine: "google", kind: "auth" }, { engine: "azure", kind: "auth" }] }, app)).toEqual({ stale: false });
    expect((await rows(shop.id)).map((r) => [r.engine, r.status, r.lastErrorCode])).toEqual([
      ["deepl", "OK", null],
      ["google", "REFUSED", "OWN_KEY_AUTH_GOOGLE"],
    ]);
  });

  it("is stale for a failure of a key replaced or removed after it was read, and never marks the new key", async () => {
    const shop = await newShop();
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(29) }, { client: app });
    const k1 = (await loadEngineKeys(shop.id, app)).credentials;
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(30) }, { client: app });
    expect(await noteOwnKeyResult(shop.id, k1, { failed: [{ engine: "deepl", kind: "auth" }] }, app)).toEqual({ stale: true });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "OK", keyVersion: 2 });

    // Also when the old key's status already said so (no write needed, but the key isn't current).
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(31) }, { client: app, checker: fixedChecker("quota") });
    const quotaKey = (await loadEngineKeys(shop.id, app)).credentials;
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: ownDeepLKey(32) }, { client: app, checker: fixedChecker("quota") });
    expect(await noteOwnKeyResult(shop.id, quotaKey, { failed: [{ engine: "deepl", kind: "quota" }] }, app)).toEqual({ stale: true });
    // A late success with the old key never flips the new key's QUOTA.
    expect(await noteOwnKeyResult(shop.id, quotaKey, { answeredBy: "deepl", failed: [] }, app)).toEqual({ stale: false });
    expect((await rows(shop.id))[0]).toMatchObject({ status: "QUOTA", keyVersion: 4 });

    const k4 = (await loadEngineKeys(shop.id, app)).credentials;
    await removeEngineKey({ shopId: shop.id, actorId: null, engine: "deepl" }, { client: app });
    expect(await noteOwnKeyResult(shop.id, k4, { failed: [{ engine: "deepl", kind: "auth" }] }, app)).toEqual({ stale: true });
    expect(await rows(shop.id)).toEqual([]);
  });
});
