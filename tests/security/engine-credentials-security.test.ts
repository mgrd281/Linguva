/**
 * The Own key plan's table of merchant engine keys (ShopEngineCredential,
 * docs/SECURITY_MODEL.md §5r) and the ledger's payer column, tested at the
 * database: row-level security for the runtime role, the CHECK constraints
 * even for the owner role, the Shop cascade, ciphertext only at rest, and the
 * restore runbook of docs/DATABASE_SCHEMA.md. Every key here is fictional and
 * built at runtime.
 */
import { readFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DecryptionError, TokenCipher } from "../../app/.server/lib/crypto";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { countAsOwner, ownerDb, resetDatabase } from "../support/db";
import { listEngineKeys, loadEngineKeys } from "../../app/.server/credentials/store";

const app = new PrismaClient();
const cipher = TokenCipher.fromKeyring(process.env.TOKEN_ENCRYPTION_KEYS!);

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

// A fictional DeepL API Free key: low entropy on purpose, assembled at runtime.
const PLAINTEXT_KEY = `${"d".repeat(8)}-${"e".repeat(4)}-${"f".repeat(12)}:fx`;

/** The AAD context the credentials module binds a merchant key to (SPEC §3.3 `credentialContext`). */
const context = (row: { shopId: string; engine: string; dataLocation: string; region: string | null }) =>
  ["engine-credential", row.shopId, row.engine, row.dataLocation, row.region ?? ""].join("\u0000");

type Row = Prisma.ShopEngineCredentialUncheckedCreateInput;

/** A well-formed DeepL row for the shop, its key encrypted under the shop's context. */
function deeplRow(shopId: string, apiKey = PLAINTEXT_KEY): Row {
  const base = { shopId, engine: "deepl", dataLocation: "eu", region: null };
  return {
    ...base,
    secret: cipher.encrypt(JSON.stringify({ v: 1, apiKey }), context(base)),
    hint: apiKey.replace(/:fx$/, "").slice(-4),
    deeplPlan: "free",
    verifiedAt: new Date(),
  };
}

const insert = (shopId: string, data: Row, client: PrismaClient = app) =>
  withTenant(shopId, (tx) => tx.shopEngineCredential.create({ data }), client);

async function twoShops() {
  const a = (await upsertInstalledShop({ shopDomain: "keys-a.myshopify.com" }, app)).shop;
  const b = (await upsertInstalledShop({ shopDomain: "keys-b.myshopify.com" }, app)).shop;
  return { a, b };
}

