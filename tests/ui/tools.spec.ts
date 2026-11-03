/**
 * The pages in Settings › Tools: glossary, translation memory, coverage and
 * Countries & markets. Each starts with its heading and the way back to
 * Settings › Tools. Content, accessibility, phone layout, the glossary's
 * rules as tiles, its plan gate before the form, a problem shown on its
 * field, replacing every term only after a question, a search that ends
 * with its field, and languages chosen by name.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp } from "./helpers";

/** The page's heading, and the way back to Settings › Tools: the trail's link on a wide page, the 44 px back row on a phone. */
async function expectToolHeader(page: Page, heading: string) {
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const back = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Tools" });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", "/app/settings?section=tools");
}

test("glossary: a term for one language, chosen by name @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/glossary");
  await expectToolHeader(page, "Glossary");
  const form = page.locator('s-section[heading="Add a term"]');
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  const term = `Merino-${info.project.name}`;
  // The three rules are tiles, one radio each; "Never translate" is the first choice.
  const rules = form.getByRole("group", { name: "Rule" });
  await expect(rules.getByRole("radio")).toHaveCount(3);
  await expect(rules.getByRole("radio", { name: "Never translate" })).toBeChecked();
  // Only "Always translate as" has a translation of its own.
  await expect(form.locator('s-text-field[name="translation"]')).toHaveCount(0);
  await form.getByRole("textbox", { name: "Term" }).fill(term);
  await form.getByRole("combobox", { name: "Language" }).selectOption({ label: "German" });
  await form.getByRole("button", { name: "Add term" }).click();
  await expectToast(page, "Term added");

  const row = page.locator("s-table-row", { hasText: term });
  await expect(row).toHaveCount(1);
  // Shown by name, not by code.
  await expect(row.getByText("German", { exact: true })).toBeVisible();
  // The form starts over for the next term.
  await expect(form.locator('s-text-field[name="term"] input')).toHaveValue("");
  // Deleting asks first.
  await row.getByRole("button", { name: "Delete" }).click();
  await page.locator("s-modal#glossary-delete").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("s-table-row", { hasText: term })).toHaveCount(0);
});

test("glossary: “Always translate as” is for one language and asks for its word on the field; nothing is added", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  const form = page.locator('s-section[heading="Add a term"]');
  await form.getByRole("radio", { name: "Always translate as" }).check();
  await expect(form.getByRole("radio", { name: "Always translate as" })).toBeChecked();
  // One language: no "All languages" then, and the word to use gets its own field.
  await expect(form.locator('s-select[name="targetLocale"] s-option[value="all"]')).toHaveCount(0);
  await expect(form.locator('s-text-field[name="translation"]')).toHaveCount(1);
  await form.getByRole("textbox", { name: "Term" }).fill("Wrong word");
  await form.getByRole("button", { name: "Add term" }).click();
  await expect(form.locator('s-text-field[name="translation"]')).toHaveAttribute("error", "Enter the word AI should always use.");
  await expect(page.locator("s-table-row", { hasText: "Wrong word" })).toHaveCount(0);
});

