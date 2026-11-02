/**
 * The Own key plan in the worker (processItem through the item processor):
 * a shop on the plan translates only with its own keys, every outgoing
 * request is recorded and carries only the merchant's key and host (never a
 * fictional operator key from the environment), the ledger charges the
 * merchant (no Linguva limit, no platform counter), a key's quota or refusal
 * stops the job with the code naming its engine and marks the key, failover
 * stays among the merchant's keys, a key replaced while an item runs is never
 * blamed, a missing key never pauses anything, and every other plan keeps
 * today's path (stop precedence, operator engines, allowance). Fake engines
 * and a fake store only: no request leaves the process.
 */
import { inspect } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyChecker } from "../../app/.server/credentials/checker";
import { listEngineKeys, resetUnknownKidReports } from "../../app/.server/credentials/store";
import { createBulkJob, AUTO_REQUESTED_BY } from "../../app/.server/jobs/bulk-jobs";
import { classifyError, JobStopError, RateLimitedError } from "../../app/.server/jobs/errors";
import { processItem, runDiscoveryPage, type JobDependencies } from "../../app/.server/jobs/processors";
import { createItemProcessor } from "../../app/.server/jobs/queues";
import { engineConsentTokens, getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { clearEngineRests, EngineRouter, engineRest } from "../../app/.server/providers/engine-router";
import { routedEngines } from "../../app/.server/providers/engines";
import { ownKeyTranslation } from "../../app/.server/providers/shop-translation";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { getShopSettings, setAiConsent, setAutoTranslate } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { getMonthlyUsage, getOwnKeyUsage } from "../../app/.server/usage/usage-ledger";
import type { ConsentToken } from "../../app/lib/engines";
import { ownKeyToken, usableOwnKey } from "../../app/lib/own-keys";
import { OWN_KEY_PLAN, PLANS, type Entitlements } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { ownerDb, resetDatabase } from "../support/db";
import { OPERATOR_ENV, ownAzureKey, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { fakeEngineFetch, type FakeEngineSpec } from "../support/fake-engines";
import { FakeShopifyStore } from "../support/fake-store";
import { fixedChecker, seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();

const K1 = ownDeepLKey(1);
const K2 = ownDeepLKey(2);
const AZURE = ownAzureKey(3);
const GOOGLE = ownGoogleKey(4);
const OPERATOR_VALUES = Object.values(OPERATOR_ENV);

/** The fictional operator keys answer too: a call with one of them would be recorded (and fail the test). */
const OPERATOR_SPEC: FakeEngineSpec = {
  deepl: { [OPERATOR_ENV.DEEPL_API_KEY]: "ok" },
  azure: { [OPERATOR_ENV.AZURE_TRANSLATOR_KEY]: "ok" },
  google: { [OPERATOR_ENV.GOOGLE_TRANSLATE_API_KEY]: "ok" },
};

function spec(own: FakeEngineSpec): FakeEngineSpec {
  return {
    deepl: { ...OPERATOR_SPEC.deepl, ...own.deepl },
    azure: { ...OPERATOR_SPEC.azure, ...own.azure },
    google: { ...OPERATOR_SPEC.google, ...own.google },
  };
}

beforeEach(async () => {
  await resetDatabase();
  clearEngineRests();
  resetUnknownKidReports();
  // Linguva's own (fictional) keys for all three engines are in the environment: they must never be used for an own-key shop.
  for (const [name, value] of Object.entries(OPERATOR_ENV)) vi.stubEnv(name, value);
  vi.stubEnv("AZURE_TRANSLATOR_REGION", "westeurope");
  resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

type Billing = { configured: boolean; entitlements: Entitlements };
const OWN: Billing = { configured: true, entitlements: OWN_KEY_PLAN };
const PRO: Billing = { configured: true, entitlements: PLANS.pro };

interface World {
  deps: JobDependencies;
  calls: ReturnType<typeof fakeEngineFetch>["calls"];
  billing: Map<string, Billing>;
  billingReads: string[];
  store: FakeShopifyStore;
  /** Runs before the fake engine answers each request (to change keys while an item runs). */
  before: Array<(url: URL, init: RequestInit | undefined) => Promise<void>>;
}

function world(own: FakeEngineSpec, options: { monthlyLimit?: number; dailyLimit?: number; platformDailyLimit?: number } = {}): World {
  const fake = fakeEngineFetch(spec(own));
  const before: World["before"] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    for (const hook of before) await hook(url, init);
    return fake.fetch(input, init);
  }) as typeof fetch;
  const billing = new Map<string, Billing>();
  const billingReads: string[] = [];
  const store = new FakeShopifyStore(3);
  // The operator's engines, built from the environment exactly as the worker builds them (with the fake fetch).
  const operator = new EngineRouter(routedEngines(getConfig(), { fetch: fetchImpl }));
  const deps: JobDependencies = {
    prisma: app,
    adminFor: async () => store.asAdmin(),
    provider: operator,
    ownKeyTranslation: (shopId, settings) => ownKeyTranslation(shopId, { settings, client: app, mode: "live", fetch: fetchImpl }),
    monthlyLimit: options.monthlyLimit ?? 1_000_000,
    ...(options.dailyLimit !== undefined ? { dailyLimit: options.dailyLimit } : {}),
    ...(options.platformDailyLimit !== undefined ? { platformDailyLimit: options.platformDailyLimit } : {}),
    billingFor: async (shopId) => {
      billingReads.push(shopId);
      return billing.get(shopId) ?? PRO;
    },
    keyPrefix: "lv:test:own-key",
  };
  return { deps, calls: fake.calls, billing, billingReads, store, before };
}

async function ownShop(w: World, domain: string, keys: Array<{ engine: string; apiKey: string; location?: string; region?: string }>, options: { consent?: ConsentToken[] | false; checker?: KeyChecker } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  for (const key of keys) await seedOwnKey(shop.id, key, { client: app, ...(options.checker ? { checker: options.checker } : {}) });
  const tokens = options.consent === false ? [] : (options.consent ?? (await listEngineKeys(shop.id, app)).filter(usableOwnKey).map(ownKeyToken));
  if (tokens.length) expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: tokens, consent: { configured: tokens, payer: "merchant" } }, app)).toBe("saved");
  w.billing.set(shop.id, OWN);
  return shop;
}

