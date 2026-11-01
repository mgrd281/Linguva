/**
 * The worker's upkeep of stored merchant engine keys (Own key plan,
 * app/.server/credentials/maintenance.ts): re-encryption under the active key
 * id after a rotation, in bounded runs from a Redis cursor, compare-and-swap
 * against a replace in between, untouched rows under unknown key ids, healed
 * UNREADABLE rows, and the per-key-id inventory of a full cycle. Keys are
 * fictional and built at runtime.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialContext } from "../../app/.server/credentials/cipher";
import { maintainEngineKeys, MAX_CHANGES, MAX_SHOPS, type MaintenanceDeps } from "../../app/.server/credentials/maintenance";
import { loadEngineKeys } from "../../app/.server/credentials/store";
import { getConfig } from "../../app/.server/lib/config";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";
import { ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { seedOwnKey } from "../support/own-keys";
import { deletePrefix, testPrefix, testRedis } from "../support/redis";

const app = new PrismaClient();
const redis = testRedis();
const PREFIX = testPrefix();
const OLD = `old:${Buffer.alloc(32, 9).toString("base64")}`;
const GONE = `gone:${Buffer.alloc(32, 5).toString("base64")}`;
const ACTIVE = () => getConfig().TOKEN_ENCRYPTION_KEYS;

let prefix = PREFIX;
beforeEach(async () => {
  await resetDatabase();
  prefix = `${PREFIX}:${Math.random().toString(36).slice(2, 8)}`;
});
afterAll(async () => {
  await deletePrefix(redis, PREFIX);
  await redis.quit();
  await app.$disconnect();
  await ownerDb.$disconnect();
});

function logs() {
  const info = vi.fn();
  const error = vi.fn();
  return { log: { info, error } as unknown as MaintenanceDeps["log"], info, error };
}

/** Active shops created directly (Shop is a global table). */
async function shops(count: number, status: "ACTIVE" | "UNINSTALLED" = "ACTIVE") {
  const domains = Array.from({ length: count }, (_, i) => `m-${status.toLowerCase()}-${String(i).padStart(4, "0")}.myshopify.com`);
  await ownerDb.shop.createMany({ data: domains.map((shopDomain) => ({ shopDomain, status })) });
  return ownerDb.shop.findMany({ where: { shopDomain: { in: domains } }, orderBy: { id: "asc" } });
}

/** A usable key stored under `cipher` (another key id than the running keyring's active one). */
async function storeUnder(cipher: TokenCipher, shopId: string, engine: "deepl" | "google", apiKey: string, status = "OK") {
  const dataLocation = engine === "deepl" ? "eu" : "global";
  const secret = cipher.encrypt(JSON.stringify({ v: 1, apiKey }), credentialContext({ shopId, engine, dataLocation, region: null }));
  return withTenant(
    shopId,
    (tx) =>
      tx.shopEngineCredential.create({
        data: { shopId, engine, secret, hint: apiKey.slice(-4).replace(/:/g, "x"), dataLocation, deeplPlan: engine === "deepl" ? "free" : null, status, verifiedAt: new Date() },
      }),
    ownerDb,
  );
}

const allRows = async (ids: string[]) => (await Promise.all(ids.map((id) => withTenant(id, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), ownerDb)))).flat();