describe("ShopEngineCredential row-level security (runtime role)", () => {
  it("returns no rows and accepts no writes without a tenant", async () => {
    const { a } = await twoShops();
    await insert(a.id, deeplRow(a.id));
    expect(await app.shopEngineCredential.count()).toBe(0);
    expect(await app.shopEngineCredential.findMany()).toEqual([]);
    expect((await app.shopEngineCredential.updateMany({ data: { status: "REFUSED" } })).count).toBe(0);
    expect((await app.shopEngineCredential.deleteMany({})).count).toBe(0);
    await expect(app.shopEngineCredential.create({ data: deeplRow(a.id) })).rejects.toThrow(/row-level security/);
    expect(await countAsOwner("ShopEngineCredential", a.id)).toBe(1);
  });

  it("keeps another shop from seeing, changing, deleting or inserting shop A's rows", async () => {
    const { a, b } = await twoShops();
    const row = await insert(a.id, deeplRow(a.id));
    expect(await withTenant(b.id, (tx) => tx.shopEngineCredential.findMany(), app)).toEqual([]);
    expect(await withTenant(b.id, (tx) => tx.shopEngineCredential.findUnique({ where: { id: row.id } }), app)).toBeNull();
    const updated = await withTenant(b.id, (tx) => tx.shopEngineCredential.updateMany({ where: { id: row.id }, data: { status: "REFUSED", keyVersion: { increment: 1 } } }), app);
    expect(updated.count).toBe(0);
    const deleted = await withTenant(b.id, (tx) => tx.shopEngineCredential.deleteMany({ where: { shopId: a.id } }), app);
    expect(deleted.count).toBe(0);
    await expect(insert(b.id, { ...deeplRow(a.id), engine: "deepl" })).rejects.toThrow(/row-level security/);
    // Moving the own row to another shop fails the policy's WITH CHECK.
    await expect(withTenant(a.id, (tx) => tx.shopEngineCredential.update({ where: { id: row.id }, data: { shopId: b.id } }), app)).rejects.toThrow(
      /row-level security/,
    );
    const own = await withTenant(a.id, (tx) => tx.shopEngineCredential.findUniqueOrThrow({ where: { id: row.id } }), app);
    expect(own).toMatchObject({ shopId: a.id, status: "OK", keyVersion: 1 });
  });

  it("lets the shop read, update and delete its own rows (the grants the feature needs)", async () => {
    const { a } = await twoShops();
    const row = await insert(a.id, deeplRow(a.id));
    const marked = await withTenant(
      a.id,
      (tx) => tx.shopEngineCredential.updateMany({ where: { id: row.id, keyVersion: 1 }, data: { status: "QUOTA", lastErrorCode: "OWN_KEY_QUOTA_DEEPL", lastErrorAt: new Date() } }),
      app,
    );
    expect(marked.count).toBe(1);
    // A guarded write with an outdated keyVersion matches nothing.
    const stale = await withTenant(a.id, (tx) => tx.shopEngineCredential.updateMany({ where: { id: row.id, keyVersion: 2 }, data: { status: "OK" } }), app);
    expect(stale.count).toBe(0);
    expect((await withTenant(a.id, (tx) => tx.shopEngineCredential.deleteMany({ where: { shopId: a.id } }), app)).count).toBe(1);
  });

  it("grants the runtime role exactly SELECT, INSERT, UPDATE and DELETE", async () => {
    const [row] = await app.$queryRaw<Array<Record<string, boolean>>>`
      SELECT has_table_privilege(current_user, 'public."ShopEngineCredential"', 'SELECT') AS "select",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'INSERT') AS "insert",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'UPDATE') AS "update",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'DELETE') AS "delete",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'TRUNCATE') AS "truncate",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'REFERENCES') AS "references",
             has_table_privilege(current_user, 'public."ShopEngineCredential"', 'TRIGGER') AS "trigger"`;
    expect(row).toEqual({ select: true, insert: true, update: true, delete: true, truncate: false, references: false, trigger: false });
    await expect(app.$executeRawUnsafe(`TRUNCATE "ShopEngineCredential"`)).rejects.toThrow(/permission denied/);
  });

  it("is forced, with exactly the tenant policy", async () => {
    const [table] = await ownerDb.$queryRaw<Array<{ rls: boolean; forced: boolean }>>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'ShopEngineCredential'`;
    expect(table).toEqual({ rls: true, forced: true });
    const policies = await ownerDb.$queryRaw<Array<{ policyname: string; cmd: string; permissive: string }>>`
      SELECT policyname, cmd, permissive FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ShopEngineCredential'`;
    expect(policies).toEqual([{ policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE" }]);
  });
});

describe("ShopEngineCredential CHECK constraints (also for the owner role)", () => {
  const refuses = async (shopId: string, data: Partial<Row>, constraint: RegExp) =>
    expect(insert(shopId, { ...deeplRow(shopId), ...data } as Row, ownerDb)).rejects.toThrow(constraint);

  it("stores only a cipher envelope, never plaintext", async () => {
    const { a } = await twoShops();
    await refuses(a.id, { secret: PLAINTEXT_KEY }, /secret_check/);
    await refuses(a.id, { secret: JSON.stringify({ v: 1, apiKey: PLAINTEXT_KEY }) }, /secret_check/);
    // A key that merely has four dots isn't an envelope either.
    await refuses(a.id, { secret: `v1.${"k".repeat(40)}.a.b.c` }, /secret_check/);
    await refuses(a.id, { secret: "v1..a.b.c" }, /secret_check/);
    await refuses(a.id, { secret: "v1.test.a b.c.d" }, /secret_check/);
    await refuses(a.id, { secret: "v2.test.a.b.c" }, /secret_check/);
  });

  it("keeps exactly four characters of the key in clear", async () => {
    const { a } = await twoShops();
    await refuses(a.id, { hint: "abcde" }, /hint_check/);
    await refuses(a.id, { hint: "abc" }, /hint_check/);
    await refuses(a.id, { hint: "ab:x" }, /hint_check/);
    await refuses(a.id, { hint: "" }, /hint_check/);
  });

  it("refuses unknown codes and impossible combinations", async () => {
    const { a } = await twoShops();
    await refuses(a.id, { keyVersion: 0 }, /keyVersion_check/);
    // An unknown engine fails every engine-bound check; PostgreSQL reports the first by name.
    await refuses(a.id, { engine: "openai" }, /ShopEngineCredential_\w+_check/);
    await refuses(a.id, { engine: "DeepL" }, /ShopEngineCredential_\w+_check/);
    await refuses(a.id, { status: "BROKEN" }, /status_check/);
    await refuses(a.id, { status: "ok" }, /status_check/);
    await refuses(a.id, { lastErrorCode: "Key refused: 403" }, /lastErrorCode_check/);
    await refuses(a.id, { lastErrorCode: "A".repeat(41) }, /lastErrorCode_check/);
    // DeepL processes in the EU only, with a plan; Google's API key is global; Azure EU or global.
    await refuses(a.id, { dataLocation: "global" }, /dataLocation_check/);
    await refuses(a.id, { deeplPlan: null }, /deeplPlan_check/);
    await refuses(a.id, { deeplPlan: "business" }, /deeplPlan_check/);
    await refuses(a.id, { region: "westeurope" }, /region_check/);
    await refuses(a.id, { engine: "google", dataLocation: "eu", deeplPlan: null }, /dataLocation_check/);
    await refuses(a.id, { engine: "google", dataLocation: "global", deeplPlan: "pro" }, /deeplPlan_check/);
    await refuses(a.id, { engine: "azure", dataLocation: "us", deeplPlan: null }, /dataLocation_check/);
    await refuses(a.id, { engine: "azure", dataLocation: "eu", deeplPlan: null, region: "West Europe" }, /region_check/);
    await refuses(a.id, { engine: "azure", dataLocation: "eu", deeplPlan: null, region: "a" }, /region_check/);
  });

  it("has exactly the reviewed CHECK constraints", async () => {
    const rows = await ownerDb.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint WHERE conrelid = 'public."ShopEngineCredential"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(rows.map((r) => r.name)).toEqual(
      ["dataLocation", "deeplPlan", "engine", "hint", "keyVersion", "lastErrorCode", "region", "secret", "status"].map((c) => `ShopEngineCredential_${c}_check`),
    );
    const [engine] = await ownerDb.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ShopEngineCredential_engine_check'`;
    expect(engine!.def).toBe("CHECK ((engine = ANY (ARRAY['deepl'::text, 'azure'::text, 'google'::text])))");
  });

  it("accepts every valid shape, RECHECK included, and one row per engine", async () => {
    const { a } = await twoShops();
    const rows: Row[] = [
      { ...deeplRow(a.id), status: "RECHECK", lastErrorCode: "OWN_KEY_RECHECK", lastErrorAt: new Date() },
      { ...deeplRow(a.id), engine: "azure", dataLocation: "global", region: "westeurope", deeplPlan: null, hint: "kkkk", status: "QUOTA" },
      { ...deeplRow(a.id), engine: "google", dataLocation: "global", deeplPlan: null, hint: "g_-.", status: "UNREADABLE" },
    ];
    for (const row of rows) await insert(a.id, row, ownerDb);
    for (const status of ["OK", "REFUSED"]) {
      await withTenant(a.id, (tx) => tx.shopEngineCredential.updateMany({ where: { engine: "deepl" }, data: { status } }), ownerDb);
    }
    expect(await countAsOwner("ShopEngineCredential", a.id)).toBe(3);
    await expect(insert(a.id, deeplRow(a.id), ownerDb)).rejects.toThrow(/Unique constraint/);
  });
});

describe("ShopEngineCredential ciphertext and lifecycle", () => {
  it("holds no plaintext: an owner dump of the shop's rows doesn't contain the key", async () => {
    const { a } = await twoShops();
    await insert(a.id, deeplRow(a.id));
    const dump = await withTenant(
      a.id,
      (tx) => tx.$queryRaw<Array<{ row: unknown }>>`SELECT row_to_json(c) AS row FROM "ShopEngineCredential" c`,
      ownerDb,
    );
    expect(dump).toHaveLength(1);
    const text = JSON.stringify(dump);
    expect(text).not.toContain(PLAINTEXT_KEY);
    expect(text).not.toContain(PLAINTEXT_KEY.replace(/:fx$/, ""));
    expect(text).not.toContain("d".repeat(8));
    // The shop's own context decrypts it.
    const stored = await withTenant(a.id, (tx) => tx.shopEngineCredential.findFirstOrThrow(), app);
    expect(JSON.parse(cipher.decrypt(stored.secret, context(stored)))).toEqual({ v: 1, apiKey: PLAINTEXT_KEY });
  });

  it("a ciphertext copied into another shop's or another engine's row doesn't decrypt there (AAD)", async () => {
    const { a, b } = await twoShops();
    const original = await insert(a.id, deeplRow(a.id));
    // The database can't tell: a copied envelope is well-formed (the owner role copies it).
    const copyB = await insert(b.id, { ...deeplRow(b.id, `${"q".repeat(20)}:fx`), secret: original.secret }, ownerDb);
    const copyAzure = await insert(a.id, { ...deeplRow(a.id), engine: "azure", dataLocation: "eu", deeplPlan: null, secret: original.secret }, ownerDb);
    const copyGlobal = { ...copyAzure, dataLocation: "global" };
    const copyRegion = { ...copyAzure, region: "westeurope" };
    for (const copy of [copyB, copyAzure, copyGlobal, copyRegion]) {
      let caught: unknown;
      try {
        cipher.decrypt(copy.secret, context(copy));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DecryptionError);
      expect((caught as DecryptionError).cause).toBe("auth");
    }
    expect(JSON.parse(cipher.decrypt(original.secret, context(original))).apiKey).toBe(PLAINTEXT_KEY);
  });

  it("is deleted with its shop (shop/redact deletes the Shop row)", async () => {
    const { a, b } = await twoShops();
    await insert(a.id, deeplRow(a.id));
    await insert(b.id, deeplRow(b.id));
    await ownerDb.shop.delete({ where: { id: a.id } });
    expect(await countAsOwner("ShopEngineCredential", a.id)).toBe(0);
    expect(await countAsOwner("ShopEngineCredential", b.id)).toBe(1);
  });

  it("the restore runbook (docs/DATABASE_SCHEMA.md) deletes keys of inactive shops and marks the rest RECHECK", async () => {
    const doc = readFileSync("docs/DATABASE_SCHEMA.md", "utf8");
    const runbook = /<!-- restore-runbook:start -->\s*```sql\n([\s\S]*?)```\s*<!-- restore-runbook:end -->/.exec(doc)?.[1];
    expect(runbook).toBeTruthy();
    const { a, b } = await twoShops();
    await insert(a.id, deeplRow(a.id));
    await insert(a.id, { ...deeplRow(a.id), engine: "google", dataLocation: "global", deeplPlan: null, status: "QUOTA" });
    await insert(b.id, deeplRow(b.id));
    // The restored backup still has the key of a store that uninstalled after the restore point.
    await ownerDb.shop.update({ where: { id: b.id }, data: { status: "UNINSTALLED", uninstalledAt: new Date() } });
    // FORCE row-level security binds the owner role too: without a tenant a plain statement changes nothing.
    expect(await ownerDb.$executeRawUnsafe(`UPDATE "ShopEngineCredential" SET "status" = 'RECHECK'`)).toBe(0);

    await ownerDb.$executeRawUnsafe(runbook!);
    expect(await countAsOwner("ShopEngineCredential", b.id)).toBe(0);
    const rows = await withTenant(a.id, (tx) => tx.shopEngineCredential.findMany({ orderBy: { engine: "asc" } }), app);
    expect(rows.map((r) => [r.engine, r.status, r.lastErrorCode])).toEqual([
      ["deepl", "RECHECK", "OWN_KEY_RECHECK"],
      ["google", "RECHECK", "OWN_KEY_RECHECK"],
    ]);
    expect(rows.every((r) => r.lastErrorAt instanceof Date)).toBe(true);
  });
});

describe("UsageLedger.payer", () => {
  const ledgerRow = (shopId: string, extra: Record<string, unknown>) =>
    withTenant(
      shopId,
      (tx) =>
        tx.usageLedger.create({
          data: { shopId, periodKey: "2026-11", kind: "RESERVE", chars: 10, provider: "deepl", idempotencyKey: `k-${Math.random()}`, ...extra },
        }),
      app,
    );

  it("is NULL (Linguva) or 'merchant', and a merchant row is never a smart row", async () => {
    const { a } = await twoShops();
    await expect(ledgerRow(a.id, { payer: null })).resolves.toMatchObject({ payer: null });
    await expect(ledgerRow(a.id, { payer: "merchant" })).resolves.toMatchObject({ payer: "merchant" });
    await expect(ledgerRow(a.id, { payer: "smart", origin: null })).rejects.toThrow(/payer_check/);
    await expect(ledgerRow(a.id, { payer: "x" })).rejects.toThrow(/payer_check/);
    await expect(ledgerRow(a.id, { payer: "linguva" })).rejects.toThrow(/payer_check/);
    await expect(ledgerRow(a.id, { payer: "merchant", origin: "smart" })).rejects.toThrow(/payer_check/);
    await expect(ledgerRow(a.id, { payer: null, origin: "smart" })).resolves.toMatchObject({ origin: "smart" });
  });

  it("was added NOT VALID (no scan of existing rows) and is still enforced on new rows", async () => {
    const [constraint] = await ownerDb.$queryRaw<Array<{ validated: boolean; def: string }>>`
      SELECT convalidated AS validated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'UsageLedger_payer_check'`;
    expect(constraint).toMatchObject({ validated: false });
    expect(constraint!.def).toMatch(/NOT VALID/);
  });

  it("stays append-only for the runtime role (no new grant)", async () => {
    const [row] = await app.$queryRaw<Array<{ update: boolean; delete: boolean }>>`
      SELECT has_table_privilege(current_user, 'public."UsageLedger"', 'UPDATE') AS "update",
             has_table_privilege(current_user, 'public."UsageLedger"', 'DELETE') AS "delete"`;
    expect(row).toEqual({ update: false, delete: false });
  });
});

describe("ShopEngineCredential as the credentials module reads it", () => {
  it("a ciphertext copied into another shop's or another engine's row is marked UNREADABLE and never used", async () => {
    const { a, b } = await twoShops();
    const original = await insert(a.id, deeplRow(a.id));
    // Copied by someone with the owner role: well-formed, under a key id the app knows.
    await insert(b.id, { ...deeplRow(b.id, `${"q".repeat(20)}:fx`), secret: original.secret }, ownerDb);
    await insert(a.id, { ...deeplRow(a.id), engine: "google", dataLocation: "global", deeplPlan: null, secret: original.secret }, ownerDb);

    const inB = await loadEngineKeys(b.id, app);
    expect(inB.credentials).toEqual([]);
    expect(inB.transient).toEqual([]);
    expect(inB.summaries.map((k) => [k.engine, k.status, k.lastErrorCode])).toEqual([["deepl", "UNREADABLE", "OWN_KEY_UNREADABLE"]]);

    const inA = await loadEngineKeys(a.id, app);
    expect(inA.credentials.map((c) => [c.engine, c.apiKey.reveal()])).toEqual([["deepl", PLAINTEXT_KEY]]);
    expect(inA.summaries.map((k) => [k.engine, k.status])).toEqual([
      ["deepl", "OK"],
      ["google", "UNREADABLE"],
    ]);
    // Neither summary nor log-able result carries the key.
    expect(JSON.stringify([inA, inB, await listEngineKeys(a.id, app)])).not.toContain(PLAINTEXT_KEY.replace(/:fx$/, ""));
  });

  it("another shop's tenant reads none of a shop's keys through the module", async () => {
    const { a, b } = await twoShops();
    await insert(a.id, deeplRow(a.id));
    expect(await listEngineKeys(b.id, app)).toEqual([]);
    expect(await loadEngineKeys(b.id, app)).toEqual({ summaries: [], credentials: [], transient: [] });
  });
});
