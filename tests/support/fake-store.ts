/**
 * In-memory stand-in for one shop's Admin GraphQL API with many products
 * (and optionally collections):
 * paginated translatableResources, translatableResource and
 * translationsRegister. Supports fault injection. It models the documented
 * contract only; real behaviour must still be verified on a dev store.
 */
import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

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

const GID_TYPES: Record<string, string> = { PRODUCT: "Product", COLLECTION: "Collection" };

export class FakeShopifyStore {
  readonly calls: string[] = [];
  /** All resources by GID (products and collections). */
  readonly products = new Map<string, Field[]>();
  readonly translations = new Map<string, { value: string; digest: string }>();
  /** Throw this error for the next N calls (any operation). */
  failNext: { count: number; error: () => Error } | null = null;

  constructor(count: number, private readonly sourceLocale = "en") {
    for (let i = 1; i <= count; i++) this.products.set(`gid://shopify/Product/${i}`, productFields(i));
  }

  addCollections(count: number) {
    for (let i = 1; i <= count; i++) this.products.set(`gid://shopify/Collection/${i}`, collectionFields(i));
    return this;
  }

  asAdmin(): Pick<AdminApiContext, "graphql"> {
    return { graphql: this.graphql } as unknown as Pick<AdminApiContext, "graphql">;
  }

  translate(gid: string, locale: string, key: string, value: string) {
    const field = this.products.get(gid)!.find((f) => f.key === key)!;
    this.translations.set(`${gid}|${locale}|${key}`, { value, digest: digestOf(field.value) });
  }

  updateSource(gid: string, key: string, value: string) {
    this.products.set(
      gid,
      this.products.get(gid)!.map((f) => (f.key === key ? { ...f, value } : f)),
    );
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

    if (name === "LinguvaTranslatableResources") {
      const gidType = GID_TYPES[String(vars.resourceType)];
      if (!gidType) throw new Error(`FakeShopifyStore: unsupported resourceType ${String(vars.resourceType)}`);
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
