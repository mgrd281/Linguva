/**
 * All other Shopify content in the browser: the content overview, a menu
 * from list to published translation, theme content with search and pages,
 * and the permission prompt for content behind an optional scope.
 */
import { expect, test } from "@playwright/test";
import { contentRef } from "../../app/lib/resource-kinds";
import { UI_THEME_GID } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, openApp, expectToast } from "./helpers";

test("the content overview lists every content type with its status @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/content");
  await expect(page.getByText(/content types have\s+something to translate/)).toBeVisible();
  // Ordered by what to do: ready first, then permissions, then the rest compactly.
  const headings = await page.locator("s-section[heading]").evaluateAll((els) => els.map((e) => e.getAttribute("heading")));
  expect(headings).toEqual(["Ready to translate", "Needs your permission", "Not in your store yet"]);
  await expect(page.locator('s-section[heading="Not in your store yet"]').getByText(/Shipping methods/)).toBeVisible();
  // Every list opens here (they left the navigation): products and collections first.
  const ready = page.locator('s-section[heading="Ready to translate"] s-table-row');
  await expect(ready.nth(0).getByRole("link", { name: "Products", exact: true })).toHaveAttribute("href", "/app/products");
  await expect(ready.nth(1).getByRole("link", { name: "Collections", exact: true })).toHaveAttribute("href", "/app/collections");
  await expect(page.getByRole("link", { name: "Menus", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Translate Menus" })).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Allow access" }).first()).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a menu: list, AI draft, publish, read back", async ({ page }) => {
  await openApp(page, "full", "/app/content/menus?lang=de");
  await page.getByRole("link", { name: "Main menu" }).click();
  await expect(page.getByText("English → German")).toBeVisible();
  // No storefront search preview for menus.
  await expect(page.getByText("Search engine listing")).toHaveCount(0);
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Main menu");
  await page.locator('s-text-field[name="value:title"] input').fill("Hauptmenü");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);

  await openApp(page, "full", "/app/content/menus?lang=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expectAccessible(page);
});

test("theme content with many texts is searched and paged @responsive", async ({ page }) => {
  await openApp(page, "full", `/app/content/theme-templates/${contentRef(UI_THEME_GID)}?lang=de`);
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
  const response = await openApp(page, "full", "/app/content/policies?lang=de");
  expect(response?.status()).toBe(200);
  await expect(page.locator('s-section[heading="Allow Linguva to read your policies"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Allow access" })).toBeVisible();
  await expectAccessible(page);
});

test("an invalid content reference is a not-found page", async ({ page }) => {
  const response = await openApp(page, "full", "/app/content/menus/not-a-valid-ref!?lang=de");
  expect(response?.status()).toBe(404);
  await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();
});

test("bulk translation offers image alt text and custom fields where a type has them", async ({ page }) => {
  await openApp(page, "full", "/app/products?lang=de");
  const option = page.getByRole("checkbox", { name: "Also translate image alt text and custom fields" });
  await expect(option).toBeVisible();
  await expect(option).not.toBeChecked();
  await expect(page.getByText("so the job takes longer")).toBeVisible();

  await openApp(page, "full", "/app/content/menus?lang=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Also translate image alt text and custom fields" })).toHaveCount(0);
});
