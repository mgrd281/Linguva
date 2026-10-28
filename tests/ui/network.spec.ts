/**
 * Slow networks and a Shopify that doesn't answer: the merchant always sees
 * that something is happening, and a hanging Shopify ends in a clear page
 * with Try again instead of an endless wait.
 */
import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("a Shopify that doesn't answer ends in a clear page within the time limit @responsive", async ({ page }) => {
  const started = Date.now();
  const response = await openApp(page, "slow", "/app/products?lang=de");
  // The app's limit in the UI tests is 3 s; Shopify would take 20 s.
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(response?.status()).toBe(504);
  await expect(page.locator('s-banner[heading="Shopify is taking too long"]')).toBeVisible();
  await expect(page.getByText("Nothing was changed by this page.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Overview" })).toBeVisible();
  // Pages that don't wait for translations still work in the same store.
  expect((await openApp(page, "slow", "/app/settings"))?.status()).toBe(200);
});

test("on a slow connection, navigation shows the admin loading bar and arrives", async ({ page }) => {
  await openApp(page, "full", "/app");
  await page.route(/\.data(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  await page.evaluate(() => ((window as unknown as { __loading: boolean[] }).__loading = []));
  await page.locator("s-section", { hasText: "What do you want to translate?" }).getByRole("link", { name: "Products" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loading: boolean[] }).__loading[0])).toBe(true);
  await expect(page.getByText("Translate all products")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __loading: boolean[] }).__loading.at(-1))).toBe(false);
});

test("on a slow connection, AI translation shows its progress and can't be sent twice", async ({ page }) => {
  await openApp(page, "full", "/app/products/8?lang=fr");
  let posts = 0;
  await page.route(/\/app\/products\/8\.data/, async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await new Promise((r) => setTimeout(r, 1_500));
    }
    await route.continue();
  });
  const button = page.locator("s-button", { hasText: "Translate with AI" });
  await button.click();
  await expect(button).toHaveAttribute("loading", "");
  // A second click while it runs doesn't send another request.
  await button.click({ force: true });
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[fr] Product 8 jacket", { timeout: 10_000 });
  await expect(button).not.toHaveAttribute("loading", "");
  expect(posts).toBe(1);
});
