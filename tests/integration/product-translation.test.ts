import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TranslationProvider } from "../../app/.server/providers/types";
import { TranslationProviderError } from "../../app/.server/providers/types";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import {
  AiConsentRequiredError,
  aiTranslateResource,
  saveResourceTranslations,
} from "../../app/.server/translation/product-translation-service";
import { getMonthlyUsage, QuotaExceededError } from "../../app/.server/usage/usage-ledger";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyAdmin } from "../support/fake-admin";

const app = new PrismaClient();
const PRODUCT = "gid://shopify/Product/1001";

const provider: TranslationProvider = {
  id: "test",
  async translate(request) {
    return {
      translations: request.segments.map((s) => s.replace("Blue", "Blau").replace("jacket", "Jacke")),
      billedCharacters: 30,
      provider: "test",
    };
  },
};

function admin() {
  return new FakeShopifyAdmin(PRODUCT, [
    { key: "title", value: "Blue jacket", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>Blue <b>jacket</b></p>", type: "HTML" },
    { key: "handle", value: "blue-jacket", type: "URI" },
  ]);
}

async function shop() {
  return (await upsertInstalledShop({ shopDomain: "translate.myshopify.com" }, app)).shop;
}

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("aiTranslateResource", () => {
  it("requires AI data-processing consent", async () => {
    const s = await shop();
    await expect(
      aiTranslateResource(
        { admin: admin().asAdmin(), shopId: s.id, resourceId: PRODUCT, targetLocale: "de", keys: ["title"], provider, monthlyLimit: 1000 },
        app,
      ),
    ).rejects.toBeInstanceOf(AiConsentRequiredError);
  });

  it("returns drafts, writes nothing to Shopify and meters actual usage", async () => {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    const fake = admin();
    const result = await aiTranslateResource(
      { admin: fake.asAdmin(), shopId: s.id, resourceId: PRODUCT, targetLocale: "de", keys: ["title", "body_html", "handle"], provider, monthlyLimit: 1000 },
      app,
    );
    expect(result.outcomes).toMatchObject([
      { key: "title", status: "translated", value: "Blau Jacke", issues: [] },
      { key: "body_html", status: "translated", value: "<p>Blau <b>Jacke</b></p>", issues: [] },
      { key: "handle", status: "skipped", reason: "MANUAL_ONLY" },
    ]);
    expect(fake.calls).not.toContain("LinguvaTranslationsRegister");
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(30);
  });

  it("refuses when the monthly limit would be exceeded", async () => {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    await expect(
      aiTranslateResource(
        { admin: admin().asAdmin(), shopId: s.id, resourceId: PRODUCT, targetLocale: "de", keys: ["body_html"], provider, monthlyLimit: 5 },
        app,
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("releases the reservation when the provider fails", async () => {
    const s = await shop();
    await setAiConsent({ shopId: s.id, granted: true, actorId: null }, app);
    const failing: TranslationProvider = {
      id: "test",
      translate: async () => {
        throw new TranslationProviderError("test", "quota", "HTTP 456", 456);
      },
    };
    await expect(
      aiTranslateResource(
        { admin: admin().asAdmin(), shopId: s.id, resourceId: PRODUCT, targetLocale: "de", keys: ["title"], provider: failing, monthlyLimit: 1000 },
        app,
      ),
    ).rejects.toBeInstanceOf(TranslationProviderError);
    expect(await getMonthlyUsage(s.id, undefined, app)).toBe(0);
  });
});

describe("saveResourceTranslations", () => {
  async function load(fake: FakeShopifyAdmin) {
    const response = await fake.graphql("query LinguvaTranslatableResource", {
      variables: { resourceId: PRODUCT, locale: "de" },
    });
    const body = (await response.json()) as {
      data: { translatableResource: { translatableContent: Array<{ key: string; digest: string }> } };
    };
    return Object.fromEntries(body.data.translatableResource.translatableContent.map((c) => [c.key, c.digest]));
  }

  it("saves translations, verifies them and records revisions", async () => {
    const s = await shop();
    const fake = admin();
    const digests = await load(fake);
    const outcomes = await saveResourceTranslations(
      {
        admin: fake.asAdmin(),
        shopId: s.id,
        actorId: "42",
        resourceId: PRODUCT,
        locale: "de",
        edits: [
          { key: "title", value: "Blaue Jacke", digest: digests.title!, origin: "AI", provider: "deepl", approved: true },
          { key: "handle", value: "blaue-jacke", digest: digests.handle!, origin: "MANUAL", approved: true },
        ],
      },
      app,
    );
    expect(outcomes).toEqual([
      { key: "title", status: "saved" },
      { key: "handle", status: "saved" },
    ]);
    expect(fake.translationOf("de", "title")).toBe("Blaue Jacke");
    const revisions = await withTenant(s.id, (tx) => tx.translationRevision.findMany({ orderBy: { key: "asc" } }), app);
    expect(revisions.map((r) => [r.key, r.origin, r.provider])).toEqual([
      ["handle", "MANUAL", null],
      ["title", "AI", "deepl"],
    ]);
    expect(await ownerDb.auditLog.count({ where: { action: "translations.saved", shopId: s.id } })).toBe(1);
  });

  it("refuses to save a translation of a source that changed meanwhile", async () => {
    const s = await shop();
    const fake = admin();
    const digests = await load(fake);
    fake.updateSource("title", "Navy jacket");
    const outcomes = await saveResourceTranslations(
      {
        admin: fake.asAdmin(),
        shopId: s.id,
        actorId: null,
        resourceId: PRODUCT,
        locale: "de",
        edits: [
          { key: "title", value: "Blaue Jacke", digest: digests.title!, origin: "AI", approved: true },
          { key: "body_html", value: "<p>Blaue <b>Jacke</b></p>", digest: digests.body_html!, origin: "AI", approved: true },
        ],
      },
      app,
    );
    expect(outcomes).toEqual([
      { key: "title", status: "conflict" },
      { key: "body_html", status: "saved" },
    ]);
    expect(fake.translationOf("de", "title")).toBeUndefined();
  });

  it("rejects empty values and unknown keys without calling Shopify", async () => {
    const s = await shop();
    const fake = admin();
    const digests = await load(fake);
    const outcomes = await saveResourceTranslations(
      {
        admin: fake.asAdmin(),
        shopId: s.id,
        actorId: null,
        resourceId: PRODUCT,
        locale: "de",
        edits: [
          { key: "title", value: "  ", digest: digests.title!, origin: "MANUAL", approved: true },
          { key: "vendor", value: "x", digest: "abc", origin: "MANUAL", approved: true },
        ],
      },
      app,
    );
    expect(outcomes.map((o) => o.status)).toEqual(["error", "error"]);
    expect(fake.calls).not.toContain("LinguvaTranslationsRegister");
  });
});
