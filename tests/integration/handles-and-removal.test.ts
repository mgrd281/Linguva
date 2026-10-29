import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { restoreRevision } from "../../app/.server/translation/history";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup() {
  const { shop } = await upsertInstalledShop({ shopDomain: "handles.myshopify.com" }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(1);
  const ctx: EditorContext = {
    admin: store.asAdmin(),
    shopId: shop.id,
    actorId: "7",
    kind: "PRODUCT",
    resourceId: P1,
    target: { locale: "de", name: "German", rtl: false },
    sourceName: "English",
  };
  return { shop, store, ctx };
}

async function saveHandle(ctx: EditorContext, value: string, confirm = false) {
  const data = await loadEditorData(ctx);
  const form = new FormData();
  form.set("intent", "save");
  form.set("value:handle", value);
  form.set("digest:handle", data.fields.find((f) => f.key === "handle")!.digest);
  if (confirm) form.set("confirm-handle", "on");
  const result = (await runEditorAction(ctx, form)) as { data: { outcomes: Array<{ key: string; status: string; message?: string }> } };
  return result.data.outcomes.find((o) => o.key === "handle")!;
}

describe("URL handles", () => {
  it("refuses malformed handles before calling Shopify", async () => {
    const { store, ctx } = await setup();
    for (const bad of ["Winter Jacke", "winter--jacke", "jacke/2", "JACKE"]) {
      expect(await saveHandle(ctx, bad)).toMatchObject({ status: "error" });
    }
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
  });

  it("sets a first handle, but changing a published one needs confirmation", async () => {
    const { store, ctx } = await setup();
    expect(await saveHandle(ctx, "winterjacke-1")).toMatchObject({ status: "saved" });
    expect(store.translationOf(P1, "de", "handle")).toBe("winterjacke-1");

    const refused = await saveHandle(ctx, "warme-jacke-1");
    expect(refused).toMatchObject({ status: "error" });
    expect(refused.message).toMatch(/Confirm the URL change/);
    expect(store.translationOf(P1, "de", "handle")).toBe("winterjacke-1");

    expect(await saveHandle(ctx, "warme-jacke-1", true)).toMatchObject({ status: "saved" });
    expect(store.translationOf(P1, "de", "handle")).toBe("warme-jacke-1");
  });
});

describe("removing a translation", () => {
  it("removes it in Shopify, keeps it in the history and can restore it", async () => {
    const { shop, store, ctx } = await setup();
    store.translate(P1, "de", "title", "Von Hand übersetzt");
    const form = new FormData();
    form.set("intent", "remove");
    form.set("key", "title");
    expect(await runEditorAction(ctx, form)).toEqual({ kind: "removed", key: "title", status: "removed" });
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();

    const [kept] = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ where: { key: "title" } }), app);
    expect(kept).toMatchObject({ origin: "EXTERNAL", value: "Von Hand übersetzt" });
    expect(await ownerDb.auditLog.count({ where: { action: "translations.removed", shopId: shop.id } })).toBe(1);

    expect(await restoreRevision({ admin: store.asAdmin(), shopId: shop.id, actorId: "7", revisionId: kept!.id, resourceGid: P1 }, app)).toEqual({
      status: "restored",
    });
    expect(store.translationOf(P1, "de", "title")).toBe("Von Hand übersetzt");
  });

  it("won't later restore a removed translation that was already outdated as current", async () => {
    const { shop, store, ctx } = await setup();
    store.translate(P1, "de", "title", "Alte Übersetzung");
    store.updateSource(P1, "title", "Product 1 jacket, new");
    const form = new FormData();
    form.set("intent", "remove");
    form.set("key", "title");
    await runEditorAction(ctx, form);
    const [kept] = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ where: { key: "title" } }), app);
    expect(await restoreRevision({ admin: store.asAdmin(), shopId: shop.id, actorId: "7", revisionId: kept!.id }, app)).toEqual({
      status: "source_changed",
    });
  });

  it("reports nothing to remove, and rejects malformed keys", async () => {
    const { ctx } = await setup();
    const form = new FormData();
    form.set("intent", "remove");
    form.set("key", "title");
    expect(await runEditorAction(ctx, form)).toMatchObject({ status: "not_found" });
    form.set("key", "title'; DROP");
    expect(await runEditorAction(ctx, form)).toMatchObject({ init: { status: 400 } });
  });
});
