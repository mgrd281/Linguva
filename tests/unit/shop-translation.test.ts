/**
 * The per-shop provider (app/.server/providers/shop-translation.ts): a shop
 * without own keys gets exactly the operator's provider and consent tokens,
 * with no database read; the Own key plan's members are built from the
 * merchant's keys only (never DEEPL_API_URL or an operator key), in DeepL,
 * Azure, Google order; mock members in mock mode; and no key is ever visible
 * in JSON or util.inspect of a sealed provider, its router or a credential.
 */
import { inspect } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { ownStateKey, stateMaterial } from "../../app/.server/credentials/cipher";
import { azureEndpointFor, type OwnCredential } from "../../app/.server/credentials/store";
import { engineConsentTokens, getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { SecretValue } from "../../app/.server/lib/secret";
import { getTranslationProvider } from "../../app/.server/providers";
import { AzureTranslatorProvider } from "../../app/.server/providers/azure";
import { DeepLProvider } from "../../app/.server/providers/deepl";
import { clearEngineRests, EngineRouter } from "../../app/.server/providers/engine-router";
import { GoogleTranslateProvider } from "../../app/.server/providers/google";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import {
  consentForShop,
  openShopTranslation,
  operatorTranslation,
  ownKeyEngines,
  SealedProvider,
  shopTranslationFacts,
} from "../../app/.server/providers/shop-translation";
import { TranslationProviderError, type TranslationRequest } from "../../app/.server/providers/types";
import type { EngineId } from "../../app/lib/engines";
import { OWN_KEY_PLAN, PLANS } from "../../app/lib/plans";
import { FAKE_AZURE_KEY, OPERATOR_ENV, ownAzureKey, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { fakeEngineFetch } from "../support/fake-engines";

const SAVED = { ...process.env };
const ENGINE_ENV = ["DEEPL_API_KEY", "DEEPL_API_KEYS", "DEEPL_API_URL", "AZURE_TRANSLATOR_KEY", "AZURE_TRANSLATOR_REGION", "GOOGLE_TRANSLATE_API_KEY", "GOOGLE_TRANSLATE_CREDENTIALS", "TRANSLATION_ENGINES", "TRANSLATION_PROVIDER"];
function withEnv(env: Record<string, string>) {
  for (const key of ENGINE_ENV) delete process.env[key];
  Object.assign(process.env, env);
  resetConfigCache();
}

afterEach(() => {
  process.env = { ...SAVED };
  resetConfigCache();
  clearEngineRests();
});

/** A Prisma client that fails the test on any use: the operator's branch reads nothing. */
function noQueries(): { client: PrismaClient; touched: string[] } {
  const touched: string[] = [];
  const client = new Proxy({} as PrismaClient, {
    get(_target, property) {
      touched.push(String(property));
      throw new Error(`database used: ${String(property)}`);
    },
  });
  return { client, touched };
}

const DEEPL = ownDeepLKey(11);
const AZURE = ownAzureKey(12);
const GOOGLE = ownGoogleKey(13);

function credential(engine: EngineId, key: string, options: { dataLocation?: "eu" | "global"; region?: string | null } = {}): OwnCredential {
  const dataLocation = engine === "google" ? "global" : (options.dataLocation ?? "eu");
  const region = engine === "azure" ? (options.region ?? null) : null;
  const endpoint = engine === "azure" ? azureEndpointFor(dataLocation) : undefined;
  return {
    id: `row-${engine}`,
    engine,
    apiKey: new SecretValue(key),
    dataLocation,
    region,
    ...(endpoint ? { endpoint } : {}),
    stateKey: ownStateKey(engine, stateMaterial(engine, key, endpoint ? { region, endpoint } : undefined)),
    status: "OK",
    keyVersion: 1,
  };
}

// Source and target both in the fake engines' language lists.
const request: TranslationRequest = { segments: ["Blue jacket"], sourceLocale: "fr", targetLocale: "de" };
const OPERATOR_VALUES = Object.values(OPERATOR_ENV);

describe("the operator's branch is today's provider", () => {
  it("equals getTranslationProvider() and the environment's tokens per mode, without a database read", async () => {
    const cases: Array<{ env: Record<string, string>; kind: unknown }> = [
      { env: { TRANSLATION_PROVIDER: "mock" }, kind: MockTranslationProvider },
      { env: {}, kind: null },
      { env: { DEEPL_API_KEY: OPERATOR_ENV.DEEPL_API_KEY }, kind: DeepLProvider },
      { env: { DEEPL_API_KEY: OPERATOR_ENV.DEEPL_API_KEY, AZURE_TRANSLATOR_KEY: FAKE_AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" }, kind: EngineRouter },
    ];
    for (const { env, kind } of cases) {
      withEnv(env);
      const expected = getTranslationProvider();
      for (const billing of [null, undefined, { entitlements: PLANS.pro }, { entitlements: PLANS.business }]) {
        const { client, touched } = noQueries();
        const opened = await openShopTranslation("shop-1", billing, { client });
        const facts = await shopTranslationFacts("shop-1", billing, { client });
        const consent = await consentForShop("shop-1", billing, client);
        expect(touched).toEqual([]);
        if (kind === null) expect(opened.provider).toBeNull();
        else expect(opened.provider).toBeInstanceOf(kind as new (...args: never[]) => unknown);
        expect(opened.provider?.constructor).toBe(expected?.constructor);
        const tokens = engineConsentTokens(getConfig());
        expect(opened).toMatchObject({ payer: "linguva", available: expected !== null, configured: tokens, unavailable: expected ? null : "AI_NOT_CONFIGURED", keys: null });
        expect(facts).toEqual({ payer: "linguva", available: expected !== null, configured: tokens, unavailable: expected ? null : "AI_NOT_CONFIGURED", keys: null });
        expect(consent).toEqual({ configured: tokens, payer: "linguva" });
      }
    }
  });

  it("operatorTranslation wraps exactly the provider it is given", () => {
    withEnv({});
    const mock = new MockTranslationProvider();
    expect(operatorTranslation(mock).provider).toBe(mock);
    expect(operatorTranslation(null)).toEqual({ payer: "linguva", provider: null, available: false, configured: ["deepl"], unavailable: "AI_NOT_CONFIGURED", keys: null });
  });
});

describe("the Own key plan's members", () => {
  it("are the merchant's keys in DeepL, Azure, Google order, never the operator's keys or DEEPL_API_URL", async () => {
    withEnv({ ...OPERATOR_ENV, DEEPL_API_URL: "https://api.deepl.com", AZURE_TRANSLATOR_REGION: "westeurope" });
    const fake = fakeEngineFetch({ deepl: { [DEEPL]: "ok" }, azure: { [AZURE]: "ok" }, google: { [GOOGLE]: "ok" } });
    const members = ownKeyEngines(
      [credential("deepl", DEEPL), credential("azure", AZURE, { region: "westeurope" }), credential("google", GOOGLE)],
      getConfig(),
      { mode: "live", fetch: fake.fetch },
    );
    expect(members.map((m) => m.id)).toEqual(["deepl", "azure", "google"]);
    expect(members.every((m) => m.provider instanceof SealedProvider && m.stateKey?.startsWith(`own:${m.id}:`))).toBe(true);
    for (const member of members) {
      const result = await member.provider.translate(request);
      expect(result.provider).toBe(member.id);
      expect(result.translations).toEqual(["[de] Blue jacket"]);
    }
    // DeepL API Free key → api-free (the key picks the host, not DEEPL_API_URL); Azure EU endpoint
    // with the key's region; Google v2 with the key in its header.
    const translations = fake.calls.filter((c) => /translate/.test(c.path) && !/languages/.test(c.path));
    expect(translations.map((c) => [c.host, c.authHeader, c.region])).toEqual([
      ["api-free.deepl.com", `DeepL-Auth-Key ${DEEPL}`, null],
      ["api-eur.cognitive.microsofttranslator.com", AZURE, "westeurope"],
      ["translation.googleapis.com", GOOGLE, null],
    ]);
    for (const call of fake.calls) for (const value of OPERATOR_VALUES) expect(JSON.stringify(call)).not.toContain(value);
  });

  it("take Azure's endpoint from the key's data location and a DeepL Pro key to api.deepl.com", async () => {
    withEnv({ DEEPL_API_URL: "https://api-free.deepl.com" });
    const pro = ownDeepLKey(21, false);
    const fake = fakeEngineFetch({ deepl: { [pro]: "ok" }, azure: { [AZURE]: "ok" } });
    const [deepl, azure] = ownKeyEngines([credential("deepl", pro), credential("azure", AZURE, { dataLocation: "global" })], getConfig(), { mode: "live", fetch: fake.fetch });
    await deepl!.provider.translate(request);
    await azure!.provider.translate(request);
    const hosts = fake.calls.filter((c) => /translate/.test(c.path) && !/languages/.test(c.path)).map((c) => [c.host, c.region]);
    expect(hosts).toEqual([
      ["api.deepl.com", null],
      ["api.cognitive.microsofttranslator.com", null],
    ]);
  });

  it("are offline mock members in mock mode: the engine's id, and -quota / -refused test keys fail every call", async () => {
    withEnv({ TRANSLATION_PROVIDER: "mock" });
    const [ok, quota, refused] = ownKeyEngines(
      [credential("deepl", "mock-deepl-1:fx"), credential("azure", "mock-azure-quota"), credential("google", "mock-google-refused")],
      getConfig(),
    );
    expect(await ok!.provider.translate(request)).toMatchObject({ provider: "deepl", translations: ["[de] Blue jacket"] });
    for (const [member, kind] of [[quota!, "quota"], [refused!, "auth"]] as const) {
      for (let i = 0; i < 3; i++) {
        const error = await member.provider.translate(request).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(TranslationProviderError);
        expect(error).toMatchObject({ provider: member.id, kind });
      }
    }
  });
});

describe("a merchant key never shows", () => {
  it("in JSON or util.inspect of a sealed provider, its router or a credential", () => {
    withEnv({});
    const credentials = [credential("deepl", DEEPL), credential("azure", AZURE, { region: "westeurope" }), credential("google", GOOGLE)];
    const fake = fakeEngineFetch({});
    const members = ownKeyEngines(credentials, getConfig(), { mode: "live", fetch: fake.fetch });
    const router = new EngineRouter(members, { ownKeys: { consented: ["deepl", "azure", "google"] } });
    const things: unknown[] = [router, ...members, ...members.map((m) => m.provider), ...credentials, { nested: { deeper: { router, credentials } } }];
    for (const thing of things) {
      const shown = [JSON.stringify(thing), inspect(thing, { depth: Infinity, showHidden: true }), String((thing as object).toString?.())];
      for (const text of shown) for (const key of [DEEPL, AZURE, GOOGLE]) expect(text).not.toContain(key);
    }
    const sealed = members[0]!.provider;
    expect(JSON.stringify(sealed)).toBe('"[own-key provider deepl]"');
    expect(inspect(sealed)).toBe("[own-key provider deepl]");
    // Public fields: the id, and the capabilities where the adapter declares them.
    expect(Object.keys(members[0]!.provider)).toEqual(["id"]);
    expect(Object.keys(members[1]!.provider)).toEqual(["id", "capabilities"]);
    expect({ ...members[2]!.provider }).toEqual({ id: "google", capabilities: { formality: false, context: false } });
  });
});

describe("SealedProvider", () => {
  it("answers translate, capabilities and the language list exactly as the adapter it wraps", async () => {
    withEnv({});
    const spec = { deepl: { [DEEPL]: "ok" as const }, azure: { [AZURE]: "ok" as const }, google: { [GOOGLE]: "ok" as const } };
    const builds: Array<[EngineId, string, (key: string, f: typeof fetch) => DeepLProvider | AzureTranslatorProvider | GoogleTranslateProvider]> = [
      ["deepl", DEEPL, (key, f) => new DeepLProvider({ apiKey: key, fetch: f })],
      ["azure", AZURE, (key, f) => new AzureTranslatorProvider({ key, region: "westeurope", fetch: f })],
      ["google", GOOGLE, (key, f) => new GoogleTranslateProvider({ auth: { kind: "apiKey", apiKey: key }, cacheScope: `own:google:scope-${key.length}`, fetch: f })],
    ];
    for (const [engine, key, build] of builds) {
      const direct = build(key, fakeEngineFetch(spec).fetch);
      const sealed = new SealedProvider(engine, new SecretValue(key), (k) => build(k, fakeEngineFetch(spec).fetch));
      expect(sealed.id).toBe(direct.id);
      expect(sealed.capabilities).toEqual((direct as { capabilities?: unknown }).capabilities);
      expect(await sealed.translate(request)).toEqual(await direct.translate(request));
      expect(typeof sealed.targetSupport).toBe("function");
      expect(await sealed.targetSupport!(["de", "fr", "xx"])).toEqual(await direct.targetSupport(["de", "fr", "xx"]));
    }
    // A mock adapter declares no language list: neither does its sealed provider (every locale).
    const mock = new SealedProvider("deepl", new SecretValue("mock-deepl-2"), () => new MockTranslationProvider({ id: "deepl" }));
    expect(mock.targetSupport).toBeUndefined();
    expect(mock.capabilities).toBeUndefined();
  });

  it("reveals the key only to the builder, once", () => {
    let revealed: string[] = [];
    new SealedProvider("deepl", new SecretValue(DEEPL), (key) => {
      revealed = [...revealed, key];
      return new MockTranslationProvider({ id: "deepl" });
    });
    expect(revealed).toEqual([DEEPL]);
  });
});

describe("own-key facts need the plan", () => {
  it("an Own key billing reads the shop's keys (not the operator's)", async () => {
    withEnv({ TRANSLATION_PROVIDER: "mock" });
    const { client, touched } = noQueries();
    await expect(shopTranslationFacts("00000000-0000-4000-8000-000000000001", { entitlements: OWN_KEY_PLAN }, { client })).rejects.toThrow(/database used/);
    expect(touched.length).toBeGreaterThan(0);
  });
});
