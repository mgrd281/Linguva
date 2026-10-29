/**
 * What the language pages show of the items they list, read live from
 * Shopify for what is on screen only (coverage stores no merchant text):
 * names and their translations, pictures, and custom fields' names, in one
 * nodes() read per 100 items. A product's picture is its featured media's
 * preview image (featuredImage is deprecated); collections and blog posts
 * have an image, product images are one; pages and blogs have none.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { LinguvaPreviewNodesQuery } from "../../types/admin.generated";
import { humanizeKey } from "./attached-resources";

type Admin = Pick<AdminApiContext, "graphql">;

// __typename inside each fragment: a node of another type comes back empty.
const PREVIEW_NODES = `#graphql
  query LinguvaPreviewNodes($ids: [ID!]!, $locale: String!) {
    nodes(ids: $ids) {
      ... on Product {
        __typename
        id
        title
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on Collection {
        __typename
        id
        title
        image {
          url
          altText
        }
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on Article {
        __typename
        id
        title
        image {
          url
          altText
        }
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on Page {
        __typename
        id
        title
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on Blog {
        __typename
        id
        title
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on MediaImage {
        __typename
        id
        alt
        image {
          url
          altText
        }
        translations(locale: $locale) {
          key
          value
        }
      }
      ... on Metafield {
        __typename
        id
        key
        definition {
          name
        }
      }
    }
  }
`;

/** Coverage types whose names and pictures are read here (custom fields only for their names); any other by its translatable content. */
export const PREVIEW_NODE_TYPES: ReadonlySet<string> = new Set(["PRODUCT", "COLLECTION", "ARTICLE", "BLOG", "PAGE", "MEDIA_IMAGE"]);

/** Ids per call (nodes() takes up to 250). */
const IDS_PER_CALL = 100;

export interface PreviewNode {
  /** Its name in the original language (a product image: its description); null for a custom field. */
  text: string | null;
  /** The key of that text among the item's translatable texts. */
  key: "title" | "alt" | null;
  /** That text in the language as customers see it (an outdated translation too); null without one. */
  translated: string | null;
  /** Its picture, as Shopify's CDN has it. */
  image: { url: string; alt: string | null } | null;
  /** A custom field's name: its definition's, else from its key. */
  label: string | null;
}

const trimmed = (value: string | null | undefined) => value?.trim() || null;

function previewNode(node: NonNullable<LinguvaPreviewNodesQuery["nodes"][number]>): PreviewNode | null {
  const translation = (key: string, translations: ReadonlyArray<{ key: string; value?: string | null }>) =>
    trimmed(translations.find((t) => t.key === key)?.value);
  const picture = (image: { url: string; altText?: string | null } | null | undefined) => (image ? { url: image.url, alt: trimmed(image.altText) } : null);
  switch (node.__typename) {
    case "Product":
      return { text: trimmed(node.title), key: "title", translated: translation("title", node.translations), image: picture(node.featuredMedia?.preview?.image), label: null };
    case "Collection":
    case "Article":
      return { text: trimmed(node.title), key: "title", translated: translation("title", node.translations), image: picture(node.image), label: null };
    case "Page":
    case "Blog":
      return { text: trimmed(node.title), key: "title", translated: translation("title", node.translations), image: null, label: null };
    case "MediaImage":
      return { text: trimmed(node.alt), key: "alt", translated: translation("alt", node.translations), image: picture(node.image), label: null };
    case "Metafield":
      return { text: null, key: null, translated: null, image: null, label: trimmed(node.definition?.name) ?? humanizeKey(node.key) };
    default:
      return null;
  }
}

/** The given resources as the language pages show them, by GID; one Shopify doesn't return (deleted) is missing. */
export async function readPreviewNodes(admin: Admin, ids: readonly string[], locale: string): Promise<Map<string, PreviewNode>> {
  const all = new Map<string, PreviewNode>();
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    const response = await admin.graphql(PREVIEW_NODES, { variables: { ids: ids.slice(i, i + IDS_PER_CALL), locale } });
    const body = await response.json();
    for (const node of body.data?.nodes ?? []) {
      const shown = node ? previewNode(node) : null;
      if (node && shown) all.set(node.id, shown);
    }
  }
  return all;
}
