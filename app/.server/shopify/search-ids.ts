/**
 * Title search for the coverage drill-down: Shopify's own search returns the
 * ids of matching products, collections, pages, blog posts or blogs (at most
 * 100); coverage items are then filtered by those ids. Other types have no
 * search in the Admin API, so the page says search isn't available for them.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AccessDeniedError, isAccessDenied } from "./translations-api";

type Admin = Pick<AdminApiContext, "graphql">;

export const SEARCHABLE_TYPES = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"] as const;
export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export function isSearchableType(type: string | null | undefined): type is SearchableType {
  return (SEARCHABLE_TYPES as readonly string[]).includes(type ?? "");
}

// Static documents (validated against the Admin schema by graphql-codegen).
const PRODUCTS_SEARCH = `#graphql
  query LinguvaSearchProducts($query: String!) {
    products(first: 100, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const COLLECTIONS_SEARCH = `#graphql
  query LinguvaSearchCollections($query: String!) {
    collections(first: 100, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const PAGES_SEARCH = `#graphql
  query LinguvaSearchPages($query: String!) {
    pages(first: 100, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const ARTICLES_SEARCH = `#graphql
  query LinguvaSearchArticles($query: String!) {
    articles(first: 100, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const BLOGS_SEARCH = `#graphql
  query LinguvaSearchBlogs($query: String!) {
    blogs(first: 100, query: $query) {
      nodes {
        id
      }
    }
  }
`;

const SEARCH: Record<SearchableType, { query: string; field: string }> = {
  PRODUCT: { query: PRODUCTS_SEARCH, field: "products" },
  COLLECTION: { query: COLLECTIONS_SEARCH, field: "collections" },
  PAGE: { query: PAGES_SEARCH, field: "pages" },
  ARTICLE: { query: ARTICLES_SEARCH, field: "articles" },
  BLOG: { query: BLOGS_SEARCH, field: "blogs" },
};

/**
 * The merchant's words as a title search, each word as a prefix (Shopify's
 * search supports prefix wildcards: "title:jack*" finds "Jacket"). Search
 * syntax characters are removed, so the text can't change the query's
 * meaning (no field names, quotes, negation or operators).
 */
export function titleQuery(text: string): string | null {
  const words = text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w && !/^(AND|OR|NOT)$/.test(w))
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `title:${w}*`).join(" AND ");
}

export async function searchIds(admin: Admin, type: SearchableType, text: string): Promise<string[]> {
  const query = titleQuery(text.slice(0, 100));
  if (!query) return [];
  const { query: document, field } = SEARCH[type];
  const response = await admin.graphql(document, { variables: { query } });
  const body = (await response.json()) as { data?: Record<string, { nodes: Array<{ id: string }> } | null>; errors?: unknown };
  if (body.errors && isAccessDenied(body.errors)) throw new AccessDeniedError(type);
  return (body.data?.[field]?.nodes ?? []).map((n) => n.id);
}
