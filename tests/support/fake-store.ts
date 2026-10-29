/**
 * In-memory stand-in for one shop's Admin GraphQL API with many products
 * (and optionally collections):
 * paginated translatableResources, translatableResource and
 * translationsRegister. Supports fault injection. It models the documented
 * contract only; real behaviour must still be verified on a dev store.
 */
import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { GraphqlQueryError } from "@shopify/shopify-api";

interface Field {
  key: string;
  value: string;
  type: string;
}

const digestOf = (value: string) => createHash("sha256").update(value).digest("hex");

export function productFields(n: number): Field[] {
  return [
    { key: "title", value: `Product ${n} jacket`, type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: `<p>Warm <b>jacket</b> number ${n}.</p>`, type: "HTML" },
    { key: "handle", value: `product-${n}`, type: "URI" },
  ];
}

export function collectionFields(n: number): Field[] {
  return [
    { key: "title", value: `Collection ${n} winter`, type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: `<p>Our <em>winter</em> picks, part ${n}.</p>`, type: "HTML" },
    { key: "handle", value: `collection-${n}`, type: "URI" },
    { key: "meta_title", value: `Winter collection ${n}`, type: "SINGLE_LINE_TEXT_FIELD" },
  ];
}

const GID_TYPES: Record<string, string> = {
  PRODUCT: "Product",
  COLLECTION: "Collection",
  PAGE: "Page",
  ARTICLE: "Article",
  BLOG: "Blog",
};

/** GID type of any resource type in the fake (PascalCase of the enum name). */
const gidTypeOf = (resourceType: string) =>
  GID_TYPES[resourceType] ??
  resourceType
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