describe("engine key maintenance (worker sweep step)", () => {
  it("moves keys to the active key id in runs of at most 50 changes, and they still decrypt without the old key id", async () => {
    const old = TokenCipher.fromKeyring(OLD);
    const list = await shops(30);
    for (const [i, shop] of list.entries()) {
      await storeUnder(old, shop.id, "deepl", ownDeepLKey(i));
      await storeUnder(old, shop.id, "google", ownGoogleKey(i));
    }
    const cipher = TokenCipher.fromKeyring(`${ACTIVE()},${OLD}`);
    const { log, info } = logs();
    const deps = { prisma: app, redis, prefix, cipher, log };
    const first = await maintainEngineKeys(deps);
    expect(first).toMatchObject({ reencrypted: MAX_CHANGES, wrapped: false, shops: 25 });
    expect(await redis.get(`${prefix}:engine-keys-cursor`)).toBe(list[24]!.id);
    const second = await maintainEngineKeys(deps);
    expect(second).toMatchObject({ reencrypted: 10, wrapped: true, shops: 5 });
    expect(await redis.get(`${prefix}:engine-keys-cursor`)).toBeNull();

    const rows = await allRows(list.map((s) => s.id));
    expect(rows).toHaveLength(60);
    const activeKid = TokenCipher.fromKeyring(ACTIVE()).activeKeyId();
    expect(rows.every((r) => r.secret.split(".")[1] === activeKid && r.keyVersion === 1 && r.status === "OK")).toBe(true);
    // The running keyring (without the old key id) reads every key.
    for (const [i, shop] of list.entries()) {
      const loaded = await loadEngineKeys(shop.id, app);
      expect(loaded.transient).toEqual([]);
      expect(loaded.credentials.map((c) => c.apiKey.reveal())).toEqual([ownDeepLKey(i), ownGoogleKey(i)]);
    }
    // The cycle that rotated counted what it found; the next full cycle finds nothing under the old key id.
    expect(info).toHaveBeenCalledWith({ perKid: { old: 60 }, unknownKid: {} }, "engine keys per key id");
    await maintainEngineKeys(deps);
    expect(info).toHaveBeenLastCalledWith({ perKid: { [activeKid]: 60 }, unknownKid: {} }, "engine keys per key id");
  });

  it("visits at most 200 active shops per run and wraps around (inactive shops are skipped)", async () => {
    await shops(MAX_SHOPS + 50);
    await shops(5, "UNINSTALLED");
    const deps = { prisma: app, redis, prefix, cipher: TokenCipher.fromKeyring(ACTIVE()), log: logs().log };
    expect(await maintainEngineKeys(deps)).toMatchObject({ shops: MAX_SHOPS, wrapped: false });
    expect(await maintainEngineKeys(deps)).toMatchObject({ shops: 50, wrapped: true });
    expect(await maintainEngineKeys(deps)).toMatchObject({ shops: MAX_SHOPS, wrapped: false });
  });

  it("leaves a key replaced between its read and its write as the replace wrote it (compare-and-swap)", async () => {
    const [shop] = await shops(1);
    await storeUnder(TokenCipher.fromKeyring(OLD), shop!.id, "deepl", ownDeepLKey(1));
    const deps: MaintenanceDeps = {
      prisma: app,
      redis,
      prefix,
      cipher: TokenCipher.fromKeyring(`${ACTIVE()},${OLD}`),
      log: logs().log,
      beforeWrite: async () => {
        await seedOwnKey(shop!.id, { engine: "deepl", apiKey: ownDeepLKey(2) }, { client: app });
      },
    };
    expect(await maintainEngineKeys(deps)).toMatchObject({ reencrypted: 0 });
    const [row] = await allRows([shop!.id]);
    expect(row).toMatchObject({ keyVersion: 2, status: "OK" });
    expect((await loadEngineKeys(shop!.id, app)).credentials.map((c) => c.apiKey.reveal())).toEqual([ownDeepLKey(2)]);
  });

  it("leaves rows under an unknown key id untouched, counts them, and says so at the end of the cycle", async () => {
    const [shop] = await shops(1);
    const before = await storeUnder(TokenCipher.fromKeyring(GONE), shop!.id, "deepl", ownDeepLKey(3));
    const { log, info, error } = logs();
    const summary = await maintainEngineKeys({ prisma: app, redis, prefix, cipher: TokenCipher.fromKeyring(ACTIVE()), log });
    expect(summary).toMatchObject({ unknownKid: 1, reencrypted: 0, healed: 0, wrapped: true });
    expect((await allRows([shop!.id]))[0]).toEqual(before);
    expect(info).toHaveBeenCalledWith({ perKid: { gone: 1 }, unknownKid: { gone: 1 } }, "engine keys per key id");
    expect(error).toHaveBeenCalledWith({ unknownKid: { gone: 1 } }, "engine keys under key ids this keyring doesn't have");
    // Labels and counts only: no shop id, key or hint in any line.
    const printed = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(printed).not.toContain(shop!.id);
    expect(printed).not.toContain(before.hint);
    expect(printed).not.toContain(ownDeepLKey(3).slice(0, 12));
  });

  it("heals an UNREADABLE row that decrypts again, and leaves a really unreadable one", async () => {
    const [a, b] = await shops(2);
    const active = TokenCipher.fromKeyring(ACTIVE());
    await storeUnder(active, a!.id, "deepl", ownDeepLKey(4), "UNREADABLE");
    const tampered = await storeUnder(active, b!.id, "deepl", ownDeepLKey(5), "UNREADABLE");
    // b's envelope is a's context: authentication fails under a known key id.
    const [aRow] = await allRows([a!.id]);
    await withTenant(b!.id, (tx) => tx.shopEngineCredential.update({ where: { id: tampered.id }, data: { secret: aRow!.secret } }), ownerDb);
    const summary = await maintainEngineKeys({ prisma: app, redis, prefix, cipher: active, log: logs().log });
    expect(summary).toMatchObject({ healed: 1, reencrypted: 0 });
    expect((await allRows([a!.id]))[0]).toMatchObject({ status: "OK", lastErrorCode: null, keyVersion: 1 });
    expect((await allRows([b!.id]))[0]).toMatchObject({ status: "UNREADABLE" });
  });

  it("runs only inside the worker sweep's lock", () => {
    const worker = readFileSync("worker/index.ts", "utf8");
    const sweep = worker.slice(worker.indexOf("const sweep = async"), worker.indexOf("const timer = setInterval(sweep"));
    const locked = sweep.indexOf('if (lock === "OK") {');
    const call = sweep.indexOf("maintainEngineKeys(");
    const after = sweep.indexOf("const purged = await purgeWebhookLog");
    expect(locked).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(locked);
    expect(after).toBeGreaterThan(call);
    expect(worker.match(/maintainEngineKeys\(/g)).toHaveLength(1);
  });
});
