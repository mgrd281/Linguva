/**
 * Custom fields for the coverage scan: owners are listed page by page with
 * their metafields, and the ones Shopify marks translatable
 * (Metafield.translatable, Admin API 2026-10) are read with their
 * translations via translatableResourcesByIds. Ten owners with their first
 * 50 metafields keep a page under Shopify's query cost limit. Metafields of
 * any kind (an app's own data among them) count toward those 50, so an
 * owner with more is read on, 100 at a time: no translatable custom field
 * is left out of the figures (docs/COVERAGE_RULES.md).
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AccessDeniedError, isAccessDenied, ShopifyApiError, type TranslatableResourceData } from "./translations-api";
import { translatableByIds } from "./attached-resources";

type Admin = Pick<AdminApiContext, "graphql">;

export const METAFIELD_OWNER_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE"] as const;
export type MetafieldOwnerType = (typeof METAFIELD_OWNER_TYPES)[number];
export const OWNERS_PER_PAGE = 10;
/** metafields(first: 50) in the owner queries below. */
export const METAFIELDS_PER_OWNER = 50;
/** metafields(first: 100) when an owner's metafields are read on. */
export const METAFIELDS_PER_PAGE = 100;

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
          pageInfo {
            hasNextPage
            endCursor
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
          pageInfo {
            hasNextPage
            endCursor
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
          pageInfo {
            hasNextPage
            endCursor
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
          pageInfo {
            hasNextPage
            endCursor
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

const MORE_METAFIELDS_QUERY = `#graphql
  query LinguvaOwnerMetafieldsAfter($id: ID!, $after: String) {
    node(id: $id) {
      ... on HasMetafields {
        metafields(first: 100, after: $after) {
          nodes {
            id
            translatable
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
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

type MetafieldPage = { nodes: Array<{ id: string; translatable: boolean }>; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } | null };

/** An owner's metafields after `after` (null: the owner is gone since it was listed). */
async function moreMetafields(admin: Admin, owner: MetafieldOwnerType, ownerGid: string, after: string): Promise<MetafieldPage | null> {
  const response = await admin.graphql(MORE_METAFIELDS_QUERY, { variables: { id: ownerGid, after } }).catch((error: unknown) => {
    throw isAccessDenied(error) ? new AccessDeniedError(`${owner}_METAFIELD`) : error;
  });
  const body = (await response.json()) as { data?: { node?: { metafields?: MetafieldPage | null } | null } | null; errors?: unknown };
  if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(`${owner}_METAFIELD`);
  if (body.data && body.data.node === null) return null;
  const connection = body.data?.node?.metafields;
  if (!connection) throw new ShopifyApiError("metafields returned no data");
  return connection;
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
    data?: Record<string, { nodes: Array<{ id: string; metafields?: MetafieldPage | null }>; pageInfo: { hasNextPage: boolean; endCursor?: string | null } } | null>;
    errors?: unknown;
  };
  if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(`${options.owner}_METAFIELD`);
  const connection = body.data?.[field];
  if (!connection) throw new ShopifyApiError(`${field} returned no data`);
  const owners = connection.nodes;
  const ownerOf = new Map<string, string>();
  for (const o of owners) {
    let page: MetafieldPage | null = o.metafields ?? null;
    while (page) {
      for (const m of page.nodes) if (m.translatable) ownerOf.set(m.id, o.id);
      // Metafields of any kind fill the first page: read on until the last one.
      const next = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
      page = next ? await moreMetafields(admin, options.owner, o.id, next) : null;
    }
  }
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
