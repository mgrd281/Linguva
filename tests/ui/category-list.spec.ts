/**
 * One area of a language, item by item (/app/languages/:locale/:category):
 * how far the area is with its next step, filters by each item's one state
 * that add up to "All", search by name, the items grouped by state with
 * pictures and the state of each text, the way to the editor, and pages of
 * 50. Also its no-access, not-counted and not-found states.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** A card or section by its name: native sections named by their label or their heading. */
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** The filter links and the current filter, as "<label> <count>". */
const filters = (page: Page) => page.getByRole("navigation", { name: "Show" });
async function filterCounts(page: Page) {
  const texts = await filters(page).locator("li").evaluateAll((items) => items.map((li) => (li as HTMLElement).innerText.trim()));
  return texts.map((text) => {
    const match = /^(.*\S)\s+([\d,]+)$/.exec(text)!;
    return { label: match[1]!, count: Number(match[2]!.replace(/,/g, "")) };
  });
}

/** Group headings (h3, one per item state on the page), top to bottom. */
const groups = (page: Page) => page.locator("h3").allInnerTexts();

test("an area's items: figure, filters that add up, groups by state, pictures and the editor @responsive", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page, "catalog", "/app/languages/de/products");

  // The trail on a wide page; on a phone one 44 px back row to the language (only one of them is shown).
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  const language = crumbs.getByRole("link", { name: "German" });
  await expect(language).toHaveCount(1);
  await expect(language).toHaveAttribute("href", "/app/languages/de");
  if (info.project.name === "mobile") {
    expect((await language.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(crumbs.getByRole("link", { name: "Overview" })).toHaveCount(0);
  } else {
    await expect(crumbs.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/app");
  }
  await expect(page.getByRole("heading", { level: 1, name: "Products in German" })).toBeVisible();
  await expect(page.getByText("55 products", { exact: true })).toBeVisible();

  // How far the area is: texts in the figure, products done beside it.
  const hero = region(page, "Progress: Products");
  await expect(hero.getByRole("img", { name: /^\d+% translated: \d+ of \d+ texts are done and live$/ })).toBeVisible();
  // The figure and Next are the hero's two headings, in the Overview's type scale; the list's heading too.
  await expect(hero.getByRole("heading", { level: 2, name: /^\d+ of \d+ texts are done and live$/ })).toBeVisible();
  await expect(hero.getByRole("heading", { level: 2, name: "Next", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Item by item" })).toBeVisible();
  await expect(hero.getByText("Fully done: 7 of 55 products")).toBeVisible();
  // One next step with the page's only primary button: translate what is open (asks first).
  await expect(hero.getByText("48 products to translate")).toBeVisible();
  const primary = page.locator('[data-button][data-variant="primary"]').filter({ hasNot: page.locator("s-modal") });
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  await expect(primary.first()).toHaveText("Translate");

  // Each product is in exactly one group: the filters add up to All.
  const counts = await filterCounts(page);
  expect(counts).toEqual([
    { label: "All", count: 55 },
    { label: "Outdated", count: 1 },
    { label: "Missing", count: 47 },
    { label: "Done", count: 7 },
  ]);
  expect(counts.slice(1).reduce((sum, c) => sum + c.count, 0)).toBe(counts[0]!.count);
  // The shown group in the app's chosen look: the blue ring and tint.
  const chosen = filters(page).locator('[aria-current="true"]');
  await expect(chosen).toHaveText("All 55");
  await expect(chosen).toHaveCSS("background-color", "rgb(245, 249, 255)");
  await expect(chosen).toHaveCSS("box-shadow", /rgb\(0, 91, 211\)/);

  // Open work first, each group with what it means for customers; a group only partly on this page links to all of it.
  expect(await groups(page)).toEqual(["Outdated", "Missing", "Done"]);
  // A chevron, not a typed "›" (the name is the words alone).
  await expect(page.getByRole("link", { name: /^View all 7$/ })).toHaveAttribute("href", "/app/languages/de/products?state=complete");
  await expect(page.getByText("You changed the original. Customers still see the old translation.")).toBeVisible();

  // A row: picture, name, what customers see, each text with its state; the whole row opens the editor.
  const row = page.locator("li", { has: page.getByRole("link", { name: "Open: Product 8 jacket" }) });
  await expect(row.getByText("Changed in the original: Description.")).toBeVisible();
  await expect(row.getByText(/^In German:/)).toBeVisible();
  await expect(row.locator("s-chip[accessibilitylabel='Name, done']")).toHaveCount(1);
  await expect(row.locator("s-chip[accessibilitylabel='Description, outdated']")).toHaveCount(1);
  await expect(row.getByRole("link", { name: "Open: Product 8 jacket" })).toHaveAttribute("href", "/app/products/8?lang=de");
  await expect(row.locator('s-icon[type="chevron-right"]')).toHaveCount(1);
  // The row's link covers the row: a click beside the name opens the editor too.
  const box = (await row.locator(".lv-row").boundingBox())!;
  const link = (await row.getByRole("link", { name: "Open: Product 8 jacket" }).boundingBox())!;
  expect(box.height).toBeGreaterThan(link.height);
  // Web addresses are never listed as a text.
  await expect(page.locator("s-chip", { hasText: "Web address" })).toHaveCount(0);
  // Where nothing is translated the row doesn't repeat its name: its group says customers see English.
  const missing = page.locator("li", { has: page.getByRole("link", { name: "Open: Product 30 jacket" }) });
  await expect(missing.getByText(/Not in German yet/)).toHaveCount(0);
  await expect(page.getByText("Customers still see English here.")).toBeVisible();

  // Pictures beside their names (decorative: the name is written next to them).
  const pictures = page.locator("ul img");
  await expect.poll(() => pictures.count()).toBeGreaterThan(0);
  for (const alt of await pictures.evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")))) expect(alt).toBe("");
  // They load as they scroll into view.
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("a filter shows one group, and pages hold 50 items", async ({ page }) => {
  await openApp(page, "catalog", "/app/languages/de/products");
  await expect(page.getByText("Page 1 · 1–50 of 55")).toBeVisible();
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 · 51–55 of 55")).toBeVisible();
  await expect(page).toHaveURL(/[?&]after=/);
  await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to the start" }).click();
  await expect(page.getByText("Page 1 · 1–50 of 55")).toBeVisible();

  await filters(page).getByRole("link", { name: "Outdated 1" }).click();
  await expect(page).toHaveURL(/[?&]state=outdated/);
  await expect(filters(page).locator('[aria-current="true"]')).toHaveText("Outdated 1");
  expect(await groups(page)).toEqual(["Outdated"]);
  await expect(page.getByRole("link", { name: /^Open: / })).toHaveCount(1);
  await expect(page.getByText(/^Page \d/)).toHaveCount(0);

  await filters(page).getByRole("link", { name: "Done 7" }).click();
  await expect(filters(page).locator('[aria-current="true"]')).toHaveText("Done 7");
  expect(await groups(page)).toEqual(["Done"]);
  await expect(page.getByRole("link", { name: /^Open: / })).toHaveCount(7);
});

test("search by name keeps the filter and can be cleared @responsive", async ({ page }) => {
  await openApp(page, "catalog", "/app/languages/de/products?state=missing");
  await page.getByRole("searchbox", { name: "Search by name" }).fill("jacket 1");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/[?&]q=jacket\+1/);
  await expect(page).toHaveURL(/[?&]state=missing/);
  // Product 1 and 10–19 match; the filter shows those still missing texts (10–19), the chips count every match.
  await expect(page.getByText("11 matches for “jacket 1”")).toBeVisible();
  await expect(filters(page).locator('[aria-current="true"]')).toHaveText("Missing 10");
  await expect(filters(page).getByRole("link", { name: "Done 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open: / })).toHaveCount(10);
  // The area's own counts are hidden while they cover only the matches.
  await expect(page.getByText("55 products", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByText("Missing 47")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("translating the area asks first @responsive", async ({ page }) => {
  await openApp(page, "catalog", "/app/languages/de/products");
  await region(page, "Progress: Products").getByRole("button", { name: "Translate" }).click();
  await expect(page.getByRole("dialog", { name: "Translate 48 products into German?" })).toBeVisible();
  const dialog = page.locator("s-modal#category-translate");
  // Counted honestly: products with open texts, and those texts by state.
  await expect(dialog.getByText("48 products: up to 83 texts – 82 missing and 1 outdated.")).toBeVisible();
  await expect(dialog.getByText("You approve them", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an area Linguva can't read says so, with the way to allow it (Content's card)", async ({ page }) => {
  await openApp(page, "full", "/app/languages/de/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Store & checkout in German" })).toBeVisible();
  const hero = region(page, "Progress: Store & checkout");
  await expect(hero.getByRole("img", { name: "No access" })).toBeVisible();
  // Policies have a permission to ask for: the step says to allow it (without one it would name what no app may read).
  await expect(hero.getByText("Allow access to Store & checkout", { exact: true })).toBeVisible();
  await expect(hero.locator('[data-button][href="/app/content?lang=de#content-access"]')).toHaveText("Allow access");
  await expectAccessible(page);
});

test("image descriptions are translated with their products: their list offers that, ticked in the dialog @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/languages/de/images");
  await expect(page.getByRole("heading", { level: 1, name: "Image descriptions in German" })).toBeVisible();
  const first = region(page, "Progress: Image descriptions").locator("ol > li").first();
  await expect(first.getByText(/^\d+ image descriptions? to translate$/)).toBeVisible();
  await expect(first.getByText("You translate image descriptions together with your products.")).toBeVisible();
  // The page's one primary button.
  const button = first.locator('[data-button][data-variant="primary"]');
  await expect(button).toHaveText("Translate with products");
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  await button.click();
  await expect(page.getByRole("dialog", { name: /^Translate \d+ products? into German\?$/ })).toBeVisible();
  const dialog = page.locator("s-modal#category-translate");
  await expect(dialog.getByRole("checkbox", { name: "Also translate image descriptions and extra details" })).toBeChecked();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an area of a language not counted yet offers counting", async ({ page }) => {
  await openApp(page, "owner", "/app/languages/de/products");
  const hero = region(page, "Progress: Products");
  await expect(hero.getByRole("img", { name: "Not counted yet" })).toBeVisible();
  await expect(hero.locator('[data-button][data-variant="primary"]')).toHaveText("Count now");
  await expect(page.getByRole("navigation", { name: "Show" })).toHaveCount(0);
});

test("while every item has one state, the list has no filters: its group heading says it @responsive", async ({ page }) => {
  // The visual store's German products: nothing translated yet.
  await openApp(page, "visual", "/app/languages/de/products");
  // Each state as on the language page: its figure semibold, then what it means.
  const hero = region(page, "Progress: Products");
  await expect(hero.getByText(/^12 still missing$/)).toBeVisible();
  await expect(hero.locator("strong.lv-strong")).toHaveText("12");
  // "All 6" and "Missing 6" would show the same items.
  await expect(filters(page)).toHaveCount(0);
  expect(await groups(page)).toEqual(["Missing"]);
  await expect(page.getByText("Customers still see English here.")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("an unknown area or language is not found", async ({ page }) => {
  for (const path of ["/app/languages/de/everything", "/app/languages/xx/products"]) {
    const response = await openApp(page, "full", path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();
  }
});
