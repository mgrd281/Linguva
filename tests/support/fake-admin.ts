/**
 * In-memory stand-in for the Shopify Admin GraphQL API, covering only the
 * translation operations Linguva uses. It models the documented contract
 * (digest per field, translationsRegister rejecting stale digests). It is
 * not a substitute for verification on a real development store.
 */
import { createHash } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

interface Field {
  key: string;
  value: string;
  type: string;
}

const digestOf = (value: string) => createHash("sha256").update(value).digest("hex");

export class FakeShopifyAdmin {
  readonly calls: string[] = [];
  private translations = new Map<string, { value: string; digest: string }>();

  constructor(
    private readonly resourceId: string,
    private fields: Field[],
    private readonly sourceLocale = "en",
  ) {}

  /** Typed view for code that expects the library's admin client. */
  asAdmin(): Pick<AdminApiContext, "graphql"> {
    return this as unknown as Pick<AdminApiContext, "graphql">;
  }

  /** Simulates the merchant editing the source in the Shopify admin. */
  updateSource(key: string, value: string) {
    this.fields = this.fields.map((f) => (f.key === key ? { ...f, value } : f));
  }

  translationOf(locale: string, key: string) {
    return this.translations.get(`${locale}:${key}`)?.value;
  }

  graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const name = /(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? "anonymous";
    this.calls.push(name);
    const vars = options?.variables ?? {};

    if (name === "LinguvaTranslatableResource") {
      if (vars.resourceId !== this.resourceId) return Response.json({ data: { translatableResource: null } });
      return Response.json({ data: { translatableResource: this.node(String(vars.locale)) } });
    }

    if (name === "LinguvaTranslationsRegister") {
      const inputs = vars.translations as Array<{
        key: string;
        value: string;
        locale: string;
        translatableContentDigest: string;
      }>;
      const userErrors: Array<{ field: string[]; message: string; code: string }> = [];
      const written: Array<{ key: string; locale: string; value: string }> = [];
      inputs.forEach((input, i) => {
        const field = this.fields.find((f) => f.key === input.key);
        if (!field || digestOf(field.value) !== input.translatableContentDigest) {
          userErrors.push({
            field: ["translations", String(i), "translatableContentDigest"],
            message: "Translatable content hash is invalid",
            code: "INVALID_TRANSLATABLE_CONTENT",
          });
          return;
        }
        this.translations.set(`${input.locale}:${input.key}`, {
          value: input.value,
          digest: input.translatableContentDigest,
        });
        written.push({ key: input.key, locale: input.locale, value: input.value });
      });
      return Response.json({ data: { translationsRegister: { translations: written, userErrors } } });
    }

    throw new Error(`FakeShopifyAdmin: unsupported operation ${name}`);
  };

  private node(locale: string) {
    return {
      resourceId: this.resourceId,
      translatableContent: this.fields.map((f) => ({
        key: f.key,
        value: f.value,
        digest: digestOf(f.value),
        locale: this.sourceLocale,
        type: f.type,
      })),
      translations: this.fields
        .filter((f) => this.translations.has(`${locale}:${f.key}`))
        .map((f) => {
          const t = this.translations.get(`${locale}:${f.key}`)!;
          return { key: f.key, value: t.value, outdated: t.digest !== digestOf(f.value), updatedAt: null };
        }),
    };
  }
}
