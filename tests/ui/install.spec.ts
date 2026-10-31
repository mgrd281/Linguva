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
  // A new merchant is guided: German exists and is published; the next step is measuring it.
  await expect(page.locator('s-section[heading="Next"]').getByText("See how much of your store is translated")).toBeVisible();
  await expect(page.locator('s-button[variant="primary"]', { hasText: "Count now" })).toBeVisible();

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
  // The same request with a valid token shows the Overview…
  const valid = new URL(url);
  valid.searchParams.set("id_token", sessionToken(shop.domain));
  expect(await (await page.request.get(valid.toString(), { maxRedirects: 0 })).text()).toContain('heading="Next"');
  // …the forged one doesn't.
  const response = await page.request.get(url.toString(), { maxRedirects: 0 });
  const body = await response.text();
  expect(body).not.toContain('heading="Next"');
  expect(body).not.toContain(shop.name);

  // A data request with a forged bearer token is refused.
  const data = await page.request.get(new URL("/app/products.data?lang=de", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${forged}` },
    maxRedirects: 0,
  });
  expect(data.status()).toBe(401);
  expect(await data.text()).not.toContain("Product 1 jacket");
});

test("a token for one store can't read another store's data", async ({ page }) => {
  // Valid token for the empty store, request for the full store's product.
  const token = sessionToken(UI_SHOPS.empty.domain);
  const data = await page.request.get(new URL("/app/products/1.data?lang=de", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await data.text()).not.toContain("Product 1 jacket");
});

test("pages and data responses carry the security headers, and the admin may still embed the app", async ({ page }) => {
  const shop = UI_SHOPS.full;
  const response = await openApp(page, "full", "/app");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toMatch(
    new RegExp(
      `^frame-ancestors https://${shop.domain} https://admin\\.shopify\\.com https://\\*\\.spin\\.dev https://admin\\.myshopify\\.io https://admin\\.shop\\.dev; ` +
        `base-uri 'self'; object-src 'none'; script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' https://cdn\\.shopify\\.com;$`,
    ),
  );
  expect(headers).toMatchObject({ "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
  expect(headers["x-frame-options"]).toBeUndefined();
  // Local http: no HSTS.
  expect(headers["strict-transport-security"]).toBeUndefined();

  const data = await page.request.get(new URL("/app/products.data?lang=de", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${sessionToken(shop.domain)}` },
  });
  expect(data.status()).toBe(200);
  expect(data.headers()["x-content-type-options"]).toBe("nosniff");

  // A page opened without a shop can't be framed by other sites.
  const login = await page.request.get(new URL("/auth/login", UI_ENV.appUrl).toString());
  expect(login.headers()["content-security-policy"]).toContain("frame-ancestors https://admin.shopify.com https://*.myshopify.com;");
});

test("the public address shows the website and asks no one to type a shop domain", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(new URL("/", UI_ENV.appUrl).toString());
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Installs go through Shopify (App Store requirement).
  await expect(page.locator('input[name="shop"]')).toHaveCount(0);
  // Every image and the stylesheet load under the page's CSP.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length)).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".pg")!).fontFamily)).toContain("Inter");

  await page.getByRole("link", { name: "Alle Preise" }).click();
  await expect(page).toHaveURL(/\/preise$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the content webhook routes of the production build refuse a delivery without a valid signature", async ({ request }) => {
  for (const [path, topic] of [
    ["/webhooks/content", "products/update"],
    ["/webhooks/content/delete", "products/delete"],
  ] as const) {
    const response = await request.post(new URL(path, UI_ENV.appUrl).toString(), {
      data: { id: 1 },
      headers: { "X-Shopify-Topic": topic, "X-Shopify-Shop-Domain": UI_SHOPS.full.domain, "X-Shopify-Hmac-Sha256": "not-a-signature", "X-Shopify-Webhook-Id": `ui-${topic}` },
    });
    // Routed to the webhook action (not 404 or 405), which checks the signature first.
    expect(response.status(), path).toBe(401);
  }
});
