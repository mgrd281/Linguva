import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  approveMemoryEntry,
  deleteMemoryEntry,
  fuzzyMatches,
  listMemory,
  lookupExact,
  memoryStats,
  recordMemoryUse,
  storeMemory,
  type MemoryContext,
} from "../../app/.server/memory/translation-memory";
import {
  deleteTerm,
  listTerms,
  resolveGlossary,
  upsertTerms,
} from "../../app/.server/glossary/glossary";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function context(domain = "tm.myshopify.com", market = ""): Promise<MemoryContext> {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  return { shopId: shop.id, sourceLocale: "en", targetLocale: "de", market };
}

describe("translation memory", () => {
  it("finds exact matches regardless of whitespace", async () => {
    const ctx = await context();
    await storeMemory(ctx, [{ source: "Free  shipping", target: "Kostenloser Versand" }], "APPROVED", app);
    const hits = await lookupExact(ctx, [" Free shipping ", "Unknown"], { allowMachine: false }, app);
    expect([...hits.entries()].map(([s, h]) => [s, h.target])).toEqual([[" Free shipping ", "Kostenloser Versand"]]);
  });

  it("only reuses machine entries when allowed", async () => {
    const ctx = await context();
    await storeMemory(ctx, [{ source: "Warm jacket", target: "Warme Jacke" }], "MACHINE", app);
    expect((await lookupExact(ctx, ["Warm jacket"], { allowMachine: false }, app)).size).toBe(0);
    expect((await lookupExact(ctx, ["Warm jacket"], { allowMachine: true }, app)).size).toBe(1);
  });

  it("never lets machine output overwrite an approved translation", async () => {
    const ctx = await context();
    await storeMemory(ctx, [{ source: "Warm jacket", target: "Warme Jacke (geprüft)" }], "APPROVED", app);
    await storeMemory(ctx, [{ source: "Warm jacket", target: "Warme Jacke (KI)" }], "MACHINE", app);
    const hit = (await lookupExact(ctx, ["Warm jacket"], { allowMachine: true }, app)).get("Warm jacket");
    expect(hit).toMatchObject({ target: "Warme Jacke (geprüft)", status: "APPROVED" });
    // A newer approved translation does replace it.
    await storeMemory(ctx, [{ source: "Warm jacket", target: "Warme Winterjacke" }], "APPROVED", app);
    expect((await lookupExact(ctx, ["Warm jacket"], { allowMachine: false }, app)).get("Warm jacket")!.target).toBe(
      "Warme Winterjacke",
    );
  });

  it("prefers market-specific entries over general ones", async () => {
    const general = await context();
    const swiss = { ...general, market: "gid://shopify/Market/2" };
    await storeMemory(general, [{ source: "Bag", target: "Tasche" }], "APPROVED", app);
    await storeMemory(swiss, [{ source: "Bag", target: "Täschli" }], "APPROVED", app);
    expect((await lookupExact(swiss, ["Bag"], { allowMachine: false }, app)).get("Bag")!.target).toBe("Täschli");
    expect((await lookupExact(general, ["Bag"], { allowMachine: false }, app)).get("Bag")!.target).toBe("Tasche");
  });

  it("returns fuzzy suggestions ranked by similarity", async () => {
    const ctx = await context();
    await storeMemory(
      ctx,
      [
        { source: "Waterproof hiking jacket for winter", target: "Wasserdichte Wanderjacke für den Winter" },
        { source: "Leather wallet with six card slots", target: "Ledergeldbörse mit sechs Kartenfächern" },
      ],
      "APPROVED",
      app,
    );
    const matches = await fuzzyMatches(ctx, "Waterproof hiking jacket for summer", {}, app);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.targetText).toBe("Wasserdichte Wanderjacke für den Winter");
    expect(matches[0]!.score).toBeGreaterThan(0.6);
    expect(matches[0]!.score).toBeLessThan(1);
  });

  it("tracks use, lists, approves and deletes entries", async () => {
    const ctx = await context();
    await storeMemory(ctx, [{ source: "Red", target: "Rot" }], "MACHINE", app);
    const [entry] = await listMemory(ctx.shopId, { search: "rot" }, app);
    await recordMemoryUse(ctx.shopId, [entry!.id, entry!.id], app);
    expect(await approveMemoryEntry(ctx.shopId, entry!.id, app)).toBe(true);
    expect(await memoryStats(ctx.shopId, app)).toEqual([
      { sourceLocale: "en", targetLocale: "de", status: "APPROVED", entries: 1, uses: 1 },
    ]);
    expect(await deleteMemoryEntry(ctx.shopId, entry!.id, app)).toBe(true);
    expect(await listMemory(ctx.shopId, {}, app)).toEqual([]);
  });

  it("ignores empty and oversized pairs", async () => {
    const ctx = await context();
    expect(
      await storeMemory(ctx, [{ source: " ", target: "x" }, { source: "a".repeat(10_001), target: "b" }], "APPROVED", app),
    ).toBe(0);
  });
});

