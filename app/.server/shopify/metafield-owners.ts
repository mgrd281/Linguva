/**
 * Custom fields for the coverage scan: owners are listed page by page with
 * their metafields, and the ones Shopify marks translatable
 * (Metafield.translatable, Admin API 2026-10) are read with their
 * translations via translatableResourcesByIds. Ten owners with up to 50
 * metafields each keep a page under Shopify's query cost limit; owners with
 * more than 50 metafields are counted with their first 50 (documented in
 * docs/COVERAGE_RULES.md).
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AccessDeniedError, isAccessDenied, ShopifyApiError, type TranslatableResourceData } from "./translations-api";
import { translatableByIds } from "./attached-resources";

type Admin = Pick<AdminApiContext, "graphql">;

export const METAFIELD_OWNER_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE"] as const;
export type MetafieldOwnerType = (typeof METAFIELD_OWNER_TYPES)[number];
export const OWNERS_PER_PAGE = 10;
/** metafields(first: 50) in the queries below. */
export const METAFIELDS_PER_OWNER = 50;

// Static documents (validated against the Admin schema by graphql-codegen).
const PRODUCTS_QUERY = `#graphql
  query LinguvaMetafieldOwnersProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        id
        metafields(first: 50) {
          nodes {
            id
            translatable
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query LinguvaMetafieldOwnersCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      nodes {
        id
        metafields(first: 50) {
          nodes {
            id
            translatable
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PAGES_QUERY = `#graphql
  query LinguvaMetafieldOwnersPages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      nodes {
        id
        metafields(first: 50) {
          nodes {
            id
            translatable
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ARTICLES_QUERY = `#graphql
  query LinguvaMetafieldOwnersArticles($first: Int!, $after: String) {
    articles(first: $first, after: $after) {
      nodes {
        id
        metafields(first: 50) {
          nodes {
            id
            translatable
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const QUERIES: Record<MetafieldOwnerType, { query: string; field: string }> = {
  PRODUCT: { query: PRODUCTS_QUERY, field: "products" },
  COLLECTION: { query: COLLECTIONS_QUERY, field: "collections" },
  PAGE: { query: PAGES_QUERY, field: "pages" },
  ARTICLE: { query: ARTICLES_QUERY, field: "articles" },
};

export interface OwnedMetafield extends TranslatableResourceData {
  ownerGid: string;
}

export async function listOwnerMetafields(
  admin: Admin,
  options: { owner: MetafieldOwnerType; locale: string; after?: string | null; first?: number },
): Promise<{ resources: OwnedMetafield[]; owners: number; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> {
  const { query, field } = QUERIES[options.owner];
  const response = await admin
    .graphql(query, { variables: { first: options.first ?? OWNERS_PER_PAGE, after: options.after ?? null } })
    .catch((error: unknown) => {
      // The Shopify library throws on GraphQL errors (a missing scope among them).
      throw isAccessDenied(error) ? new AccessDeniedError(`${options.owner}_METAFIELD`) : error;
    });
  const body = (await response.json()) as {
    data?: Record<string, { nodes: Array<{ id: string; metafields?: { nodes: Array<{ id: string; translatable: boolean }> } | null }>; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } | null>;
    errors?: unknown;
  };
  if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(`${options.owner}_METAFIELD`);
  const connection = body.data?.[field];
  if (!connection) throw new ShopifyApiError(`${field} returned no data`);
  const owners = connection.nodes;
  const ownerOf = new Map<string, string>();
  for (const o of owners) for (const m of o.metafields?.nodes ?? []) if (m.translatable) ownerOf.set(m.id, o.id);
  const data = await translatableByIds(admin, [...ownerOf.keys()], options.locale);
  const resources: OwnedMetafield[] = [];
  for (const [id, ownerGid] of ownerOf) {
    const d = data.get(id);
    if (d) resources.push({ ...d, ownerGid });
  }
  return {
    resources,
    owners: owners.length,
    pageInfo: { hasNextPage: connection.pageInfo.hasNextPage, endCursor: connection.pageInfo.endCursor ?? null },
  };
}
