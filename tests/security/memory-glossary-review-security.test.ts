import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteTerm,
  glossaryToCsv,
  listTerms,
  resolveGlossary,
  upsertTerms,
} from "../../app/.server/glossary/glossary";
import {
  approveMemoryEntry,
  deleteMemoryEntry,
  fuzzyMatches,
  listMemory,
  lookupExact,
  storeMemory,
} from "../../app/.server/memory/translation-memory";
import {
  approveDrafts,
  listPendingDrafts,
  rejectDrafts,
  saveDrafts,
} from "../../app/.server/review/drafts";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { restoreRevision } from "../../app/.server/translation/history";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function twoShops() {
  const a = (await upsertInstalledShop({ shopDomain: "a.myshopify.com" }, app)).shop;
  const b = (await upsertInstalledShop({ shopDomain: "b.myshopify.com" }, app)).shop;
  return { a, b };
}

const ctx = (shopId: string) => ({ shopId, sourceLocale: "en", targetLocale: "de" });

describe("translation memory isolation", () => {
  it("never returns another shop's memory, exact or fuzzy", async () => {
    const { a, b } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Secret product line launch text", target: "Geheimer Text" }], "APPROVED", app);
    expect((await lookupExact(ctx(b.id), ["Secret product line launch text"], { allowMachine: true }, app)).size).toBe(0);
    expect(await fuzzyMatches(ctx(b.id), "Secret product line launch texts", { threshold: 0.1 }, app)).toEqual([]);
    // Positive control: the same search finds the entry for its own shop.
    expect(await fuzzyMatches(ctx(a.id), "Secret product line launch texts", { threshold: 0.1 }, app)).toHaveLength(1);
    expect(await listMemory(b.id, { search: "Secret" }, app)).toEqual([]);
    // Shop A still sees its own entry.
    expect((await lookupExact(ctx(a.id), ["Secret product line launch text"], { allowMachine: true }, app)).size).toBe(1);
  });

  it("cannot delete or approve another shop's memory entries", async () => {
    const { a, b } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Red", target: "Rot" }], "MACHINE", app);
    const [entry] = await listMemory(a.id, {}, app);
    expect(await deleteMemoryEntry(b.id, entry!.id, app)).toBe(false);
    expect(await approveMemoryEntry(b.id, entry!.id, app)).toBe(false);
    const [still] = await listMemory(a.id, {}, app);
    expect(still).toMatchObject({ id: entry!.id, status: "MACHINE" });
  });

  it("treats fuzzy search input as data, not SQL", async () => {
    const { a, b } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Leaked text of shop A", target: "x" }], "APPROVED", app);
    for (const attack of ["' OR '1'='1", "'); DELETE FROM \"TranslationMemory\"; --", "%' OR 1=1 --"]) {
      expect(await fuzzyMatches(ctx(b.id), attack, { threshold: 0 }, app)).toEqual([]);
      expect(await listMemory(b.id, { search: attack }, app)).toEqual([]);
    }
    expect(await listMemory(a.id, {}, app)).toHaveLength(1);
  });

  it("fails closed without a tenant", async () => {
    const { a } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Red", target: "Rot" }], "APPROVED", app);
    expect(await app.translationMemory.count()).toBe(0);
  });
});

describe("glossary isolation", () => {
  it("keeps glossaries private to each shop", async () => {
    const { a, b } = await twoShops();
    await upsertTerms(a.id, [{ rule: "PREFERRED", term: "hoodie", translation: "Geheim", targetLocale: "de" }], {}, app);
    expect(await listTerms(b.id, {}, app)).toEqual([]);
    expect((await resolveGlossary(b.id, "de", "", app)).protect.replacements).toEqual([]);
    const [term] = await listTerms(a.id, {}, app);
    expect(await deleteTerm(b.id, term!.id, app)).toBe(false);
    expect(await listTerms(a.id, {}, app)).toHaveLength(1);
  });

  it("exports formula-like terms so spreadsheets don't execute them", () => {
    const csv = glossaryToCsv([
      { rule: "DO_NOT_TRANSLATE", term: '=HYPERLINK("https://evil.test","x")', translation: null, targetLocale: "", market: "", caseSensitive: false, notes: "+cmd|' /C calc'!A0" },
    ]);
    const dataLine = csv.split("\r\n")[1]!;
    expect(dataLine).toContain(`"'=HYPERLINK(""https://evil.test"",""x"")"`);
    expect(dataLine).toContain(`"'+cmd|' /C calc'!A0"`);
  });
});

