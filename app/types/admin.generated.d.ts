/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type LinguvaShopLocalesQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopLocalesQuery = { shopLocales: Array<Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'primary' | 'published'>> };

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

export type LinguvaLiveMarketsQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaLiveMarketsQuery = { markets: { nodes: Array<(
      Pick<AdminTypes.Market, 'id' | 'name'>
      & { webPresences: { nodes: Array<(
          Pick<AdminTypes.MarketWebPresence, 'id' | 'subfolderSuffix'>
          & { defaultLocale: Pick<AdminTypes.ShopLocale, 'locale'>, alternateLocales: Array<Pick<AdminTypes.ShopLocale, 'locale'>>, domain?: AdminTypes.Maybe<Pick<AdminTypes.Domain, 'host'>>, rootUrls: Array<Pick<AdminTypes.MarketWebPresenceRootUrl, 'locale' | 'url'>> }
        )> } }
    )> } };

interface GeneratedQueryTypes {
  "#graphql\n  query LinguvaShopLocales {\n    shopLocales {\n      locale\n      name\n      primary\n      published\n    }\n  }\n": {return: LinguvaShopLocalesQuery, variables: LinguvaShopLocalesQueryVariables},
  "#graphql\n  query LinguvaTranslatableResources(\n    $resourceType: TranslatableResourceType!\n    $first: Int!\n    $after: String\n    $locale: String!\n  ) {\n    translatableResources(resourceType: $resourceType, first: $first, after: $after) {\n      nodes {\n        resourceId\n        translatableContent {\n          key\n          value\n          digest\n          locale\n          type\n        }\n        translations(locale: $locale) {\n          key\n          value\n          outdated\n          updatedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": {return: LinguvaTranslatableResourcesQuery, variables: LinguvaTranslatableResourcesQueryVariables},
  "#graphql\n  query LinguvaTranslatableResource($resourceId: ID!, $locale: String!) {\n    translatableResource(resourceId: $resourceId) {\n      resourceId\n      translatableContent {\n        key\n        value\n        digest\n        locale\n        type\n      }\n      translations(locale: $locale) {\n        key\n        value\n        outdated\n        updatedAt\n      }\n    }\n  }\n": {return: LinguvaTranslatableResourceQuery, variables: LinguvaTranslatableResourceQueryVariables},
  "#graphql\n        query LinguvaShopIdentity {\n          shop {\n            id\n            name\n          }\n        }": {return: LinguvaShopIdentityQuery, variables: LinguvaShopIdentityQueryVariables},
  "#graphql\n  query LinguvaLiveShopFacts {\n    shop {\n      myshopifyDomain\n      plan {\n        partnerDevelopment\n        publicDisplayName\n      }\n    }\n  }\n": {return: LinguvaLiveShopFactsQuery, variables: LinguvaLiveShopFactsQueryVariables},
  "#graphql\n  query LinguvaLiveMarkets {\n    markets(first: 10) {\n      nodes {\n        id\n        name\n        webPresences(first: 5) {\n          nodes {\n            id\n            defaultLocale {\n              locale\n            }\n            alternateLocales {\n              locale\n            }\n            subfolderSuffix\n            domain {\n              host\n            }\n            rootUrls {\n              locale\n              url\n            }\n          }\n        }\n      }\n    }\n  }\n": {return: LinguvaLiveMarketsQuery, variables: LinguvaLiveMarketsQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n  mutation LinguvaTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {\n    translationsRegister(resourceId: $resourceId, translations: $translations) {\n      translations {\n        key\n        locale\n        value\n      }\n      userErrors {\n        field\n        message\n        code\n      }\n    }\n  }\n": {return: LinguvaTranslationsRegisterMutation, variables: LinguvaTranslationsRegisterMutationVariables},
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
