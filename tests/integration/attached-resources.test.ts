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
import { attachedForAi } from "../../app/components/ResourceTranslationEditor";
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

  it("gives the editor the item's picture as its area list reads it, whether or not an image has a description", async () => {
    const { shop, store } = await setup();
    // The product's only image has no description yet: nothing to translate, its picture all the same.
    store.addImage(P1, "", "jacket");
    const product = await loadEditorData(ctx(store, shop.id));
    expect(product.attached.items).toEqual([]);
    expect(product.attached.imagesWithoutAlt).toBe(1);
    expect(product.picture).toBe(store.imageUrl("jacket"));
    // Collections and blog posts: their image (their image descriptions carry no picture).
    store.addImage("gid://shopify/Collection/1", "Winter collection banner", "mountains");
    store.addImage("gid://shopify/Article/1", "Washing wool in a basin", "tent");
    expect((await loadEditorData(ctx(store, shop.id, "COLLECTION", "gid://shopify/Collection/1"))).picture).toBe(store.imageUrl("mountains"));
    expect((await loadEditorData(ctx(store, shop.id, "ARTICLE", "gid://shopify/Article/1"))).picture).toBe(store.imageUrl("tent"));
    // None: the area's icon. Pages and blogs have no picture, and nothing is asked for one.
    expect((await loadEditorData(ctx(store, shop.id, "PRODUCT", P2))).picture).toBeNull();
    const asked = store.calls.filter((c) => c === "LinguvaPreviewNodes").length;
    expect((await loadEditorData(ctx(store, shop.id, "PAGE", "gid://shopify/Page/1"))).picture).toBeNull();
    expect(store.calls.filter((c) => c === "LinguvaPreviewNodes")).toHaveLength(asked);
  });

  it("opens the editor without its picture when Shopify can't say", async () => {
    const { shop, store } = await setup();
    store.addImage(P1, "Red wool jacket", "jacket");
    const admin = store.asAdmin();
    const failing = {
      graphql: (query: string, options?: Parameters<typeof admin.graphql>[1]) =>
        query.includes("LinguvaPreviewNodes") ? Promise.reject(new Error("Shopify unavailable")) : admin.graphql(query, options),
    };
    const data = await loadEditorData({ ...ctx(store, shop.id), admin: failing as typeof admin });
    expect(data.picture).toBeNull();
    expect(data.attached.items).toHaveLength(1);
  });

  it("re-saves an outdated image description unchanged only when the merchant ticks “still correct”", async () => {
    const { shop, store } = await setup();
    const img = store.addImage(P1, "Red wool jacket");
    store.translate(img, "de", "alt", "Rote Wolljacke");
    store.updateSource(img, "alt", "Red wool jacket, front view");
    const field = (await loadEditorData(ctx(store, shop.id))).attached.items.find((i) => i.id === img)!.fields[0]!;
    expect(field).toMatchObject({ translation: "Rote Wolljacke", outdated: true });
    // The page's form as it is posted: the text unchanged, with its digests.
    const entries: Array<[string, string]> = [
      ["intent", "save-attached"],
      ...saveEntries(img, "alt", "Rote Wolljacke", field.digest),
      [attachedFieldName("current", img, "alt"), field.currentDigest],
    ];
    const outcomes = async (extra: Array<[string, string]>) =>
      ((await runEditorAction(ctx(store, shop.id), form([...entries, ...extra]))) as { data: { outcomes: unknown[] } }).data.outcomes;

    expect(await outcomes([])).toEqual([]);
    expect(await outcomes([[attachedFieldName("confirm", img, "alt"), "on"]])).toEqual([{ ref: attachedRef(img, "alt"), status: "saved" }]);
    const reloaded = (await loadEditorData(ctx(store, shop.id))).attached.items.find((i) => i.id === img)!.fields[0]!;
    expect(reloaded).toMatchObject({ translation: "Rote Wolljacke", outdated: false });
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

  it("drafts the image descriptions of 25 items per AI request, as the editor counts them", async () => {
    const { shop, store } = await setup();
    const images = Array.from({ length: 27 }, (_, i) => store.addImage(P1, `Red wool jacket, view ${i + 1}`));
    // The editor's count: 25 now, 2 for a request after these drafts are published.
    expect(attachedForAi((await loadEditorData(ctx(store, shop.id))).attached.items)).toEqual({ now: 25, later: 2 });
    const result = await runEditorAction(ctx(store, shop.id), form([["intent", "ai-translate-attached"]]));
    if (!("kind" in result) || result.kind !== "attached-ai") throw new Error("unexpected result");
    expect(Object.keys(result.drafts)).toEqual(images.slice(0, 25).map((id) => attachedRef(id, "alt")));
    expect(result.stopped).toBeUndefined();
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
      { ref: attachedRef(mf, "value"), status: "conflict", code: "SOURCE_CHANGED" },
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

  it("translates lists and links item by item; addresses and item count can't be changed", async () => {
    const { shop, store } = await setup();
    const list = store.addMetafield(P1, { namespace: "custom", key: "features", type: "list.single_line_text_field", value: '["Warm","Waterproof"]' });
    const links = store.addMetafield(P1, {
      namespace: "custom",
      key: "guides",
      type: "list.link",
      value: '[{"text":"Care guide","url":"https://example.com/care"},{"text":"Size chart","url":"/pages/sizes"}]',
    });

    const data = await loadEditorData(ctx(store, shop.id));
    expect(data.attached.items.find((i) => i.id === list)?.fields[0]).toMatchObject({ type: "LIST_SINGLE_LINE_TEXT_FIELD", machine: true });
    expect(data.attached.items.find((i) => i.id === links)?.fields[0]).toMatchObject({ type: "LIST_LINK", machine: true });
    expect(data.attached.unsupported).toBe(0);

    const ai = await runEditorAction(ctx(store, shop.id), form([["intent", "ai-translate-attached"]]));
    if (!("kind" in ai) || ai.kind !== "attached-ai") throw new Error("unexpected result");
    expect(JSON.parse(ai.drafts[attachedRef(list, "value")]!)).toEqual(["[de] Warm", "[de] Waterproof"]);
    const linkDraft = ai.drafts[attachedRef(links, "value")]!;
    expect(JSON.parse(linkDraft)).toEqual([
      { text: "[de] Care guide", url: "https://example.com/care" },
      { text: "[de] Size chart", url: "/pages/sizes" },
    ]);

    const digestOf = (id: string) => data.attached.items.find((i) => i.id === id)!.fields[0]!.digest;
    // Another address, a dropped item or malformed JSON: refused with a structure error, nothing published.
    for (const bad of [
      linkDraft.replace("https://example.com/care", "https://evil.example/"),
      JSON.stringify([{ text: "Pflege", url: "https://example.com/care" }]),
      "Pflegehinweise",
    ]) {
      const refused = await runEditorAction(ctx(store, shop.id), form([["intent", "save-attached"], ...saveEntries(links, "value", bad, digestOf(links))]));
      expect((refused as { data: { outcomes: Array<{ status: string; code?: string }> } }).data.outcomes, bad).toEqual([
        expect.objectContaining({ ref: attachedRef(links, "value"), status: "error", code: "STRUCTURE_CHANGED" }),
      ]);
    }
    expect(store.translationOf(links, "de", "value")).toBeUndefined();
    // An item left untranslated is refused as empty.
    const partial = await runEditorAction(
      ctx(store, shop.id),
      form([["intent", "save-attached"], ...saveEntries(links, "value", '[{"text":"Pflege","url":"https://example.com/care"},{"text":"","url":"/pages/sizes"}]', digestOf(links))]),
    );
    expect((partial as { data: { outcomes: Array<{ code?: string }> } }).data.outcomes).toEqual([expect.objectContaining({ code: "EMPTY_TRANSLATION" })]);

    // Edited texts with the source's addresses publish.
    const edited = JSON.stringify([
      { text: "Pflegehinweise", url: "https://example.com/care" },
      { text: "Größentabelle", url: "/pages/sizes" },
    ]);
    await runEditorAction(
      ctx(store, shop.id),
      form([
        ["intent", "save-attached"],
        ...saveEntries(links, "value", edited, digestOf(links)),
        ...saveEntries(list, "value", '["Warm","Wasserdicht"]', digestOf(list)),
      ]),
    );
    expect(store.translationOf(links, "de", "value")).toBe(edited);
    expect(store.translationOf(list, "de", "value")).toBe('["Warm","Wasserdicht"]');
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