export class FakeShopifyStore {
  readonly calls: string[] = [];
  /** All resources by GID (products and collections). */
  readonly products = new Map<string, Field[]>();
  readonly translations = new Map<string, { value: string; digest: string }>();
  /** The store's time zone (Settings → General). */
  timeZone = "Europe/Berlin";
  /** Product media (MediaImage GIDs; null = a video or 3D model). */
  readonly media = new Map<string, Array<{ id: string; url: string } | null>>();
  /** Nested image resources of collections and articles, by parent. */
  readonly nestedImages = new Map<string, Array<{ id: string; type: string }>>();
  readonly metafields = new Map<
    string,
    Array<{ id: string; namespace: string; key: string; type: string; translatable: boolean; definition: { name: string } | null }>
  >();
  private nextSubId = 9000;
  /** The shop's languages (shopLocales). */
  locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "de", name: "German", primary: false, published: true },
  ];
  /** When resources last changed (Product.updatedAt etc.); unset: long ago. */
  readonly updatedAt = new Map<string, Date>();
  /** Resource types the app has no access scope for (ACCESS_DENIED). */
  readonly deniedTypes = new Set<string>();
  /**
   * Throw GraphQL errors like the real Shopify library (GraphqlQueryError)
   * instead of returning them in the body.
   */
  throwsLikeLibrary = false;
  /** Resource types whose listing always fails with a GraphQL error (not access). */
  readonly brokenTypes = new Set<string>();
  /** Throw this error for the next N calls (any operation). */
  failNext: { count: number; error: () => Error } | null = null;

  constructor(count: number, private readonly sourceLocale = "en") {
    for (let i = 1; i <= count; i++) this.products.set(`gid://shopify/Product/${i}`, productFields(i));
  }

  /** Adds online store pages, blog posts and blogs. */
  addContent(count: number) {
    for (let i = 1; i <= count; i++) {
      this.products.set(`gid://shopify/Page/${i}`, [
        { key: "title", value: `About us ${i}`, type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "body_html", value: `<p>We make <strong>warm</strong> clothes since ${1990 + i}.</p>`, type: "HTML" },
        { key: "handle", value: `about-us-${i}`, type: "URI" },
      ]);
      this.products.set(`gid://shopify/Article/${i}`, [
        { key: "title", value: `How to wash wool ${i}`, type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "body_html", value: `<p>Use cold water, step ${i}.</p>`, type: "HTML" },
        { key: "summary_html", value: `<p>Wool care tips ${i}.</p>`, type: "HTML" },
        { key: "handle", value: `wash-wool-${i}`, type: "URI" },
      ]);
      this.products.set(`gid://shopify/Blog/${i}`, [
        { key: "title", value: `Journal ${i}`, type: "SINGLE_LINE_TEXT_FIELD" },
        { key: "handle", value: `journal-${i}`, type: "URI" },
      ]);
    }
    return this;
  }

  addCollections(count: number) {
    for (let i = 1; i <= count; i++) this.products.set(`gid://shopify/Collection/${i}`, collectionFields(i));
    return this;
  }

  /**
   * Adds an image with alt text to a product (as MediaImage), collection or
   * article (as a nested image resource). Returns the image's GID.
   */
  addImage(parentGid: string, alt: string) {
    const n = ++this.nextSubId;
    if (parentGid.includes("/Product/")) {
      const id = `gid://shopify/MediaImage/${n}`;
      this.media.set(parentGid, [...(this.media.get(parentGid) ?? []), { id, url: `https://cdn.example/${n}.jpg` }]);
      this.products.set(id, [{ key: "alt", value: alt, type: "STRING" }]);
      return id;
    }
    const type = parentGid.includes("/Collection/") ? "COLLECTION_IMAGE" : "ARTICLE_IMAGE";
    const id = `gid://shopify/${type === "COLLECTION_IMAGE" ? "CollectionImage" : "ArticleImage"}/${n}`;
    this.nestedImages.set(parentGid, [...(this.nestedImages.get(parentGid) ?? []), { id, type }]);
    this.products.set(id, [{ key: "alt", value: alt, type: "STRING" }]);
    return id;
  }

  /**
   * Adds a resource of any translatable type, e.g. ("MENU", "1", fields) →
   * gid://shopify/Menu/1. Theme resources may use non-numeric ids.
   */
  addResource(resourceType: string, id: string, fields: Field[]) {
    const gid = `gid://shopify/${gidTypeOf(resourceType)}/${id}`;
    this.products.set(gid, fields);
    return gid;
  }

  /** Adds a video (not translatable here) to a product's media. */
  addVideo(productGid: string) {
    this.media.set(productGid, [...(this.media.get(productGid) ?? []), null]);
  }

  /** Adds a metafield; translatable ones get translatable content under key "value". */
  addMetafield(ownerGid: string, m: { namespace: string; key: string; type: string; value: string; translatable?: boolean; name?: string }) {
    const id = `gid://shopify/Metafield/${++this.nextSubId}`;
    const translatable = m.translatable ?? true;
    this.metafields.set(ownerGid, [
      ...(this.metafields.get(ownerGid) ?? []),
      { id, namespace: m.namespace, key: m.key, type: m.type, translatable, definition: m.name ? { name: m.name } : null },
    ]);
    // Shopify's content type: list.single_line_text_field → LIST_SINGLE_LINE_TEXT_FIELD.
    if (translatable) this.products.set(id, [{ key: "value", value: m.value, type: m.type.toUpperCase().replace(".", "_") }]);
    return id;
  }

  asAdmin(): Pick<AdminApiContext, "graphql"> {
    return { graphql: this.graphql } as unknown as Pick<AdminApiContext, "graphql">;
  }

  translate(gid: string, locale: string, key: string, value: string) {
    const field = this.products.get(gid)!.find((f) => f.key === key)!;
    this.translations.set(`${gid}|${locale}|${key}`, { value, digest: digestOf(field.value) });
  }

  /** Adds (or replaces) a translatable field on a resource. */
  setField(gid: string, key: string, value: string, type = "SINGLE_LINE_TEXT_FIELD") {
    const fields = (this.products.get(gid) ?? []).filter((f) => f.key !== key);
    this.products.set(gid, [...fields, { key, value, type }]);
  }

  updateSource(gid: string, key: string, value: string) {
    this.products.set(
      gid,
      this.products.get(gid)!.map((f) => (f.key === key ? { ...f, value } : f)),
    );
  }

  /** Marks a resource as changed at a time (as a save in the admin would). */
  touch(gid: string, at: Date) {
    this.updatedAt.set(gid, at);
    return this;
  }

  translationOf(gid: string, locale: string, key: string) {
    return this.translations.get(`${gid}|${locale}|${key}`)?.value;
  }

  graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const name = /(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "anonymous";
    this.calls.push(name);
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count--;
      throw this.failNext.error();
    }
    const vars = options?.variables ?? {};

    if (name === "LinguvaTranslatableResources" && this.brokenTypes.has(String(vars.resourceType))) {
      throw new GraphqlQueryError({ message: "Internal error. Looks like something went wrong on our end.", response: {} as never, body: { errors: [{ message: "Internal error" }] } });
    }
    if ((name === "LinguvaTranslatableResources" || name === "LinguvaProbeTranslatable") && this.deniedTypes.has(String(vars.resourceType))) {
      if (this.throwsLikeLibrary) {
        throw new GraphqlQueryError({
          message: "Access denied for translatableResources field.",
          response: {} as never,
          body: { errors: [{ message: "Access denied for translatableResources field.", extensions: { code: "ACCESS_DENIED" } }] },
        });
      }
      return Response.json({
        errors: [{ message: "Access denied for translatableResources field.", extensions: { code: "ACCESS_DENIED" } }],
      });
    }
    const recent = /^LinguvaRecent(Products|Collections|Pages|Articles|Blogs)$/.exec(name);
    if (recent) {
      // Filtered by updated_at:>'…'; oldest first by updatedAt unless reversed (blogs: Shopify's default order).
      const resourceType = { Products: "PRODUCT", Collections: "COLLECTION", Pages: "PAGE", Articles: "ARTICLE", Blogs: "BLOG" }[recent[1]!]!;
      if (this.deniedTypes.has(resourceType)) {
        if (this.throwsLikeLibrary) {
          throw new GraphqlQueryError({ message: "Access denied", response: {} as never, body: { errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] } });
        }
        return Response.json({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] });
      }
      const changedAt = (gid: string) => this.updatedAt.get(gid) ?? new Date("2026-01-01T00:00:00Z");
      let all = [...this.products.keys()].filter((gid) => gid.startsWith(`gid://shopify/${gidTypeOf(resourceType)}/`));
      // Blogs keep Shopify's default order (by id); the others are sorted by UPDATED_AT.
      if (resourceType !== "BLOG") {
        all.sort((a, b) => changedAt(a).getTime() - changedAt(b).getTime());
        if (vars.reverse) all.reverse();
      }
      const after = /^updated_at:>'(.+)'$/.exec(String(vars.query ?? ""));
      if (after) all = all.filter((gid) => changedAt(gid) > new Date(after[1]!));
      const start = vars.after ? Number(vars.after) : 0;
      const slice = all.slice(start, start + Number(vars.first));
      const end = start + slice.length;
      return Response.json({
        data: {
          [recent[1]!.toLowerCase()]: {
            nodes: slice.map((id) => ({ id, updatedAt: changedAt(id).toISOString() })),
            pageInfo: { hasNextPage: end < all.length, endCursor: slice.length ? String(end) : null },
          },
        },
      });
    }
    const search = /^LinguvaSearch(Products|Collections|Pages|Articles|Blogs)$/.exec(name);
    if (search) {
      // "title:jack* AND title:red*": every word starts a word of the title.
      const type = { Products: "Product", Collections: "Collection", Pages: "Page", Articles: "Article", Blogs: "Blog" }[search[1]!]!;
      const prefixes = [...String(vars.query).matchAll(/title:([^*\s]+)\*/g)].map((m) => m[1]!.toLowerCase());
      const ids = [...this.products.keys()].filter((gid) => {
        if (!gid.startsWith(`gid://shopify/${type}/`)) return false;
        const words = (this.products.get(gid)!.find((f) => f.key === "title")?.value ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u);
        return prefixes.every((p) => words.some((w) => w.startsWith(p)));
      });
      return Response.json({ data: { [search[1]!.toLowerCase()]: { nodes: ids.slice(0, 100).map((id) => ({ id })) } } });
    }
    const owners = /^LinguvaMetafieldOwners(Products|Collections|Pages|Articles)$/.exec(name);
    if (owners) {
      const type = { Products: "Product", Collections: "Collection", Pages: "Page", Articles: "Article" }[owners[1]!]!;
      const all = [...this.products.keys()].filter((gid) => gid.startsWith(`gid://shopify/${type}/`));
      const start = vars.after ? Number(vars.after) : 0;
      const slice = all.slice(start, start + Number(vars.first));
      const end = start + slice.length;
      return Response.json({
        data: {
          [owners[1]!.toLowerCase()]: {
            nodes: slice.map((id) => ({
              id,
              metafields: { nodes: (this.metafields.get(id) ?? []).slice(0, 50).map((m) => ({ id: m.id, translatable: m.translatable })) },
            })),
            pageInfo: { hasNextPage: end < all.length, endCursor: slice.length ? String(end) : null },
          },
        },
      });
    }
    if (name === "LinguvaProbeTranslatable") {
      const prefix = `gid://shopify/${gidTypeOf(String(vars.resourceType))}/`;
      const first = [...this.products.keys()].find((gid) => gid.startsWith(prefix));
      return Response.json({ data: { translatableResources: { nodes: first ? [{ resourceId: first }] : [] } } });
    }
    if (name === "LinguvaTranslatableResources") {
      const gidType = gidTypeOf(String(vars.resourceType));
      const all = [...this.products.keys()].filter((gid) => gid.startsWith(`gid://shopify/${gidType}/`));
      const start = vars.after ? Number(vars.after) : 0;
      const first = Number(vars.first);
      const slice = all.slice(start, start + first);
      const end = start + slice.length;
      return Response.json({
        data: {
          translatableResources: {
            nodes: slice.map((gid) => this.node(gid, String(vars.locale))),
            pageInfo: { hasNextPage: end < all.length, endCursor: slice.length ? String(end) : null },
          },
        },
      });
    }
    if (name === "LinguvaTranslatableResource") {
      const gid = String(vars.resourceId);
      return Response.json({
        data: { translatableResource: this.products.has(gid) ? this.node(gid, String(vars.locale)) : null },
      });
    }
    if (name === "LinguvaShopLocales") return Response.json({ data: { shopLocales: this.locales } });
    if (name === "LinguvaShopTimeZone") return Response.json({ data: { shop: { ianaTimezone: this.timeZone } } });
    if (name === "LinguvaProductMedia") {
      const gid = String(vars.id);
      if (!this.products.has(gid)) return Response.json({ data: { product: null } });
      const nodes = (this.media.get(gid) ?? []).map((m) => (m ? { id: m.id, image: { url: m.url } } : {}));
      return Response.json({ data: { product: { media: { nodes } } } });
    }
    if (name === "LinguvaTranslatableByIds") {
      const ids = (vars.ids as string[]).filter((id) => this.products.has(id));
      return Response.json({
        data: { translatableResourcesByIds: { nodes: ids.map((id) => this.node(id, String(vars.locale))) } },
      });
    }
    if (name === "LinguvaNestedImages") {
      const gid = String(vars.id);
      if (!this.products.has(gid)) return Response.json({ data: { translatableResource: null } });
      const nodes = (this.nestedImages.get(gid) ?? [])
        .filter((i) => i.type === vars.type)
        .map((i) => this.node(i.id, String(vars.locale)));
      return Response.json({ data: { translatableResource: { nestedTranslatableResources: { nodes } } } });
    }
    if (name === "LinguvaOwnerMetafields") {
      const gid = String(vars.id);
      if (!this.products.has(gid)) return Response.json({ data: { node: null } });
      return Response.json({ data: { node: { metafields: { nodes: this.metafields.get(gid) ?? [] } } } });
    }
    if (name === "LinguvaTranslationsRegister") {
      const gid = String(vars.resourceId);
      const inputs = vars.translations as Array<{
        key: string;
        value: string;
        locale: string;
        translatableContentDigest: string;
      }>;
      const fields = this.products.get(gid) ?? [];
      const written: Array<{ key: string; locale: string; value: string }> = [];
      const userErrors: Array<{ field: string[]; message: string; code: string }> = [];
      inputs.forEach((input, i) => {
        const field = fields.find((f) => f.key === input.key);
        if (!field || digestOf(field.value) !== input.translatableContentDigest) {
          userErrors.push({
            field: ["translations", String(i)],
            message: "Translatable content hash is invalid",
            code: "INVALID_TRANSLATABLE_CONTENT",
          });
          return;
        }
        this.translations.set(`${gid}|${input.locale}|${input.key}`, {
          value: input.value,
          digest: input.translatableContentDigest,
        });
        written.push({ key: input.key, locale: input.locale, value: input.value });
      });
      return Response.json({ data: { translationsRegister: { translations: written, userErrors } } });
    }
    if (name === "LinguvaTranslationsRemove") {
      const gid = String(vars.resourceId);
      const removed: Array<{ key: string; locale: string }> = [];
      for (const locale of vars.locales as string[]) {
        for (const key of vars.keys as string[]) {
          if (this.translations.delete(`${gid}|${locale}|${key}`)) removed.push({ key, locale });
        }
      }
      return Response.json({ data: { translationsRemove: { translations: removed, userErrors: [] } } });
    }
    throw new Error(`FakeShopifyStore: unsupported operation ${name}`);
  };

  private node(gid: string, locale: string) {
    const fields = this.products.get(gid)!;
    return {
      resourceId: gid,
      translatableContent: fields.map((f) => ({
        key: f.key,
        value: f.value,
        digest: digestOf(f.value),
        locale: this.sourceLocale,
        type: f.type,
      })),
      translations: fields
        .filter((f) => this.translations.has(`${gid}|${locale}|${f.key}`))
        .map((f) => {
          const t = this.translations.get(`${gid}|${locale}|${f.key}`)!;
          return { key: f.key, value: t.value, outdated: t.digest !== digestOf(f.value), updatedAt: null };
        }),
    };
  }
}
