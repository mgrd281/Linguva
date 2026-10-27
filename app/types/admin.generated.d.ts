/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type LinguvaShopLocalesQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopLocalesQuery = { shopLocales: Array<Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'primary' | 'published'>> };

export type LinguvaTranslatableProductsQueryVariables = AdminTypes.Exact<{
  first: AdminTypes.Scalars['Int']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
  locale: AdminTypes.Scalars['String']['input'];
}>;


export type LinguvaTranslatableProductsQuery = { translatableResources: { nodes: Array<(
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

interface GeneratedQueryTypes {
  "#graphql\n  query LinguvaShopLocales {\n    shopLocales {\n      locale\n      name\n      primary\n      published\n    }\n  }\n": {return: LinguvaShopLocalesQuery, variables: LinguvaShopLocalesQueryVariables},
  "#graphql\n  query LinguvaTranslatableProducts($first: Int!, $after: String, $locale: String!) {\n    translatableResources(resourceType: PRODUCT, first: $first, after: $after) {\n      nodes {\n        resourceId\n        translatableContent {\n          key\n          value\n          digest\n          locale\n          type\n        }\n        translations(locale: $locale) {\n          key\n          value\n          outdated\n          updatedAt\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": {return: LinguvaTranslatableProductsQuery, variables: LinguvaTranslatableProductsQueryVariables},
  "#graphql\n  query LinguvaTranslatableResource($resourceId: ID!, $locale: String!) {\n    translatableResource(resourceId: $resourceId) {\n      resourceId\n      translatableContent {\n        key\n        value\n        digest\n        locale\n        type\n      }\n      translations(locale: $locale) {\n        key\n        value\n        outdated\n        updatedAt\n      }\n    }\n  }\n": {return: LinguvaTranslatableResourceQuery, variables: LinguvaTranslatableResourceQueryVariables},
  "#graphql\n        query LinguvaShopIdentity {\n          shop {\n            id\n            name\n          }\n        }": {return: LinguvaShopIdentityQuery, variables: LinguvaShopIdentityQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n  mutation LinguvaTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {\n    translationsRegister(resourceId: $resourceId, translations: $translations) {\n      translations {\n        key\n        locale\n        value\n      }\n      userErrors {\n        field\n        message\n        code\n      }\n    }\n  }\n": {return: LinguvaTranslationsRegisterMutation, variables: LinguvaTranslationsRegisterMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