describe("review isolation", () => {
  async function draftFor(shopId: string) {
    await saveDrafts(
      shopId,
      [
        {
          jobId: null,
          resourceGid: P1,
          resourceTitle: "Product 1",
          locale: "de",
          key: "title",
          sourceDigest: "d",
          sourceValue: "Product 1 jacket",
          value: "[de] Product 1 jacket",
          segmentPairs: [],
          issues: [],
          provider: "mock",
        },
      ],
      app,
    );
    const [draft] = await listPendingDrafts(shopId, {}, app);
    return draft!;
  }

  it("cannot approve or reject another shop's drafts", async () => {
    const { a, b } = await twoShops();
    const draftOfA = await draftFor(a.id);
    const storeOfB = new FakeShopifyStore(1);

    const result = await approveDrafts(
      { admin: storeOfB.asAdmin(), shopId: b.id, actorId: "attacker", draftIds: [draftOfA.id] },
      app,
    );
    expect(result).toEqual({ published: 0, stale: 0, failed: 0, changed: 0 });
    expect(storeOfB.calls).toEqual([]);
    expect(await rejectDrafts(b.id, [draftOfA.id], "attacker", app)).toBe(0);
    expect((await listPendingDrafts(a.id, {}, app))[0]).toMatchObject({ id: draftOfA.id, status: "PENDING" });
  });

  it("ignores malformed draft ids", async () => {
    const { a } = await twoShops();
    expect(await rejectDrafts(a.id, ["' OR 1=1", "../x", ""], null, app)).toBe(0);
  });

  it("cannot restore another shop's revision", async () => {
    const { a, b } = await twoShops();
    await withTenant(
      a.id,
      (tx) =>
        tx.translationRevision.create({
          data: { shopId: a.id, resourceGid: P1, key: "title", locale: "de", value: "A's text", sourceDigest: "d", origin: "MANUAL", approved: true },
        }),
      app,
    );
    const revision = await withTenant(a.id, (tx) => tx.translationRevision.findFirstOrThrow(), app);
    const storeOfB = new FakeShopifyStore(1);
    await expect(
      restoreRevision({ admin: storeOfB.asAdmin(), shopId: b.id, actorId: "attacker", revisionId: revision.id }, app),
    ).resolves.toEqual({ status: "not_found" });
    expect(storeOfB.calls).toEqual([]);
  });

  it("can't delete drafts or revisions with the runtime role", async () => {
    await twoShops();
    await expect(app.$executeRawUnsafe(`DELETE FROM "TranslationDraft"`)).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(`DELETE FROM "TranslationRevision"`)).rejects.toThrow(/permission denied/);
  });
});

describe("fuzzy search function (security definer)", () => {
  it("returns nothing without a tenant, and only the current tenant's entries with one", async () => {
    const { a, b } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Waterproof hiking jacket for summer", target: "x" }], "APPROVED", app);
    // Called directly by the runtime role, outside withTenant.
    const none = await app.$queryRaw<unknown[]>`
      SELECT * FROM linguva_memory_fuzzy('en', 'de', '', 'Waterproof hiking jacket for summer', 0, 1000, 0.3, 10)`;
    expect(none).toEqual([]);
    const asB = await withTenant(
      b.id,
      (tx) => tx.$queryRaw<unknown[]>`
        SELECT * FROM linguva_memory_fuzzy('en', 'de', '', 'Waterproof hiking jacket for summer', 0, 1000, 0.3, 10)`,
      app,
    );
    expect(asB).toEqual([]);
    const asA = await withTenant(
      a.id,
      (tx) => tx.$queryRaw<unknown[]>`
        SELECT * FROM linguva_memory_fuzzy('en', 'de', '', 'Waterproof hiking jacket for summer', 0, 1000, 0.3, 10)`,
      app,
    );
    expect(asA).toHaveLength(1);
  });

  it("is a narrow, hardened definer function and the table stays under RLS", async () => {
    const [fn] = await ownerDb.$queryRaw<Array<{ secdef: boolean; config: string[] | null; public_exec: boolean }>>`
      SELECT p.prosecdef AS secdef, p.proconfig AS config,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p WHERE p.proname = 'linguva_memory_fuzzy'`;
    expect(fn).toMatchObject({ secdef: true, public_exec: false });
    expect(fn!.config).toContain("search_path=pg_catalog, pg_temp");
    const [table] = await ownerDb.$queryRaw<Array<{ rls: boolean }>>`
      SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'TranslationMemory'`;
    expect(table!.rls).toBe(true);
    // The runtime role reading the table directly is still filtered by RLS.
    const { a } = await twoShops();
    await storeMemory(ctx(a.id), [{ source: "Red", target: "Rot" }], "APPROVED", app);
    expect(await app.translationMemory.count()).toBe(0);
  });
});
