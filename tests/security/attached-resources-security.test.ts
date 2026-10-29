/**
 * A form can only address images and metafields of the edited resource:
 * ids of other resources, hidden metafields and unsupported types are never
 * written, whatever the request contains.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRANSLATION_PROVIDER = "mock";
  process.env.AI_USER_REQUESTS_PER_MINUTE = "100";
  process.env.AI_SHOP_REQUESTS_PER_MINUTE = "100";
});

import { PrismaClient } from "@prisma/client";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { attachedFieldName } from "../../app/.server/translation/attached-editor";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import type { ResourceKind } from "../../app/lib/resource-kinds";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";

beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

async function setup(domain = "attached.myshopify.com") {
  const { shop } = await upsertInstalledShop({ shopDomain: domain }, app);
  await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
  const store = new FakeShopifyStore(2).addCollections(1).addContent(1);
  return { shop, store };
}

const ctx = (store: FakeShopifyStore, shopId: string, kind: ResourceKind = "PRODUCT", resourceId = P1): EditorContext => ({
  admin: store.asAdmin(),
  shopId,
  actorId: "7",
  kind,
  resourceId,
  target: { locale: "de", name: "German", rtl: false },
  sourceName: "English",
});

function form(entries: Array<[string, string]>) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

function saveEntries(id: string, key: string, value: string, digest: string): Array<[string, string]> {
  return [
    [attachedFieldName("value", id, key), value],
    [attachedFieldName("digest", id, key), digest],
  ];
}

describe("attached resources can't be used to reach other resources", () => {
  it("ignores values posted for another product's image or metafield, or the parent itself", async () => {
    const { shop, store } = await setup();
    const own = store.addImage(P1, "Red wool jacket");
    const foreignImage = store.addImage(P2, "Other product image");
    const foreignField = store.addMetafield(P2, { namespace: "custom", key: "care", type: "single_line_text_field", value: "Dry clean" });
    const hidden = store.addMetafield(P1, { namespace: "custom", key: "internal", type: "single_line_text_field", value: "Secret", translatable: false });
    const digestOf = (gid: string, key: string) =>
      // The attacker knows the real digests (they are not secret).
      ((store as unknown as { node(g: string, l: string): { translatableContent: Array<{ key: string; digest: string }> } })
        .node(gid, "de").translatableContent.find((c) => c.key === key)?.digest ?? "x");

    const result = await runEditorAction(
      ctx(store, shop.id),
      form([
        ["intent", "save-attached"],
        ...saveEntries(foreignImage, "alt", "Gekapert", digestOf(foreignImage, "alt")),
        ...saveEntries(foreignField, "value", "Gekapert", digestOf(foreignField, "value")),
        ...saveEntries(hidden, "value", "Gekapert", "x"),
        ...saveEntries(P1, "title", "Gekapert", digestOf(P1, "title")),
        ...saveEntries(own, "title", "Gekapert", "x"), // a key the image doesn't have
      ]),
    );
    expect((result as { data: { outcomes: unknown[] } }).data.outcomes).toEqual([]);
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect(store.translationOf(foreignImage, "de", "alt")).toBeUndefined();
    expect(store.translationOf(foreignField, "de", "value")).toBeUndefined();
    expect(store.translationOf(P1, "de", "title")).toBeUndefined();
  });

  it("never writes unsupported metafield types, even with a valid digest", async () => {
    const { shop, store } = await setup();
    const rich = store.addMetafield(P1, { namespace: "custom", key: "details", type: "rich_text_field", value: '{"type":"root"}' });
    const node = (store as unknown as { node(g: string, l: string): { translatableContent: Array<{ digest: string }> } }).node(rich, "de");
    await runEditorAction(ctx(store, shop.id), form([["intent", "save-attached"], ...saveEntries(rich, "value", "not json", node.translatableContent[0]!.digest)]));
    expect(store.translationOf(rich, "de", "value")).toBeUndefined();
  });

  it("keeps the editor usable when the attached resources can't be loaded", async () => {
    const { shop, store } = await setup();
    const original = store.graphql;
    store.graphql = async (query, options) => {
      if (/LinguvaOwnerMetafields/.test(query)) throw new Error("Access denied for metafields");
      return original(query, options);
    };
    const data = await loadEditorData(ctx(store, shop.id));
    expect(data.fields.length).toBeGreaterThan(0);
    expect(data.attached).toEqual({ available: false, items: [], imagesWithoutAlt: 0, unsupported: 0 });
  });
});
