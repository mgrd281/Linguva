/**
 * Empty, error and loading states: every page says what is going on and
 * what to do next, and failures never show internal details.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test.describe("empty states", () => {
  test("a store with only its primary language is guided to add one", async ({ page }) => {
    await openApp(page, "empty", "/app");
    // The checklist starts with adding a language, as the primary action.
    await expect(page.getByText("0 of 5 steps done")).toBeVisible();
    await expect(page.locator('s-button[variant="primary"]', { hasText: "Open language settings" })).toHaveAttribute("href", "shopify://admin/settings/languages");
    await expect(page.getByText(/Your store only has its primary language/)).toBeVisible();
    await openApp(page, "empty", "/app/products");
    await expect(page.getByText("No languages to translate into")).toBeVisible();
    await expect(page.locator("s-button", { hasText: "Open language settings" })).toBeVisible();
    await expectAccessible(page);
  });

  test("an empty catalog, no jobs and nothing to review @responsive", async ({ page }) => {
    await openApp(page, "emptyCatalog", "/app/products?lang=de");
    await expect(page.getByText("No products yet")).toBeVisible();
    await expect(page.getByText(/appear here, ready to translate into German/)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await openApp(page, "emptyCatalog", "/app/jobs");
    await expect(page.getByText(/No jobs yet/)).toBeVisible();
    await openApp(page, "emptyCatalog", "/app/review");
    await expect(page.getByText(/Nothing to review/)).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("error states", () => {
  test("a Shopify outage shows a clear message, keeps the app usable and leaks nothing @responsive", async ({ page }) => {
    const response = await openApp(page, "failing", "/app/products?lang=de");
    expect(response?.status()).toBe(503);
    const banner = page.locator(`s-banner[heading="Shopify didn't respond"]`);
    await expect(banner).toBeVisible();
    await expect(page.getByText(/Nothing was changed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("s-button", { hasText: "Go to Overview" })).toHaveAttribute("href", "/app");
    const html = await page.content();
    // Neither Shopify's raw answer nor internals (error classes, paths, stack frames).
    expect(html).not.toMatch(/Service unavailable|HttpResponseError|GraphqlQueryError|node_modules|\.server\/|\n\s+at \S+ \(/);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);

    // "Try again" retries; the outage persists, the message stays.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(banner).toBeVisible();
    // Pages that don't need the failing API keep working.
    await openApp(page, "failing", "/app/languages");
    await expect(page.getByText("German")).toBeVisible();
  });

  test("a resource that doesn't exist shows a not-found page", async ({ page }) => {
    const response = await openApp(page, "full", "/app/products/999999?lang=de");
    expect(response?.status()).toBe(404);
    await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe("loading states", () => {
  test("AI translation shows progress and then fills the drafts without publishing", async ({ page }) => {
    await openApp(page, "full", "/app/products/4?lang=de");
    // Hold the action response so the in-between state is observable.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/app/products/4.data**", async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    const button = page.getByRole("button", { name: "Translate with AI" });
    await button.click();
    await expect(page.locator("s-button[loading]").filter({ hasText: "Translate with AI" })).toHaveCount(1);
    release();
    await expect(page.locator("s-button[loading]").filter({ hasText: "Translate with AI" })).toHaveCount(0);
    await expect(page.getByText(/AI drafts are filled in below/)).toBeVisible();
    await expect(page.getByText("AI draft").first()).toBeVisible();
    // Nothing is published until the merchant clicks Publish: reload shows Shopify's value.
    await openApp(page, "full", "/app/products/4?lang=de");
    await expect(page.getByText("AI draft")).toHaveCount(0);
  });

  test("navigating between pages shows the admin loading bar", async ({ page }) => {
    await openApp(page, "full", "/app");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/app/coverage.data**", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("link", { name: "Open coverage report" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loading: boolean[] }).__loading.at(-1))).toBe(true);
    release();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loading: boolean[] }).__loading.at(-1))).toBe(false);
  });
});