async function operatorShop(w: World, domain: string, options: { consent?: boolean } = {}) {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  if (options.consent ?? true) expect(await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: engineConsentTokens(getConfig()) }, app)).toBe("saved");
  w.billing.set(shop.id, PRO);
  return shop;
}

async function itemsOf(w: World, shopId: string, options: { automatic?: boolean; requestedBy?: string; key?: string } = {}) {
  if (options.automatic) await setAutoTranslate({ shopId, enabled: true, locales: ["de"], allowedLocales: ["de"], actorId: null }, app);
  const requestedBy = options.requestedBy ?? (options.automatic ? AUTO_REQUESTED_BY : null);
  const { job } = await createBulkJob({ shopId, resourceType: "PRODUCT", targetLocale: "de", requestedBy, idempotencyKey: options.key ?? `own-${shopId.slice(0, 8)}-${requestedBy ?? "m"}` }, app);
  const page = await runDiscoveryPage(w.deps, { shopId, jobId: job.id });
  return { job, itemIds: page.itemIds };
}

/** The item processor (what the queue runs): stops jobs, finishes items and pauses automatic translation. */
const run = (w: World, shopId: string, itemId: string, attemptsMade = 0) =>
  createItemProcessor(w.deps)({ data: { shopId, itemId }, id: `${itemId}:${attemptsMade}`, attemptsMade, opts: { attempts: 5 } } as never);

