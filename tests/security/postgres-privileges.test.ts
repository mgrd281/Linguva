/**
 * PostgreSQL privileges, roles and the linguva_memory_fuzzy() security
 * definer function, tested adversarially with three roles:
 *   linguva_app   runtime role (subject to RLS)
 *   linguva_owner migration role (owns tables and the function)
 *   linguva_probe a database user with no grants at all (test-only)
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkDatabasePosture } from "../../app/.server/lib/db-posture";
import { prisma as runtimeClient } from "../../app/.server/lib/db";
import { fuzzyMatches, storeMemory } from "../../app/.server/memory/translation-memory";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();
const probeUrl = (() => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = "linguva_probe";
  url.password = "linguva_probe_dev";
  return url.toString();
})();
const probe = new PrismaClient({ datasources: { db: { url: probeUrl } } });

beforeEach(resetDatabase);
afterAll(async () => {
  await Promise.all([app.$disconnect(), probe.$disconnect(), ownerDb.$disconnect(), runtimeClient.$disconnect()]);
});

const TEXT = "Waterproof hiking jacket for cold mountain days";
type Row = { id: string; targetText: string; score: number };
const callFuzzy = (tx: { $queryRaw: PrismaClient["$queryRaw"] }, text = TEXT, extra: { threshold?: number; limit?: number; market?: string } = {}) =>
  tx.$queryRaw<Row[]>`
    SELECT "id", "targetText", "score" FROM linguva_memory_fuzzy(
      'en', 'de', ${extra.market ?? ""}, ${text}, 0, 10000, ${extra.threshold ?? 0.3}::real, ${extra.limit ?? 10}::int)`;

async function twoShopsWithMemory() {
  const a = (await upsertInstalledShop({ shopDomain: "pg-a.myshopify.com" }, app)).shop;
  const b = (await upsertInstalledShop({ shopDomain: "pg-b.myshopify.com" }, app)).shop;
  const pairs = (tag: string) => [
    { source: TEXT, target: `${tag}: Wasserdichte Wanderjacke` },
    { source: `${TEXT} with hood`, target: `${tag}: mit Kapuze` },
    { source: "Warm wool scarf for winter evenings", target: `${tag}: Schal` },
  ];
  await storeMemory({ shopId: a.id, sourceLocale: "en", targetLocale: "de" }, pairs("A"), "APPROVED", app);
  await storeMemory({ shopId: b.id, sourceLocale: "en", targetLocale: "de" }, pairs("B"), "APPROVED", app);
  return { a, b };
}

/** Runs `fn` in one transaction on the runtime role with app.shop_id set to `value` (or left unset). */
function asRuntime<T>(value: string | null, fn: (tx: PrismaClient) => Promise<T>) {
  return app.$transaction(async (tx) => {
    if (value !== null) await tx.$executeRaw`SELECT set_config('app.shop_id', ${value}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

describe("database posture", () => {
  it("has no findings for the runtime role", async () => {
    expect(await checkDatabasePosture(app)).toEqual([]);
  });

  it("flags any change to a definer function until it is reviewed", async () => {
    // A harmless-looking edit (a comment) is enough to require a new review.
    const [original] = await ownerDb.$queryRaw<Array<{ src: string }>>`
      SELECT prosrc AS src FROM pg_proc WHERE proname = 'linguva_memory_fuzzy'`;
    const fn = "linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer)";
    const definition = (await ownerDb.$queryRawUnsafe<Array<{ def: string }>>(`SELECT pg_get_functiondef('${fn}'::regprocedure) AS def`))[0]!.def;
    try {
      await ownerDb.$executeRawUnsafe(definition.replace(original!.src, `${original!.src}\n-- edited`));
      expect((await checkDatabasePosture(app)).map((i) => i.code)).toEqual(["DEFINER_CHANGED_WITHOUT_REVIEW"]);
    } finally {
      await ownerDb.$executeRawUnsafe(definition);
    }
    expect(await checkDatabasePosture(app)).toEqual([]);
  });

  it("detects a privileged connection (the check isn't vacuous)", async () => {
    const codes = (await checkDatabasePosture(ownerDb)).map((i) => i.code);
    expect(codes).toContain("RUNTIME_OWNS_TABLE");
    expect(codes).toContain("RUNTIME_CAN_CREATE_IN_PUBLIC");
  });

  it("the app's own database client connects as the runtime role", async () => {
    const [row] = await runtimeClient.$queryRaw<Array<{ user: string }>>`SELECT current_user AS "user"`;
    expect(row!.user).toBe("linguva_app");
  });
});

describe("runtime role cannot change security", () => {
  const denied = /permission denied|must be owner|must be member|not allowed/i;
  const attempts: Array<[string, string]> = [
    ["assume the owner role", `SET ROLE linguva_owner`],
    ["disable RLS", `ALTER TABLE "TranslationMemory" DISABLE ROW LEVEL SECURITY`],
    ["change FORCE", `ALTER TABLE "TranslationDraft" NO FORCE ROW LEVEL SECURITY`],
    ["drop the policy", `DROP POLICY tenant_isolation ON "TranslationMemory"`],
    ["add a permissive policy", `CREATE POLICY open ON "TranslationMemory" USING (true)`],
    [
      "replace the definer function",
      `CREATE OR REPLACE FUNCTION linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer)
       RETURNS TABLE (id uuid, "sourceText" text, "targetText" text, status "MemoryStatus", score double precision)
       LANGUAGE sql AS $$ SELECT NULL::uuid, NULL, NULL, NULL::"MemoryStatus", 1::float8 $$`,
    ],
    ["change the function's owner", `ALTER FUNCTION linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer) OWNER TO linguva_app`],
    ["create a shadowing function in public", `CREATE FUNCTION public.similarity(text, unknown) RETURNS real LANGUAGE sql AS $$ SELECT 1::real $$`],
    ["create a table in public", `CREATE TABLE public.x (id int)`],
    ["truncate tenant data", `TRUNCATE "TranslationMemory"`],
    ["delete revisions", `DELETE FROM "TranslationRevision"`],
    ["read the audit log", `SELECT * FROM "AuditLog"`],
  ];
  for (const [name, sql] of attempts) {
    it(`can't ${name}`, async () => {
      await expect(app.$executeRawUnsafe(sql)).rejects.toThrow(denied);
    });
  }
});

