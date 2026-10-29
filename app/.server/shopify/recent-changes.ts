/**
 * Resources changed since a given time, oldest first (Admin API 2026-10).
 * Every type is filtered with the documented `updated_at` search term;
 * products, collections, pages and blog posts are also sorted by
 * UPDATED_AT (a sort key of each, VERIFIED in the schema), so a run that
 * stops at its limit knows up to when it got everything. Blogs have no such
 * sort key. Used by the periodic check for automatic translation.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AccessDeniedError, isAccessDenied, ShopifyApiError } from "./translations-api";

type Admin = Pick<AdminApiContext, "graphql">;

export const SWEPT_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"] as const;
export type SweptType = (typeof SWEPT_TYPES)[number];

const PAGE_SIZE = 100;

const PRODUCTS = `#graphql
  query LinguvaRecentProducts($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const COLLECTIONS = `#graphql
  query LinguvaRecentCollections($first: Int!, $after: String, $query: String!) {
    collections(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const PAGES = `#graphql
  query LinguvaRecentPages($first: Int!, $after: String, $query: String!) {
    pages(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
      nodes { id updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const ARTICLES = `#graphql
  query LinguvaRecentArticles($first: Int!, $after: String, $query: String!) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
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

/** The whole second of an ISO time (Shopify's update times have seconds). */
const second = (iso: string) => Math.floor(Date.parse(iso) / 1000);

interface Connection {
  nodes: Array<{ id: string; updatedAt: string }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/**
 * Resources of one type changed after `since`, oldest first, about `max`.
 * `capped`: more changed than that; `through` is then the update time up to
 * which every change was returned (the next run continues after it), and
 * null for blogs, which can't be read in that order. The cut never splits a
 * second: changes made in the same second as the last one returned all come
 * along, so continuing after `through` loses nothing.
 */
export async function changedSince(
  admin: Admin,
  type: SweptType,
  since: Date,
  max: number,
  /** Called before every request (the shop's Shopify rate limit); may throw RateLimitedError. */
  beforeRequest?: () => Promise<void>,
): Promise<{ changes: Array<{ id: string; updatedAt: string }>; capped: boolean; through: Date | null }> {
  const { document, field } = QUERIES[type];
  const changes: Array<{ id: string; updatedAt: string }> = [];
  let after: string | null = null;
  for (;;) {
    await beforeRequest?.();
    const variables: Record<string, unknown> = { first: PAGE_SIZE, after, query: `updated_at:>'${since.toISOString()}'` };
    const response = await admin.graphql(document, { variables }).catch((error: unknown) => {
      // The Shopify library throws on GraphQL errors (a missing scope among them).
      throw isAccessDenied(error) ? new AccessDeniedError(type) : error;
    });
    const body = (await response.json()) as { data?: Record<string, Connection | undefined>; errors?: unknown };
    if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(type);
    const connection = body.data?.[field];
    if (!connection) throw new ShopifyApiError(`${field} returned no data`);
    for (const node of connection.nodes) {
      // The search term filters already; this guards against an inclusive comparison (whole seconds, as Shopify compares).
      if (second(node.updatedAt) <= second(since.toISOString())) continue;
      const last = changes[changes.length - 1];
      if (changes.length >= max && (type === "BLOG" || !last || second(node.updatedAt) !== second(last.updatedAt))) {
        // Sorted by update time: everything up to the last one returned is complete.
        return { changes, capped: true, through: type === "BLOG" || !last ? null : new Date(second(last.updatedAt) * 1000) };
      }
      changes.push({ id: node.id, updatedAt: node.updatedAt });
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return { changes, capped: false, through: null };
    after = connection.pageInfo.endCursor;
  }
}
