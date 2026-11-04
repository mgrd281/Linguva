/**
 * The editor shows each text's state beside its name: translated, outdated
 * or not translated (a web address nobody wrote yet is optional), so a
 * merchant sees what needs work without reading every input; one square tile
 * per text says the same and leads to it. The texts come in Review's order,
 * and the original description shows in full.
 * The way back leads to the area list the item is opened from, as that list
 * was opened (from Content: its trail starts there).
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, openApp } from "./helpers";

test("each text starts with its state, in Review's order, and its tile leads to it @responsive", async ({ page }) => {
  // Demo catalog: the jacket's German name is translated, its description outdated, its Google description missing.
  await openApp(page, "demo", "/app/products/2?lang=de");
  const text = (name: string) => page.locator(`s-section[data-text="${name}"]`);
  await expect(text("Name").locator("s-badge").first()).toHaveText("Translated");
  await expect(text("Description").locator("s-badge").first()).toHaveText("Outdated");
  await expect(text("Google description").locator("s-badge").first()).toHaveText("Not translated");
  // The web address is never machine-translated: said next to its state.
  await expect(text("Web address").locator("s-badge", { hasText: "Manual only" })).toBeVisible();
  // Name, description, the Google preview and texts, the web address last; then the image descriptions.
  const order = await page.locator("s-section[data-text]").evaluateAll((els) => els.map((el) => el.getAttribute("data-text")));
  expect(order).toEqual(["Name", "Description", "On Google", "Google title", "Google description", "Web address", "Image descriptions and extra details"]);

  // The item's name with how much is open (the image's description counts, the web address doesn't).
  await expect(page.getByRole("heading", { level: 1, name: "Waterproof Hiking Jacket" })).toBeVisible();
  await expect(page.getByText("In German · 3 of 5 texts to translate")).toBeVisible();
  // AI works on the open texts only: their number in the button's name.
  await expect(page.getByRole("button", { name: "Translate with AI: 3 open texts" })).toBeVisible();

  // One tile per text, in the same order, each moving to its text.
  const tiles = page.getByRole("navigation", { name: "Texts" }).getByRole("link");
  await expect(tiles.locator(".lv-sr")).toHaveText([
    "Name: Translated",
    "Description: Outdated",
    "Google title: Translated",
    "Google description: Not translated",
    "Web address: Translated",
    "Images and details: 1 to translate",
  ]);
  await page.getByRole("link", { name: "Google description: Not translated" }).click();
  await expect(page.locator("#editor-text-meta_description-heading")).toBeFocused();
  await expect(page.locator("#editor-text-meta_description-heading")).toBeInViewport();

  // The original description's frame is tall enough for its last list item.
  // (The frame is sandboxed: its content is measured inside the frame.)
  const frame = text("Description").locator("iframe").first();
  const clientHeight = await frame.evaluate((f: HTMLIFrameElement) => f.clientHeight);
  const contentHeight = await (await frame.elementHandle())!.contentFrame().then((f) => f!.evaluate(() => document.documentElement.scrollHeight));
  expect(contentHeight).toBeLessThanOrEqual(clientHeight);
  await expectAccessible(page);
});

test("a new item: its web address is optional, both columns are labelled alike, the empty description says how to fill it @responsive", async ({ page }) => {
  // The reviewed screen (the visual store, only read here): nothing of the jacket is in German yet.
  await openApp(page, "visual", "/app/products/2?lang=de");
  const text = (name: string) => page.locator(`s-section[data-text="${name}"]`);
  await expect(page.getByText("In German · 2 of 2 texts to translate")).toBeVisible();
  // The count leaves the web address out, so it never says "Not translated" beside the two texts it counts.
  await expect(text("Web address").locator("s-badge").first()).toHaveText("Optional");
  await expect(text("Web address").locator("s-badge", { hasText: "Manual only" })).toBeVisible();
  const tiles = page.getByRole("navigation", { name: "Texts" }).getByRole("link");
  await expect(tiles.locator(".lv-sr")).toHaveText(["Name: Not translated", "Description: Not translated", "Web address: Optional"]);

  // The language above the field, as above the original (not Polaris' label inside the empty field on a phone); the field keeps it as its name.
  const name = text("Name");
  await expect(name.getByText("English (original)")).toBeVisible();
  const field = name.locator('s-text-field[name="value:title"]');
  expect(await field.evaluate((el) => el.parentElement?.previousElementSibling?.textContent)).toBe("German");
  await expect(field).toHaveAttribute("labelAccessibilityVisibility", "exclusive");
  await expect(name.getByRole("textbox", { name: "German" })).toBeVisible();

  // The empty description isn't a passive box: it says what to do, and writing it opens its code.
  const empty = text("Description").getByRole("button", { name: "Nothing in German yet – translate it with AI above, or write it here." });
  await expect(empty).toBeVisible();
  await expect(text("Description").getByText("The preview appears here once there is a translation.")).toHaveCount(0);
  await empty.click();
  await expect(page.locator('s-text-area[name="value:body_html"] textarea')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("value:body_html");
  await expectAccessible(page);
});

test("the item's picture is beside its name, as its area list shows it: a collection's too", async ({ page }) => {
  // Demo catalog: the Hiking collection's image (its description is an image description of its own, without a picture).
  await openApp(page, "demo", "/app/collections/1?lang=de");
  await expect(page.getByRole("heading", { level: 1, name: "Hiking" })).toBeVisible();
  const picture = page.locator(".lv-ed-header .lv-ed-picture img");
  await expect(picture).toHaveAttribute("src", /\/mountains\.svg\?width=96$/);
  // Decorative: the name is written beside it.
  await expect(picture).toHaveAttribute("alt", "");
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("the way back leads to the area list the item is opened from", async ({ page }) => {
  await openApp(page, "demo", "/app/products/2?lang=de");
  await expect(page.locator('s-link[slot="breadcrumb-actions"]')).toHaveAttribute("href", "/app/languages/de/products");
  await expect(page.locator('s-link[slot="breadcrumb-actions"]')).toHaveText("Products in German");
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/app/languages/de/products");
  await expect(trail.getByRole("link", { name: "German" })).toHaveAttribute("href", "/app/languages/de");
});

test("opened from a list that came from Content, the way back keeps that", async ({ page }) => {
  await openApp(page, "full", "/app/languages/de/products?from=content");
  const item = page.getByRole("link", { name: /^Open: / }).first();
  await expect(item).toHaveAttribute("href", /^\/app\/products\/\d+\?lang=de&from=content$/);
  await item.click();
  await expect(page).toHaveURL(/\/app\/products\/\d+\?lang=de&from=content/);
  // Back to the list and the language page as they were opened: their trail starts at Content.
  await expect(page.locator('s-link[slot="breadcrumb-actions"]')).toHaveAttribute("href", "/app/languages/de/products?from=content");
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/app/languages/de/products?from=content");
  await expect(trail.getByRole("link", { name: "German" })).toHaveAttribute("href", "/app/languages/de?from=content");
});
