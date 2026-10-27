/**
 * Image alt text and metafields in the editor: listing from Shopify,
 * AI drafts (never published by AI alone), saving, and the guarantee that a
 * form can only address images and metafields of the edited resource.
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
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { attachedFieldName, attachedRef } from "../../app/.server/translation/attached-editor";
import { loadEditorData, runEditorAction, type EditorContext } from "../../app/.server/translation/resource-editor";
import type { ResourceKind } from "../../app/lib/resource-kinds";
import { PLANS } from "../../app/lib/plans";
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

describe("image alt text and metafields in the editor", () => {
  it("lists product images and translatable text metafields only", async () => {
    const { shop, store } = await setup();
    const img = store.addImage(P1, "Red wool jacket, front view");
    store.addImage(P1, ""); // no alt text yet
    store.addVideo(P1);
    const mf = store.addMetafield(P1, { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
    const named = store.addMetafield(P1, { namespace: "custom", key: "fit_note", type: "single_line_text_field", value: "Runs small.", name: "Fit advice" });
    store.addMetafield(P1, { namespace: "custom", key: "sku_note", type: "single_line_text_field", value: "X-1", translatable: false });
    const rich = store.addMetafield(P1, {
      namespace: "custom",
      key: "details",
      type: "rich_text_field",
      value: '{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Soft merino."}]}]}',
    });
    store.addMetafield(P1, { namespace: "custom", key: "specs", type: "json", value: '{"weight":450}' });
    store.addImage(P2, "Other product image");

    const data = await loadEditorData(ctx(store, shop.id));
    expect(data.attached.available).toBe(true);
    // Metafields by the merchant's own name (or a readable key), the technical key as detail.
    expect(data.attached.items.map((i) => [i.id, i.kind, i.label, i.detail])).toEqual([
      [img, "IMAGE", "Image", null],
      [mf, "METAFIELD", "Care", "custom.care"],
      [named, "METAFIELD", "Fit advice", "custom.fit_note"],
      [rich, "METAFIELD", "Details", "custom.details"],
    ]);
    expect(data.attached.items[0]!.previewUrl).toMatch(/^https:\/\/cdn\.example\//);
    expect(data.attached.items[0]!.fields[0]).toMatchObject({ key: "alt", source: "Red wool jacket, front view", machine: true });
    expect(data.attached.imagesWithoutAlt).toBe(1);
    // Rich text is translated keeping its structure; JSON stays "not supported here".
    expect(data.attached.items.find((i) => i.id === rich)?.fields[0]).toMatchObject({ type: "RICH_TEXT_FIELD", machine: true });
    expect(data.attached.unsupported).toBe(1);
  });

  it("lists collection and blog post images via nested resources", async () => {
    const { shop, store } = await setup();
    const c = store.addImage("gid://shopify/Collection/1", "Winter collection banner");
    const a = store.addImage("gid://shopify/Article/1", "Washing wool in a basin");
    expect((await loadEditorData(ctx(store, shop.id, "COLLECTION", "gid://shopify/Collection/1"))).attached.items.map((i) => i.id)).toEqual([c]);
    expect((await loadEditorData(ctx(store, shop.id, "ARTICLE", "gid://shopify/Article/1"))).attached.items.map((i) => i.id)).toEqual([a]);
    // Pages have no image resource, but can have metafields.
    const m = store.addMetafield("gid://shopify/Page/1", { namespace: "custom", key: "subtitle", type: "single_line_text_field", value: "Since 1991" });
    expect((await loadEditorData(ctx(store, shop.id, "PAGE", "gid://shopify/Page/1"))).attached.items.map((i) => i.id)).toEqual([m]);
  });

  it("creates AI drafts for missing alt text and metafields without publishing them", async () => {
    const { shop, store } = await setup();
    const img = store.addImage(P1, "Red wool jacket");
    const done = store.addImage(P1, "Back view");
    store.translate(done, "de", "alt", "Rückansicht");
    const mf = store.addMetafield(P1, { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });

    const result = await runEditorAction(ctx(store, shop.id), form([["intent", "ai-translate-attached"]]));
    expect(result).toMatchObject({ kind: "attached-ai", provider: "mock" });
    if (!("kind" in result) || result.kind !== "attached-ai") throw new Error("unexpected result");
    expect(result.drafts).toEqual({
      [attachedRef(img, "alt")]: "[de] Red wool jacket",
      [attachedRef(mf, "value")]: "[de] Hand wash cold.",
    });
    // Already translated alt text is not sent again; nothing is published.
    expect(store.calls).not.toContain("LinguvaTranslationsRegister");
    expect(store.translationOf(img, "de", "alt")).toBeUndefined();
  });

  it("publishes reviewed alt text and metafields with revisions, and refuses stale digests", async () => {
    const { shop, store } = await setup();
    const img = store.addImage(P1, "Red wool jacket");
    const mf = store.addMetafield(P1, { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash cold." });
    const data = await loadEditorData(ctx(store, shop.id));
    const digest = (id: string) => data.attached.items.find((i) => i.id === id)!.fields[0]!.digest;

    const result = await runEditorAction(
      ctx(store, shop.id),
      form([
        ["intent", "save-attached"],
        ...saveEntries(img, "alt", "Rote Wolljacke", digest(img)),
        ...saveEntries(mf, "value", "Kalt von Hand waschen.", "stale-digest"),
      ]),
    );
    const body = (result as { data: { kind: string; outcomes: Array<{ ref: string; status: string }> } }).data;
    expect(body.kind).toBe("attached-saved");
    expect(body.outcomes).toEqual([
      { ref: attachedRef(img, "alt"), status: "saved" },
      { ref: attachedRef(mf, "value"), status: "conflict" },
    ]);
    expect(store.translationOf(img, "de", "alt")).toBe("Rote Wolljacke");
    expect(store.translationOf(mf, "de", "value")).toBeUndefined();
    const revisions = await withTenant(shop.id, (tx) => tx.translationRevision.findMany({ where: { resourceGid: img } }), app);
    expect(revisions).toMatchObject([{ key: "alt", value: "Rote Wolljacke", approved: true }]);
  });

  it("translates rich text with AI keeping its structure, and refuses tampered structure on save", async () => {
    const { shop, store } = await setup();
    const source = JSON.stringify({
      type: "root",
      children: [
        { type: "heading", level: 2, children: [{ type: "text", value: "Care" }] },
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Read the " },
            { type: "link", url: "https://example.com/care", children: [{ type: "text", value: "care guide", bold: true }] },
            { type: "text", value: " first." },
          ],
        },
      ],
    });
    const rich = store.addMetafield(P1, { namespace: "custom", key: "details", type: "rich_text_field", value: source });

    const ai = await runEditorAction(ctx(store, shop.id), form([["intent", "ai-translate-attached"]]));
    if (!("kind" in ai) || ai.kind !== "attached-ai") throw new Error("unexpected result");
    const draft = ai.drafts[attachedRef(rich, "value")]!;
    const parsed = JSON.parse(draft);
    expect(parsed.children[0]).toEqual({ type: "heading", level: 2, children: [{ type: "text", value: "[de] Care" }] });
    expect(parsed.children[1].children.find((c: { type: string }) => c.type === "link")).toMatchObject({ url: "https://example.com/care" });

    const data = await loadEditorData(ctx(store, shop.id));
    const digest = data.attached.items.find((i) => i.id === rich)!.fields[0]!.digest;
    // A posted value whose link points elsewhere is refused, nothing is published.
    const tampered = draft.replace("https://example.com/care", "https://evil.example/");
    const refused = await runEditorAction(ctx(store, shop.id), form([["intent", "save-attached"], ...saveEntries(rich, "value", tampered, digest)]));
    expect((refused as { data: { outcomes: Array<{ status: string }> } }).data.outcomes).toEqual([
      expect.objectContaining({ ref: attachedRef(rich, "value"), status: "error" }),
    ]);
    expect(store.translationOf(rich, "de", "value")).toBeUndefined();
    // Malformed JSON is refused too.
    await runEditorAction(ctx(store, shop.id), form([["intent", "save-attached"], ...saveEntries(rich, "value", "<p>not json</p>", digest)]));
    expect(store.translationOf(rich, "de", "value")).toBeUndefined();

    // The AI draft itself publishes.
    await runEditorAction(ctx(store, shop.id), form([["intent", "save-attached"], ...saveEntries(rich, "value", draft, digest)]));
    expect(store.translationOf(rich, "de", "value")).toBe(draft);
  });

  it("respects the plan's languages for AI on attached resources", async () => {
    const { shop, store } = await setup();
    store.addImage(P1, "Red wool jacket");
    const c = {
      ...ctx(store, shop.id),
      billing: { configured: true, state: "ACTIVE" as const, entitlements: PLANS.free, subscription: null, stale: false, mustChoosePlan: false },
      targetLocales: ["fr", "de"],
    };
    expect(await runEditorAction(c, form([["intent", "ai-translate-attached"]]))).toEqual({ kind: "error", code: "PLAN_LANGUAGE" });
  });
});
