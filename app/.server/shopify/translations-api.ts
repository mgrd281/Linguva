import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { resourceGid, type ResourceKind } from "../../lib/resource-kinds";
import type { TranslatableResourceType } from "../../types/admin.types";

type Admin = Pick<AdminApiContext, "graphql">;

export class ShopifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyApiError";
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
  options: { resourceType: ResourceKind; locale: string; first?: number; after?: string | null },
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

/** Product GIDs are built server-side from a numeric id in the URL. */
export function productGid(id: string): string | null {
  return resourceGid("PRODUCT", id);
}

export { numericId } from "../../lib/resource-kinds";
