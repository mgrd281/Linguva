/**
 * The Own key plan's encryption context, process state keys and the
 * merchant's own DeepL usage figure (app/.server/credentials/cipher.ts,
 * deepl-quota.ts). Keys are fictional; every response comes from a fake fetch.
 */
import { afterEach, describe, expect, it } from "vitest";
import { credentialCipher, credentialContext, ownStateKey, stateMaterial } from "../../app/.server/credentials/cipher";
import { clearOwnDeepLUsageCache, ownDeepLUsage } from "../../app/.server/credentials/deepl-quota";
import { DecryptionError, TokenCipher } from "../../app/.server/lib/crypto";
import { SecretValue } from "../../app/.server/lib/secret";
import { AZURE_EU_ENDPOINT, AZURE_GLOBAL_ENDPOINT } from "../../app/.server/providers/azure";
import { fakeEngineFetch } from "../support/fake-engines";
import { ownAzureKey, ownDeepLKey } from "../support/engine-fixtures";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const keyring = (id: string, fill: number) => `${id}:${Buffer.alloc(32, fill).toString("base64")}`;

afterEach(() => clearOwnDeepLUsageCache());

describe("credential encryption context", () => {
  it("binds shop, engine, data location and region (a copied envelope doesn't decrypt)", () => {
    const cipher = TokenCipher.fromKeyring(keyring("k1", 3));
    const row = { shopId: SHOP_A, engine: "azure" as const, dataLocation: "eu" as const, region: "westeurope" };
    expect(credentialContext(row)).toBe(["engine-credential", SHOP_A, "azure", "eu", "westeurope"].join("\u0000"));
    expect(credentialContext({ ...row, region: null })).toBe(["engine-credential", SHOP_A, "azure", "eu", ""].join("\u0000"));
    const envelope = cipher.encrypt(JSON.stringify({ v: 1, apiKey: ownAzureKey(1) }), credentialContext(row));
    expect(JSON.parse(cipher.decrypt(envelope, credentialContext(row))).apiKey).toBe(ownAzureKey(1));
    for (const other of [
      { ...row, shopId: SHOP_B },
      { ...row, engine: "google" as const },
      { ...row, dataLocation: "global" as const },
      { ...row, region: "northeurope" },
      { ...row, region: null },
    ]) {
      expect(() => cipher.decrypt(envelope, credentialContext(other))).toThrow(DecryptionError);
    }
    // Without a context (a session's AAD) it doesn't decrypt either.
    expect(() => cipher.decrypt(envelope)).toThrow(DecryptionError);
  });

  it("uses one cipher per keyring string", () => {
    const one = credentialCipher({ TOKEN_ENCRYPTION_KEYS: keyring("k1", 4) });
    expect(credentialCipher({ TOKEN_ENCRYPTION_KEYS: keyring("k1", 4) })).toBe(one);
    const other = credentialCipher({ TOKEN_ENCRYPTION_KEYS: keyring("k2", 5) });
    expect(other).not.toBe(one);
    expect(other.activeKeyId()).toBe("k2");
  });
});

describe("own state keys (fingerprints, never the key)", () => {
  const cipher = TokenCipher.fromKeyring(keyring("k1", 6));

  it("is own:<engine>:<22 characters>, stable, and doesn't contain the key", () => {
    const key = ownDeepLKey(1);
    const state = ownStateKey("deepl", key, cipher);
    expect(state).toMatch(/^own:deepl:[A-Za-z0-9_-]{22}$/);
    expect(ownStateKey("deepl", key, cipher)).toBe(state);
    expect(state).not.toContain(key.slice(0, 8));
    expect(state).not.toContain(key.slice(-6));
    expect(ownStateKey("deepl", ownDeepLKey(2), cipher)).not.toBe(state);
    expect(ownStateKey("google", key, cipher).slice(-22)).not.toBe(state.slice(-22));
    // Another keyring (a rotation) gives another fingerprint.
    expect(ownStateKey("deepl", key, TokenCipher.fromKeyring(keyring("k9", 9)))).not.toBe(state);
  });

  it("tells an Azure key apart by region and endpoint (another account state)", () => {
    const key = ownAzureKey(2);
    const eu = ownStateKey("azure", stateMaterial("azure", key, { region: "westeurope", endpoint: AZURE_EU_ENDPOINT }), cipher);
    const global = ownStateKey("azure", stateMaterial("azure", key, { region: "westeurope", endpoint: AZURE_GLOBAL_ENDPOINT }), cipher);
    const noRegion = ownStateKey("azure", stateMaterial("azure", key, { region: null, endpoint: AZURE_EU_ENDPOINT }), cipher);
    expect(new Set([eu, global, noRegion]).size).toBe(3);
    expect(stateMaterial("deepl", "x")).toBe("x");
    expect(stateMaterial("google", "y")).toBe("y");
  });
});

describe("the merchant's own DeepL usage (Settings)", () => {
  const credential = (key: string, stateKey = `own:deepl:${key.length}`) => ({ engine: "deepl" as const, apiKey: new SecretValue(key), stateKey });

  it("is a fixed figure without any request in mock mode", async () => {
    expect(await ownDeepLUsage(SHOP_A, credential("mock-deepl-1:fx"), { mode: "mock", fetch: fakeEngineFetch({}).fetch })).toEqual({ plan: "free", used: 1_234, limit: 500_000 });
  });

  it("asks /v2/usage with the merchant's key, caches it two minutes per credential, and shows nothing on errors", async () => {
    const key = ownDeepLKey(3, false);
    const fake = fakeEngineFetch({ deepl: { [key]: { usage: { count: 42, limit: 1e12 } } } });
    let now = 0;
    const options = { mode: "live" as const, fetch: fake.fetch, now: () => now };
    expect(await ownDeepLUsage(SHOP_A, credential(key, "own:deepl:a"), options)).toEqual({ plan: "pro", used: 42, limit: null });
    now += 60_000;
    expect(await ownDeepLUsage(SHOP_B, credential(key, "own:deepl:a"), options)).toEqual({ plan: "pro", used: 42, limit: null });
    expect(fake.calls).toHaveLength(1);
    now += 61_000;
    await ownDeepLUsage(SHOP_A, credential(key, "own:deepl:a"), options);
    expect(fake.calls.map((c) => [c.host, c.path])).toEqual([
      ["api.deepl.com", "/v2/usage"],
      ["api.deepl.com", "/v2/usage"],
    ]);
    expect(await ownDeepLUsage(SHOP_A, credential(ownDeepLKey(4), "own:deepl:b"), options)).toBeNull();
    expect(await ownDeepLUsage(SHOP_A, { engine: "google", apiKey: new SecretValue(key), stateKey: "own:google:x" }, options)).toBeNull();
  });

  it("keeps at most 1,000 credentials (the oldest is dropped)", async () => {
    const key = ownDeepLKey(5);
    const fake = fakeEngineFetch({ deepl: { [key]: "ok" } });
    const options = { mode: "live" as const, fetch: fake.fetch, now: () => 0 };
    for (let i = 0; i < 1_001; i++) await ownDeepLUsage(SHOP_A, credential(key, `own:deepl:${i}`), options);
    expect(fake.calls).toHaveLength(1_001);
    await ownDeepLUsage(SHOP_A, credential(key, "own:deepl:1000"), options);
    expect(fake.calls).toHaveLength(1_001);
    await ownDeepLUsage(SHOP_A, credential(key, "own:deepl:0"), options);
    expect(fake.calls).toHaveLength(1_002);
  });
});