const translateCalls = (w: World) => w.calls.filter((c) => /translate/.test(c.path) && !/languages/.test(c.path));
const jobOf = (shopId: string, jobId: string) => withTenant(shopId, (tx) => tx.translationJob.findFirstOrThrow({ where: { id: jobId } }), app);
const itemOf = (shopId: string, itemId: string) => withTenant(shopId, (tx) => tx.translationJobItem.findFirstOrThrow({ where: { id: itemId } }), app);
const keyRows = (shopId: string) => withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);
const ledger = (shopId: string) => withTenant(shopId, (tx) => tx.usageLedger.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } }), app);

function expectNoOperatorKey(w: World) {
  for (const call of w.calls) for (const value of OPERATOR_VALUES) expect(JSON.stringify(call)).not.toContain(value);
}

describe("an Own key shop translates only with its own keys", () => {
  it("sends every request with the merchant's key to its host, charges the merchant and ignores Linguva's limits", async () => {
    const w = world({ deepl: { [K1]: "ok" } }, { monthlyLimit: 1, dailyLimit: 1, platformDailyLimit: 1 });
    const shop = await ownShop(w, "own-ok.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { job, itemIds } = await itemsOf(w, shop.id);
    for (const itemId of itemIds) expect(await processItem(w.deps, { shopId: shop.id, itemId }, 1)).toMatchObject({ status: "SUCCEEDED" });

    expect(translateCalls(w).length).toBeGreaterThan(0);
    for (const call of w.calls) {
      expect(call.host).toBe("api-free.deepl.com");
      expect(call.authHeader).toBe(`DeepL-Auth-Key ${K1}`);
    }
    expectNoOperatorKey(w);
    // The ledger: every row the merchant's, nothing for Linguva's allowance or the platform.
    const rows = await ledger(shop.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.payer === "merchant" && r.provider === "deepl")).toBe(true);
    expect(await ownerDb.platformUsageDay.count()).toBe(0);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBe(0);
    const billed = (await jobOf(shop.id, job.id)).charsBilled;
    expect(billed).toBeGreaterThan(0);
    expect(await getOwnKeyUsage(shop.id, undefined, app)).toEqual({ total: billed, byEngine: { deepl: billed } });
  });

  it("stops an automatic job with OWN_KEY_QUOTA_DEEPL when the key's quota is used up: item cancelled, an hour's pause, key marked", async () => {
    const w = world({ deepl: { [K1]: "quota" } });
    const shop = await ownShop(w, "own-quota.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { job, itemIds } = await itemsOf(w, shop.id, { automatic: true });
    const started = Date.now();
    await expect(run(w, shop.id, itemIds[0]!)).rejects.toThrow("OWN_KEY_QUOTA_DEEPL");
    expect(await jobOf(shop.id, job.id)).toMatchObject({ status: "FAILED", errorCode: "OWN_KEY_QUOTA_DEEPL" });
    expect(await itemOf(shop.id, itemIds[0]!)).toMatchObject({ status: "CANCELLED", errorCode: "OWN_KEY_QUOTA_DEEPL" });
    const settings = await getShopSettings(shop.id, app);
    expect(settings.autoPauseReason).toBe("OWN_KEY_QUOTA_DEEPL");
    expect(settings.autoPausedUntil!.getTime() - started).toBeGreaterThan(55 * 60_000);
    expect(settings.autoPausedUntil!.getTime() - started).toBeLessThan(65 * 60_000);
    expect((await keyRows(shop.id))[0]).toMatchObject({ status: "QUOTA", lastErrorCode: "OWN_KEY_QUOTA_DEEPL" });
    expectNoOperatorKey(w);
    // Nothing charged: the engine refused before billing (the reservation was released).
    expect((await getOwnKeyUsage(shop.id, undefined, app)).total).toBe(0);
  });

  it("stops with OWN_KEY_AUTH_DEEPL when the key is refused, marks it REFUSED, and the next item builds no provider from it", async () => {
    const w = world({ deepl: { [K1]: "refused" } });
    const shop = await ownShop(w, "own-auth.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { itemIds } = await itemsOf(w, shop.id);
    const error = await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1).catch((e: unknown) => e);
    expect(classifyError(error)).toEqual({ kind: "job-stop", code: "OWN_KEY_AUTH_DEEPL" });
    expect((await keyRows(shop.id))[0]).toMatchObject({ status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL" });
    const calls = w.calls.length;
    // The refused key is no longer used: the stop comes from the shop's keys, without a request.
    await expect(processItem(w.deps, { shopId: shop.id, itemId: itemIds[1]! }, 1)).rejects.toEqual(new JobStopError("OWN_KEY_AUTH_DEEPL"));
    expect(w.calls.length).toBe(calls);
    expectNoOperatorKey(w);
  });

  it("fails over among the merchant's keys only: DeepL used up, Google translates and is charged, DeepL marked", async () => {
    const w = world({ deepl: { [K1]: "quota" }, google: { [GOOGLE]: "ok" } });
    const shop = await ownShop(w, "own-failover.myshopify.com", [
      { engine: "deepl", apiKey: K1 },
      { engine: "google", apiKey: GOOGLE },
    ]);
    const { itemIds } = await itemsOf(w, shop.id);
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const drafts = await withTenant(shop.id, (tx) => tx.translationDraft.findMany({ select: { provider: true } }), app);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.provider === "google")).toBe(true);
    // failovers reached noteOwnKeyResult through completeTranslation: DeepL's row says so.
    expect((await keyRows(shop.id)).map((r) => [r.engine, r.status])).toEqual([
      ["deepl", "QUOTA"],
      ["google", "OK"],
    ]);
    const usage = await getOwnKeyUsage(shop.id, undefined, app);
    expect(usage.byEngine.google).toBeGreaterThan(0);
    expect(usage.byEngine.deepl ?? 0).toBe(0);
    for (const call of translateCalls(w)) expect([`DeepL-Auth-Key ${K1}`, GOOGLE]).toContain(call.authHeader);
    expectNoOperatorKey(w);
  });

  it("marks both keys when every key fails (DeepL used up, Google refused) and never reaches an operator engine", async () => {
    const w = world({ deepl: { [K1]: "quota" }, google: { [GOOGLE]: "refused" } });
    const shop = await ownShop(w, "own-both.myshopify.com", [
      { engine: "deepl", apiKey: K1 },
      { engine: "google", apiKey: GOOGLE },
    ]);
    const { itemIds } = await itemsOf(w, shop.id);
    const error = await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1).catch((e: unknown) => e);
    expect(classifyError(error)).toMatchObject({ kind: "job-stop", code: "OWN_KEY_QUOTA_DEEPL" });
    expect((await keyRows(shop.id)).map((r) => [r.engine, r.status])).toEqual([
      ["deepl", "QUOTA"],
      ["google", "REFUSED"],
    ]);
    expect(w.calls.length).toBeGreaterThan(0);
    expectNoOperatorKey(w);
  });

  it("never blames a key replaced while the item ran: the new key stays OK, no stop, no pause, the retry uses it", async () => {
    const w = world({ deepl: { [K1]: "refused", [K2]: "ok" } });
    const shop = await ownShop(w, "own-replace.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { job, itemIds } = await itemsOf(w, shop.id, { automatic: true });
    let replaced = false;
    w.before.push(async (url, init) => {
      if (replaced || url.pathname !== "/v2/translate" || !new Headers(init?.headers).get("Authorization")?.includes(K1)) return;
      replaced = true;
      // K1 was loaded for this item; the merchant saves K2 before K1's answer (a refusal) arrives.
      await seedOwnKey(shop.id, { engine: "deepl", apiKey: K2 }, { client: app });
    });
    const error = await run(w, shop.id, itemIds[0]!).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranslationProviderError);
    expect(classifyError(error)).toEqual({ kind: "retryable", code: "PROVIDER_UNAVAILABLE" });
    expect((await keyRows(shop.id))[0]).toMatchObject({ status: "OK", keyVersion: 2, lastErrorCode: null });
    expect(await jobOf(shop.id, job.id)).toMatchObject({ errorCode: null });
    expect((await getShopSettings(shop.id, app)).autoPauseReason).toBeNull();
    // The queue's retry: translated with K2.
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 2)).toMatchObject({ status: "SUCCEEDED" });
    expect(translateCalls(w).at(-1)!.authHeader).toBe(`DeepL-Auth-Key ${K2}`);
  });

  it("a late success with an old key doesn't flip the new key's QUOTA", async () => {
    const w = world({ deepl: { [K1]: "ok", [K2]: "ok" } });
    const quota = fixedChecker("quota");
    const shop = await ownShop(w, "own-late.myshopify.com", [{ engine: "deepl", apiKey: K1 }], { checker: quota, consent: ["deepl"] });
    const { itemIds } = await itemsOf(w, shop.id);
    let replaced = false;
    w.before.push(async (url) => {
      if (replaced || url.pathname !== "/v2/translate") return;
      replaced = true;
      await seedOwnKey(shop.id, { engine: "deepl", apiKey: K2 }, { client: app, checker: quota });
    });
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await keyRows(shop.id))[0]).toMatchObject({ status: "QUOTA", keyVersion: 2 });
    // Without a replacement, a QUOTA key that answered is usable again.
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[1]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect((await keyRows(shop.id))[0]).toMatchObject({ status: "OK", keyVersion: 2, lastErrorCode: null });
  });

  it("without a key stops with OWN_KEY_MISSING before CONSENT_REQUIRED, and pauses nothing", async () => {
    const w = world({});
    const shop = await ownShop(w, "own-missing.myshopify.com", [], { consent: false });
    const { job, itemIds } = await itemsOf(w, shop.id, { automatic: true });
    await expect(run(w, shop.id, itemIds[0]!)).rejects.toThrow("OWN_KEY_MISSING");
    expect(await jobOf(shop.id, job.id)).toMatchObject({ status: "FAILED", errorCode: "OWN_KEY_MISSING" });
    const settings = await getShopSettings(shop.id, app);
    expect(settings).toMatchObject({ autoPausedUntil: null, autoPauseReason: null });
    expect(w.calls).toEqual([]);
  });

  it("stops a smart job left over from Business with PLAN_SMART, before looking at keys", async () => {
    const w = world({});
    const shop = await ownShop(w, "own-smart.myshopify.com", [], { consent: false });
    const { itemIds } = await itemsOf(w, shop.id, { requestedBy: SMART_REQUESTED_BY });
    await expect(processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).rejects.toEqual(new JobStopError("PLAN_SMART"));
  });

  it("sends nothing when the consent covers another data location than the key's (azure-eu consent, global key)", async () => {
    const w = world({ azure: { [AZURE]: "ok" } });
    const shop = await ownShop(w, "own-azure.myshopify.com", [{ engine: "azure", apiKey: AZURE, location: "global", region: "westeurope" }], { consent: ["azure-eu"] });
    const { itemIds } = await itemsOf(w, shop.id);
    await expect(processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).rejects.toEqual(new JobStopError("CONSENT_REQUIRED"));
    expect(translateCalls(w)).toEqual([]);
  });

  it("an unknown key id fails the item retryable (no stop, no pause, no OWN_KEY_MISSING) until the keyring has it again", async () => {
    const w = world({ deepl: { [K1]: "ok" } });
    const shop = await ownShop(w, "own-kid.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { job, itemIds } = await itemsOf(w, shop.id, { automatic: true });
    const keyring = process.env.TOKEN_ENCRYPTION_KEYS!;
    const before = await keyRows(shop.id);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `other:${Buffer.alloc(32, 3).toString("base64")}`);
    resetConfigCache();
    const error = await run(w, shop.id, itemIds[0]!).catch((e: unknown) => e);
    expect(classifyError(error)).toEqual({ kind: "retryable", code: "PROVIDER_UNAVAILABLE" });
    expect(await jobOf(shop.id, job.id)).toMatchObject({ errorCode: null });
    expect((await getShopSettings(shop.id, app)).autoPauseReason).toBeNull();
    expect(await keyRows(shop.id)).toEqual(before);
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", keyring);
    resetConfigCache();
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 2)).toMatchObject({ status: "SUCCEEDED" });
  });

  it("holds no key in the provider it builds, at any depth", async () => {
    const w = world({ deepl: { [K1]: "ok" }, azure: { [AZURE]: "ok" }, google: { [GOOGLE]: "ok" } });
    const shop = await ownShop(w, "own-sealed.myshopify.com", [
      { engine: "deepl", apiKey: K1 },
      { engine: "azure", apiKey: AZURE, region: "westeurope" },
      { engine: "google", apiKey: GOOGLE },
    ]);
    const t = await ownKeyTranslation(shop.id, { client: app, mode: "live", fetch: fakeEngineFetch({}).fetch });
    expect(t.provider?.engines).toEqual(["deepl", "azure", "google"]);
    for (const thing of [t, t.provider, t.used, { deep: { deeper: { t } } }]) {
      for (const text of [JSON.stringify(thing), inspect(thing, { depth: Infinity, showHidden: true })]) {
        for (const key of [K1, AZURE, GOOGLE]) expect(text).not.toContain(key);
      }
    }
  });
});

