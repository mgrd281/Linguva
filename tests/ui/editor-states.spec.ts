/**
 * The editor shows each text's state beside its name: translated, outdated
 * or not translated, so a merchant sees what needs work without reading
 * every input; one square tile per text says the same and leads to it. The
 * texts come in Review's order, and the original description shows in full.
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

test("the way back leads to the area list the item is opened from", async ({ page }) => {
  await openApp(page, "demo", "/app/products/2?lang=de");
  await expect(page.locator('s-link[slot="breadcrumb-actions"]')).toHaveAttribute("href", "/app/languages/de/products");
  await expect(page.locator('s-link[slot="breadcrumb-actions"]')).toHaveText("Products in German");
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/app/languages/de/products");
  await expect(trail.getByRole("link", { name: "German" })).toHaveAttribute("href", "/app/languages/de");
});
