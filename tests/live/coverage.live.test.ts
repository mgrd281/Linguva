/**
 * Coverage and CSV against the real development store (phase J).
 *
 * Read-only on Shopify unless LIVE_ALLOW_WRITES=yes: the scan, the
 * independent recount and the CSV export only read; imports become drafts
 * in the local test database. With writes allowed, one draft product
 * fixture (tagged linguva-live-test, deleted afterwards) is translated by
 * approving an imported draft, and the coverage item must turn complete.
 *
 * Prints a summary for the results log (counts, timings; no store text).
 * Off unless configured (docs/DEV_STORE_VERIFICATION.md); never in CI.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { COVERAGE_TYPES, createCoverageReport, runCoveragePage, type CoveragePagePayload } from "../../app/.server/coverage/coverage";
import { listCoverageItems, loadCoverageSummary } from "../../app/.server/coverage/summary";
import { rebuildCountsTx } from "../../app/.server/coverage/items";
import { listTranslatableResources } from "../../app/.server/shopify/translations-api";
import { SHOP_LOCALES_QUERY } from "../../app/.server/locales/shop-locales";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { exportTranslations, importTranslations } from "../../app/.server/translation/csv-transfer";
import { parseCsv, toCsv } from "../../app/.server/glossary/csv";
import { approveDrafts, searchPendingDrafts } from "../../app/.server/review/drafts";
import { byType } from "../../app/lib/coverage-view";
import { createLiveAdmin } from "./admin-client";
import { createFixtureProduct, deleteFixture, shopFacts } from "./fixtures";
import { assertDevelopmentStore, LiveTestRefused, readLiveSettings } from "./guard";

const settings = readLiveSettings();
const live = describe.skipIf(!settings);
const writes = describe.skipIf(!settings?.allowWrites);
const prisma = new PrismaClient();
const admin = settings ? createLiveAdmin(settings) : null!;
// Chosen and checked once by tests/live/global-setup.ts.
const locale = inject("liveTargetLocale");
const runId = randomBytes(4).toString("hex");
const created = new Set<string>();
let shopId: string;

/** Types counted independently below (the catalog and the online store). */
const RECOUNT_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG", "MEDIA_IMAGE"] as const;

/**
 * Independent count from Shopify's own data, without Linguva's coverage
 * code: fields with an original, translated and current, outdated, missing.
 */
