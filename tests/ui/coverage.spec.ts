/**
 * The coverage dashboard ("Coverage in detail") and its drill-down on the
 * production build, with the count seeded in global-setup (full store:
 * German partly translated and partly outdated, French AI drafts waiting,
 * Arabic hidden, theme texts, policies without access). The drill-down's
 * exact figures come from a store no other test changes (coverageItems:
 * German like the full store's products), so they hold in any order of the
 * specs. Counting is "count" here as everywhere ("review" means approving),
 * with the Overview's words ("Count translations again"), and a row's bulk
 * translation asks first. A type's row counts what its next step counts.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** A card of the page, by its heading. */
const card = (page: Page, heading: string) => page.getByRole("region", { name: heading, exact: true });

test("shows the whole store, one language at a time and what to do next @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/coverage");

  // Whole store: published languages only (Arabic isn't published), all of them read in full.
  const store = card(page, "Whole store");
  // Counted: when, quietly, beside the way to count again, at the card's foot (as on the Overview).
  await expect(store.getByRole("button", { name: "Count translations again" })).toBeVisible();
  await expect(store.getByText(/^Last counted:/)).toBeVisible();
  await expect(store).toContainText("texts live in published languages");
  await expect(page.getByRole("img", { name: /^Whole store coverage:/ })).toBeVisible();
  // Policies need a scope the store didn't grant: never counted, so named beside the figure.
  await expect(store).toContainText("Not in this figure: 1 content type Linguva can't read yet.");
  await expect(store.getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");

  // French drafts wait in Review: the next step says so and links there. It comes first: on the left on a
  // wide page, on top on a phone.
  const next = card(page, "Next step");
  const [first, second] = [(await next.boundingBox())!, (await store.boundingBox())!];
  if (info.project.name === "mobile") expect(first.y + first.height).toBeLessThanOrEqual(second.y);
  else {
    expect(first.x + first.width).toBeLessThanOrEqual(second.x);
    expect(Math.round(first.height)).toBe(Math.round(second.height));
  }
  await expect(next).toContainText(/Review \d+ drafts in French/);
  await expect(next.locator('[data-button][href^="/app/review?lang=fr"]')).toHaveCount(1);
  // The action says what it does, not just "Open".
  await expect(next.getByRole("link", { name: "Review drafts" })).toBeVisible();
  // The whole-store bar has a key with every state that has texts.
  await expect(store).toContainText(/Complete \d+/);
  await expect(store).toContainText(/Draft \d+/);
  // How it's counted: folded away, opens on demand.
  const rules = page.locator("details", { hasText: "How coverage is counted" });
  await expect(rules).not.toHaveAttribute("open");
  await rules.locator("summary").click();
  await expect(rules).toHaveAttribute("open", "");
  await expect(rules.getByText(/Percentages are rounded down/)).toBeVisible();

  // The languages as the Content page's chips: the one shown below in the chosen look, the others links, the hidden one marked.
  const languages = card(page, "Languages");
  const chips = languages.getByRole("navigation", { name: "Language" });
  await expect(chips.locator('[aria-current="page"]')).toContainText("French");
  await expect(chips.getByRole("link", { name: /^German: \d+% translated$/ })).toHaveAttribute("href", "/app/coverage?lang=de");
  await expect(chips.getByRole("link", { name: /^Arabic \(hidden\): / })).toBeVisible();
  // The shown language: its states and the way to its own page. Its name, whether it's hidden and its figure
  // are the chip's: the box names it for screen readers only, without a second badge or figure.
  await expect(languages.getByRole("heading", { level: 3, name: "French" })).toHaveCount(1);
  await expect(languages.locator("s-badge")).toHaveCount(0);
  await expect(languages.locator(".lv-figure")).toHaveCount(0);
  await expect(languages.getByRole("img", { name: /^French: coverage: / })).toBeVisible();
  await expect(languages.getByRole("link", { name: "Next steps for French" })).toHaveAttribute("href", "/app/languages/fr");

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("by content type: in the merchant's words; excluded, unavailable and empty types are told apart; translating asks first", async ({ page }) => {
  await openApp(page, "full", "/app/coverage?lang=de");
  const types = card(page, "German by content type");
  await expect(types).toBeVisible();
  const row = (name: string) => types.locator("s-table-row", { has: page.getByText(name, { exact: true }) });
  await expect(row("Products")).toContainText("Show items");
  await expect(row("Products")).toContainText(/\d+ of \d+/);
  // Web addresses are counted on their own row below: named beside the type's figure, not in it.
  await expect(row("Products")).toContainText(/\+ \d+ web address(es)?, not in the totals/);
  // Theme texts are counted on their own row, not in the totals.
  await expect(row("Texts in templates")).toContainText("Not in the totals");
  // No access to policies (optional scope not granted): not a counting failure.
  await expect(row("Legal texts")).toContainText("no access to this content yet");
  await expect(row("Legal texts").getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");
  await expect(types).toContainText(/Types with nothing to translate are hidden: \d+/);

  const fields = card(page, "German by kind of text");
  await expect(fields.getByText("Titles and names", { exact: true })).toBeVisible();
  await expect(fields.getByText("Google titles", { exact: true })).toBeVisible();
  await expect(fields).toContainText("Web addresses are optional and not in the totals");
  await expectAccessible(page);

  // A row's "Translate" starts nothing yet: it asks first, with what it translates and the AI characters.
  await row("Products").getByRole("button", { name: "Translate: Products, German" }).click();
  const dialog = page.getByRole("dialog", { name: "Translate Products into German?" });
  await expect(dialog).toBeVisible();
  // The dialog's words are the modal's own (slotted) children.
  const modal = page.locator("s-modal#coverage-translate");
  await expect(modal).toContainText(/Up to \d+ texts?: /);
  await expect(modal).toContainText("AI characters");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/coverage\?lang=de/);
});

test("a number opens the exact items behind it, filtered and paged", async ({ page }) => {
  await openApp(page, "coverageItems", "/app/coverage?lang=de");
  // The next step says what is open, in words any language's grammar takes, and its button opens it; the
  // type's row counts the same texts (its web addresses apart): complete and open add up to its total.
  const next = card(page, "Next step");
  const step = /^Products: (\d+) texts are missing or outdated in German$/.exec(((await next.locator("s-paragraph").textContent()) ?? "").trim());
  expect(step, "the next step's words").not.toBeNull();
  await expect(next.getByRole("link", { name: "Show what's missing" })).toHaveAttribute("href", "/app/coverage/items?lang=de&type=PRODUCT");
  const products = card(page, "German by content type").locator("s-table-row", { has: page.getByText("Products", { exact: true }) });
  const figure = /(\d+) of (\d+)/.exec((await products.textContent()) ?? "");
  expect(Number(figure![1]) + Number(step![1])).toBe(Number(figure![2]));
  await card(page, "Languages").getByRole("link", { name: /^Outdated: \d+ texts?/ }).click();
  await expect(page).toHaveURL(/\/app\/coverage\/items\?lang=de&state=outdated/);
  await expect(page.getByRole("heading", { level: 1, name: "Coverage by item" })).toBeVisible();
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
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=product\+25/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Product 25 jacket");

  // Bulk actions for the chosen type and language: the button asks first.
  await expect(card(page, "Translate in bulk")).toContainText("Translates missing, outdated and failed texts of Products into German");
  await page.getByRole("button", { name: "Translate missing and outdated" }).click();
  await expect(page.getByRole("dialog", { name: "Translate Products into German?" })).toBeVisible();
  await page.locator("s-modal#coverage-items-translate").getByRole("button", { name: "Cancel", exact: true }).click();
  // The page is checked once the question has closed: while it fades out, axe measures half-transparent text.
  await expect(page.getByRole("dialog", { name: "Translate Products into German?" })).toBeHidden();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a choice of the drill-down applies at once, without a button @responsive", async ({ page }) => {
  await openApp(page, "coverageItems", "/app/coverage/items?lang=de&type=PRODUCT");
  await page.getByRole("combobox", { name: "State" }).selectOption("outdated");
  await expect(page).toHaveURL(/state=outdated/);
  await expect(page.locator("s-table-body s-table-row")).toHaveCount(1);
});

test("search is offered only where Shopify can search @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage/items?lang=de&type=MENU&q=main");
  await expect(page.getByText(/Title search works for products, collections, pages, blog posts and blogs/)).toBeVisible();
  await expect(card(page, "Translate in bulk")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store that was never counted explains counting instead of showing zeros", async ({ page }) => {
  await openApp(page, "emptyCatalog", "/app/coverage");
  // Counting has a card of its own until the store is counted, with the page's one primary button.
  const count = page.locator("[data-button]", { hasText: "Count translations" });
  await expect(count).toHaveAttribute("data-variant", "primary");
  await expect(page.getByText(/hasn't been counted yet/)).toBeVisible();
  await expect(card(page, "Whole store")).toHaveCount(0);
  await expect(page.getByText(/(^|\s)0\s?%/)).toHaveCount(0);
  await expectAccessible(page);
});
