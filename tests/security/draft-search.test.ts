/**
 * linguva_draft_search(), the second reviewed SECURITY DEFINER function
 * (SECURITY_MODEL §5l), tested adversarially like linguva_memory_fuzzy():
 * it returns exactly the ids RLS would show for the same text, only of
 * PENDING drafts, nothing without a tenant, treats its input as data, can't
 * be redirected through pg_temp, and bounds its work. TranslationDraft
 * isn't forced for the owner role only; the runtime role stays filtered.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await Promise.all([app.$disconnect(), ownerDb.$disconnect()]);
});

const draft = (gid: string, source: string, value: string, title: string | null = null) => ({
  jobId: null,
  resourceGid: gid,
  resourceTitle: title,
  locale: "de",
  key: "title",
  sourceDigest: "d",
  sourceValue: source,
  value,
  segmentPairs: [],
  issues: [],
  provider: "mock",
});

async function twoShopsWithDrafts() {
  const a = (await upsertInstalledShop({ shopDomain: "search-a.myshopify.com" }, app)).shop;
  const b = (await upsertInstalledShop({ shopDomain: "search-b.myshopify.com" }, app)).shop;
  await saveDrafts(a.id, [
    draft("gid://shopify/Product/1", "Waterproof hiking jacket", "A: Wasserdichte Wanderjacke", "Hiking jacket"),
    draft("gid://shopify/Product/2", "100% wool_scarf", "A: Schal aus Wolle"),
    draft("gid://shopify/Product/3", "Rain boots", "A: Gummistiefel"),
  ], app);
  await saveDrafts(b.id, [draft("gid://shopify/Product/1", "Waterproof hiking jacket", "B: Wanderjacke")], app);
  return { a, b };
}

type Row = { id: string };
const callSearch = (tx: { $queryRaw: PrismaClient["$queryRaw"] }, text: string | null, limit = 100) =>
  tx.$queryRaw<Row[]>`SELECT "id" FROM linguva_draft_search(${text}, ${limit}::int)`;

/** One transaction on the runtime role with app.shop_id set to `value` (or left unset). */
function asRuntime<T>(value: string | null, fn: (tx: PrismaClient) => Promise<T>) {
  return app.$transaction(async (tx) => {
    if (value !== null) await tx.$executeRaw`SELECT set_config('app.shop_id', ${value}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

describe("linguva_draft_search() returns nothing RLS wouldn't", () => {
  it("matches a direct RLS-filtered query for every app.shop_id state", async () => {
    const { a, b } = await twoShopsWithDrafts();
    for (const state of [null, "", a.id, b.id, randomUUID()]) {
      const [viaFunction, viaRls] = await asRuntime(state, async (tx) => [
        (await callSearch(tx, "hiking")).map((r) => r.id).sort(),
        (
          await tx.$queryRaw<Row[]>`
            SELECT "id" FROM "TranslationDraft" WHERE "status" = 'PENDING'
              AND ("sourceValue" ILIKE '%hiking%' OR "value" ILIKE '%hiking%' OR "resourceTitle" ILIKE '%hiking%')`
        )
          .map((r) => r.id)
          .sort(),
      ]);
      expect(viaFunction, `state ${state}`).toEqual(viaRls);
    }
    const forA = await withTenant(a.id, (tx) => callSearch(tx, "hiking"), app);
    expect(forA).toHaveLength(1);
  });

  it("returns only pending drafts", async () => {
    const { a } = await twoShopsWithDrafts();
    await ownerDb.translationDraft.updateMany({ where: { shopId: a.id, sourceValue: "Rain boots" }, data: { status: "REJECTED" } });
    expect(await withTenant(a.id, (tx) => callSearch(tx, "rain boots"), app)).toEqual([]);
  });

  it("fails closed for a malformed app.shop_id and doesn't leak across pooled transactions", async () => {
    const { a } = await twoShopsWithDrafts();
    await expect(asRuntime("not-a-uuid", (tx) => callSearch(tx, "hiking"))).rejects.toThrow(/invalid input syntax for type uuid/);
    await expect(asRuntime(`${a.id}' OR '1'='1`, (tx) => callSearch(tx, "hiking"))).rejects.toThrow(/uuid/);
    for (let i = 0; i < 5; i++) {
      expect((await searchPendingDrafts(a.id, { search: "hiking" }, app)).total).toBe(1);
      expect(await callSearch(app, "hiking")).toEqual([]);
    }
  });

  it("can't be redirected through pg_temp (temp tables or functions)", async () => {
    const { a } = await twoShopsWithDrafts();
    const ids = await asRuntime(a.id, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE "TranslationDraft" (LIKE public."TranslationDraft" INCLUDING DEFAULTS)`);
      await tx.$executeRawUnsafe(
        `INSERT INTO pg_temp."TranslationDraft" ("id","shopId","resourceGid","locale","key","sourceDigest","sourceValue","value","updatedAt")
         VALUES ('${randomUUID()}', '${a.id}', 'gid://shopify/Product/9', 'de', 'title', 'd', 'hiking FAKE', 'FAKE', now())`,
      );
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.lower(text) RETURNS text LANGUAGE sql AS $$ SELECT 'hiking' $$`);
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.replace(text, text, text) RETURNS text LANGUAGE sql AS $$ SELECT '%' $$`);
      return (await callSearch(tx, "hiking")).map((r) => r.id);
    });
    const real = await ownerDb.translationDraft.findMany({ where: { shopId: a.id, sourceValue: { contains: "hiking" } }, select: { id: true } });
    expect(ids).toEqual(real.map((r) => r.id));
  });

  it("treats the text as data, literally, and bounds the work", async () => {
    const { a } = await twoShopsWithDrafts();
    const run = (text: string | null, limit?: number) => withTenant(a.id, (tx) => callSearch(tx, text, limit), app);
    for (const attack of ["' OR '1'='1", "x'); DELETE FROM \"TranslationDraft\"; --", "%%%", "___", "\\\\%"]) {
      expect(await run(attack), attack).toEqual([]);
    }
    // % and _ are characters, not wildcards.
    expect(await run("100% wool_scarf")).toHaveLength(1);
    expect(await run("100_ wool%scarf")).toEqual([]);
    // Too short, too long or missing: nothing (the app scans short text the RLS way).
    expect(await run("hi")).toEqual([]);
    expect(await run(null)).toEqual([]);
    const started = performance.now();
    expect(await run("x".repeat(100_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(await run("a: ", -5)).toHaveLength(1);
    expect((await run("a: ", 1_000_000)).length).toBe(3);
    expect(await ownerDb.translationDraft.count()).toBe(4); // nothing was deleted
  });

  it("a caller who controls app.shop_id gets exactly what RLS would give them, no more", async () => {
    const { a, b } = await twoShopsWithDrafts();
    const [viaFunction, direct] = await asRuntime(a.id, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.shop_id', ${b.id}, true)`;
      return [await callSearch(tx, "hiking"), await tx.translationDraft.findMany({ select: { id: true } })];
    });
    expect(viaFunction.map((r) => r.id)).toEqual(direct.map((r) => r.id));
  });

  it("isn't executable by PUBLIC, has a fixed search path and runs as an ordinary owner", async () => {
    const [fn] = await ownerDb.$queryRaw<Array<{ config: string[]; secdef: boolean; owner_super: boolean; owner_bypass: boolean; public_exec: boolean }>>`
      SELECT p.proconfig AS config, p.prosecdef AS secdef, r.rolsuper AS owner_super, r.rolbypassrls AS owner_bypass,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'linguva_draft_search'`;
    expect(fn).toEqual({ config: ["search_path=pg_catalog, pg_temp"], secdef: true, owner_super: false, owner_bypass: false, public_exec: false });
  });
});