describe("runtime role cannot grant itself privileges", () => {
  it("GRANT is a no-op without grant option", async () => {
    // PostgreSQL only warns ("no privileges were granted"); check the effect.
    await app.$executeRawUnsafe(`GRANT DELETE ON "TranslationRevision" TO linguva_app`).catch(() => undefined);
    const [row] = await ownerDb.$queryRaw<Array<{ can: boolean }>>`
      SELECT has_table_privilege('linguva_app', '"TranslationRevision"', 'DELETE') AS can`;
    expect(row!.can).toBe(false);
  });
});

describe("a database user without grants (linguva_probe)", () => {
  it("can't read tenant tables or call the function, whatever app.shop_id says", async () => {
    const { a } = await twoShopsWithMemory();
    await expect(probe.$queryRawUnsafe(`SELECT * FROM "TranslationMemory"`)).rejects.toThrow(/permission denied/);
    await expect(
      probe.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.shop_id', ${a.id}, true)`;
        return callFuzzy(tx as unknown as PrismaClient);
      }),
    ).rejects.toThrow(/permission denied/);
    for (const table of ["Shop", "Session", "AuditLog", "TranslationDraft", "UsageLedger", "CoverageStat"]) {
      await expect(probe.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/);
    }
  });
});

describe("linguva_memory_fuzzy() returns nothing RLS wouldn't", () => {
  it("matches a direct RLS-filtered query for every app.shop_id state", async () => {
    const { a, b } = await twoShopsWithMemory();
    const states: Array<string | null> = [null, "", a.id, b.id, randomUUID()];
    for (const state of states) {
      const [viaFunction, viaRls] = await asRuntime(state, async (tx) => [
        (await callFuzzy(tx)).map((r) => r.id).sort(),
        (
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "TranslationMemory"
            WHERE "sourceLocale" = 'en' AND "targetLocale" = 'de' AND similarity("sourceText", ${TEXT}) >= 0.3`
        )
          .map((r) => r.id)
          .sort(),
      ]);
      expect(viaFunction, `state ${state}`).toEqual(viaRls);
    }
    // And the positive cases really return the tenant's own rows only.
    const forA = await asRuntime(a.id, (tx) => callFuzzy(tx));
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((r) => r.targetText.startsWith("A:"))).toBe(true);
  });

  it("fails closed for a malformed app.shop_id and doesn't leak across pooled transactions", async () => {
    const { a } = await twoShopsWithMemory();
    await expect(asRuntime("not-a-uuid", (tx) => callFuzzy(tx))).rejects.toThrow(/invalid input syntax for type uuid/);
    await expect(asRuntime(`${a.id}' OR '1'='1`, (tx) => callFuzzy(tx))).rejects.toThrow(/uuid/);
    for (let i = 0; i < 5; i++) {
      expect((await fuzzyMatches({ shopId: a.id, sourceLocale: "en", targetLocale: "de" }, TEXT, {}, app)).length).toBeGreaterThan(0);
      // Same pool, no tenant: nothing.
      expect(await callFuzzy(app)).toEqual([]);
    }
  });

  it("can't be redirected through pg_temp (temp tables or functions)", async () => {
    const { a } = await twoShopsWithMemory();
    const rows = await asRuntime(a.id, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "TranslationMemory" (LIKE public."TranslationMemory" INCLUDING DEFAULTS)`);
      await tx.$executeRawUnsafe(
        `INSERT INTO pg_temp."TranslationMemory" ("id","shopId","sourceLocale","targetLocale","market","sourceHash","sourceText","targetText","status","updatedAt")
         VALUES (gen_random_uuid(), '${a.id}', 'en', 'de', '', 'x', '${TEXT}', 'FAKE', 'APPROVED', now())`,
      );
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.similarity(text, text) RETURNS real LANGUAGE sql AS $$ SELECT 0.99::real $$`);
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.length(text) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`);
      return callFuzzy(tx);
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.targetText === "FAKE")).toBe(false);
    expect(rows.every((r) => r.targetText.startsWith("A:"))).toBe(true);
    // Real similarity scores, not the planted 0.99.
    expect(rows.some((r) => Math.abs(r.score - 0.99) < 1e-6)).toBe(false);
  });

  it("treats every parameter as data and bounds the work", async () => {
    const { a } = await twoShopsWithMemory();
    const run = (text: string, extra: Parameters<typeof callFuzzy>[2] = {}) => asRuntime(a.id, (tx) => callFuzzy(tx, text, extra));
    for (const attack of ["' OR '1'='1", "x'); DELETE FROM \"TranslationMemory\"; --", "%", "_"]) {
      expect((await run(attack)).every((r) => r.targetText.startsWith("A:"))).toBe(true);
    }
    expect(await run(TEXT, { market: "%" })).toHaveLength(3 - 1); // the scarf isn't similar; '%' is a market name, not a wildcard
    expect((await run(TEXT, { limit: 1000 })).length).toBeLessThanOrEqual(10);
    expect((await run(TEXT, { limit: -5 })).length).toBe(1);
    expect(await run(TEXT, { threshold: 0.1 })).toEqual([]);
    const started = performance.now();
    expect(await run("x".repeat(100_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
    const nulls = await asRuntime(a.id, (tx) =>
      tx.$queryRaw<Row[]>`SELECT * FROM linguva_memory_fuzzy(NULL, 'de', '', ${TEXT}, 0, 100, 0.5, 3)`,
    );
    expect(nulls).toEqual([]);
    expect(await app.translationMemory.count()).toBe(0); // still nothing visible without a tenant
    expect(await ownerDb.translationMemory.count()).toBe(6); // nothing was deleted
  });

  it("a caller who controls app.shop_id gets exactly what RLS would give them, no more", async () => {
    // Setting app.shop_id is the trust boundary for RLS and the function
    // alike; only withTenant() sets it, from the verified session.
    const { a, b } = await twoShopsWithMemory();
    const [fn, direct] = await asRuntime(a.id, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.shop_id', ${b.id}, true)`;
      return [await callFuzzy(tx), await tx.translationMemory.findMany({ select: { targetText: true } })];
    });
    expect(fn.every((r) => r.targetText.startsWith("B:"))).toBe(true);
    expect(direct.every((r) => r.targetText.startsWith("B:"))).toBe(true);
  });
});

describe("TranslationMemory without FORCE RLS", () => {
  it("only the owner role is unfiltered; the runtime role stays filtered for every operation", async () => {
    const { a, b } = await twoShopsWithMemory();
    // Owner (migrations only) sees all rows: the documented consequence.
    expect(await ownerDb.translationMemory.count()).toBe(6);
    // Runtime role: nothing without a tenant, its own rows with one, and writes stay confined.
    expect(await app.translationMemory.count()).toBe(0);
    expect(await withTenant(a.id, (tx) => tx.translationMemory.count(), app)).toBe(3);
    const updated = await withTenant(a.id, (tx) => tx.translationMemory.updateMany({ data: { targetText: "x" } }), app);
    expect(updated.count).toBe(3);
    const deleted = await withTenant(a.id, (tx) => tx.translationMemory.deleteMany({ where: { shopId: b.id } }), app);
    expect(deleted.count).toBe(0);
    await expect(
      withTenant(a.id, (tx) =>
        tx.translationMemory.create({
          data: { shopId: b.id, sourceLocale: "en", targetLocale: "de", sourceHash: "h", sourceText: "s", targetText: "t", status: "APPROVED" },
        }),
      app),
    ).rejects.toThrow(/row-level security/);
    expect(await withTenant(b.id, (tx) => tx.translationMemory.count({ where: { targetText: "x" } }), app)).toBe(0);
  });

  it("is the only tenant table without FORCE", async () => {
    const rows = await ownerDb.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual(["TranslationMemory"]);
  });
});
