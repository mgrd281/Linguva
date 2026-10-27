/**
 * Leaving the editor with unpublished changes asks first; published or
 * untouched translations leave without a question.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The breadcrumb back to the list, as the admin's title bar would follow it.
const goBack = (page: Page) => page.locator('s-link[slot="breadcrumb-actions"]').evaluate((el) => (el as HTMLElement).click());

test("unpublished changes are kept unless the merchant chooses to leave @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/products/3?locale=fr");
  const title = page.locator('s-text-field[name="value:title"] input');

  // Untouched: leaves without asking.
  await goBack(page);
  await expect(page).toHaveURL(/\/app\/products\?locale=fr/);

  await openApp(page, "full", "/app/products/3?locale=fr");
  const editor = page.url();
  await title.fill("Veste numéro 3");
  await goBack(page);
  const warning = page.locator('s-banner[heading="Leave without publishing?"]');
  await expect(warning).toBeVisible();
  expect(page.url()).toBe(editor);
  await expect(title).toHaveValue("Veste numéro 3");

  await warning.getByRole("button", { name: "Stay on this page" }).click();
  await expect(warning).toHaveCount(0);
  await expect(title).toHaveValue("Veste numéro 3");

  await goBack(page);
  await page.locator('s-banner[heading="Leave without publishing?"]').getByRole("button", { name: "Leave without publishing" }).click();
  await expect(page).toHaveURL(/\/app\/products\?locale=fr/);
});

test("after publishing, leaving doesn't ask", async ({ page }) => {
  await openApp(page, "full", "/app/products/4?locale=fr");
  await page.locator('s-text-field[name="value:title"] input').fill("Veste numéro 4");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expect(page.locator('s-banner[heading="Translations published"]')).toBeVisible();
  await goBack(page);
  await expect(page).toHaveURL(/\/app\/products\?locale=fr/);
});