test("glossary: a plan without the glossary says so before the form, and the form can't be used @responsive", async ({ page }) => {
  // Starter: no glossary to edit (Pro and Business have one).
  await openApp(page, "emptyCatalog", "/app/glossary");
  const form = page.locator('s-section[heading="Add a term"]');
  await expect(form.locator("s-badge", { hasText: "Pro" })).toBeVisible();
  await expect(form.getByText("The glossary is part of the Pro and Business plans.")).toBeVisible();
  await expect(form.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/plan");
  await expect(form.getByRole("radio", { name: "Never translate" })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Add term" })).toBeDisabled();
  await expect(page.locator('s-section[heading="As a CSV file"]').getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("glossary: replacing every term asks first and names how many go", async ({ page }) => {
  // The demo store has five terms; cancelling leaves them as they are.
  await openApp(page, "demo", "/app/glossary");
  const csv = page.locator('s-section[heading="As a CSV file"]');
  await csv.getByRole("checkbox", { name: "Replace all existing terms" }).check();
  await csv.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Replace all 5 terms?" })).toBeVisible();
  await page.locator("s-modal#glossary-replace").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Replace all 5 terms?" })).toBeHidden();
  await expect(page.locator("s-table-row")).toHaveCount(5);
});

test("glossary: a search ends with its field, so a shorter list shows every term again", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"].map((letter) => `Lv-Suche-${letter}`);
  const remove = async (row: Locator) => {
    await row.getByRole("button", { name: "Delete" }).click();
    await page.locator("s-modal#glossary-delete").getByRole("button", { name: "Delete", exact: true }).click();
  };
  // Eight terms: the list gets its search.
  await page.locator('s-drop-zone[name="file"] input[type="file"]').setInputFiles({
    name: "terms.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["rule,term,translation,target_locale,market,case_sensitive,notes", ...names.map((name) => `DO_NOT_TRANSLATE,${name},,,,,`)].join("\n")),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expectToast(page, "8 terms imported.");
  await expect(page.locator('s-section[heading="Terms (8)"]')).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search terms" });
  const rows = page.locator("s-table-row");
  await search.fill("Suche-C");
  await expect(rows).toHaveCount(1);

  // Deleting the one found leaves seven: no search, and every term listed, not "No term matches your search".
  await remove(rows);
  await expect(page.locator('s-section[heading="Terms (7)"]')).toHaveCount(1);
  await expect(search).toHaveCount(0);
  await expect(rows).toHaveCount(7);
  await expect(page.getByText("No term matches your search.")).toHaveCount(0);

  // Eight again: the search comes back empty, over the whole list.
  const form = page.locator('s-section[heading="Add a term"]');
  await form.getByRole("textbox", { name: "Term" }).fill("Lv-Suche-C");
  await form.getByRole("button", { name: "Add term" }).click();
  await expectToast(page, "Term added");
  await expect(search).toHaveValue("");
  await expect(rows).toHaveCount(8);

  // Clean up for other tests.
  for (const name of names) {
    const row = page.locator("s-table-row", { hasText: name });
    await remove(row);
    await expect(row).toHaveCount(0);
  }
});

test("translation memory: search with a language chosen by name @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/memory");
  await expectToolHeader(page, "Translation memory");
  await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/lang=fr/);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("coverage report and Countries & markets explain what they do @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage");
  await expectToolHeader(page, "Coverage in detail");
  await expect(page.getByRole("button", { name: "Count store again" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Markets needs an optional permission the test store didn't grant: a prompt, not an error.
  const response = await openApp(page, "full", "/app/markets");
  expect(response?.status()).toBe(200);
  await expectToolHeader(page, "Countries & markets");
  await expect(page.getByRole("button", { name: "Allow reading markets" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("Countries & markets: the checks first, each with its fix, in the interface's language names @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/markets", { locale: "de" });
  await expect(page.getByRole("heading", { level: 1, name: "Länder & Märkte" })).toBeVisible();
  const checks = page.locator('s-section[heading="Hinweise"]');
  // German's own name, never Shopify's English one; the fix beside it.
  await expect(checks.getByText(/^Deutsch ist veröffentlicht, wird aber von keinem aktiven Markt angeboten/)).toBeVisible();
  await expect(checks.getByRole("link", { name: "Märkte in Shopify öffnen" }).first()).toHaveAttribute("href", "shopify://admin/settings/markets");
  await expect(page.locator('s-section[heading="Länder und ihre Sprachen"] s-table').getByText("Spanisch (versteckt)")).toBeVisible();
  // The markets themselves are folded under the countries.
  const details = page.locator("details", { hasText: "Märkte im Detail (3)" });
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details.getByRole("heading", { name: "North America" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
