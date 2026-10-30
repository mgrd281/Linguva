/**
 * Actions that can't be undone ask first: rejecting a page of translations,
 * cancelling a job, deleting memory entries and glossary terms (Polaris
 * modal), and rejecting one translation (a question in its place). Cancel
 * leaves everything as it was; confirming does the action and says so.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectToast, openApp } from "./helpers";

const modal = (page: Page, id: string) => page.locator(`s-modal#${id}`);
const dialogOpen = (page: Page, heading: string) => page.getByRole("dialog", { name: heading });
// The modal's buttons are its slotted children, not part of the dialog's shadow tree.
const modalButton = (page: Page, id: string, name: string) => modal(page, id).getByRole("button", { name, exact: true });

test("rejecting asks first: Cancel keeps every text, one text is rejected after its own question", async ({ page }) => {
  await openApp(page, "full", "/app/review");
  const summary = page.getByText(/^\d+ translations? on this page/);
  const before = Number((await summary.innerText()).match(/\d+/)![0]);
  const allTab = page.getByRole("navigation", { name: "Languages" }).locator('[aria-current="true"]');
  await expect(allTab).toContainText(String(before));

  await page.locator("s-button", { hasText: "Reject all" }).click();
  const dialog = page.getByRole("dialog", { name: /^Reject \d+ translations\?$/ });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await modalButton(page, "review-reject", "Cancel").click();
  await expect(dialog).toBeHidden();
  await expect(summary).toHaveText(new RegExp(`^${before} `));

  // One text: its ✕ asks in place, says it can't be undone, and only then rejects.
  await page.getByRole("button", { name: "Reject: Name – Product 2 jacket" }).filter({ visible: true }).click();
  const question = page.locator("s-banner", { hasText: "This can't be undone." });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Reject: Name – Product 2 jacket" }).click();
  await expect(page.getByText("Rejected – won't be published.", { exact: true })).toBeVisible();
  await expect(summary).toHaveText(new RegExp(`^${before - 1} `));
  await expect(allTab).toContainText(String(before - 1));
  await expect(modal(page, "review-reject")).toHaveCount(1);
});

test("confirming Reject all rejects the page's texts and a toast says so", async ({ page }) => {
  // One product's French texts (a search narrows the page), so the shared store keeps the rest.
  await openApp(page, "full", "/app/review?lang=fr&q=Product%208%20jacket");
  await expect(page.getByText(/^2 translations on this page/)).toBeVisible();
  await page.locator("s-button", { hasText: "Reject all" }).click();
  await expect(page.getByRole("dialog", { name: "Reject 2 translations?" })).toBeVisible();
  await modalButton(page, "review-reject", "Reject 2").click();
  await expectToast(page, /^\d+ translations rejected\. They won't be published\.$/);
  await expect(page.locator("#review-done-heading")).toBeVisible();
});

test("deleting a glossary term asks first", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  const section = page.locator("s-section").filter({ has: page.locator("s-text-field[name='term']") }).first();
  await section.locator("s-text-field[name='term'] input").fill("Linguva-Testbegriff");
  await section.getByRole("button", { name: /Add term/ }).click();
  const row = page.locator("s-table-row", { hasText: "Linguva-Testbegriff" });
  await expect(row).toBeVisible();

  await row.locator("s-button", { hasText: "Delete" }).click();
  const dialog = dialogOpen(page, "Delete this term?");
  await expect(dialog).toBeVisible();
  await modalButton(page, "glossary-delete", "Cancel").click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();

  await row.locator("s-button", { hasText: "Delete" }).click();
  await modalButton(page, "glossary-delete", "Delete").click();
  await expect(row).toHaveCount(0);
});

test("choosing a language tab and then All again shows every language", async ({ page }) => {
  // As a merchant arrives: the Overview reads the store's languages (names, which are hidden).
  await openApp(page, "full", "/app");
  await openApp(page, "full", "/app/review");
  const tabs = page.getByRole("navigation", { name: "Languages" });
  // Arabic waits too, and customers can't choose it yet.
  await expect(tabs.getByRole("link", { name: /^Arabic hidden \d+$/ })).toBeVisible();
  await tabs.getByRole("link", { name: /^French \d+$/ }).click();
  await expect(page).toHaveURL(/lang=fr/);
  await expect(tabs.locator('[aria-current="true"]')).toContainText("French");
  await tabs.getByRole("link", { name: /^All \d+$/ }).click();
  await expect(page).not.toHaveURL(/lang=/);
  await expect(tabs.locator('[aria-current="true"]')).toContainText("All");
  const all = Number(((await tabs.locator('[aria-current="true"]').textContent()) ?? "").match(/\d+/)![0]);
  await expect(page.getByText(new RegExp(`^${all} translations on this page`))).toBeVisible();
});

test("a glossary CSV is imported from the drop zone and confirmed with a toast", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  await page.locator('s-drop-zone[name="file"] input[type="file"]').setInputFiles({
    name: "terms.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("rule,term,translation,target_locale,market,case_sensitive,notes\nDO_NOT_TRANSLATE,Linguva-CSV,,,,,\n"),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expectToast(page, "1 term imported.");
  await expect(page.locator("s-table-row", { hasText: "Linguva-CSV" })).toHaveCount(1);
  // Clean up for other tests.
  await page.locator("s-table-row", { hasText: "Linguva-CSV" }).locator("s-button", { hasText: "Delete" }).click();
  await modalButton(page, "glossary-delete", "Delete").click();
  await expect(page.locator("s-table-row", { hasText: "Linguva-CSV" })).toHaveCount(0);
});