describe("glossary", () => {
  it("adds, updates, lists and deletes terms", async () => {
    const { shopId } = await context();
    await upsertTerms(shopId, [
      { rule: "DO_NOT_TRANSLATE", term: "KARINEX" },
      { rule: "PREFERRED", term: "hoodie", translation: "Hoodie", targetLocale: "de" },
    ], {}, app);
    // Same rule + term + locale updates instead of duplicating.
    await upsertTerms(shopId, [{ rule: "PREFERRED", term: "hoodie", translation: "Kapuzenpullover", targetLocale: "de" }], {}, app);
    const terms = await listTerms(shopId, {}, app);
    expect(terms.map((t) => [t.rule, t.term, t.translation])).toEqual([
      ["DO_NOT_TRANSLATE", "KARINEX", null],
      ["PREFERRED", "hoodie", "Kapuzenpullover"],
    ]);
    expect(await deleteTerm(shopId, terms[0]!.id, app)).toBe(true);
    expect(await listTerms(shopId, {}, app)).toHaveLength(1);
  });

  it("rejects invalid terms and leaves nothing half-written", async () => {
    const { shopId } = await context();
    await expect(
      upsertTerms(shopId, [
        { rule: "DO_NOT_TRANSLATE", term: "OK" },
        { rule: "PREFERRED", term: "missing translation", targetLocale: "de" },
      ], {}, app),
    ).rejects.toThrow();
    expect(await listTerms(shopId, {}, app)).toEqual([]);
  });

  it("replaces all terms on request", async () => {
    const { shopId } = await context();
    await upsertTerms(shopId, [{ rule: "DO_NOT_TRANSLATE", term: "Old" }], {}, app);
    await upsertTerms(shopId, [{ rule: "DO_NOT_TRANSLATE", term: "New" }], { replaceAll: true }, app);
    expect((await listTerms(shopId, {}, app)).map((t) => t.term)).toEqual(["New"]);
  });

  it("resolves the terms for a language from the database", async () => {
    const { shopId } = await context();
    await upsertTerms(shopId, [
      { rule: "DO_NOT_TRANSLATE", term: "KARINEX", caseSensitive: true },
      { rule: "PREFERRED", term: "hoodie", translation: "Kapuzenpullover", targetLocale: "de" },
      { rule: "FORBIDDEN", term: "billig", targetLocale: "de" },
      { rule: "PREFERRED", term: "hoodie", translation: "sweat à capuche", targetLocale: "fr" },
    ], {}, app);
    const de = await resolveGlossary(shopId, "de", "", app);
    expect(de.protect.protectedTerms).toEqual([{ term: "KARINEX", caseSensitive: true }]);
    expect(de.protect.replacements).toEqual([{ term: "hoodie", caseSensitive: false, value: "Kapuzenpullover" }]);
    expect(de.rules.map((r) => r.term)).toEqual(["billig"]);
  });
});
