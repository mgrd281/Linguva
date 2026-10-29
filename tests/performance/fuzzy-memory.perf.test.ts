/**
 * Fuzzy translation memory search at scale: 100,000 entries for one shop
 * plus 20,000 for another, with a shared product vocabulary (many common
 * trigrams, the hard case for trigram indexes).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fuzzyMatches } from "../../app/.server/memory/translation-memory";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { ownerDb, resetDatabase } from "../support/db";

const app = new PrismaClient();
const ENTRIES = 100_000;
let shopA: string;
let shopB: string;

const WORDS =
  "warm cold light dark blue red green black white grey soft hard waterproof breathable cotton wool linen leather silk denim jacket coat shirt dress skirt trousers jeans shorts boots shoes sneakers sandals hat cap scarf gloves socks belt bag backpack wallet watch ring necklace earrings bracelet for with and the a of in on men women kids classic modern vintage slim regular oversized long short sleeve hood pocket pockets zipper buttons collar winter summer spring autumn outdoor sport running hiking casual formal office party travel organic recycled premium handmade limited edition new size small medium large extra colour pattern striped checked plain printed floral elegant comfortable durable lightweight everyday perfect gift set pack piece care wash machine hand dry iron natural fabric material quality design style fit look day night weather rain snow wind sun beach city mountain";

async function seed(shopId: string, count: number, marker: string) {
  await ownerDb.$transaction(
    [
      ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
      ownerDb.$executeRawUnsafe(
        `INSERT INTO "TranslationMemory" ("shopId","sourceLocale","targetLocale","market","sourceHash","sourceText","targetText","status","updatedAt")
         SELECT $1::uuid, 'en', 'de', '', md5(t), t, '${marker} ' || t,
                CASE WHEN g % 3 = 0 THEN 'APPROVED' ELSE 'MACHINE' END::"MemoryStatus", now()
         FROM (
           SELECT g, array_to_string(ARRAY(
             SELECT w[1 + floor(random() * array_length(w, 1))::int]
             FROM generate_series(1, 4 + (g % 9)) x WHERE g > 0), ' ') || ' ' || g AS t
           FROM generate_series(1, $2::int) g, (SELECT string_to_array($3, ' ') AS w) words
         ) s`,
        shopId,
        count,
        WORDS,
      ),
    ],
  );
}

beforeAll(async () => {
  await resetDatabase();
  shopA = (await upsertInstalledShop({ shopDomain: "perf-a.myshopify.com" }, app)).shop.id;
  shopB = (await upsertInstalledShop({ shopDomain: "perf-b.myshopify.com" }, app)).shop.id;
  await seed(shopA, ENTRIES, "A");
  await seed(shopB, 20_000, "B");
  await ownerDb.$executeRawUnsafe(`ANALYZE "TranslationMemory"`);
}, 180_000);

afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

const ctx = (shopId: string) => ({ shopId, sourceLocale: "en", targetLocale: "de" });

describe(`fuzzy memory search with ${ENTRIES.toLocaleString()} entries`, () => {
  it("finds near-duplicates quickly and only in the shop's own memory", async () => {
    const samples = await withTenant(
      shopA,
      (tx) => tx.$queryRaw<Array<{ sourceText: string }>>`
        SELECT "sourceText" FROM "TranslationMemory"
        WHERE "shopId" = ${shopA}::uuid AND length("sourceText") > 40
        ORDER BY md5("id"::text) LIMIT 10`,
      app,
    );
    expect(samples).toHaveLength(10);
    // Warm-up (plan cache, buffers).
    await fuzzyMatches(ctx(shopA), samples[0]!.sourceText, {}, app);

    const timings: number[] = [];
    let found = 0;
    for (const { sourceText } of samples) {
      // A near-duplicate: the trailing number differs.
      const probe = sourceText.replace(/ \d+$/, " 7");
      const started = performance.now();
      const matches = await fuzzyMatches(ctx(shopA), probe, { threshold: 0.6 }, app);
      timings.push(performance.now() - started);
      if (matches.some((m) => m.sourceText === sourceText)) found++;
      expect(matches.every((m) => m.targetText.startsWith("A "))).toBe(true);
    }
    for (const probe of ["warm waterproof jacket for men with hood and two pockets", "Ein völlig anderer Satz ohne Treffer"]) {
      const started = performance.now();
      await fuzzyMatches(ctx(shopA), probe, {}, app);
      timings.push(performance.now() - started);
    }
    timings.sort((x, y) => x - y);
    const median = timings[Math.floor(timings.length / 2)]!;
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1]!;
    console.info(`fuzzy search over ${ENTRIES} entries: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, recall ${found}/10`);
    expect(found).toBeGreaterThanOrEqual(9);
    expect(median).toBeLessThan(250);
    expect(p95).toBeLessThan(750);
  }, 60_000);

  it("is several times faster than evaluating similarity under RLS for every row", async () => {
    const probe = "warm waterproof jacket for men with hood and two pockets";
    const time = async (fn: () => Promise<unknown>) => {
      await fn();
      const started = performance.now();
      await fn();
      return performance.now() - started;
    };
    const indexed = await time(() => fuzzyMatches(ctx(shopA), probe, {}, app));
    // The previous query, run directly by the runtime role under RLS.
    const direct = await time(() =>
      withTenant(
        shopA,
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', '0.6', true)`;
          return tx.$queryRaw`
            SELECT "id", similarity("sourceText", ${probe}) AS score FROM "TranslationMemory"
            WHERE "shopId" = ${shopA}::uuid AND "sourceLocale" = 'en' AND "targetLocale" = 'de'
              AND "sourceText" % ${probe}
            ORDER BY score DESC LIMIT 3`;
        },
        app,
      ),
    );
    console.info(`same search: ${indexed.toFixed(1)} ms with the index function, ${direct.toFixed(1)} ms under RLS without it`);
    expect(indexed * 2).toBeLessThan(direct);
  }, 60_000);
});
