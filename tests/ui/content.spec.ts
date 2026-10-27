/**
 * All other Shopify content in the browser: the content overview, a menu
 * from list to published translation, theme content with search and pages,
 * and the permission prompt for content behind an optional scope.
 */
import { expect, test } from "@playwright/test";
import { contentRef } from "../../app/lib/resource-kinds";
import { UI_THEME_GID } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("the content overview lists every content type with its status @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/content");
  await expect(page.getByText(/content types have something to translate/)).toBeVisible();
  for (const group of ["Online store", "Store", "Navigation", "Catalog", "Theme", "Checkout", "Notifications"]) {
    await expect(page.locator(`s-section[heading="${group}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole("link", { name: "Menus", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Translate Menus" })).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Allow access" }).first()).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a menu: list, AI draft, publish, read back", async ({ page }) => {
  await openApp(page, "full", "/app/content/menus?locale=de");
  await page.getByRole("link", { name: "Main menu" }).click();
  await expect(page.getByText("English → German")).toBeVisible();
  // No storefront search preview for menus.
  await expect(page.getByText("Search engine listing")).toHaveCount(0);
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Main menu");
  await page.locator('s-text-field[name="value:title"] input').fill("Hauptmenü");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expect(page.locator('s-banner[heading="Translations published"]')).toBeVisible();

  await openApp(page, "full", "/app/content/menus?locale=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expectAccessible(page);
});

test("theme content with many texts is searched and paged @responsive", async ({ page }) => {
  await openApp(page, "full", `/app/content/theme-templates/${contentRef(UI_THEME_GID)}?locale=de`);
  await expect(page.locator('s-section[heading="120 texts"]')).toHaveCount(1);
  await expect(page.getByText(/Showing 1–50 of 120/)).toBeVisible();
  await page.locator("s-button", { hasText: "Next" }).click();
  await expect(page.getByText(/Showing 51–100 of 120/)).toBeVisible();

  await page.locator('s-search-field[name="q"] input').fill("free shipping");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/Showing 1–1 of 1 matching/)).toBeVisible();
  await expect(page.getByText("Free shipping over 50 €")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("content behind a permission asks for it instead of failing", async ({ page }) => {
  const response = await openApp(page, "full", "/app/content/policies?locale=de");
  expect(response?.status()).toBe(200);
  await expect(page.locator('s-section[heading="Allow Linguva to read your policies"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Allow access" })).toBeVisible();
  await expectAccessible(page);
});

test("an invalid content reference is a not-found page", async ({ page }) => {
  const response = await openApp(page, "full", "/app/content/menus/not-a-valid-ref!?locale=de");
  expect(response?.status()).toBe(404);
  await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();
});
