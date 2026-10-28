/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type LinguvaShopIdQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopIdQuery = { shop: Pick<AdminTypes.Shop, 'id'> };

export type LinguvaShopLocalesQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopLocalesQuery = { shopLocales: Array<Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'primary' | 'published'>> };

export type LinguvaMarketsQueryVariables = AdminTypes.Exact<{
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type LinguvaMarketsQuery = { markets: { nodes: Array<(
      Pick<AdminTypes.Market, 'id' | 'name' | 'handle' | 'status'>
      & { webPresences: { nodes: Array<(
          Pick<AdminTypes.MarketWebPresence, 'id' | 'subfolderSuffix'>
          & { domain?: AdminTypes.Maybe<Pick<AdminTypes.Domain, 'host'>>, defaultLocale: Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'published'>, alternateLocales: Array<Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'published'>>, rootUrls: Array<Pick<AdminTypes.MarketWebPresenceRootUrl, 'locale' | 'url'>> }
        )> } }
    )>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaProductMediaQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type LinguvaProductMediaQuery = { product?: AdminTypes.Maybe<{ media: { nodes: Array<(
        Pick<AdminTypes.MediaImage, 'id'>
        & { image?: AdminTypes.Maybe<Pick<AdminTypes.Image, 'url'>> }
      )> } }> };

export type LinguvaTranslatableByIdsQueryVariables = AdminTypes.Exact<{
  ids: Array<AdminTypes.Scalars['ID']['input']> | AdminTypes.Scalars['ID']['input'];
  locale: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaTranslatableByIdsQuery = { translatableResourcesByIds: { nodes: Array<(
      Pick<AdminTypes.TranslatableResource, 'resourceId'>
      & { translatableContent: Array<Pick<AdminTypes.TranslatableContent, 'key' | 'value' | 'digest' | 'locale' | 'type'>>, translations: Array<Pick<AdminTypes.Translation, 'key' | 'value' | 'outdated' | 'updatedAt'>> }
    )> } };

export type LinguvaNestedImagesQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
  type: AdminTypes.TranslatableResourceType;
  locale: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaNestedImagesQuery = { translatableResource?: AdminTypes.Maybe<{ nestedTranslatableResources: { nodes: Array<(
        Pick<AdminTypes.TranslatableResource, 'resourceId'>
        & { translatableContent: Array<Pick<AdminTypes.TranslatableContent, 'key' | 'value' | 'digest' | 'locale' | 'type'>>, translations: Array<Pick<AdminTypes.Translation, 'key' | 'value' | 'outdated' | 'updatedAt'>> }
      )> } }> };

export type LinguvaOwnerMetafieldsQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type LinguvaOwnerMetafieldsQuery = { node?: AdminTypes.Maybe<{ metafields: { nodes: Array<(
        Pick<AdminTypes.Metafield, 'id' | 'namespace' | 'key' | 'type' | 'translatable'>
        & { definition?: AdminTypes.Maybe<Pick<AdminTypes.MetafieldDefinition, 'name'>> }
      )> } } | { metafields: { nodes: Array<(
        Pick<AdminTypes.Metafield, 'id' | 'namespace' | 'key' | 'type' | 'translatable'>
        & { definition?: AdminTypes.Maybe<Pick<AdminTypes.MetafieldDefinition, 'name'>> }
      )> } }> };

export type LinguvaRecentProductsQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type LinguvaRecentProductsQuery = { products: { nodes: Array<Pick<AdminTypes.Product, 'id' | 'updatedAt'>>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaRecentCollectionsQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type LinguvaRecentCollectionsQuery = { collections: { nodes: Array<Pick<AdminTypes.Collection, 'id' | 'updatedAt'>>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaRecentPagesQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type LinguvaRecentPagesQuery = { pages: { nodes: Array<Pick<AdminTypes.Page, 'id' | 'updatedAt'>>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaRecentArticlesQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type LinguvaRecentArticlesQuery = { articles: { nodes: Array<Pick<AdminTypes.Article, 'id' | 'updatedAt'>>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaRecentBlogsQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
  query: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaRecentBlogsQuery = { blogs: { nodes: Array<Pick<AdminTypes.Blog, 'id' | 'updatedAt'>>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaTranslatableResourcesQueryVariables = AdminTypes.Exact<{
  resourceType: AdminTypes.TranslatableResourceType;
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
  locale: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaTranslatableResourcesQuery = { translatableResources: { nodes: Array<(
      Pick<AdminTypes.TranslatableResource, 'resourceId'>
      & { translatableContent: Array<Pick<AdminTypes.TranslatableContent, 'key' | 'value' | 'digest' | 'locale' | 'type'>>, translations: Array<Pick<AdminTypes.Translation, 'key' | 'value' | 'outdated' | 'updatedAt'>> }
    )>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type LinguvaTranslatableResourceQueryVariables = AdminTypes.Exact<{
  resourceId: AdminTypes.Scalars['ID']['input'];
  locale: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaTranslatableResourceQuery = { translatableResource?: AdminTypes.Maybe<(
    Pick<AdminTypes.TranslatableResource, 'resourceId'>
    & { translatableContent: Array<Pick<AdminTypes.TranslatableContent, 'key' | 'value' | 'digest' | 'locale' | 'type'>>, translations: Array<Pick<AdminTypes.Translation, 'key' | 'value' | 'outdated' | 'updatedAt'>> }
  )> };

export type LinguvaTranslationsRegisterMutationVariables = AdminTypes.Exact<{
  resourceId: AdminTypes.Scalars['ID']['input'];
  translations: Array<AdminTypes.TranslationInput> | AdminTypes.TranslationInput;
}>;


export type LinguvaTranslationsRegisterMutation = { translationsRegister?: AdminTypes.Maybe<{ translations?: AdminTypes.Maybe<Array<Pick<AdminTypes.Translation, 'key' | 'locale' | 'value'>>>, userErrors: Array<Pick<AdminTypes.TranslationUserError, 'field' | 'message' | 'code'>> }> };

export type LinguvaTranslationsRemoveMutationVariables = AdminTypes.Exact<{
  resourceId: AdminTypes.Scalars['ID']['input'];
  keys: Array<AdminTypes.Scalars['String']['input']> | AdminTypes.Scalars['String']['input'];
  locales: Array<AdminTypes.Scalars['String']['input']> | AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaTranslationsRemoveMutation = { translationsRemove?: AdminTypes.Maybe<{ translations?: AdminTypes.Maybe<Array<Pick<AdminTypes.Translation, 'key' | 'locale'>>>, userErrors: Array<Pick<AdminTypes.TranslationUserError, 'field' | 'message' | 'code'>> }> };

export type LinguvaProbeTranslatableQueryVariables = AdminTypes.Exact<{
  resourceType: AdminTypes.TranslatableResourceType;
}>;


export type LinguvaProbeTranslatableQuery = { translatableResources: { nodes: Array<Pick<AdminTypes.TranslatableResource, 'resourceId'>> } };

export type LinguvaShopIdentityQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopIdentityQuery = { shop: Pick<AdminTypes.Shop, 'id' | 'name'> };

export type LinguvaLiveShopFactsQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaLiveShopFactsQuery = { shop: (
    Pick<AdminTypes.Shop, 'myshopifyDomain'>
    & { plan: Pick<AdminTypes.ShopPlan, 'partnerDevelopment' | 'publicDisplayName'> }
  ) };

export type LinguvaLiveProductCreateMutationVariables = AdminTypes.Exact<{
  product: AdminTypes.ProductCreateInput;
}>;


export type LinguvaLiveProductCreateMutation = { productCreate?: AdminTypes.Maybe<{ product?: AdminTypes.Maybe<Pick<AdminTypes.Product, 'id' | 'handle'>>, userErrors: Array<Pick<AdminTypes.UserError, 'field' | 'message'>> }> };

export type LinguvaLiveProductUpdateMutationVariables = AdminTypes.Exact<{
  product: AdminTypes.ProductUpdateInput;
}>;


export type LinguvaLiveProductUpdateMutation = { productUpdate?: AdminTypes.Maybe<{ product?: AdminTypes.Maybe<Pick<AdminTypes.Product, 'id'>>, userErrors: Array<Pick<AdminTypes.UserError, 'field' | 'message'>> }> };

export type LinguvaLiveProductDeleteMutationVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type LinguvaLiveProductDeleteMutation = { productDelete?: AdminTypes.Maybe<(
    Pick<AdminTypes.ProductDeletePayload, 'deletedProductId'>
    & { userErrors: Array<Pick<AdminTypes.UserError, 'field' | 'message'>> }
  )> };

export type LinguvaLiveCollectionCreateMutationVariables = AdminTypes.Exact<{
  collection: AdminTypes.CollectionCreateInput;
}>;


export type LinguvaLiveCollectionCreateMutation = { collectionCreate?: AdminTypes.Maybe<{ collection?: AdminTypes.Maybe<Pick<AdminTypes.Collection, 'id' | 'handle'>>, userErrors: Array<Pick<AdminTypes.UserError, 'field' | 'message'>> }> };

export type LinguvaLiveCollectionDeleteMutationVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type LinguvaLiveCollectionDeleteMutation = { collectionDelete?: AdminTypes.Maybe<(
    Pick<AdminTypes.CollectionDeletePayload, 'deletedCollectionId'>
    & { userErrors: Array<Pick<AdminTypes.UserError, 'field' | 'message'>> }
  )> };

export type LinguvaLiveTranslationsRemoveMutationVariables = AdminTypes.Exact<{
  resourceId: AdminTypes.Scalars['ID']['input'];
  keys: Array<AdminTypes.Scalars['String']['input']> | AdminTypes.Scalars['String']['input'];
  locales: Array<AdminTypes.Scalars['String']['input']> | AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaLiveTranslationsRemoveMutation = { translationsRemove?: AdminTypes.Maybe<{ translations?: AdminTypes.Maybe<Array<Pick<AdminTypes.Translation, 'key' | 'locale'>>>, userErrors: Array<Pick<AdminTypes.TranslationUserError, 'field' | 'message' | 'code'>> }> };

interface GeneratedQueryTypes {
  "#graphql\n  query LinguvaShopId {\n    shop {\n      id\n    }\n  }\n": {return: LinguvaShopIdQuery, variables: LinguvaShopIdQueryVariables},
  "#graphql\n  query LinguvaShopLocales {\n    shopLocales {\n      locale\n      name\n      primary\n      published\n    }\n  }\n": {return: LinguvaShopLocalesQuery, variables: LinguvaShopLocalesQueryVariables},
  "#graphql\n  query LinguvaMarkets($after: String) {\n    markets(first: 50, after: $after) {\n      nodes {\n        id\n        name\n        handle\n        status\n        webPresences(first: 10) {\n          nodes {\n            id\n            subfolderSuffix\n            domain {\n              host\n            }\n            defaultLocale {\n              locale\n              name\n              published\n            }\n            alternateLocales {\n              locale\n              name\n              published\n            }\n            rootUrls {\n              locale\n              url\n            }\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": {return: LinguvaMarketsQuery, variables: LinguvaMarketsQueryVariables},
  "#graphql\n  query LinguvaProductMedia($id: ID!) {\n    product(id: $id) {\n      media(first: 50) {\n        nodes {\n          ... on MediaImage {\n            id\n            image {\n              url\n            }\n          }\n        }\n      }\n    }\n  }\n": {return: LinguvaProductMediaQuery, variables: LinguvaProductMediaQueryVariables},
  "#graphql\n  query LinguvaTranslatableByIds($ids: [ID!]!, $locale: String!) {\n    translatableResourcesByIds(resourceIds: $ids, first: 100) {\n      nodes {\n        resourceId\n        translatableContent {\n          key\n          value\n          digest\n          locale\n          type\n        }\n        translations(locale: $locale) {\n          key\n          value\n          outdated\n          updatedAt\n        }\n      }\n    }\n  }\n": {return: LinguvaTranslatableByIdsQuery, variables: LinguvaTranslatableByIdsQueryVariables},
  "#graphql\n  query LinguvaNestedImages($id: ID!, $type: TranslatableResourceType!, $locale: String!) {\n    translatableResource(resourceId: $id) {\n      nestedTranslatableResources(resourceType: $type, first: 10) {\n        nodes {\n          resourceId\n        translatableContent {\n          key\n          value\n          digest\n          locale\n          type\n        }\n        translations(locale: $locale) {\n          key\n          value\n          outdated\n          updatedAt\n        }\n        }\n      }\n    }\n  }\n": {return: LinguvaNestedImagesQuery, variables: LinguvaNestedImagesQueryVariables},
  "#graphql\n  query LinguvaOwnerMetafields($id: ID!) {\n    node(id: $id) {\n      ... on HasMetafields {\n        metafields(first: 100) {\n          nodes {\n            id\n            namespace\n            key\n            type\n            translatable\n            definition {\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n": {return: LinguvaOwnerMetafieldsQuery, variables: LinguvaOwnerMetafieldsQueryVariables},
  "#graphql\n  query LinguvaRecentProducts($first: Int!, $after: String) {\n    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {\n      nodes { id updatedAt }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n": {return: LinguvaRecentProductsQuery, variables: LinguvaRecentProductsQueryVariables},
  "#graphql\n  query LinguvaRecentCollections($first: Int!, $after: String) {\n    collections(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {\n      nodes { id updatedAt }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n": {return: LinguvaRecentCollectionsQuery, variables: LinguvaRecentCollectionsQueryVariables},
  "#graphql\n  query LinguvaRecentPages($first: Int!, $after: String) {\n    pages(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {\n      nodes { id updatedAt }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n": {return: LinguvaRecentPagesQuery, variables: LinguvaRecentPagesQueryVariables},
  "#graphql\n  query LinguvaRecentArticles($first: Int!, $after: String) {\n    articles(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {\n      nodes { id updatedAt }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n": {return: LinguvaRecentArticlesQuery, variables: LinguvaRecentArticlesQueryVariables},
  "#graphql\n  query LinguvaRecentBlogs($first: Int!, $after: String, $query: String!) {\n    blogs(first: $first, after: $after, query: $query) {\n      nodes { id updatedAt }\n      pageInfo { hasNextPage endCursor }\n    }\n  }\n": {return: LinguvaRecentBlogsQuery, variables: LinguvaRecentBlogsQueryVariables},
  "#graphql\n  query LinguvaTranslatableResources(\n    $resourceType: TranslatableResourceType!\n    $first: Int!\n    $after: String\n    $locale: String!\n  ) {\n    translatableResources(resourceType: $resourceType, first: $first, after: $after) {\n      nodes {\n        resourceId\n        translatableContent {\n          key\n          value\n          digest\n          locale\n          type\n        }\n        translations(locale: $locale) {\n          key\n          value\n          outdated\n          updatedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": {return: LinguvaTranslatableResourcesQuery, variables: LinguvaTranslatableResourcesQueryVariables},
  "#graphql\n  query LinguvaTranslatableResource($resourceId: ID!, $locale: String!) {\n    translatableResource(resourceId: $resourceId) {\n      resourceId\n      translatableContent {\n        key\n        value\n        digest\n        locale\n        type\n      }\n      translations(locale: $locale) {\n        key\n        value\n        outdated\n        updatedAt\n      }\n    }\n  }\n": {return: LinguvaTranslatableResourceQuery, variables: LinguvaTranslatableResourceQueryVariables},
  "#graphql\n  query LinguvaProbeTranslatable($resourceType: TranslatableResourceType!) {\n    translatableResources(resourceType: $resourceType, first: 1) {\n      nodes {\n        resourceId\n      }\n    }\n  }\n": {return: LinguvaProbeTranslatableQuery, variables: LinguvaProbeTranslatableQueryVariables},
  "#graphql\n        query LinguvaShopIdentity {\n          shop {\n            id\n            name\n          }\n        }": {return: LinguvaShopIdentityQuery, variables: LinguvaShopIdentityQueryVariables},
  "#graphql\n  query LinguvaLiveShopFacts {\n    shop {\n      myshopifyDomain\n      plan {\n        partnerDevelopment\n        publicDisplayName\n      }\n    }\n  }\n": {return: LinguvaLiveShopFactsQuery, variables: LinguvaLiveShopFactsQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n  mutation LinguvaTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {\n    translationsRegister(resourceId: $resourceId, translations: $translations) {\n      translations {\n        key\n        locale\n        value\n      }\n      userErrors {\n        field\n        message\n        code\n      }\n    }\n  }\n": {return: LinguvaTranslationsRegisterMutation, variables: LinguvaTranslationsRegisterMutationVariables},
  "#graphql\n  mutation LinguvaTranslationsRemove($resourceId: ID!, $keys: [String!]!, $locales: [String!]!) {\n    translationsRemove(resourceId: $resourceId, translationKeys: $keys, locales: $locales) {\n      translations {\n        key\n        locale\n      }\n      userErrors {\n        field\n        message\n        code\n      }\n    }\n  }\n": {return: LinguvaTranslationsRemoveMutation, variables: LinguvaTranslationsRemoveMutationVariables},
  "#graphql\n  mutation LinguvaLiveProductCreate($product: ProductCreateInput!) {\n    productCreate(product: $product) {\n      product {\n        id\n        handle\n      }\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: LinguvaLiveProductCreateMutation, variables: LinguvaLiveProductCreateMutationVariables},
  "#graphql\n  mutation LinguvaLiveProductUpdate($product: ProductUpdateInput!) {\n    productUpdate(product: $product) {\n      product {\n        id\n      }\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: LinguvaLiveProductUpdateMutation, variables: LinguvaLiveProductUpdateMutationVariables},
  "#graphql\n  mutation LinguvaLiveProductDelete($id: ID!) {\n    productDelete(input: { id: $id }) {\n      deletedProductId\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: LinguvaLiveProductDeleteMutation, variables: LinguvaLiveProductDeleteMutationVariables},
  "#graphql\n  mutation LinguvaLiveCollectionCreate($collection: CollectionCreateInput!) {\n    collectionCreate(collection: $collection) {\n      collection {\n        id\n        handle\n      }\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: LinguvaLiveCollectionCreateMutation, variables: LinguvaLiveCollectionCreateMutationVariables},
  "#graphql\n  mutation LinguvaLiveCollectionDelete($id: ID!) {\n    collectionDelete(input: { id: $id }) {\n      deletedCollectionId\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: LinguvaLiveCollectionDeleteMutation, variables: LinguvaLiveCollectionDeleteMutationVariables},
  "#graphql\n  mutation LinguvaLiveTranslationsRemove($resourceId: ID!, $keys: [String!]!, $locales: [String!]!) {\n    translationsRemove(resourceId: $resourceId, translationKeys: $keys, locales: $locales) {\n      translations {\n        key\n        locale\n      }\n      userErrors {\n        field\n        message\n        code\n      }\n    }\n  }\n": {return: LinguvaLiveTranslationsRemoveMutation, variables: LinguvaLiveTranslationsRemoveMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