async function recount(resourceType: (typeof RECOUNT_TYPES)[number]) {
  const counts = { total: 0, complete: 0, outdated: 0, missing: 0, items: 0 };
  let after: string | null = null;
  do {
    const page = await listTranslatableResources(admin, { resourceType, locale, after, first: 50 });
    for (const r of page.resources) {
      counts.items++;
      for (const field of r.content) {
        if (!field.value || !field.value.trim()) continue;
        counts.total++;
        const t = r.translations.find((x) => x.key === field.key);
        if (!t || !t.value || !t.value.trim()) counts.missing++;
        else if (t.outdated) counts.outdated++;
        else counts.complete++;
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return counts;
}

async function scan() {
  const { report } = await createCoverageReport({ shopId, locales: [locale], requestedBy: null, idempotencyKey: `live-${runId}-${Date.now()}` }, prisma);
  let next: CoveragePagePayload | null = { shopId, reportId: report.id, segmentIndex: 0, cursor: null };
  const started = performance.now();
  let pages = 0;
  while (next) {
    next = await runCoveragePage({ prisma, adminFor: async () => admin, keyPrefix: `lv:live:${runId}` }, next);
    pages++;
  }
  return { ms: Math.round(performance.now() - started), pages };
}

beforeAll(async () => {
  if (!settings) return;
  assertDevelopmentStore(settings, await shopFacts(admin));
  const response = await admin.graphql(SHOP_LOCALES_QUERY);
  const { data } = (await response.json()) as { data: { shopLocales: Array<{ locale: string; primary: boolean }> } };
  const target = data.shopLocales.find((l) => l.locale === locale);
  if (!target || target.primary) throw new LiveTestRefused(`enable ${locale} as an additional language on the dev store first`);
  shopId = (await upsertInstalledShop({ shopDomain: settings.shop }, prisma)).shop.id;
}, 60_000);

afterAll(async () => {
  for (const gid of created) {
    try {
      await deleteFixture(admin, gid, created);
    } catch (error) {
      console.error(`Cleanup failed for ${gid}; delete it by hand (tag linguva-live-test).`, error);
    }
  }
  await prisma.$disconnect();
}, 60_000);

live("coverage on the real store (read-only)", () => {
  it("scans every type and matches an independent recount of Shopify's data", async () => {
    const timing = await scan();
    const summary = await loadCoverageSummary(shopId, prisma);
    const types = byType(summary.counts, locale);
    const lines: string[] = [];
    for (const type of RECOUNT_TYPES) {
      const expected = await recount(type);
      const actual = types.get(type)?.counts ?? { complete: 0, review: 0, draft: 0, failed: 0, outdated: 0, missing: 0 };
      lines.push(`${type}: ${expected.items} items, ${expected.total} fields; complete ${actual.complete}/${expected.complete}, outdated ${actual.outdated}/${expected.outdated}, missing ${actual.missing}/${expected.missing}`);
      // A fresh test database has no drafts or failed jobs: Shopify's three states only.
      expect({ complete: actual.complete, outdated: actual.outdated, missing: actual.missing }, type).toEqual({
        complete: expected.complete,
        outdated: expected.outdated,
        missing: expected.missing,
      });
    }
    // Every type was read: scanned, or without access (optional scope not granted), never failed.
    const segments = summary.segments.filter((s) => s.locale === locale);
    expect(segments).toHaveLength(COVERAGE_TYPES.length);
    expect(segments.filter((s) => s.status === "FAILED" || s.status === "SCANNING")).toEqual([]);
    const denied = segments.filter((s) => s.status === "DENIED").map((s) => s.resourceType);
    console.info(
      [
        `Coverage scan of ${settings!.shop} (${locale}): ${timing.pages} Shopify pages in ${timing.ms} ms.`,
        ...lines.map((l) => `  ${l} (Linguva/recount)`),
        `  No access (optional scopes of the test app): ${denied.join(", ") || "none"}`,
      ].join("\n"),
    );
  }, 600_000);

  it("keeps counts equal to counts rebuilt from the items", async () => {
    const before = (await loadCoverageSummary(shopId, prisma)).counts;
    await withTenant(shopId, async (tx) => {
      for (const type of COVERAGE_TYPES) await rebuildCountsTx(tx, shopId, locale, type);
    }, prisma);
    const after = (await loadCoverageSummary(shopId, prisma)).counts;
    const key = (r: { locale: string; resourceType: string; fieldGroup: string; state: string; count: number }) => `${r.locale}|${r.resourceType}|${r.fieldGroup}|${r.state}|${r.count}`;
    expect(before.map(key).sort()).toEqual(after.map(key).sort());
  });

  it("loads the dashboard summary and an items page quickly", async () => {
    const t0 = performance.now();
    await loadCoverageSummary(shopId, prisma);
    const summaryMs = performance.now() - t0;
    const t1 = performance.now();
    await listCoverageItems(shopId, { locale, resourceType: "PRODUCT", state: "missing", limit: 50 }, prisma);
    const itemsMs = performance.now() - t1;
    console.info(`Dashboard summary ${summaryMs.toFixed(0)} ms, items page ${itemsMs.toFixed(0)} ms (local database).`);
    expect(summaryMs).toBeLessThan(1500);
    expect(itemsMs).toBeLessThan(500);
  });

  it("exports products as CSV that matches the recount, and imports filled rows as drafts only", async () => {
    const expected = await recount("PRODUCT");
    const exported = await exportTranslations(admin, { resourceType: "PRODUCT", locale, onlyGaps: false });
    expect(exported.rows).toBe(expected.total);
    const table = parseCsv(exported.csv);
    const gap = table.slice(1).find((r) => r[7] === "missing" && r[2] === "title");
    if (!gap) return console.info("CSV import skipped: no product title is missing in this language.");
    gap[6] = `Linguva live CSV ${runId}`;
    const result = await importTranslations({ admin, shopId, csv: toCsv([table[0]!, gap]), targetLocales: [locale] }, prisma);
    expect(result.drafts).toBe(1);
    // Nothing was written to Shopify: the field is still missing there.
    const after = await listTranslatableResources(admin, { resourceType: "PRODUCT", locale, first: 50 });
    const resource = after.resources.find((r) => r.resourceId === gap[0]);
    if (resource) expect(resource.translations.find((t) => t.key === "title")?.value ?? null).not.toBe(gap[6]);
    console.info(`CSV: ${exported.rows} product fields exported; 1 row imported as a draft, Shopify unchanged.`);
  }, 300_000);
});

writes("coverage after approving an imported draft (fixture only)", () => {
  it("turns the field complete in coverage right after publishing", async () => {
    const product = await createFixtureProduct(admin, runId);
    created.add(product.id);
    await scan();
    const csv = parseCsv((await exportTranslations(admin, { resourceType: "PRODUCT", locale, onlyGaps: true })).csv);
    const row = csv.find((r) => r[0] === product.id && r[2] === "title");
    expect(row, "fixture title in the export").toBeDefined();
    row![6] = `Linguva Live-Test ${runId} Jacke`;
    expect((await importTranslations({ admin, shopId, csv: toCsv([csv[0]!, row!]), targetLocales: [locale] }, prisma)).drafts).toBe(1);

    const itemBefore = (await listCoverageItems(shopId, { locale, resourceType: "PRODUCT", state: "draft", limit: 100 }, prisma)).items.find((i) => i.resourceGid === product.id);
    expect(itemBefore?.counts.draft).toBe(1);

    const draft = (await searchPendingDrafts(shopId, {}, prisma)).drafts.find((d) => d.resourceGid === product.id)!;
    expect(await approveDrafts({ admin, shopId, actorId: "live", draftIds: [draft.id] }, prisma)).toMatchObject({ published: 1 });
    const itemAfter = (await listCoverageItems(shopId, { locale, resourceType: "PRODUCT", state: "complete", limit: 100 }, prisma)).items.find((i) => i.resourceGid === product.id);
    expect(itemAfter?.counts.complete).toBe(1);
  }, 600_000);
});
