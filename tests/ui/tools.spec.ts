/**
 * The supporting pages: glossary, translation memory, coverage report and
 * Markets. Content, accessibility, phone layout, and the glossary flow with
 * languages chosen by name.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("glossary: a term for one language, chosen by name @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/glossary");
  const form = page.locator('s-section[heading="Add a term"]');
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  const term = `Merino-${info.project.name}`;
  await form.getByRole("combobox", { name: "Rule" }).selectOption("DO_NOT_TRANSLATE");
  await form.getByRole("textbox", { name: "Term" }).fill(term);
  await form.getByRole("combobox", { name: "Language" }).selectOption({ label: "German" });
  await form.getByRole("button", { name: "Add term" }).click();

  const row = page.locator("s-table-row", { hasText: term });
  await expect(row).toHaveCount(1);
  // Shown by name, not by code.
  await expect(row.getByText("German", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("s-table-row", { hasText: term })).toHaveCount(0);
});

test("glossary: a wrong market number is explained, nothing is added", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  const form = page.locator('s-section[heading="Add a term"]');
  await form.getByRole("textbox", { name: "Term" }).fill("Wrong market");
  await form.getByRole("textbox", { name: "Only in one market (optional)" }).fill("abc");
  await form.getByRole("button", { name: "Add term" }).click();
  await expect(page.locator('s-banner[heading="Term not added"]')).toContainText("market number from the Markets page");
  await expect(page.locator("s-table-row", { hasText: "Wrong market" })).toHaveCount(0);
});

test("translation memory: search with a language chosen by name @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/memory");
  await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/locale=fr/);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("coverage report and Markets pages explain what they do @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/coverage");
  await expect(page.getByRole("button", { name: "Run coverage report" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Markets needs an optional permission the test store didn't grant: a prompt, not an error.
  const response = await openApp(page, "full", "/app/markets");
  expect(response?.status()).toBe(200);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
