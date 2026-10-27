/**
 * Contract tests against a real Shopify development store. They verify the
 * assumptions the fakes encode (digests, outdated flags, error codes) and
 * run the production translation pipeline end to end on fixtures.
 *
 * Off unless configured; see docs/DEV_STORE_SETUP.md. Never runs in CI.
 * Uses the mock provider: no AI costs, no merchant text leaves the store.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBulkJob } from "../../app/.server/jobs/bulk-jobs";
import { processItem, type JobDependencies } from "../../app/.server/jobs/processors";
import { MockTranslationProvider } from "../../app/.server/providers/mock";
import { setAiConsent, setBulkPublishMode } from "../../app/.server/settings/shop-settings";
import {
  getTranslatableResource,
  listTranslatableResources,
  registerTranslations,
  removeTranslations as removeAppTranslations,
} from "../../app/.server/shopify/translations-api";
import { SHOP_LOCALES_QUERY } from "../../app/.server/locales/shop-locales";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { restoreRevision } from "../../app/.server/translation/history";
import { saveResourceTranslations } from "../../app/.server/translation/product-translation-service";
import { RESOURCE_KINDS } from "../../app/lib/resource-kinds";
import { createLiveAdmin } from "./admin-client";
import {
  createFixtureCollection,
  createFixtureProduct,
  deleteFixture,
  listMarkets,
  removeTranslations,
  shopFacts,
  updateFixtureProductTitle,
} from "./fixtures";
import { assertDevelopmentStore, LiveTestRefused, readLiveSettings } from "./guard";

const settings = readLiveSettings();
const live = describe.skipIf(!settings);
const writes = describe.skipIf(!settings?.allowWrites);

const runId = randomBytes(4).toString("hex");
const created = new Set<string>();
const prisma = new PrismaClient();
const admin = settings ? createLiveAdmin(settings) : null!;
const locale = settings?.targetLocale ?? "de";
let product: { id: string; handle: string };
let collection: { id: string; handle: string };

const field = async (gid: string, key: string) => {
  const resource = await getTranslatableResource(admin, gid, locale);
  return {
    content: resource?.content.find((c) => c.key === key),
    translation: resource?.translations.find((t) => t.key === key),
  };
};

beforeAll(async () => {
  if (!settings) return;
  // The gate: nothing runs unless this is the configured development store.
  assertDevelopmentStore(settings, await shopFacts(admin));
  const response = await admin.graphql(SHOP_LOCALES_QUERY);
  const { data } = (await response.json()) as { data: { shopLocales: Array<{ locale: string; primary: boolean }> } };
  const target = data.shopLocales.find((l) => l.locale === locale);
  if (!target || target.primary) {
    throw new LiveTestRefused(`enable ${locale} as an additional language on the dev store first`);
  }
  if (!settings.allowWrites) return;
  product = await createFixtureProduct(admin, runId);
  created.add(product.id);
  collection = await createFixtureCollection(admin, runId);
  created.add(collection.id);
}, 60_000);

afterAll(async () => {
  // Fixtures (and their translations) are deleted even when tests fail.
  for (const gid of created) {
    try {
      await deleteFixture(admin, gid, created);
    } catch (error) {
      console.error(`Cleanup failed for ${gid}; delete it by hand (tag linguva-live-test).`, error);
    }
  }
  await prisma.$disconnect();
}, 60_000);

live("read contract (no writes)", () => {
  it("lists products and collections with digests for every translatable field", async () => {
    // Also confirms the GID type Linguva assumes for each kind (Page, Article, Blog).
    for (const resourceType of ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"] as const) {
      const page = await listTranslatableResources(admin, { resourceType, locale, first: 5 });
      for (const r of page.resources) {
        expect(r.resourceId).toMatch(new RegExp(`^gid://shopify/${RESOURCE_KINDS[resourceType].gidType}/\\d+$`));
        for (const c of r.content) if (c.value) expect(c.digest).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("reads markets and their web presences (needs read_markets)", async (context) => {
    let markets;
    try {
      markets = await listMarkets(admin);
    } catch (error) {
      if (/access denied|read_markets/i.test(String(error))) context.skip();
      throw error;
    }
    for (const m of markets) {
      for (const wp of m.webPresences.nodes) {
        expect(wp.defaultLocale.locale).toBeTruthy();
        expect(Array.isArray(wp.alternateLocales)).toBe(true);
      }
    }
  });
});

writes("write contract on fixtures", () => {
  it("exposes the expected product and collection keys, SEO fields included", async () => {
    const p = await getTranslatableResource(admin, product.id, locale);
    expect(p?.content.map((c) => c.key)).toEqual(
      expect.arrayContaining(["title", "body_html", "handle", "product_type", "meta_title", "meta_description"]),
    );
    const c = await getTranslatableResource(admin, collection.id, locale);
    expect(c?.content.map((x) => x.key)).toEqual(
      expect.arrayContaining(["title", "body_html", "handle", "meta_title", "meta_description"]),
    );
  });

  it("registers a translation with the current digest and reads it back up to date", async () => {
    const { content } = await field(product.id, "meta_title");
    const result = await registerTranslations(admin, product.id, locale, [
      { key: "meta_title", value: "Winterjacke (Live-Test)", translatableContentDigest: content!.digest! },
    ]);
    expect(result.userErrors).toEqual([]);
    const { translation } = await field(product.id, "meta_title");
    expect(translation).toMatchObject({ value: "Winterjacke (Live-Test)", outdated: false });
  });

  it("rejects a wrong digest with INVALID_TRANSLATABLE_CONTENT (the fake store's assumption)", async () => {
    const result = await registerTranslations(admin, product.id, locale, [
      { key: "title", value: "Falsch", translatableContentDigest: "0".repeat(64) },
    ]);
    expect(result.userErrors.map((e) => e.code)).toEqual(["INVALID_TRANSLATABLE_CONTENT"]);
    expect((await field(product.id, "title")).translation?.value ?? null).not.toBe("Falsch");
  });

  it("accepts a translated URL handle", async () => {
    const { content } = await field(collection.id, "handle");
    const result = await registerTranslations(admin, collection.id, locale, [
      { key: "handle", value: `linguva-live-test-${runId}-${locale.toLowerCase()}`, translatableContentDigest: content!.digest! },
    ]);
    expect(result.userErrors).toEqual([]);
  });

  it("marks a translation outdated after the source changes, and refuses the old digest", async () => {
    const before = await field(product.id, "title");
    await registerTranslations(admin, product.id, locale, [
      { key: "title", value: "Winterjacke", translatableContentDigest: before.content!.digest! },
    ]);
    await updateFixtureProductTitle(admin, product.id, `Linguva live test ${runId} jacket v2`);
    const after = await field(product.id, "title");
    expect(after.content!.digest).not.toBe(before.content!.digest);
    expect(after.translation).toMatchObject({ value: "Winterjacke", outdated: true });

    const stale = await registerTranslations(admin, product.id, locale, [
      { key: "title", value: "Alt", translatableContentDigest: before.content!.digest! },
    ]);
    expect(stale.userErrors.length).toBe(1);
  });

  it("removes a translation", async () => {
    // The app's own removal call (editor "Remove translation").
    const result = await removeAppTranslations(admin, product.id, locale, ["meta_title"]);
    expect(result.userErrors).toEqual([]);
    expect((await field(product.id, "meta_title")).translation?.value ?? null).toBeNull();
  });
});

writes("Linguva pipeline on fixtures", () => {
  let shopId: string;
  let deps: JobDependencies;

  beforeAll(async () => {
    // A local tenant row stands for the dev store; the test database is used.
    const { shop } = await upsertInstalledShop({ shopDomain: settings!.shop }, prisma);
    shopId = shop.id;
    await setAiConsent({ shopId, granted: true, actorId: null }, prisma);
    await setBulkPublishMode({ shopId, mode: "AUTO_PUBLISH", confirmed: true, actorId: "live-test" }, prisma);
    deps = {
      prisma,
      adminFor: async () => admin,
      provider: new MockTranslationProvider(),
      monthlyLimit: 1_000_000,
      keyPrefix: `lv:live:${runId}`,
    };
  });

  // Jobs here get items for the fixtures only (no discovery over the store).
  async function runFixtureJob(gid: string, resourceType: "PRODUCT" | "COLLECTION", overwriteProtected = false) {
    const { job } = await createBulkJob(
      { shopId, resourceType, targetLocale: locale, requestedBy: null, idempotencyKey: `live-${runId}-${randomBytes(3).toString("hex")}`, overwriteProtected },
      prisma,
    );
    const item = await withTenant(
      shopId,
      async (tx) => {
        await tx.translationJob.update({ where: { id: job.id }, data: { status: "RUNNING", discoveryDone: true, totalItems: 1 } });
        return tx.translationJobItem.create({ data: { shopId, jobId: job.id, resourceGid: gid } });
      },
      prisma,
    );
    await processItem(deps, { shopId, itemId: item.id }, 1);
    return withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id: job.id } }), prisma);
  }

  it("keeps a translation made outside Linguva and fills only the gaps", async () => {
    // The fixture's title already has an outdated "manual" translation (previous test).
    const job = await runFixtureJob(product.id, "PRODUCT");
    expect(job.protectedSkipped).toBeGreaterThan(0);
    expect((await field(product.id, "title")).translation?.value).toBe("Winterjacke");
    const body = await field(product.id, "body_html");
    expect(body.translation).toMatchObject({ outdated: false });
    // Markup and the link come from the source; only text is translated.
    expect(body.translation!.value).toContain('<a href="https://example.com/care">');
    expect(body.translation!.value).toContain("<strong>");
  });

  it("replaces it only with explicit permission, keeping the old value as history", async () => {
    await runFixtureJob(product.id, "PRODUCT", true);
    expect((await field(product.id, "title")).translation).toMatchObject({ outdated: false });
    expect((await field(product.id, "title")).translation!.value).not.toBe("Winterjacke");
    const external = await withTenant(
      shopId,
      (tx) => tx.translationRevision.findFirst({ where: { resourceGid: product.id, key: "title", origin: "EXTERNAL" } }),
      prisma,
    );
    expect(external?.value).toBe("Winterjacke");
  });

  it("translates a collection and never machine-translates its handle", async () => {
    await removeTranslations(admin, collection.id, ["handle"], [locale]);
    const job = await runFixtureJob(collection.id, "COLLECTION");
    expect(job.succeededItems).toBe(1);
    expect((await field(collection.id, "title")).translation?.outdated).toBe(false);
    expect((await field(collection.id, "handle")).translation?.value ?? null).toBeNull();
  });

  it("publishes a manual edit and restores the previous version", async () => {
    const before = await field(collection.id, "title");
    const [saved] = await saveResourceTranslations(
      {
        admin,
        shopId,
        actorId: "live-test",
        resourceId: collection.id,
        locale,
        edits: [{ key: "title", value: "Winterauswahl (manuell)", digest: before.content!.digest!, origin: "MANUAL", approved: true }],
      },
      prisma,
    );
    expect(saved?.status).toBe("saved");
    const previous = await withTenant(
      shopId,
      (tx) =>
        tx.translationRevision.findFirstOrThrow({
          where: { resourceGid: collection.id, key: "title", value: before.translation!.value! },
          orderBy: { createdAt: "desc" },
        }),
      prisma,
    );
    const restored = await restoreRevision({ admin, shopId, actorId: "live-test", revisionId: previous.id, resourceGid: collection.id }, prisma);
    expect(restored).toEqual({ status: "restored" });
    expect((await field(collection.id, "title")).translation?.value).toBe(before.translation!.value);
  });
});
