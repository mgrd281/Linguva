import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { getConfig, isShopAllowed } from "./.server/lib/config";
import { TokenCipher } from "./.server/lib/crypto";
import { prisma } from "./.server/lib/db";
import { logger } from "./.server/lib/logger";
import { EncryptedSessionStorage } from "./.server/shopify/encrypted-session-storage";
import { withShopifyTimeout } from "./.server/shopify/admin-timeout";
import { upsertInstalledShop } from "./.server/tenancy/shop-service";

const config = getConfig();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new EncryptedSessionStorage(
    new PrismaSessionStorage(prisma),
    TokenCipher.fromKeyring(config.TOKEN_ENCRYPTION_KEYS),
  ),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // No tenant for a store this deployment doesn't serve (staging guard).
      if (!isShopAllowed(session.shop)) {
        logger.warn({ shop: session.shop }, "install refused: store not served by this deployment");
        throw new Response("This Linguva deployment isn't available for this store.", { status: 403 });
      }
      const response = await withShopifyTimeout(admin, getConfig().SHOPIFY_TIMEOUT_MS, "page").graphql(
        `#graphql
        query LinguvaShopIdentity {
          shop {
            id
            name
          }
        }`,
      );
      const { data } = await response.json();
      const { event } = await upsertInstalledShop({
        shopDomain: session.shop,
        shopifyShopGid: data?.shop.id ?? null,
        name: data?.shop.name ?? null,
        scopes: session.scope ?? null,
      });
      if (event) logger.info({ shop: session.shop, event }, "shop installed");
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
