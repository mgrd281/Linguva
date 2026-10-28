/**
 * Resources changed since a given time, newest first (Admin API 2026-10).
 * Products, collections, pages and blog posts are sorted by UPDATED_AT
 * (a sort key of each, VERIFIED in the schema); blogs have no such sort key
 * and are filtered with the documented `updated_at` search term instead.
 * Used by the periodic check for automatic translation.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AccessDeniedError, isAccessDenied, ShopifyApiError } from "./translations-api";

type Admin = Pick<AdminApiContext, "graphql">;

export const SWEPT_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"] as const;
export type SweptType = (typeof SWEPT_TYPES)[number];

const PAGE_SIZE = 100;

const PRODUCTS = `#graphql
  query LinguvaRecentProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const COLLECTIONS = `#graphql
  query LinguvaRecentCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const PAGES = `#graphql
  query LinguvaRecentPages($first: Int!, $after: String) {
    pages(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const ARTICLES = `#graphql
  query LinguvaRecentArticles($first: Int!, $after: String) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const BLOGS = `#graphql
  query LinguvaRecentBlogs($first: Int!, $after: String, $query: String!) {
    blogs(first: $first, after: $after, query: $query) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const QUERIES: Record<SweptType, { document: string; field: "products" | "collections" | "pages" | "articles" | "blogs" }> = {
  PRODUCT: { document: PRODUCTS, field: "products" },
  COLLECTION: { document: COLLECTIONS, field: "collections" },
  PAGE: { document: PAGES, field: "pages" },
  ARTICLE: { document: ARTICLES, field: "articles" },
  BLOG: { document: BLOGS, field: "blogs" },
};

interface Connection {
  nodes: Array<{ id: string; updatedAt: string }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/**
 * GIDs of resources of one type changed after `since`, newest first, at
 * most `max`. `capped`: more changed than that (the rest is left to a
 * "Translate all" run; the caller logs it).
 */
export async function changedSince(
  admin: Admin,
  type: SweptType,
  since: Date,
  max: number,
): Promise<{ ids: string[]; capped: boolean }> {
  const { document, field } = QUERIES[type];
  const ids: string[] = [];
  let after: string | null = null;
  for (;;) {
    const variables: Record<string, unknown> = { first: PAGE_SIZE, after };
    if (type === "BLOG") variables.query = `updated_at:>'${since.toISOString()}'`;
    const response = await admin.graphql(document, { variables });
    const body = (await response.json()) as { data?: Record<string, Connection | undefined>; errors?: unknown };
    if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(type);
    const connection = body.data?.[field];
    if (!connection) throw new ShopifyApiError(`${field} returned no data`);
    for (const node of connection.nodes) {
      if (new Date(node.updatedAt) <= since) {
        // Sorted newest first: everything after this changed earlier. Blogs
        // are filtered, not sorted: skip just this one.
        if (type !== "BLOG") return { ids, capped: false };
        continue;
      }
      if (ids.length === max) return { ids, capped: true };
      ids.push(node.id);
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return { ids, capped: false };
    after = connection.pageInfo.endCursor;
  }
}
