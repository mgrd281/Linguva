/**
 * The coverage dashboard and its drill-down on the production build, with
 * the scan seeded in global-setup (full store: German partly translated and
 * partly outdated, French AI drafts waiting, Arabic unpublished, theme texts,
 * policies without access). The drill-down's exact figures come from a store
 * no other test changes (coverageItems: German like the full store's
 * products), so they hold in any order of the specs.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("shows the whole store, each language and what to do next @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage");
  await expect(page.getByRole("button", { name: "Rescan store" })).toBeVisible();
  await expect(page.getByText(/^Last full scan:/)).toBeVisible();

  // Whole store: published languages only (Arabic isn't published), all of them read in full.
  const store = page.locator('s-section[heading="Whole store"]');
  await expect(store).toContainText("fields live in published languages");
  await expect(page.getByRole("img", { name: /^Whole store coverage:/ })).toBeVisible();
  // Policies need a scope the store didn't grant: never checked, so named beside the figure.
  await expect(store).toContainText("Not in this figure: 1 content type Linguva can't read yet.");
  await expect(store.getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");

  // French drafts wait in Review: the next step says so and links there.
  const next = page.locator('s-section[heading="Next step"]');
  await expect(next).toContainText(/Review \d+ drafts in French/);
  await expect(next.locator('s-button[href^="/app/review?lang=fr"]')).toHaveCount(1);
  // The action says what it does, not just "Open".
  await expect(next.getByRole("link", { name: "Review drafts" })).toBeVisible();
  // The whole-store bar has a key with every state that has fields.
  await expect(page.locator('s-section[heading="Whole store"]')).toContainText(/Complete \d+/);
  await expect(page.locator('s-section[heading="Whole store"]')).toContainText(/Draft \d+/);
  // How it's counted: folded away, opens on demand.
  const rules = page.locator("details", { hasText: "How coverage is counted" });
  await expect(rules).not.toHaveAttribute("open");
  await rules.locator("summary").click();
  await expect(rules).toHaveAttribute("open", "");
  await expect(rules.getByText(/Percentages are rounded down/)).toBeVisible();

  // One card per target language, the unpublished one marked.
  const languages = page.locator('s-section[heading="Languages"]');
  for (const name of ["German", "French", "Arabic"]) await expect(languages.getByRole("heading", { name })).toBeVisible();
  // Each card's name opens the language's own page.
  await expect(languages.getByRole("link", { name: "German", exact: true })).toHaveAttribute("href", "/app/languages/de");
  await expect(languages.locator("s-badge", { hasText: "Not published" })).toHaveCount(1);
  await expect(languages.getByRole("img", { name: /^German: coverage: Complete \d+/ })).toBeVisible();

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("by content type: excluded, unavailable and empty types are told apart", async ({ page }) => {
  await openApp(page, "full", "/app/coverage?lang=de");
  const types = page.locator('s-section[heading="German by content type"]');
  await expect(types).toBeVisible();
  const row = (name: string) => types.locator("s-table-row", { has: page.getByText(name, { exact: true }) });
  await expect(row("Products")).toContainText("Show items");
  await expect(row("Products")).toContainText(/\d+ of \d+/);
  // Theme texts are counted on their own row, not in the totals.
  await expect(row("Theme templates")).toContainText("Not in the totals");
  // No access to policies (optional scope not granted): not a scan failure.
  await expect(row("Policies")).toContainText("no access to this content yet");
  await expect(row("Policies").getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");
  await expect(types).toContainText(/Types with nothing to translate are hidden: \d+/);

  const fields = page.locator('s-section[heading="German by field"]');
  await expect(fields.getByText("Titles and names", { exact: true })).toBeVisible();
  await expect(fields).toContainText("URLs are optional and not in the totals");
  await expectAccessible(page);
});

test("a number opens the exact items behind it, filtered and paged", async ({ page }) => {
  await openApp(page, "coverageItems", "/app/coverage?lang=de");
  const legend = page.locator('s-section[heading="Languages"] s-box', { has: page.getByRole("heading", { name: "German" }) });
  await legend.getByRole("link", { name: /^Outdated: \d+ fields?/ }).click();
  await expect(page).toHaveURL(/\/app\/coverage\/items\?lang=de&state=outdated/);
  await expect(page.getByRole("combobox", { name: "State" })).toHaveValue("outdated");
  // Product 2's description changed after it was translated.
  const rows = page.locator("s-table-body s-table-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Product 2 jacket");
  await expect(rows.first()).toContainText("Outdated: Descriptions");
  await expect(rows.first().getByRole("link", { name: "Product 2 jacket" })).toHaveAttribute("href", "/app/products/2?lang=de");

  // Missing titles of products, paged 50 at a time; search by title.
  await openApp(page, "coverageItems", "/app/coverage/items?lang=de&type=PRODUCT&group=title&state=missing");
  await expect(rows).toHaveCount(20);
  await page.getByRole("searchbox", { name: "Search titles" }).fill("product 25");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/q=product\+25/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Product 25 jacket");

  // Bulk actions for the chosen type and language.
  await expect(page.locator('s-section[heading="Translate in bulk"]')).toContainText("Translates missing, outdated and failed fields of Products into German");
  await expect(page.getByRole("button", { name: "Translate missing and outdated" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("search is offered only where Shopify can search @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage/items?lang=de&type=MENU&q=main");
  await expect(page.getByText(/Title search works for products, collections, pages, blog posts and blogs/)).toBeVisible();
  await expect(page.locator('s-section[heading="Translate in bulk"]')).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store that was never scanned explains the scan instead of showing zeros", async ({ page }) => {
  await openApp(page, "emptyCatalog", "/app/coverage");
  await expect(page.getByRole("button", { name: "Scan store" })).toBeVisible();
  await expect(page.getByText(/hasn't been scanned yet/)).toBeVisible();
  await expect(page.locator('s-section[heading="Whole store"]')).toHaveCount(0);
  await expect(page.getByText(/(^|\s)0\s?%/)).toHaveCount(0);
  await expectAccessible(page);
});
