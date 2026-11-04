/**
 * The pages in Settings › Tools: glossary, translation memory, coverage and
 * Countries & markets. Each starts with its heading and the way back to
 * Settings › Tools, its cards named by their headings. Content,
 * accessibility, phone layout, the glossary's rules as tiles (side by side
 * on a phone), its plan gate before the form, a problem shown on its field,
 * replacing every term only after a question, a search that ends with its
 * field, languages chosen by name, an empty memory that leads on, and the
 * markets' permission asked as on the Content page.
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

/** A card of the page, by its heading. */
const card = (page: Page, heading: string) => page.getByRole("region", { name: heading, exact: true });

test("glossary: a term for one language, chosen by name @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/glossary");
  await expectToolHeader(page, "Glossary");
  const form = card(page, "Add a term");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // The card's heading a step above the rule's label, which reads as the other fields' labels do.
  const type = await form.evaluate((section) => ({
    heading: getComputedStyle(section.querySelector("h2")!).fontSize,
    legend: Number(getComputedStyle(section.querySelector("legend")!).fontWeight),
  }));
  expect(type.heading).toBe("17px");
  expect(type.legend).toBeLessThan(600);
  // On a phone the three rules stand side by side, the chosen one's sentence under them, so the term and its
  // button are on the first screen; on a wide page each tile says its own.
  const tiles = await form.locator("label.lv-tools-rule").evaluateAll((labels) => labels.map((l) => Math.round(l.getBoundingClientRect().top)));
  expect(new Set(tiles).size).toBe(1);
  const help = form.locator(".lv-tools-rules__help");
  if (info.project.name === "mobile") {
    await expect(help).toBeVisible();
    await expect(help).toHaveText("Brand and product names, SKUs: they stay exactly as they are.");
    const add = (await form.getByRole("button", { name: "Add term" }).boundingBox())!;
    expect(add.y + add.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  } else {
    await expect(help).toBeHidden();
  }

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
  const form = card(page, "Add a term");
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
  const form = card(page, "Add a term");
  await expect(form.locator("s-badge", { hasText: "Pro" })).toBeVisible();
  await expect(form.getByText("The glossary is part of the Pro and Business plans.")).toBeVisible();
  await expect(form.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/plan");
  await expect(form.getByRole("radio", { name: "Never translate" })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Add term" })).toBeDisabled();
  await expect(card(page, "As a CSV file").getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("glossary: replacing every term asks first and names how many go", async ({ page }) => {
  // The demo store has five terms; cancelling leaves them as they are.
  await openApp(page, "demo", "/app/glossary");
  const csv = card(page, "As a CSV file");
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
  await expect(card(page, "Terms (8)")).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search terms" });
  const rows = page.locator("s-table-row");
  await search.fill("Suche-C");
  await expect(rows).toHaveCount(1);

  // Deleting the one found leaves seven: no search, and every term listed, not "No term matches your search".
  await remove(rows);
  await expect(card(page, "Terms (7)")).toHaveCount(1);
  await expect(search).toHaveCount(0);
  await expect(rows).toHaveCount(7);
  await expect(page.getByText("No term matches your search.")).toHaveCount(0);

  // Eight again: the search comes back empty, over the whole list.
  const form = card(page, "Add a term");
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

test("translation memory: a language chosen by name applies at once; Search is for the words, on the fields' line @responsive", async ({ page }, info) => {
  // Opened on a language: the search shows whatever this shared store's memory holds by now.
  await openApp(page, "full", "/app/memory?lang=de");
  await expectToolHeader(page, "Translation memory");
  // The lead is one line on what the page is for.
  await expect(page.getByText("Every translation you publish is saved sentence by sentence and reused for the same text without AI, at no cost.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
  await expect(page).toHaveURL(/[?&]lang=fr/);
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("jacket");
  const button = page.getByRole("button", { name: "Search", exact: true });
  await button.click();
  await expect(page).toHaveURL(/[?&]q=jacket/);
  await expect(page).toHaveURL(/[?&]lang=fr/);
  const [field, pressed] = [(await search.boundingBox())!, (await button.boundingBox())!];
  if (info.project.name === "mobile") {
    // Under the fields at its own width, as the app's other buttons on a phone.
    expect(pressed.y).toBeGreaterThan(field.y + field.height);
    expect(pressed.width).toBeLessThan(page.viewportSize()!.width / 2);
    // The tool's sign level with the heading, not beside the lead's lines.
    const sign = (await page.locator(".lv-page-head .lv-icon-square").boundingBox())!;
    const heading = (await page.getByRole("heading", { level: 1, name: "Translation memory" }).boundingBox())!;
    expect(Math.abs(sign.y - heading.y)).toBeLessThanOrEqual(2);
  } else {
    // Beside the fields, on their line, not on their labels' (24 px higher before; the input sits inside its frame).
    expect(Math.abs(pressed.y + pressed.height - (field.y + field.height))).toBeLessThanOrEqual(8);
  }
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("translation memory: an empty memory says what fills it and leads there, without zero figures or a search @responsive", async ({ page }) => {
  // A store without a catalog: nothing was ever published, so nothing is remembered.
  await openApp(page, "emptyCatalog", "/app/memory");
  await expectToolHeader(page, "Translation memory");
  await expect(page.getByRole("heading", { level: 2, name: "Nothing in your memory yet" })).toBeVisible();
  await expect(page.getByText("It fills up as you publish translations. Your memory belongs to your store alone.")).toBeVisible();
  const start = page.locator("[data-button]", { hasText: "Translate content" });
  await expect(start).toHaveAttribute("href", "/app/content");
  await expect(start).toHaveAttribute("data-variant", "primary");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator(".lv-tools-figures")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("coverage report and Countries & markets explain what they do @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage");
  await expectToolHeader(page, "Coverage in detail");
  // The Overview's words for the same count.
  await expect(page.getByRole("button", { name: "Count translations again" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Markets needs an optional permission the test store didn't grant: a prompt, not an error, asked as the
  // Content page asks for one: what it shows, the button with the Overview's words, and what happens next.
  const response = await openApp(page, "full", "/app/markets");
  expect(response?.status()).toBe(200);
  await expectToolHeader(page, "Countries & markets");
  const access = card(page, "See your languages per market");
  await expect(access.getByRole("list", { name: "What you see with it" }).getByRole("listitem")).toHaveText(["Languages per market", "Web addresses", "What hides a translation"]);
  await expect(access.getByRole("button", { name: "Allow access to markets" })).toBeVisible();
  await expect(access.getByText("You confirm it once in Shopify.")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("Countries & markets: the checks first, each with its fix, in the interface's language names @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/markets", { locale: "de" });
  await expect(page.getByRole("heading", { level: 1, name: "Länder & Märkte" })).toBeVisible();
  const checks = card(page, "Hinweise");
  // German's own name, never Shopify's English one; the fix beside it.
  await expect(checks.getByText(/^Deutsch ist veröffentlicht, wird aber von keinem aktiven Markt angeboten/)).toBeVisible();
  await expect(checks.getByRole("link", { name: "Märkte in Shopify öffnen" }).first()).toHaveAttribute("href", "shopify://admin/settings/markets");
  await expect(card(page, "Länder und ihre Sprachen").locator("s-table").getByText("Spanisch (versteckt)")).toBeVisible();
  // The markets themselves are folded under the countries.
  const details = page.locator("details", { hasText: "Märkte im Detail (3)" });
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details.getByRole("heading", { name: "North America" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
