/**
 * The Overview: one next step (the only primary button), the share per
 * language from a completed measurement, the countries without their
 * language, and measuring without fake progress.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("one next step, the share per language and the countries missing their language @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app");
  const next = page.locator('s-section[heading="Next step"]');
  await expect(next.getByText(/^Review \d+ translations?$/)).toBeVisible();
  await expect(next.locator('s-button[variant="primary"]')).toHaveAttribute("href", "/app/review");
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);

  const languages = page.locator('s-section[heading="Your languages"]');
  await expect(languages.getByText("translated across your 2 published languages")).toBeVisible();
  // One line per language: its name leads to what's missing, the bar and share beside it.
  const french = languages.getByRole("link", { name: /^French, \d+% translated: show what's missing$/ });
  await expect(french).toBeVisible();
  await expect(languages.getByRole("img", { name: /^French translated/ })).toBeVisible();
  await expect(languages.getByText("44%", { exact: true })).toBeVisible();
  await expect(languages.getByText("Hidden", { exact: true })).toHaveCount(1);
  await expect(languages.getByRole("listitem")).toHaveCount(3);
  // Name and share on one line, on a phone too.
  const german = await languages.getByRole("link", { name: /^German, / }).boundingBox();
  const share = await languages.getByText("44%", { exact: true }).boundingBox();
  expect(Math.abs(german!.y + german!.height / 2 - (share!.y + share!.height / 2))).toBeLessThan(8);

  const countries = page.locator('s-section[heading="Countries you sell to"]');
  await expect(countries.getByText(/^Not added to your store: Italian \(Italy, Switzerland\), Dutch \(Netherlands, Belgium\)/)).toBeVisible();
  await expect(countries.getByText("Added, but hidden from customers: Spanish (Spain)")).toBeVisible();
  await expect(countries.locator('s-link[href="shopify://admin/settings/languages"][target="_top"]')).toHaveCount(1);
  await expect(countries.getByRole("link", { name: "See all countries" })).toBeVisible();
  // Links only, no buttons; the draft market (Japan) doesn't count.
  await expect(countries.locator("s-button")).toHaveCount(0);
  await expect(countries.getByText(/Japan/)).toHaveCount(0);
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

test("a store without a measurement starts it from the Overview, without a progress bar stuck at 0", async ({ page }) => {
  await openApp(page, "measure", "/app");
  const next = page.locator('s-section[heading="Next step"]');
  await expect(next.getByText("See how much of your store is translated")).toBeVisible();
  await expect(page.getByText("Percentages appear after the first measurement.")).toBeVisible();
  await expect(page.getByText("Other languages on your storefront: German")).toBeVisible();
  await expect(page.locator('s-section[heading="Your languages"]').getByRole("img")).toHaveCount(0);
  // Markets aren't connected: an offer, not an error.
  await expect(page.locator('s-section[heading="Countries you sell to"]').getByRole("button", { name: "Show countries" })).toBeVisible();

  await next.getByRole("button", { name: "Measure now" }).click();
  // The page's live region (the button's own spinner is a status too while it loads).
  const status = next.locator('div[role="status"]');
  await expect(status).toHaveText("Starting…");
  // The button is gone: the focus moved to the status that replaced it.
  await expect(status).toBeFocused();
  await expect(next.getByRole("button", { name: "Measure now" })).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Coverage measurement" })).toHaveCount(0);
  await expect(page.getByText(/Measuring… 0 of/)).toHaveCount(0);
  await expectAccessible(page);
});

test("a measurement that never started can be started again, in German, without polling @responsive", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".data")) requests.push(request.url());
  });
  await openApp(page, "stalled", "/app", { locale: "de" });
  const next = page.locator('s-section[heading="Nächster Schritt"]');
  await expect(next.getByText(/^Die Messung kommt seit .+ nicht voran$/)).toBeVisible();
  // No worker runs in these tests (no heartbeat): the card says so instead of "start it again".
  await expect(next.getByText(/^Hintergrundaufgaben laufen gerade nicht/)).toBeVisible();
  await expect(next.locator('s-button[variant="primary"]', { hasText: "Erneut messen" })).toHaveCount(1);
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  // No measuring bar stuck at 0: the only bar on the page is the AI usage in the sidebar.
  await expect(page.getByRole("progressbar")).toHaveCount(1);
  await expect(page.getByRole("progressbar", { name: "KI-Nutzung in diesem Monat" })).toHaveCount(1);
  await expect(page.getByText(/Wird gemessen/)).toHaveCount(0);

  const languages = page.locator('s-section[heading="Deine Sprachen"]');
  await expect(languages.getByText("Die Prozente erscheinen nach der ersten Messung.")).toBeVisible();
  const live = languages.getByText(/^Weitere Sprachen im Onlineshop: /);
  await expect(live).toBeVisible();
  expect((await live.textContent())!.split(":")[1]!.split(",")).toHaveLength(12);
  await expect(languages.getByRole("link", { name: "Sprachen verwalten" })).toHaveAttribute("href", "/app/languages");

  const countries = page.locator('s-section[heading="Länder, in die du verkaufst"]');
  await expect(countries.getByText("9 ohne ihre Sprache")).toBeVisible();
  await expect(countries.getByText("19 in ihrer Sprache angeboten")).toBeVisible();
  await expect(countries.getByText(/^Nicht in deinem Shop: /)).toBeVisible();
  await expect(countries.getByText(/du kannst also noch 7 hinzufügen\.$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Produkte" })).toBeVisible();

  // Nothing under way: the page doesn't reload itself.
  await page.waitForTimeout(4_000);
  expect(requests).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a stuck newer measurement keeps the figures and can be started again from the languages", async ({ page }) => {
  await openApp(page, "remeasure", "/app");
  const languages = page.locator('s-section[heading="Your languages"]');
  await expect(languages.getByRole("listitem")).toHaveCount(1);
  // No worker runs in these tests: the note says so (with a worker: "A newer measurement didn't complete…").
  await expect(languages.getByText(/^Background jobs aren't running right now/)).toBeVisible();
  // A secondary action: the next step keeps the page's only primary button.
  await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
  await languages.getByRole("button", { name: "Measure again" }).click();
  const status = languages.locator('div[role="status"]');
  await expect(status).toContainText("Starting…");
  await expect(status).toBeFocused();
  await expect(languages.getByRole("button", { name: "Measure again" })).toHaveCount(0);
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
