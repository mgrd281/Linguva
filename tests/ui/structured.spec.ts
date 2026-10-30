/**
 * Lists and links (custom fields) in the editor: shown as lists, never as
 * JSON; translated item by item with the link addresses kept; an item left
 * empty is pointed out and nothing incomplete is published.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectToast, openApp } from "./helpers";

test("lists and links are translated item by item and keep their link addresses", async ({ page }) => {
  await openApp(page, "full", "/app/products/14?lang=de");
  const panel = page.locator('s-section[heading="Images and custom fields"]');
  // The original is shown readably, with the addresses as plain text.
  await expect(panel.locator("s-list-item", { hasText: "Care guide" })).toHaveText("Care guide (https://example.com/care)");
  await expect(panel.getByText('[{"text"')).toHaveCount(0);

  const careLink = panel.locator('s-text-field[label="German, item 1"][details="Links to https://example.com/care"] input');
  const sizeLink = panel.locator('s-text-field[label="German, item 2"][details="Links to /pages/sizes"] input');
  await careLink.fill("Pflegehinweise");
  // The second item is still empty: pointed out, and refused when publishing.
  await expect(panel.locator('s-text-field[label="German, item 2"][error]')).toHaveCount(1);
  await page.getByRole("button", { name: "Publish alt text and fields" }).click();
  await expect(panel.getByText("Translation is empty")).toBeVisible();

  await sizeLink.fill("Größentabelle");
  await page.getByRole("button", { name: "Publish alt text and fields" }).click();
  // Only the links: the untouched list's translation (written elsewhere) isn't saved again.
  await expectToast(page, "1 translation published");
  await expect(panel.locator('s-text-field[label="German, item 2"]:not([details]) input')).toHaveValue("Wasserdicht");

  // Read back from the (simulated) Shopify: the texts are translated, the addresses unchanged.
  await openApp(page, "full", "/app/products/14?lang=de");
  await expect(panel.locator('s-text-field[label="German, item 1"] input').first()).toHaveValue("Pflegehinweise");
  await expect(panel.locator('s-text-field[label="German, item 2"][details="Links to /pages/sizes"] input')).toHaveValue("Größentabelle");
  await expectAccessible(page);
});

test("AI fills each item of a list; nothing is published until the merchant does", async ({ page }) => {
  await openApp(page, "full", "/app/products/14?lang=fr");
  const panel = page.locator('s-section[heading="Images and custom fields"]');
  await page.getByRole("button", { name: "Translate missing alt text and fields with AI" }).click();
  await expect(panel.locator('s-text-field[details="Links to https://example.com/care"] input')).toHaveValue("[fr] Care guide");
  await expect(panel.locator('s-text-field[label="French, item 2"]:not([details]) input')).toHaveValue("[fr] Waterproof");
  await expect(panel.getByText("AI draft").first()).toBeVisible();
});

test("Review shows a list of links as a list and approves it as translated", async ({ page }) => {
  await openApp(page, "customFields", "/app/review");
  // In its product's card, under the product's own texts.
  const card = page.locator('s-section[accessibilitylabel^="Product 1 jacket"]');
  const draft = card.locator("li", { hasText: "Extra detail: Guides" });
  await expect(draft.locator("s-list-item", { hasText: "[de] Care guide" }).first()).toHaveText("[de] Care guide (https://example.com/care)");
  // Approved as shown: no JSON to edit here; single items are changed in the editor.
  await expect(draft.locator("s-text-area")).toHaveCount(0);
  await expect(draft.getByText(/to change single items, open the editor/)).toBeVisible();
  await expectAccessible(page);

  await draft.getByRole("button", { name: "Approve: Extra detail: Guides – Product 1 jacket" }).filter({ visible: true }).click();
  await expect(draft.getByText("Approved – customers see it now.")).toBeVisible();
  await openApp(page, "customFields", "/app/products/1?lang=de");
  await expect(page.locator('s-text-field[details="Links to https://example.com/care"] input')).toHaveValue("[de] Care guide");
});
