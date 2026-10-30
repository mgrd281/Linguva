/**
 * All other Shopify content in the browser: the Content page (the store area
 * by area for one language, the permission card, More texts and the folds),
 * a menu from list to published translation, theme content with search and
 * pages, and the permission prompt for content behind an optional scope.
 */
import { expect, test } from "@playwright/test";
import { contentRef } from "../../app/lib/resource-kinds";
import { UI_ENV, UI_SHOPS, UI_THEME_GID } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, openApp, expectToast, sessionToken } from "./helpers";

test("the content page shows the store area by area for one language @responsive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page, "full", "/app/content?lang=de");
  await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();

  // The languages: visible ones by name, the hidden one last; the shown one is no link.
  const languages = page.getByRole("navigation", { name: "Choose a language" });
  await expect(languages.locator('li s-text[type="strong"]')).toHaveText(["French", "German", "Arabic"]);
  await expect(languages.locator('[aria-current="page"]')).toHaveText(/German/);
  await expect(languages.getByRole("link", { name: /^French: / })).toHaveAttribute("href", "/app/content?lang=fr");
  await expect(languages.locator("li", { hasText: "Arabic" })).toContainText("hidden");
  // When it was counted, as the language page says it, never "today"; the way to its next steps.
  await expect(page.getByText(/^Last counted .+ UTC$/)).toBeVisible();
  await expect(page.locator("s-page")).not.toContainText(/today/i);
  await expect(page.getByRole("link", { name: "Next steps for German" })).toHaveAttribute("href", "/app/languages/de");

  // One card for what Linguva may not read, with one button that asks for all of it.
  await expect(page.getByRole("heading", { name: "Linguva can't read everything yet" })).toBeVisible();
  await expect(page.locator("s-chip", { hasText: "Legal texts" })).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Allow access" })).toHaveCount(1);
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  expect(await page.locator('form input[name="scope"]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))).toEqual(["read_legal_policies"]);

  // Each area is one link to its list in this language, with its figure in the link's name.
  await expect(page.getByRole("link", { name: /^Products: \d+% translated\. / })).toHaveAttribute("href", "/app/languages/de/products");
  await expect(page.getByRole("link", { name: /^Menus & filters/ })).toHaveAttribute("href", "/app/languages/de/navigation");
  // Store & checkout: no figure while legal texts are refused, and why.
  await expect(page.getByRole("link", { name: "Store & checkout. No access: Legal texts." })).toBeVisible();

  // More texts: the theme's parts open below their row, each a link to its list in the language.
  const theme = page.locator("details#theme");
  await expect(theme).not.toHaveAttribute("open");
  await theme.locator("summary").click();
  await expect(theme).toHaveAttribute("open", "");
  await expect(theme.getByRole("link", { name: /^Texts in templates/ })).toHaveAttribute("href", "/app/content/theme-templates?lang=de");
  await expect(page.getByRole("link", { name: /^Web addresses/ })).toHaveAttribute("href", "/app/coverage/items?lang=de&group=url");

  // What isn't in the store yet, folded, with its count.
  const empty = page.locator("summary", { hasText: "Not in your store yet" });
  await expect(empty.locator("s-badge")).toHaveText("17");
  await empty.click();
  await expect(page.getByText("As soon as you add any of these in Shopify, they appear above.")).toBeVisible();

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("without ?lang the page and the lists open in a visible language, never the hidden one", async ({ page }) => {
  await openApp(page, "full", "/app/content");
  const current = page.getByRole("navigation", { name: "Choose a language" }).locator('[aria-current="page"]');
  await expect(current).toHaveText(/German|French/);
  await expect(current).not.toHaveText(/Arabic/);

  await openApp(page, "full", "/app/content/menus");
  await expect(page.locator('s-badge[tone="info"]')).toHaveText("French");
  // The hidden language is marked; the way back keeps the list's language.
  await expect(page.getByRole("link", { name: "Arabic (hidden)" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Content" })).toHaveAttribute("href", "/app/content?lang=fr");
});

test("the permission request asks for allow-listed content scopes only", async ({ page }) => {
  await openApp(page, "full", "/app/content");
  for (const scope of ["read_markets", "write_products"]) {
    const response = await page.request.post(new URL("/app/content.data", UI_ENV.appUrl).toString(), {
      headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS.full.domain)}` },
      form: { intent: "request-scope", scope },
      maxRedirects: 0,
    });
    // Answered by the page itself ({ ok: false }): no redirect to Shopify's permission screen.
    expect(response.status(), scope).toBe(200);
    expect(response.headers()["x-shopify-api-request-failure-reauthorize-url"], scope).toBeUndefined();
    expect(response.headers()["location"], scope).toBeUndefined();
    expect(await response.text(), scope).toMatch(/"ok",false/);
  }
});

test("the theme's and notifications' groups open from a language page, in its language", async ({ page }) => {
  await openApp(page, "full", "/app/content?lang=fr&open=theme");
  await expect(page.locator("details#theme")).toHaveAttribute("open", "");
  await expect(page.locator("details#theme").getByRole("link", { name: /^Texts in templates/ })).toHaveAttribute("href", "/app/content/theme-templates?lang=fr");
  // Keyboard: the row opens and closes with Enter, like any disclosure.
  const summary = page.locator("details#theme > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details#theme")).not.toHaveAttribute("open");
  await page.keyboard.press("Space");
  await expect(page.locator("details#theme")).toHaveAttribute("open", "");
});

test("a language not counted yet says so, offers counting and shows no figures @responsive", async ({ page }) => {
  // The owner's store is never counted (the Overview's test starts a count in the "measure" store).
  await openApp(page, "owner", "/app/content");
  await expect(page.getByRole("heading", { name: "German isn't counted yet" })).toBeVisible();
  await expect(page.locator('s-button[variant="primary"]', { hasText: "Count now" })).toHaveCount(1);
  await expect(page.getByText(/^Last counted/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Products. Not counted yet." })).toHaveAttribute("href", "/app/languages/de/products");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store with many languages picks one in a select, shown on request", async ({ page }) => {
  await openApp(page, "stalled", "/app/content");
  const select = page.locator('s-select[name="lang"]');
  await expect(select).toHaveAttribute("label", "Language");
  await expect(page.getByRole("navigation", { name: "Choose a language" }).locator("li")).toHaveCount(0);
  await expect(page.locator("s-button", { hasText: "Show" })).toBeVisible();
  await expectAccessible(page);
});

test("without an additional language the page says where to add one", async ({ page }) => {
  await openApp(page, "empty", "/app/content");
  await expect(page.getByRole("heading", { name: "No language to translate into yet" })).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Open language settings" })).toHaveAttribute("href", "shopify://admin/settings/languages");
  await expect(page.getByText("Nothing to translate yet.", { exact: false })).toBeVisible();
  await expectAccessible(page);
});

test("a menu: list, AI draft, publish, read back", async ({ page }) => {
  await openApp(page, "full", "/app/content/menus?lang=de");
  await page.getByRole("link", { name: "Main menu" }).click();
  await expect(page.getByText("English → German")).toBeVisible();
  // No storefront search preview for menus.
  await expect(page.getByText("Search engine listing")).toHaveCount(0);
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Main menu");
  await page.locator('s-text-field[name="value:title"] input').fill("Hauptmenü");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);

  await openApp(page, "full", "/app/content/menus?lang=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expectAccessible(page);
});

test("theme content with many texts is searched and paged @responsive", async ({ page }) => {
  await openApp(page, "full", `/app/content/theme-templates/${contentRef(UI_THEME_GID)}?lang=de`);
  await expect(page.locator('s-section[heading="120 texts"]')).toHaveCount(1);
  await expect(page.getByText(/Showing 1–50 of 120/)).toBeVisible();
  await page.locator("s-button", { hasText: "Next" }).click();
  await expect(page.getByText(/Showing 51–100 of 120/)).toBeVisible();

  await page.locator('s-search-field[name="q"] input').fill("free shipping");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/Showing 1–1 of 1 matching/)).toBeVisible();
  await expect(page.getByText("Free shipping over 50 €")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("content behind a permission asks for it instead of failing", async ({ page }) => {
  const response = await openApp(page, "full", "/app/content/policies?lang=de");
  expect(response?.status()).toBe(200);
  await expect(page.locator('s-section[heading="Allow Linguva to read your policies"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Allow access" })).toBeVisible();
  await expectAccessible(page);
});

test("an invalid content reference is a not-found page", async ({ page }) => {
  const response = await openApp(page, "full", "/app/content/menus/not-a-valid-ref!?lang=de");
  expect(response?.status()).toBe(404);
  await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();
});

test("bulk translation offers image alt text and custom fields where a type has them", async ({ page }) => {
  await openApp(page, "full", "/app/products?lang=de");
  const option = page.getByRole("checkbox", { name: "Also translate image alt text and custom fields" });
  await expect(option).toBeVisible();
  await expect(option).not.toBeChecked();
  await expect(page.getByText("so the job takes longer")).toBeVisible();

  await openApp(page, "full", "/app/content/menus?lang=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Also translate image alt text and custom fields" })).toHaveCount(0);
});
