/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type LinguvaShopLocalesQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopLocalesQuery = { shopLocales: Array<Pick<AdminTypes.ShopLocale, 'locale' | 'name' | 'primary' | 'published'>> };

export type LinguvaShopIdentityQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type LinguvaShopIdentityQuery = { shop: Pick<AdminTypes.Shop, 'id' | 'name'> };

interface GeneratedQueryTypes {
  "#graphql\n  query LinguvaShopLocales {\n    shopLocales {\n      locale\n      name\n      primary\n      published\n    }\n  }\n": {return: LinguvaShopLocalesQuery, variables: LinguvaShopLocalesQueryVariables},
  "#graphql\n        query LinguvaShopIdentity {\n          shop {\n            id\n            name\n          }\n        }": {return: LinguvaShopIdentityQuery, variables: LinguvaShopIdentityQueryVariables},
}

interface GeneratedMutationTypes {
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
