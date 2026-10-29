/**
 * Leaving the editor with unpublished changes asks first; published or
 * untouched translations leave without a question.
 */
import { expect, test, type Page } from "@playwright/test";
import { clickSaveBarButton, expectToast, openApp, saveBarShown } from "./helpers";

// The breadcrumb back to the list, as the admin's title bar would follow it.
const goBack = (page: Page) => page.locator('s-link[slot="breadcrumb-actions"]').evaluate((el) => (el as HTMLElement).click());

test("unpublished changes are kept unless the merchant chooses to leave @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/products/3?lang=fr");
  const title = page.locator('s-text-field[name="value:title"] input');

  // Untouched: leaves without asking.
  await goBack(page);
  await expect(page).toHaveURL(/\/app\/products\?lang=fr/);

  await openApp(page, "full", "/app/products/3?lang=fr");
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
  await expect(page).toHaveURL(/\/app\/products\?lang=fr/);
});

test("after publishing, leaving doesn't ask", async ({ page }) => {
  await openApp(page, "full", "/app/products/4?lang=fr");
  await page.locator('s-text-field[name="value:title"] input').fill("Veste numéro 4");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);
  await goBack(page);
  await expect(page).toHaveURL(/\/app\/products\?lang=fr/);
});

test("the admin's save bar appears with changes, publishes, and discards", async ({ page }) => {
  const BAR = "linguva-editor-save-bar";
  await openApp(page, "full", "/app/products/11?lang=fr");
  const title = page.locator('s-text-field[name="value:title"] input');
  expect(await saveBarShown(page, BAR)).toBe(false);

  // Discard: the typed text goes, the bar hides, leaving doesn't ask.
  await title.fill("Veste numéro 11");
  await expect.poll(() => saveBarShown(page, BAR)).toBe(true);
  await clickSaveBarButton(page, BAR, 1);
  await expect(title).toHaveValue("");
  await expect.poll(() => saveBarShown(page, BAR)).toBe(false);

  // Publish from the save bar: a toast confirms, the bar hides.
  await title.fill("Veste numéro 11");
  await expect.poll(() => saveBarShown(page, BAR)).toBe(true);
  await clickSaveBarButton(page, BAR, 0);
  await expectToast(page, "1 translation published");
  await expect.poll(() => saveBarShown(page, BAR)).toBe(false);
  await goBack(page);
  await expect(page).toHaveURL(/\/app\/products\?lang=fr/);
});
