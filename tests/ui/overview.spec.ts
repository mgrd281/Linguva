/**
 * The Overview: the next step (the only primary button) and what else needs
 * the merchant, first, beside the store's figure; the customers by country
 * or by language (every card opens that language's page); counting without
 * fake progress; and the welcome after a plan is chosen.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** A card or section by its name: native sections named by their label or heading. */
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("the next step first, the store's figure, and a card per country that opens its language @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("Alpine Demo Store · Original language: English · sells to 14 countries")).toBeVisible();

  const store = region(page, "Your store");
  // The original language is left out of the count.
  await expect(store.getByText("Your store in 2 other languages")).toBeVisible();
  await expect(store.getByRole("img", { name: /^\d+% translated: \d+ of \d+ texts done$/ })).toBeVisible();
  await expect(store.getByText("Where nothing is translated yet, customers see English.")).toBeVisible();

  const next = region(page, "Next");
  await expect(next.getByRole("heading", { level: 2, name: "Next" })).toBeVisible();
  await expect(next.getByText(/^Approve \d+ translations?$/)).toBeVisible();
  // Its icon is the one for approving, in its square.
  await expect(next.locator('.lv-icon-square s-icon[type="eye-check-mark"]')).toHaveCount(1);
  await expect(next.locator('[data-button][data-variant="primary"]')).toHaveAttribute("href", "/app/review");
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  // What approving brings is said once, in the next step, not again under the store's figure.
  await expect(next.getByText(/Afterwards you're at \d+%\./)).toBeVisible();
  await expect(store.getByText(/^Once you approve/)).toHaveCount(0);
  // Next comes first: on a phone above the store's figure, on a wide page to its left.
  const [nextBox, storeBox] = [await next.boundingBox(), await store.boundingBox()];
  expect(nextBox!.y).toBeLessThanOrEqual(storeBox!.y);
  expect(nextBox!.x).toBeLessThanOrEqual(storeBox!.x);
  // Beneath it, quieter: the outdated text with its language, and the country whose language is hidden (Spain).
  await expect(next.getByText("1 text in German is outdated")).toBeVisible();
  await expect(next.getByRole("link", { name: "Open German" })).toHaveAttribute("href", "/app/languages/de");
  await expect(next.getByText("A language is missing in 1 country")).toBeVisible();
  await expect(next.locator('[data-button][href="shopify://admin/settings/languages"][target="_top"]')).toHaveText("Open language settings");
  // Counting again sits with its date in the store's card, with the counting icon.
  const recount = store.getByRole("button", { name: "Count translations again" });
  await expect(recount).toBeVisible();
  await expect(recount.locator('s-icon[type="chart-donut"]')).toHaveCount(1);
  await expect(store.getByText(/^Last counted: /)).toBeVisible();

  // Countries first (the markets are known), each card opening the language its customers read.
  await expect(page.getByRole("heading", { level: 2, name: "Your customers by country" })).toBeVisible();
  await expect(page.getByText(/^Each country shows the language customers read there – the least translated first\./)).toBeVisible();
  const switcher = page.getByRole("group", { name: "Show by" });
  await expect(switcher.getByRole("button")).toHaveCount(2);
  await expect(switcher.getByRole("button", { name: "Countries", pressed: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^France French/ })).toHaveAttribute("href", "/app/languages/fr");
  await expect(page.getByRole("link", { name: /^Germany German/ })).toHaveAttribute("href", "/app/languages/de");
  // Switzerland reads three languages: a row each, the one the store hasn't added not a link but a badge.
  const switzerland = region(page, "Switzerland");
  await expect(switzerland.getByText("Customers there read 3 languages")).toBeVisible();
  await expect(switzerland.getByRole("link", { name: /^French/ })).toHaveAttribute("href", "/app/languages/fr");
  await expect(switzerland.getByRole("link", { name: /^German/ })).toHaveAttribute("href", "/app/languages/de");
  await expect(switzerland.locator("s-badge", { hasText: "Not set up" })).toHaveAttribute("icon", "minus-circle");
  await expect(switzerland.getByRole("link")).toHaveCount(2);
  // Canada reads the original too: marked, nothing to open.
  await expect(region(page, "Canada").getByText("Original")).toBeVisible();
  await expect(region(page, "Canada").getByRole("link")).toHaveCount(1);
  // Countries without a language of their own, together, with the way to add one (the next step offers publishing).
  const missing = region(page, "No language of their own");
  await expect(missing.getByText("Czechia")).toBeVisible();
  await expect(missing.locator('[data-button][href="shopify://admin/settings/languages"][target="_top"]')).toHaveText("Open language settings");
  // Spain's language is hidden; the United States read the original; the draft market (Japan) doesn't count.
  await expect(page.getByRole("link", { name: /^Spain Hidden Customers can't choose Spanish there yet\./ })).toHaveAttribute("href", "/app/languages/es");
  await expect(page.getByText("Customers here read your original in English. Nothing to do.")).toBeVisible();
  await expect(page.getByText(/Japan/)).toHaveCount(0);

  // The languages view, kept in the address, without loading the page again.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await switcher.getByRole("button", { name: "Languages" }).click();
  await expect(switcher.getByRole("button", { name: "Languages", pressed: true })).toBeVisible();
  await expect(switcher.getByRole("button", { name: "Countries", pressed: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your languages" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=languages/);
  await expect(page.getByRole("link", { name: /^Spanish Hidden/ })).toHaveAttribute("href", "/app/languages/es");
  expect(requests).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("in French and Spanish the outdated row's button names the language page it opens", async ({ page }) => {
  // Not "Voir en allemand" / "Ver en alemán", which reads like switching the display language.
  for (const [locale, label] of [
    ["fr", "Ouvrir la langue (allemand)"],
    ["es", "Abrir alemán"],
  ] as const) {
    await openApp(page, "demo", "/app", { locale });
    await expect(page.locator("#overview-next").getByRole("link", { name: label, exact: true })).toHaveAttribute("href", "/app/languages/de");
  }
});

test("names the content Linguva can't read beside the figure, with the way to allow it @responsive", async ({ page }) => {
  // Policies need read_legal_policies, which this store didn't grant.
  await openApp(page, "full", "/app");
  const store = region(page, "Your store");
  await expect(store.getByText(/Not in these figures: 1 content type Linguva can't read yet\./)).toBeVisible();
  await expect(store.locator('.lv-ov-note s-icon[type="lock"]')).toHaveCount(1);
  await expect(store.getByRole("link", { name: "Allow access" })).toHaveAttribute("href", "/app/content/policies");
  // No markets access: languages only, and the offer to show countries. The intro says how the cards are sorted, as the countries' does.
  await expect(page.getByRole("heading", { name: "Your languages" })).toBeVisible();
  await expect(page.getByText(/ – the least translated first\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access to markets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Countries" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Arabic Hidden/ })).toHaveAttribute("href", "/app/languages/ar");
  // The running French job, with its language and area.
  const running = region(page, "Running now");
  await expect(running.getByRole("heading", { level: 2, name: "Running now" })).toBeVisible();
  await expect(running.getByRole("link", { name: "French · Products" })).toBeVisible();
  // Nothing is called done while a content type it counts can't be read.
  await expect(page.getByText("Everything done")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the first translation opens the products' list of the visible language; the cards line up in full rows @responsive", async ({ page }, info) => {
  // The visual store: German visible and counted, French hidden, nothing translated yet.
  await openApp(page, "visual", "/app");
  const next = region(page, "Next");
  await expect(next.getByText("Publish your first translation")).toBeVisible();
  // The area's list, whose Translate asks first (never the old Products list).
  await expect(next.locator('[data-button][data-variant="primary"]')).toHaveAttribute("href", "/app/languages/de/products");
  if (info.project.name === "desktop") {
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    const [nextBox, storeBox] = [await box(next), await box(region(page, "Your store"))];
    // The top row's two cards start on one line, each as tall as its content (the shorter one isn't stretched).
    expect(Math.abs(nextBox.y - storeBox.y)).toBeLessThanOrEqual(2);
    // Two languages fill their row, right under the two cards (never beside an empty third column).
    const [german, french] = [await box(page.getByRole("link", { name: /^German/ })), await box(page.getByRole("link", { name: /^French Hidden/ }))];
    expect(Math.abs(german.x - nextBox.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(french.x + french.width - (storeBox.x + storeBox.width))).toBeLessThanOrEqual(2);
  }
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("the Markets page lists every country with its languages @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/markets");
  const table = page.getByRole("region", { name: "Countries and their languages", exact: true }).locator("s-table");
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
  const next = region(page, "Next");
  await expect(next.getByText("See how much of your store is translated")).toBeVisible();
  await expect(next.locator('.lv-icon-square s-icon[type="chart-donut"]')).toHaveCount(1);
  await expect(page.getByText("The percentages appear once your store has been counted.")).toBeVisible();
  await expect(page.getByText("Customers can choose this language: German")).toBeVisible();
  // No figures yet, and nothing to count again from the store's card.
  await expect(page.getByRole("link", { name: /^German/ })).toHaveAttribute("href", "/app/languages/de");
  await expect(page.getByRole("button", { name: "Count translations again" })).toHaveCount(0);

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
  const next = region(page, "Als Nächstes");
  await expect(next.getByText(/^Das Zählen kommt seit .+ nicht voran$/)).toBeVisible();
  // No worker runs in these tests (no heartbeat): the card says counting is paused instead of "start it again".
  await expect(next.getByText(/^Das Zählen pausiert\. Linguva macht von selbst weiter, sobald es kann/)).toBeVisible();
  await expect(next.locator('[data-button][data-variant="primary"]', { hasText: "Neu zählen" })).toHaveCount(1);
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  // No bar stuck at 0 anywhere.
  await expect(page.getByRole("progressbar")).toHaveCount(0);

  const store = region(page, "Dein Shop");
  await expect(store.getByText("Noch nicht gezählt", { exact: true })).toBeVisible();
  const live = store.getByText(/^Diese 12 Sprachen können Kunden wählen: /);
  await expect(live).toBeVisible();
  expect((await live.textContent())!.split(": ")[1]!.split(", ")).toHaveLength(12);

  // The countries: nine without their language together, the original ones in one quiet card.
  await expect(next.getByText("In 9 Ländern fehlt eine Sprache")).toBeVisible();
  // Shopify's language limit and the way to add them, once: in the row under the next step.
  await expect(next.getByText(/du kannst also 7 der \d+ fehlenden hinzufügen\./)).toBeVisible();
  await expect(next.locator('[data-button][href="shopify://admin/settings/languages"][target="_top"]')).toHaveText("Spracheinstellungen öffnen");
  const missing = region(page, "Keine eigene Sprache");
  await expect(missing.getByText("Bulgarien")).toBeVisible();
  await expect(missing.locator("[data-button]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Dänemark Dänisch/ })).toHaveAttribute("href", "/app/languages/da");
  await expect(page.getByText("Hier lesen Kunden dein Original auf Deutsch. Nichts zu tun.")).toBeVisible();

  // Nothing under way: the page doesn't reload itself.
  await page.waitForTimeout(4_000);
  expect(requests).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a stuck newer count keeps the figures and can be started again from the store's card", async ({ page }) => {
  await openApp(page, "remeasure", "/app");
  const store = region(page, "Your store");
  await expect(store.getByText("Your store in 1 other language")).toBeVisible();
  // No worker runs in these tests: the note says what happens (with a worker: "A newer count didn't finish…"), never a "background service".
  await expect(store.getByText(/^Counting paused\. Linguva continues by itself as soon as it can/)).toBeVisible();
  await expect(page.getByText(/background service/)).toHaveCount(0);
  // A secondary action: the next step keeps the page's only primary button.
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  await store.getByRole("button", { name: "Count translations again" }).click();
  const status = store.locator('div[role="status"]');
  await expect(status).toContainText("Starting…");
  await expect(status).toBeFocused();
  await expect(page.getByRole("button", { name: "Count translations again" })).toHaveCount(0);
  await expectAccessible(page);
});

test("after a plan is chosen, the welcome link opens the Overview, which welcomes the merchant above the next step", async ({ page }) => {
  await openApp(page, "demo", "/app/welcome");
  // Shopify's redirect keeps the embedded app's parameters.
  await expect(page).toHaveURL(/\/app\?welcome=1&.*\bembedded=1\b/);
  const banner = page.locator('s-banner[heading="Thanks for choosing a plan"]');
  await expect(banner.getByText("Your plan is active. You can start translating now.")).toBeVisible();
  // The next step's button goes on from there: still the page's only primary button.
  await expect(region(page, "Next").locator('[data-button][data-variant="primary"]')).toHaveAttribute("href", "/app/review");
  await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
  await expectAccessible(page);

  // The Own key plan without a key: the welcome asks for the key first, as the Plan page does.
  await openApp(page, "ownkey", "/app/welcome");
  await expect(page.getByText("Your Own key plan is active. Add your DeepL, Microsoft Azure or Google Cloud key to start translating.")).toBeVisible();
  await expect(page.locator("s-banner s-link", { hasText: "Add your key" })).toHaveAttribute("href", "/app/settings?section=keys");

  // No active plan reported (yet): the Plan page, which a store without a plan may open, says how things stand.
  await openApp(page, "empty", "/app/welcome");
  await expect(page).toHaveURL(/\/app\/plan\?welcome=1/);
  await expect(page.locator('s-banner[heading="Thanks for choosing a plan"]')).toHaveCount(0);
});

test("the Coverage page lets a stuck measurement be started again, without following it", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await openApp(page, "stalled", "/app/coverage", { locale: "de" });
  // Counting is "zählen" there too ("prüfen" means approving).
  await expect(page.getByText(/^Das Zählen kommt seit .+ nicht voran$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Übersetzungen (neu )?zählen$/ })).toBeEnabled();
  await expect(page.getByRole("progressbar", { name: /Zählen|Prüfung|Messung|Scan/ })).toHaveCount(0);
  await page.waitForTimeout(4_000);
  expect(requests).toEqual([]);
  await expectAccessible(page);
});
