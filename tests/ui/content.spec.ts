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

  // The languages: visible ones by name, the hidden one last; the shown one is no link, in the chosen look (blue ring and tint).
  const languages = page.getByRole("navigation", { name: "Choose a language" });
  await expect(languages.locator("li")).toHaveText([/^French/, /^German/, /^Arabic/]);
  const current = languages.locator('[aria-current="page"]');
  await expect(current).toHaveText(/German/);
  await expect(current).toHaveCSS("background-color", "rgb(245, 249, 255)");
  await expect(current).toHaveCSS("box-shadow", /rgb\(0, 91, 211\)/);
  // A chip names its language only: the figures are on the tiles below and on the language's own page.
  await expect(languages.getByRole("link", { name: "French", exact: true })).toHaveAttribute("href", "/app/content?lang=fr");
  await expect(languages).not.toContainText("%");
  await expect(languages.locator("li", { hasText: "Arabic" })).toContainText("hidden");
  // When it was counted, as the language page says it, never "today"; the way to its next steps (whose trail leads back here).
  // In the store's time zone (Europe/Berlin in the fixtures), so without "UTC".
  await expect(page.getByText(/^Last counted .+\d{1,2}:\d{2}\s?[AP]M$/)).toBeVisible();
  await expect(page.locator("s-page")).not.toContainText(/today/i);
  await expect(page.getByRole("link", { name: "Next steps for German" })).toHaveAttribute("href", "/app/languages/de?from=content");

  // One card for what Linguva may not read, with one button that asks for all of it.
  await expect(page.getByRole("heading", { name: "Linguva can't read everything yet" })).toBeVisible();
  await expect(page.locator("s-chip", { hasText: "Legal texts" })).toBeVisible();
  await expect(page.locator("[data-button]", { hasText: "Allow access" })).toHaveCount(1);
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  expect(await page.locator('form input[name="scope"]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))).toEqual(["read_legal_policies"]);

  // Each area is one link to its list in this language, with its figure in the link's name.
  await expect(page.getByRole("link", { name: /^Products: \d+% translated\. / })).toHaveAttribute("href", "/app/languages/de/products?from=content");
  await expect(page.getByRole("link", { name: /^Menus & filters/ })).toHaveAttribute("href", "/app/languages/de/navigation?from=content");
  // Store & checkout: no figure while legal texts are refused, and why.
  await expect(page.getByRole("link", { name: "Store & checkout. No access: Legal texts." })).toBeVisible();
  // The tiers are groups, not steps: their headings carry no number.
  await expect(page.getByRole("heading", { level: 3, name: "What customers see first" })).toBeVisible();
  // Each permission's chip shows what it unlocks (legal texts: a contract).
  await expect(page.locator("s-chip", { hasText: "Legal texts" }).locator('s-icon[type="contract"]')).toHaveCount(1);

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

test("the key names only the states the tiles draw, and an area's name has its card's size @responsive", async ({ page }) => {
  // The visual store's German: nothing translated yet.
  await openApp(page, "visual", "/app/content?lang=de");
  const key = page.getByText(/^(Done|Waiting for approval|Outdated|Failed|Missing)$/).filter({ visible: true });
  expect(await key.allInnerTexts()).toEqual(["Missing"]);
  // The same name and size as the area's card on the language page.
  await expect(page.locator(".lv-h3", { hasText: /^Products$/ })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("without ?lang the page and the lists open in a visible language, never the hidden one", async ({ page }) => {
  await openApp(page, "full", "/app/content");
  const current = page.getByRole("navigation", { name: "Choose a language" }).locator('[aria-current="page"]');
  await expect(current).toHaveText(/German|French/);
  await expect(current).not.toHaveText(/Arabic/);

  await openApp(page, "full", "/app/content/menus");
  // The list's current language is Content's chip in the chosen look.
  await expect(page.locator('.lv-lang[aria-current="page"]', { hasText: "French" })).toBeVisible();
  // The hidden language is marked; the way back keeps the list's language.
  await expect(page.getByRole("link", { name: "Arabic (hidden)" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Content" })).toHaveAttribute("href", "/app/content?lang=fr");
});

test("opened from Content, a language's page and its areas lead back here", async ({ page }) => {
  await openApp(page, "full", "/app/content?lang=de");
  await page.getByRole("link", { name: "Next steps for German" }).click();
  await expect(page).toHaveURL(/\/app\/languages\/de\?from=content/);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Content" })).toHaveAttribute("href", "/app/content?lang=de");
  await expect(crumbs.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Products", exact: true }).getByRole("link", { name: /^View all \d+: Products$/ })).toHaveAttribute(
    "href",
    "/app/languages/de/products?from=content",
  );

  await openApp(page, "full", "/app/languages/de/products?from=content");
  await expect(crumbs.getByRole("link", { name: "Content" })).toHaveAttribute("href", "/app/content?lang=de");
  await expect(crumbs.getByRole("link", { name: "German" })).toHaveAttribute("href", "/app/languages/de?from=content");
  // The list's filters keep it too.
  await expect(page.getByRole("navigation", { name: "Show" }).getByRole("link").first()).toHaveAttribute("href", /[?&]from=content/);
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
  await expect(page.locator('[data-button][data-variant="primary"]', { hasText: "Count now" })).toHaveCount(1);
  await expect(page.getByText(/^Last counted/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Products. Not counted yet." })).toHaveAttribute("href", "/app/languages/de/products?from=content");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store with many languages picks one in a select that opens it at once", async ({ page }) => {
  await openApp(page, "stalled", "/app/content");
  const select = page.locator('s-select[name="lang"]');
  await expect(select).toHaveAttribute("label", "Language");
  await expect(page.getByRole("navigation", { name: "Choose a language" }).locator("li")).toHaveCount(0);
  // Nothing to press after picking: "Show" is there only without scripts (<noscript>).
  await expect(page.locator("[data-button]", { hasText: "Show" })).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
  await expect(page).toHaveURL(/\/app\/content\?lang=fr/);
  await expect(page.getByRole("link", { name: "Next steps for French" })).toBeVisible();
});

test("without an additional language the page says where to add one", async ({ page }) => {
  await openApp(page, "empty", "/app/content");
  await expect(page.getByRole("heading", { name: "No language to translate into yet" })).toBeVisible();
  await expect(page.locator("[data-button]", { hasText: "Open language settings" })).toHaveAttribute("href", "shopify://admin/settings/languages");
  await expect(page.getByText("Nothing to translate yet.", { exact: false })).toBeVisible();
  await expectAccessible(page);
});

test("a store with nothing to translate says so and offers no count", async ({ page }) => {
  // Every type checked and empty: counting would find nothing.
  await openApp(page, "emptyCatalog", "/app/content");
  await expect(page.getByText("Nothing to translate yet.", { exact: false })).toBeVisible();
  await expect(page.locator("[data-button]", { hasText: /Count/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /isn't counted yet/ })).toHaveCount(0);
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
  await page.locator("[data-button]", { hasText: "Next" }).click();
  await expect(page.getByText(/Showing 51–100 of 120/)).toBeVisible();

  // Enter searches at once (the search also runs while typing).
  await page.locator('s-search-field[name="q"] input').fill("free shipping");
  await page.locator('s-search-field[name="q"] input').press("Enter");
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

test("bulk translation offers image descriptions and extra details where a type has them", async ({ page }) => {
  // The products' one list (the area's): its Translate asks first, the option in the dialog, unticked for the area's own step.
  await openApp(page, "full", "/app/languages/de/products");
  await page.getByRole("region", { name: "Progress: Products", exact: true }).getByRole("button", { name: "Translate" }).click();
  const dialog = page.locator("s-modal#category-translate");
  const option = dialog.getByRole("checkbox", { name: "Also translate image descriptions and extra details" });
  await expect(option).toBeVisible();
  await expect(option).not.toBeChecked();
  await expect(dialog.getByText("Takes longer, because every item is read one by one.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await openApp(page, "full", "/app/content/menus?lang=de");
  await expect(page.getByText("Translate all into German")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Also translate image descriptions and extra details" })).toHaveCount(0);
});

test("a theme part's list is titled as Content names it, its items' states in the area lists' words", async ({ page }) => {
  await openApp(page, "full", "/app/content/theme-templates?lang=de");
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Texts in templates");
  await expect(page.getByRole("heading", { level: 1, name: "Texts in templates" })).toBeVisible();
  // A type's own list: its items' states with the area lists' words and icons (the menu may be published by the test above).
  await openApp(page, "full", "/app/content/menus?lang=de");
  const badge = page.locator("s-badge", { hasText: /^(Done|Missing)$/ }).first();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("icon", /^(check-circle-filled|circle-dashed)$/);
  // Its languages as Content picks them.
  await expect(page.getByRole("navigation", { name: "Translate into" }).locator('.lv-lang[aria-current="page"]')).toContainText("German");
});
