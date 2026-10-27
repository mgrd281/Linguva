/**
 * Installation and authentication through the real app code: session token
 * validation, Shopify-managed install with token exchange, the afterAuth
 * hook, encrypted token storage. Shopify itself is simulated.
 */
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { testEnv } from "../support/env";
import { UI_ENV, UI_SHOPS } from "./fixtures/shops";
import { openApp, sessionToken } from "./helpers";

const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
test.afterAll(() => owner.$disconnect());

test("a new store installs through token exchange and lands on the Overview", async ({ page }) => {
  const shop = UI_SHOPS.fresh;
  expect(await owner.shop.findUnique({ where: { shopDomain: shop.domain } })).toBeNull();

  await openApp(page, "fresh", "/app");
  await expect(page.getByText("Primary language")).toBeVisible();
  await expect(page.getByText(shop.name)).toBeVisible();

  // afterAuth stored the tenant with the GID Shopify reported.
  const row = await owner.shop.findUniqueOrThrow({ where: { shopDomain: shop.domain } });
  expect(row).toMatchObject({ shopifyShopGid: shop.gid, status: "ACTIVE" });
  // The offline token (and its refresh token) are stored encrypted.
  const session = await owner.session.findFirstOrThrow({ where: { shop: shop.domain, isOnline: false } });
  expect(session.accessToken).not.toContain("ui-test-token");
  expect(JSON.stringify(session)).not.toContain(`ui-test-refresh-${shop.domain}`);
});

test("a forged session token gets no app content", async ({ page }) => {
  const shop = UI_SHOPS.full;
  // Correct structure, wrong signature.
  const [header, payload] = sessionToken(shop.domain).split(".");
  const forged = `${header}.${payload}.${Buffer.from("forged-signature").toString("base64url")}`;
  const url = new URL("/app", UI_ENV.appUrl);
  url.searchParams.set("embedded", "1");
  url.searchParams.set("shop", shop.domain);
  url.searchParams.set("host", Buffer.from("admin.shopify.com/store/ui-full").toString("base64"));
  url.searchParams.set("id_token", forged);
  const response = await page.request.get(url.toString(), { maxRedirects: 0 });
  const body = await response.text();
  expect(body).not.toContain(shop.name);
  expect(body).not.toContain("Primary language");

  // A data request with a forged bearer token is refused.
  const data = await page.request.get(new URL("/app/products.data?locale=de", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${forged}` },
    maxRedirects: 0,
  });
  expect(data.status()).toBe(401);
  expect(await data.text()).not.toContain("Product 1 jacket");
});

test("a token for one store can't read another store's data", async ({ page }) => {
  // Valid token for the empty store, request for the full store's product.
  const token = sessionToken(UI_SHOPS.empty.domain);
  const data = await page.request.get(new URL("/app/products/1.data?locale=de", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await data.text()).not.toContain("Product 1 jacket");
});
