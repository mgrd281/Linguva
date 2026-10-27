/**
 * Translatable resources attached to a product, collection, page or post:
 * image alt text and metafields. Their GIDs always come from Shopify for the
 * given parent, never from the browser, so a form can't address another
 * resource (see collectAttachedEdits).
 *
 * - Product images: MediaImage nodes from product.media, then their alt text
 *   via translatableResourcesByIds (VERIFIED: MEDIA_IMAGE, key "alt").
 * - Collection and article images: nestedTranslatableResources of type
 *   COLLECTION_IMAGE / ARTICLE_IMAGE (key "alt"; how Shopify nests them is
 *   checked by the live test).
 * - Metafields: the owner's metafields with Metafield.translatable = true
 *   (2026-10), then translatableResourcesByIds (key "value").
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { TranslatableResourceType } from "../../types/admin.types";
import { kindOfGid } from "../../lib/resource-kinds";
import type { TranslatableResourceData } from "./translations-api";

type Admin = Pick<AdminApiContext, "graphql">;

export interface AttachedResource extends TranslatableResourceData {
  kind: "IMAGE" | "METAFIELD";
  /** "Image", or the metafield's name (its definition's, or from its key). */
  label: string;
  /** Technical identifier shown as detail ("namespace.key" for metafields). */
  detail?: string;
  previewUrl?: string | null;
  /** Metafield type (for example multi_line_text_field). */
  valueType?: string;
}


const PRODUCT_MEDIA = `#graphql
  query LinguvaProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 50) {
        nodes {
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const BY_IDS = `#graphql
  query LinguvaTranslatableByIds($ids: [ID!]!, $locale: String!) {
    translatableResourcesByIds(resourceIds: $ids, first: 100) {
      nodes {
        resourceId
        translatableContent {
          key
          value
          digest
          locale
          type
        }
        translations(locale: $locale) {
          key
          value
          outdated
          updatedAt
        }
      }
    }
  }
`;

const NESTED_IMAGES = `#graphql
  query LinguvaNestedImages($id: ID!, $type: TranslatableResourceType!, $locale: String!) {
    translatableResource(resourceId: $id) {
      nestedTranslatableResources(resourceType: $type, first: 10) {
        nodes {
          resourceId
        translatableContent {
          key
          value
          digest
          locale
          type
        }
        translations(locale: $locale) {
          key
          value
          outdated
          updatedAt
        }
        }
      }
    }
  }
`;

const METAFIELDS = `#graphql
  query LinguvaOwnerMetafields($id: ID!) {
    node(id: $id) {
      ... on HasMetafields {
        metafields(first: 100) {
          nodes {
            id
            namespace
            key
            type
            translatable
            definition {
              name
            }
          }
        }
      }
    }
  }
`;

type Node = {
  resourceId: string;
  translatableContent: Array<{ key: string; value?: string | null; digest?: string | null; locale: string; type: string }>;
  translations: Array<{ key: string; value?: string | null; outdated: boolean; updatedAt?: string | null }>;
};

function toData(node: Node): TranslatableResourceData {
  return {
    resourceId: node.resourceId,
    content: node.translatableContent.map((c) => ({
      key: c.key,
      value: c.value ?? null,
      digest: c.digest ?? null,
      locale: c.locale,
      type: c.type,
    })),
    translations: node.translations.map((t) => ({
      key: t.key,
      value: t.value ?? null,
      outdated: t.outdated,
      updatedAt: t.updatedAt ?? null,
    })),
  };
}

async function byIds(admin: Admin, ids: string[], locale: string): Promise<Map<string, TranslatableResourceData>> {
  if (!ids.length) return new Map();
  const response = await admin.graphql(BY_IDS, { variables: { ids, locale } });
  const nodes = ((await response.json()).data?.translatableResourcesByIds?.nodes ?? []) as Node[];
  return new Map(nodes.map((n) => [n.resourceId, toData(n)]));
}

const NESTED_IMAGE_TYPE: Partial<Record<string, TranslatableResourceType>> = {
  COLLECTION: "COLLECTION_IMAGE" as TranslatableResourceType,
  ARTICLE: "ARTICLE_IMAGE" as TranslatableResourceType,
};

export async function listImageResources(admin: Admin, parentGid: string, locale: string): Promise<AttachedResource[]> {
  const kind = kindOfGid(parentGid);
  if (kind === "PRODUCT") {
    const response = await admin.graphql(PRODUCT_MEDIA, { variables: { id: parentGid } });
    const media = ((await response.json()).data?.product?.media?.nodes ?? []) as Array<{ id?: string; image?: { url?: string | null } | null }>;
    const images = media.filter((m): m is { id: string; image?: { url?: string | null } | null } => Boolean(m.id));
    const data = await byIds(admin, images.map((m) => m.id), locale);
    return images.flatMap((m) => {
      const d = data.get(m.id);
      return d ? [{ ...d, kind: "IMAGE" as const, label: "Image", previewUrl: m.image?.url ?? null }] : [];
    });
  }
  const type = kind ? NESTED_IMAGE_TYPE[kind] : undefined;
  if (!type) return [];
  const response = await admin.graphql(NESTED_IMAGES, { variables: { id: parentGid, type, locale } });
  const nodes = ((await response.json()).data?.translatableResource?.nestedTranslatableResources?.nodes ?? []) as Node[];
  return nodes.map((n) => ({ ...toData(n), kind: "IMAGE" as const, label: "Image", previewUrl: null }));
}

export async function listTranslatableMetafields(admin: Admin, ownerGid: string, locale: string): Promise<AttachedResource[]> {
  const response = await admin.graphql(METAFIELDS, { variables: { id: ownerGid } });
  const all = ((await response.json()).data?.node?.metafields?.nodes ?? []) as Array<{
    id: string;
    namespace: string;
    key: string;
    type: string;
    translatable: boolean;
    definition?: { name?: string | null } | null;
  }>;
  // Shopify decides translatability (type and owner settings): never guess.
  const translatable = all.filter((m) => m.translatable);
  const data = await byIds(admin, translatable.map((m) => m.id), locale);
  return translatable.flatMap((m) => {
    const d = data.get(m.id);
    // The merchant's own name for the field when it has a definition; the
    // technical key otherwise (shown as detail either way).
    const technical = `${m.namespace}.${m.key}`;
    return d
      ? [{ ...d, kind: "METAFIELD" as const, label: m.definition?.name?.trim() || humanizeKey(m.key), detail: technical, valueType: m.type }]
      : [];
  });
}

/** "care_instructions" → "Care instructions". */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_.-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** Images and translatable metafields of a parent resource. */
export async function listAttachedResources(admin: Admin, parentGid: string, locale: string): Promise<AttachedResource[]> {
  const [images, metafields] = await Promise.all([
    listImageResources(admin, parentGid, locale),
    listTranslatableMetafields(admin, parentGid, locale),
  ]);
  return [...images, ...metafields];
}
