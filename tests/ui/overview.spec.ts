/**
 * The Overview: the store's figure next to the next step (the only primary
 * button) and what else needs the merchant, the customers by country or by
 * language (every card opens that language's page), and counting without
 * fake progress.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** A card or section by its accessibility label (Polaris sets it as an attribute). */
const labelled = (label: string) => `s-section[accessibilitylabel="${label}"]`;

test("the store's figure, one next step, and a card per country that opens its language @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("Alpine Demo Store · Original language: English · sells to 14 countries")).toBeVisible();

  const store = page.locator(labelled("Your store"));
  await expect(store.getByText("Your store in 2 languages")).toBeVisible();
  await expect(store.getByRole("img", { name: /^\d+% translated: \d+ of \d+ texts are done and live$/ })).toBeVisible();
  await expect(store.getByText("Where nothing is translated yet, customers see English.")).toBeVisible();

  const next = page.locator('s-section[heading="Next"]');
  await expect(next.getByText(/^Approve \d+ translations?$/)).toBeVisible();
  await expect(next.locator('s-button[variant="primary"]')).toHaveAttribute("href", "/app/review");
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  // Beneath it, quieter: the outdated text and the country whose language is hidden (Spain).
  await expect(next.getByText("1 text is outdated")).toBeVisible();
  await expect(next.getByRole("link", { name: "German: View" })).toHaveAttribute("href", "/app/languages/de");
  await expect(next.getByText("A language is missing in 1 country")).toBeVisible();
  await expect(next.locator('s-button[href="shopify://admin/settings/languages"][target="_top"]')).toHaveCount(1);

  // Countries first (the markets are known), each card opening the language its customers read.
  await expect(page.getByRole("heading", { name: "Your customers by country" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Countries", pressed: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^France French/ })).toHaveAttribute("href", "/app/languages/fr");
  await expect(page.getByRole("link", { name: /^Germany German/ })).toHaveAttribute("href", "/app/languages/de");
  // Switzerland reads three languages: a row each, the one the store hasn't added not a link.
  const switzerland = page.locator(labelled("Switzerland"));
  await expect(switzerland.getByRole("link", { name: /^French/ })).toHaveAttribute("href", "/app/languages/fr");
  await expect(switzerland.getByRole("link", { name: /^German/ })).toHaveAttribute("href", "/app/languages/de");
  await expect(switzerland.getByText("not set up")).toBeVisible();
  await expect(switzerland.getByRole("link")).toHaveCount(2);
  // Canada reads the original too: marked, nothing to open.
  await expect(page.locator(labelled("Canada")).getByText("Original")).toBeVisible();
  await expect(page.locator(labelled("Canada")).getByRole("link")).toHaveCount(1);
  // Countries without a language of their own, together, with the way to add one.
  const missing = page.locator(labelled("No language of their own"));
  await expect(missing.getByText("Czechia")).toBeVisible();
  await expect(missing.locator('s-button[href="shopify://admin/settings/languages"][target="_top"]')).toHaveCount(1);
  // Spain's language is hidden; the United States read the original; the draft market (Japan) doesn't count.
  await expect(page.getByRole("link", { name: /^Spain Hidden Customers can't choose Spanish there yet\./ })).toHaveAttribute("href", "/app/languages/es");
  await expect(page.getByText("Customers here read your original in English. Nothing to do.")).toBeVisible();
  await expect(page.getByText(/Japan/)).toHaveCount(0);

  // The languages view, kept in the address, without loading the page again.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await page.getByRole("button", { name: "Languages" }).click();
  await expect(page.getByRole("button", { name: "Languages", pressed: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your languages" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=languages/);
  await expect(page.getByRole("link", { name: /^Spanish Hidden/ })).toHaveAttribute("href", "/app/languages/es");
  expect(requests).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("names the content Linguva can't read beside the figure, with the way to allow it @responsive", async ({ page }) => {
  // Policies need read_legal_policies, which this store didn't grant.
  await openApp(page, "full", "/app");
  const store = page.locator(labelled("Your store"));
  await expect(store.getByText(/Not in these figures: 1 content type Linguva can't read yet\./)).toBeVisible();
  await expect(store.getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");
  // No markets access: languages only, and the offer to show countries.
  await expect(page.getByRole("heading", { name: "Your languages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access to markets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Countries" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Arabic Hidden/ })).toHaveAttribute("href", "/app/languages/ar");
  // The running French job, with its language and area.
  await expect(page.locator(labelled("Running now")).getByRole("link", { name: "French · Products" })).toBeVisible();
  // Nothing is called done while a content type it counts can't be read.
  await expect(page.getByText("Everything done")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the Markets page lists every country with its languages @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/markets");
  const table = page.locator('s-section[heading="Countries and their languages"] s-table');
  await expect(table.getByText("Czechia")).toBeVisible();
  await expect(table.getByText("Czech (not added)")).toBeVisible();
  await expect(table.getByText("Spanish (hidden)")).toBeVisible();
  await expect(table.getByText("Switzerland")).toBeVisible();
  await expect(table.getByText("Japan")).toHaveCount(0);
  // Measured: the legend says "in their language", not only "offered".
  await expect(page.getByText(/^\d+ in (its|their) language$/)).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store that was never counted starts counting from the Overview, without a progress bar stuck at 0", async ({ page }) => {
  await openApp(page, "measure", "/app");
  const next = page.locator('s-section[heading="Next"]');
  await expect(next.getByText("See how much of your store is translated")).toBeVisible();
  await expect(page.getByText("The percentages appear once your store has been counted.")).toBeVisible();
  await expect(page.getByText("Customers can choose this language: German")).toBeVisible();
  // No figures yet, and nothing to count again from the header.
  await expect(page.getByRole("link", { name: /^German/ })).toHaveAttribute("href", "/app/languages/de");
  await expect(page.getByRole("button", { name: "Count store again" })).toHaveCount(0);

  await next.getByRole("button", { name: "Count now" }).click();
  // The page's live region (the button's own spinner is a status too while it loads).
  const status = next.locator('div[role="status"]');
  await expect(status).toHaveText("Starting…");
  // The button is gone: the focus moved to the status that replaced it.
  await expect(status).toBeFocused();
  await expect(next.getByRole("button", { name: "Count now" })).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Counting progress" })).toHaveCount(0);
  await expect(page.getByText(/^Part 0 of/)).toHaveCount(0);
  await expectAccessible(page);
});

test("a count that never started can be started again, in German, without polling @responsive", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await openApp(page, "stalled", "/app", { locale: "de" });
  await expect(page.getByText("Stalled Store · Original: Deutsch · verkauft in 28 Ländern")).toBeVisible();
  const next = page.locator('s-section[heading="Als Nächstes"]');
  await expect(next.getByText(/^Das Zählen kommt seit .+ nicht voran$/)).toBeVisible();
  // No worker runs in these tests (no heartbeat): the card says so instead of "start it again".
  await expect(next.getByText(/^Hintergrundaufgaben laufen gerade nicht/)).toBeVisible();
  await expect(next.locator('s-button[variant="primary"]', { hasText: "Neu zählen" })).toHaveCount(1);
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  // No bar stuck at 0 anywhere.
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  const store = page.locator(labelled("Dein Shop"));
  await expect(store.getByText("Noch nicht gezählt", { exact: true })).toBeVisible();
  const live = store.getByText(/^Diese 12 Sprachen können Kunden wählen: /);
  await expect(live).toBeVisible();
  expect((await live.textContent())!.split(": ")[1]!.split(", ")).toHaveLength(12);

  // The countries: nine without their language together, the original ones in one quiet card.
  await expect(next.getByText("In 9 Ländern fehlt eine Sprache")).toBeVisible();
  const missing = page.locator(labelled("Keine eigene Sprache"));
  await expect(missing.getByText("Bulgarien")).toBeVisible();
  await expect(missing.getByText(/du kannst also noch 7 hinzufügen\.$/)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Dänemark Dänisch/ })).toHaveAttribute("href", "/app/languages/da");
  await expect(page.getByText("Hier lesen Kunden dein Original auf Deutsch. Nichts zu tun.")).toBeVisible();

  // Nothing under way: the page doesn't reload itself.
  await page.waitForTimeout(4_000);
  expect(requests).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a stuck newer count keeps the figures and can be started again from the header", async ({ page }) => {
  await openApp(page, "remeasure", "/app");
  const store = page.locator(labelled("Your store"));
  await expect(store.getByText("Your store in 1 language")).toBeVisible();
  // No worker runs in these tests: the note says so (with a worker: "A newer count didn't finish…").
  await expect(store.getByText(/^Background jobs aren't running right now/)).toBeVisible();
  // A secondary action: the next step keeps the page's only primary button.
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Count store again" }).click();
  const status = store.locator('div[role="status"]');
  await expect(status).toContainText("Starting…");
  await expect(status).toBeFocused();
  await expect(page.getByRole("button", { name: "Count store again" })).toHaveCount(0);
  await expectAccessible(page);
});

test("the Coverage page lets a stuck measurement be started again, without following it", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await openApp(page, "stalled", "/app/coverage", { locale: "de" });
  await expect(page.getByText(/^Die Prüfung kommt seit .+ nicht voran$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Shop (erneut )?prüfen$/ })).toBeEnabled();
  await expect(page.getByRole("progressbar", { name: /Prüfung|Messung|Scan/ })).toHaveCount(0);
  await page.waitForTimeout(4_000);
  expect(requests).toEqual([]);
  await expectAccessible(page);
});
