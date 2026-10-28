/**
 * The Overview: translation per language, the countries the store sells to
 * that can't read it in their language, and measuring coverage from here.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("headline figures, coverage per language and the countries missing their language @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app");
  await expect(page.getByText("Languages on your storefront")).toBeVisible();
  await expect(page.getByText("Translated on average")).toBeVisible();
  await expect(page.getByText("Countries in their language")).toBeVisible();
  // Measured in this store: a bar and the share per language, on a phone too.
  const languages = page.locator('s-section[heading="Your languages"]');
  await expect(languages.getByRole("img", { name: /^French translated/ })).toBeVisible();
  await expect(languages.getByText("44%", { exact: true })).toBeVisible();

  const countries = page.locator('s-section[heading="Countries you sell to"]');
  await expect(countries.getByText("Languages your customers are missing")).toBeVisible();
  // Italian would reach Italy and the Italian-speaking part of Switzerland.
  await expect(countries.getByText(/Reaches 2 countries: .*Italy, .*Switzerland/)).toBeVisible();
  await expect(countries.locator("s-button", { hasText: "Add language" }).first()).toHaveAttribute("href", "shopify://admin/settings/languages");
  // Spanish is in the store but hidden: publish it rather than add it.
  await expect(countries.getByText("Added to your store, but hidden from customers.")).toBeVisible();
  await expect(countries.locator("s-button", { hasText: "Publish language" })).toHaveCount(1);
  await expect(countries.getByRole("link", { name: "2 more languages: see all countries" })).toBeVisible();
  // The draft market (Japan) doesn't count.
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
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a store without a measurement starts it from the Overview and follows it", async ({ page }) => {
  await openApp(page, "measure", "/app");
  await expect(page.getByText("Not measured yet").first()).toBeVisible();
  // Markets aren't connected: an offer, not an error.
  await expect(page.locator('s-section[heading="Countries you sell to"]').getByRole("button", { name: "Show countries" })).toBeVisible();
  await page.getByRole("button", { name: "Measure now" }).click();
  await expect(page.getByRole("progressbar", { name: "Coverage measurement" })).toBeVisible();
  await expect(page.getByText(/Measuring… 0 of \d+ parts/)).toBeVisible();
  await expectAccessible(page);
});
