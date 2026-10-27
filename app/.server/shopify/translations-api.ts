import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { resourceGid, type TranslatableKind } from "../../lib/resource-kinds";
import type { TranslatableResourceType } from "../../types/admin.types";

type Admin = Pick<AdminApiContext, "graphql">;

export class ShopifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

/** The app lacks the access scope for a resource type. */
export class AccessDeniedError extends Error {
  constructor(readonly resourceType: string) {
    super(`Access denied for ${resourceType}`);
    this.name = "AccessDeniedError";
  }
}

export interface TranslatableField {
  key: string;
  value: string | null;
  digest: string | null;
  locale: string;
  type: string;
}

export interface ExistingTranslation {
  key: string;
  value: string | null;
  outdated: boolean;
  updatedAt: string | null;
}

export interface TranslatableResourceData {
  resourceId: string;
  content: TranslatableField[];
  translations: ExistingTranslation[];
}

const LIST_QUERY = `#graphql
  query LinguvaTranslatableResources(
    $resourceType: TranslatableResourceType!
    $first: Int!
    $after: String
    $locale: String!
  ) {
    translatableResources(resourceType: $resourceType, first: $first, after: $after) {
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const RESOURCE_QUERY = `#graphql
  query LinguvaTranslatableResource($resourceId: ID!, $locale: String!) {
    translatableResource(resourceId: $resourceId) {
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
`;

const REGISTER_MUTATION = `#graphql
  mutation LinguvaTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations {
        key
        locale
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const REMOVE_MUTATION = `#graphql
  mutation LinguvaTranslationsRemove($resourceId: ID!, $keys: [String!]!, $locales: [String!]!) {
    translationsRemove(resourceId: $resourceId, translationKeys: $keys, locales: $locales) {
      translations {
        key
        locale
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

function toResource(node: {
  resourceId: string;
  translatableContent: Array<{
    key: string;
    value?: string | null;
    digest?: string | null;
    locale: string;
    type: string;
  }>;
  translations: Array<{
    key: string;
    value?: string | null;
    outdated: boolean;
    updatedAt?: string | null;
  }>;
}): TranslatableResourceData {
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

export async function listTranslatableResources(
  admin: Admin,
  options: { resourceType: TranslatableKind | "MEDIA_IMAGE" | "COLLECTION_IMAGE" | "ARTICLE_IMAGE"; locale: string; first?: number; after?: string | null },
) {
  const response = await admin.graphql(LIST_QUERY, {
    variables: {
      // ResourceKind values are TranslatableResourceType enum names.
      resourceType: options.resourceType as TranslatableResourceType,
      first: options.first ?? 25,
      after: options.after ?? null,
      locale: options.locale,
    },
  });
  const body = await response.json();
  const errors = (body as { errors?: unknown }).errors;
  if (errors && isAccessDenied(errors)) throw new AccessDeniedError(String(options.resourceType));
  const connection = body.data?.translatableResources;
  if (!connection) throw new ShopifyApiError("translatableResources returned no data");
  return {
    resources: connection.nodes.map(toResource),
    pageInfo: {
      hasNextPage: connection.pageInfo.hasNextPage,
      endCursor: connection.pageInfo.endCursor ?? null,
    },
  };
}

export async function getTranslatableResource(
  admin: Admin,
  resourceId: string,
  locale: string,
): Promise<TranslatableResourceData | null> {
  const response = await admin.graphql(RESOURCE_QUERY, { variables: { resourceId, locale } });
  const body = await response.json();
  const node = body.data?.translatableResource;
  return node ? toResource(node) : null;
}

export interface TranslationWrite {
  key: string;
  value: string;
  translatableContentDigest: string;
}

export async function registerTranslations(
  admin: Admin,
  resourceId: string,
  locale: string,
  writes: readonly TranslationWrite[],
) {
  if (writes.length > 250) {
    // Shopify caps every array input at 250 items.
    throw new ShopifyApiError("At most 250 translations per call");
  }
  const response = await admin.graphql(REGISTER_MUTATION, {
    variables: {
      resourceId,
      translations: writes.map((w) => ({ ...w, locale })),
    },
  });
  const body = await response.json();
  const result = body.data?.translationsRegister;
  if (!result) throw new ShopifyApiError("translationsRegister returned no data");
  return {
    translations: (result.translations ?? []).map((t) => ({
      key: t.key,
      locale: t.locale,
      value: t.value ?? null,
    })),
    userErrors: result.userErrors.map((e) => ({
      field: e.field ?? null,
      message: e.message,
      code: e.code ?? null,
    })),
  };
}

/** Removes the market-independent translation of the given keys for one locale. */
export async function removeTranslations(admin: Admin, resourceId: string, locale: string, keys: readonly string[]) {
  const response = await admin.graphql(REMOVE_MUTATION, {
    variables: { resourceId, keys: [...keys], locales: [locale] },
  });
  const body = await response.json();
  const result = body.data?.translationsRemove;
  if (!result) throw new ShopifyApiError("translationsRemove returned no data");
  return {
    removed: (result.translations ?? []).map((t) => t.key),
    userErrors: result.userErrors.map((e) => ({ message: e.message, code: e.code ?? null })),
  };
}

/** Product GIDs are built server-side from a numeric id in the URL. */
export function productGid(id: string): string | null {
  return resourceGid("PRODUCT", id);
}

export { numericId } from "../../lib/resource-kinds";

const PROBE_QUERY = `#graphql
  query LinguvaProbeTranslatable($resourceType: TranslatableResourceType!) {
    translatableResources(resourceType: $resourceType, first: 1) {
      nodes {
        resourceId
      }
    }
  }
`;

/** Shopify refused the query for lack of an access scope. */
export function isAccessDenied(errorOrBody: unknown): boolean {
  const text =
    errorOrBody instanceof Error
      ? JSON.stringify(errorOrBody, Object.getOwnPropertyNames(errorOrBody))
      : JSON.stringify(errorOrBody ?? "");
  return /ACCESS_DENIED|access denied|requires? .*access scope/i.test(text);
}

export type ProbeResult = { status: "available"; hasItems: boolean } | { status: "denied" };

/** Whether the shop has resources of a type, and whether the app may read them. */
export async function probeTranslatableType(admin: Admin, resourceType: TranslatableKind): Promise<ProbeResult> {
  let body: { data?: { translatableResources?: { nodes: unknown[] } | null }; errors?: unknown };
  try {
    const response = await admin.graphql(PROBE_QUERY, { variables: { resourceType: resourceType as TranslatableResourceType } });
    body = await response.json();
  } catch (error) {
    if (isAccessDenied(error)) return { status: "denied" };
    throw error;
  }
  if (body.errors && isAccessDenied(body.errors)) return { status: "denied" };
  const nodes = body.data?.translatableResources?.nodes;
  if (!nodes) throw new ShopifyApiError("translatableResources returned no data");
  return { status: "available", hasItems: nodes.length > 0 };
}