describe("TranslationDraft without FORCE RLS", () => {
  it("only the owner role is unfiltered; the runtime role stays filtered for every operation", async () => {
    const { a, b } = await twoShopsWithDrafts();
    expect(await ownerDb.translationDraft.count()).toBe(4);
    expect(await app.translationDraft.count()).toBe(0);
    expect(await withTenant(a.id, (tx) => tx.translationDraft.count(), app)).toBe(3);
    // Writes for another shop are refused by the policy's check.
    await expect(
      withTenant(a.id, (tx) => tx.translationDraft.create({ data: { ...draft("gid://shopify/Product/7", "x", "y"), shopId: b.id, segmentPairs: [], issues: [] } }), app),
    ).rejects.toThrow();
    expect(await withTenant(a.id, (tx) => tx.translationDraft.updateMany({ where: { shopId: b.id }, data: { value: "hijacked" } }), app)).toEqual({ count: 0 });
    // Drafts are never deleted by the app: the runtime role has no DELETE right at all.
    await expect(withTenant(a.id, (tx) => tx.translationDraft.deleteMany({ where: { shopId: b.id } }), app)).rejects.toThrow(/permission denied/);
    expect(await ownerDb.translationDraft.count({ where: { shopId: b.id, value: "B: Wanderjacke" } })).toBe(1);
  });
});

describe("Review search through the indexed function", () => {
  it("finds the same drafts as before, per store, with the other filters", async () => {
    const { a, b } = await twoShopsWithDrafts();
    const titles = async (shopId: string, search: string, extra = {}) =>
      (await searchPendingDrafts(shopId, { search, ...extra }, app)).drafts.map((d) => d.value).sort();
    expect(await titles(a.id, "HIKING")).toEqual(["A: Wasserdichte Wanderjacke"]);
    expect(await titles(a.id, "Wanderjacke")).toEqual(["A: Wasserdichte Wanderjacke"]);
    expect(await titles(b.id, "hiking")).toEqual(["B: Wanderjacke"]);
    expect(await titles(a.id, "100% wool")).toEqual(["A: Schal aus Wolle"]);
    expect(await titles(a.id, "hiking", { locale: "fr" })).toEqual([]);
    // Two characters: the scan, same result kind.
    expect(await titles(a.id, "A:")).toHaveLength(3);
  });
});
