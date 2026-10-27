/**
 * Fixture resources for live tests. Every resource is created by the test
 * run, named and tagged so it can be recognised, and deleted afterwards.
 * Nothing that existed before the run is ever changed.
 */
import type { LiveAdmin } from "./admin-client";

export const FIXTURE_TAG = "linguva-live-test";

const SHOP_FACTS = `#graphql
  query LinguvaLiveShopFacts {
    shop {
      myshopifyDomain
      plan {
        partnerDevelopment
        publicDisplayName
      }
    }
  }
`;

const PRODUCT_CREATE = `#graphql
  mutation LinguvaLiveProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE = `#graphql
  mutation LinguvaLiveProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE = `#graphql
  mutation LinguvaLiveProductDelete($id: ID!) {
    productDelete(input: { id: $id }) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_CREATE = `#graphql
  mutation LinguvaLiveCollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_DELETE = `#graphql
  mutation LinguvaLiveCollectionDelete($id: ID!) {
    collectionDelete(input: { id: $id }) {
      deletedCollectionId
      userErrors {
        field
        message
      }
    }
  }
`;

const TRANSLATIONS_REMOVE = `#graphql
  mutation LinguvaLiveTranslationsRemove($resourceId: ID!, $keys: [String!]!, $locales: [String!]!) {
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

const MARKETS = `#graphql
  query LinguvaLiveMarkets {
    markets(first: 10) {
      nodes {
        id
        name
        webPresences(first: 5) {
          nodes {
            id
            defaultLocale {
              locale
            }
            alternateLocales {
              locale
            }
            subfolderSuffix
            domain {
              host
            }
            rootUrls {
              locale
              url
            }
          }
        }
      }
    }
  }
`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function run(admin: LiveAdmin, query: string, variables: Record<string, unknown> = {}): Promise<Json> {
  const response = await admin.graphql(query, { variables });
  return ((await response.json()) as { data: Json }).data;
}

function check(result: { userErrors: Array<{ message: string }> }, what: string) {
  if (result.userErrors.length) throw new Error(`${what}: ${result.userErrors.map((e) => e.message).join("; ")}`);
}

export async function shopFacts(admin: LiveAdmin) {
  const { shop } = await run(admin, SHOP_FACTS);
  return {
    myshopifyDomain: String(shop.myshopifyDomain),
    partnerDevelopment: shop.plan.partnerDevelopment === true,
    planName: String(shop.plan.publicDisplayName),
  };
}

export async function createFixtureProduct(admin: LiveAdmin, runId: string) {
  const { productCreate } = await run(admin, PRODUCT_CREATE, {
    product: {
      title: `Linguva live test ${runId} jacket`,
      handle: `linguva-live-test-${runId}`,
      descriptionHtml: `<p>Warm <strong>winter</strong> jacket, 2 pockets. See <a href="https://example.com/care">care</a>.</p>`,
      productType: "Jacket",
      // Draft: never visible on the storefront.
      status: "DRAFT",
      tags: [FIXTURE_TAG],
      seo: { title: `Winter jacket ${runId}`, description: "A warm jacket for cold days." },
    },
  });
  check(productCreate, "productCreate");
  return productCreate.product as { id: string; handle: string };
}

export async function updateFixtureProductTitle(admin: LiveAdmin, id: string, title: string) {
  const { productUpdate } = await run(admin, PRODUCT_UPDATE, { product: { id, title } });
  check(productUpdate, "productUpdate");
}

export async function createFixtureCollection(admin: LiveAdmin, runId: string) {
  const { collectionCreate } = await run(admin, COLLECTION_CREATE, {
    collection: {
      title: `Linguva live test ${runId} collection`,
      handle: `linguva-live-test-${runId}`,
      descriptionHtml: `<p>Our <em>winter</em> picks.</p>`,
      seo: { title: `Winter picks ${runId}`, description: "Selected winter items." },
    },
  });
  check(collectionCreate, "collectionCreate");
  return collectionCreate.collection as { id: string; handle: string };
}

export async function removeTranslations(admin: LiveAdmin, resourceId: string, keys: string[], locales: string[]) {
  const { translationsRemove } = await run(admin, TRANSLATIONS_REMOVE, { resourceId, keys, locales });
  return translationsRemove as { translations: Array<{ key: string }> | null; userErrors: Array<{ code: string | null; message: string }> };
}

/** Deletes a fixture. Refuses anything that isn't one of this run's fixtures. */
export async function deleteFixture(admin: LiveAdmin, gid: string, created: ReadonlySet<string>) {
  if (!created.has(gid)) throw new Error(`Refusing to delete ${gid}: not created by this run`);
  if (gid.startsWith("gid://shopify/Product/")) {
    check((await run(admin, PRODUCT_DELETE, { id: gid })).productDelete, "productDelete");
  } else if (gid.startsWith("gid://shopify/Collection/")) {
    check((await run(admin, COLLECTION_DELETE, { id: gid })).collectionDelete, "collectionDelete");
  }
}

export async function listMarkets(admin: LiveAdmin) {
  const { markets } = await run(admin, MARKETS);
  return markets.nodes as Array<{
    id: string;
    name: string;
    webPresences: {
      nodes: Array<{
        id: string;
        defaultLocale: { locale: string };
        alternateLocales: Array<{ locale: string }>;
        subfolderSuffix: string | null;
        domain: { host: string } | null;
        rootUrls: Array<{ locale: string; url: string }>;
      }>;
    };
  }>;
}