describe("every other plan keeps today's path", () => {
  it("keeps the stop precedence AI_NOT_CONFIGURED → CONSENT_REQUIRED → PLAN_REQUIRED", async () => {
    const w = world({});
    const shop = await operatorShop(w, "op-order.myshopify.com", { consent: false });
    const { itemIds } = await itemsOf(w, shop.id);
    const item = { shopId: shop.id, itemId: itemIds[0]! };
    await expect(processItem({ ...w.deps, provider: null }, item, 1)).rejects.toEqual(new JobStopError("AI_NOT_CONFIGURED"));
    w.billing.set(shop.id, { configured: true, entitlements: PLANS.free });
    await expect(processItem(w.deps, item, 1)).rejects.toEqual(new JobStopError("CONSENT_REQUIRED"));
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: engineConsentTokens(getConfig()) }, app);
    await expect(processItem(w.deps, item, 1)).rejects.toEqual(new JobStopError("PLAN_REQUIRED"));
    expect(w.calls).toEqual([]);
  });

  it("reads no billing before the throttle while an operator provider exists", async () => {
    const w = world({});
    const shop = await operatorShop(w, "op-throttle.myshopify.com");
    const { itemIds } = await itemsOf(w, shop.id);
    w.billingReads.length = 0;
    const limited: JobDependencies = { ...w.deps, shopifyLimiter: { take: async () => 500 } };
    await expect(processItem(limited, { shopId: shop.id, itemId: itemIds[0]! }, 1)).rejects.toEqual(new RateLimitedError(500));
    expect(w.billingReads).toEqual([]);
  });

  it("a Pro shop in the same process uses the operator's engines while an own DeepL key rests", async () => {
    const w = world({ deepl: { [K1]: "quota" } });
    const own = await ownShop(w, "own-rest.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const ownItems = await itemsOf(w, own.id);
    await processItem(w.deps, { shopId: own.id, itemId: ownItems.itemIds[0]! }, 1).catch(() => undefined);
    // The own key rests under its fingerprint, never under the engine id the operator uses.
    expect(engineRest("deepl")).toBeNull();
    const pro = await operatorShop(w, "op-rest.myshopify.com");
    const proItems = await itemsOf(w, pro.id);
    w.calls.length = 0;
    expect(await processItem(w.deps, { shopId: pro.id, itemId: proItems.itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    const sent = translateCalls(w);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((c) => c.authHeader === `DeepL-Auth-Key ${OPERATOR_ENV.DEEPL_API_KEY}`)).toBe(true);
    expect((await ledger(pro.id)).every((r) => r.payer === null)).toBe(true);
  });

  it("a pending change to Own key doesn't use the saved keys: Pro translates with Linguva's engines and allowance", async () => {
    const w = world({ deepl: { [K1]: "ok" } });
    const shop = await operatorShop(w, "op-pending.myshopify.com");
    await seedOwnKey(shop.id, { engine: "deepl", apiKey: K1 }, { client: app });
    const { itemIds } = await itemsOf(w, shop.id);
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    for (const call of translateCalls(w)) expect(call.authHeader).toBe(`DeepL-Auth-Key ${OPERATOR_ENV.DEEPL_API_KEY}`);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBeGreaterThan(0);
    expect(await getOwnKeyUsage(shop.id, undefined, app)).toEqual({ total: 0, byEngine: {} });
  });

  it("follows a plan change between two items: down to Pro uses the operator and the allowance, back up uses the own key", async () => {
    const w = world({ deepl: { [K1]: "ok" } });
    const shop = await ownShop(w, "own-switch.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    // The store also allowed Linguva's notice once (before or after): each notice has its own version.
    const { itemIds } = await itemsOf(w, shop.id);
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[0]! }, 1)).toMatchObject({ status: "SUCCEEDED" });
    expect(translateCalls(w).every((c) => c.authHeader === `DeepL-Auth-Key ${K1}`)).toBe(true);

    // Down to Pro: the own-key consent doesn't cover Linguva's notice.
    w.billing.set(shop.id, PRO);
    await expect(processItem(w.deps, { shopId: shop.id, itemId: itemIds[1]! }, 1)).rejects.toEqual(new JobStopError("CONSENT_REQUIRED"));
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: engineConsentTokens(getConfig()) }, app);
    w.calls.length = 0;
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[1]! }, 2)).toMatchObject({ status: "SUCCEEDED" });
    expect(translateCalls(w).every((c) => c.authHeader === `DeepL-Auth-Key ${OPERATOR_ENV.DEEPL_API_KEY}`)).toBe(true);
    expect(await getMonthlyUsage(shop.id, undefined, app)).toBeGreaterThan(0);

    // Back up to Own key: asked once again for the own-key notice, then the own key.
    w.billing.set(shop.id, OWN);
    await expect(processItem(w.deps, { shopId: shop.id, itemId: itemIds[2]! }, 1)).rejects.toEqual(new JobStopError("CONSENT_REQUIRED"));
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null, shown: ["deepl"], consent: { configured: ["deepl"], payer: "merchant" } }, app);
    w.calls.length = 0;
    expect(await processItem(w.deps, { shopId: shop.id, itemId: itemIds[2]! }, 2)).toMatchObject({ status: "SUCCEEDED" });
    expect(translateCalls(w).every((c) => c.authHeader === `DeepL-Auth-Key ${K1}`)).toBe(true);
  });

  it("without the own-key dependency an Own key shop has no provider: OWN_KEY_MISSING, never the operator's", async () => {
    const w = world({ deepl: { [K1]: "ok" } });
    const shop = await ownShop(w, "own-nodeps.myshopify.com", [{ engine: "deepl", apiKey: K1 }]);
    const { itemIds } = await itemsOf(w, shop.id);
    const withoutOwn: JobDependencies = { ...w.deps };
    delete withoutOwn.ownKeyTranslation;
    await expect(processItem(withoutOwn, { shopId: shop.id, itemId: itemIds[0]! }, 1)).rejects.toEqual(new JobStopError("OWN_KEY_MISSING"));
    expect(w.calls).toEqual([]);
  });
});
