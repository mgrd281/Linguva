/**
 * Actions that can't be undone ask first (Polaris modal): rejecting drafts,
 * cancelling a job, deleting memory entries and glossary terms. Cancel
 * leaves everything as it was; confirming does the action and a toast
 * confirms it.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectToast, openApp } from "./helpers";

const modal = (page: Page, id: string) => page.locator(`s-modal#${id}`);
const dialogOpen = (page: Page, heading: string) => page.getByRole("dialog", { name: heading });
// The modal's buttons are its slotted children, not part of the dialog's shadow tree.
const modalButton = (page: Page, id: string, name: string) => modal(page, id).getByRole("button", { name, exact: true });

test("rejecting drafts asks first; Cancel keeps them, confirming rejects only the selected", async ({ page }) => {
  await openApp(page, "full", "/app/review");
  const intro = page.getByText(/translations waiting for review/);
  const before = Number((await intro.innerText()).match(/\d+/)![0]);

  await page.locator("s-button", { hasText: "Reject selected" }).first().click();
  const dialog = dialogOpen(page, "Reject the selected translations?");
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await modalButton(page, "review-reject", "Cancel").click();
  await expect(dialog).toBeHidden();
  await expect(intro).toHaveText(new RegExp(`^${before} `));

  // Keep only the last draft selected, then confirm.
  const boxes = page.locator('s-checkbox[name="draft"]');
  const count = await boxes.count();
  for (let i = 0; i < count - 1; i++) await boxes.nth(i).getByRole("checkbox").uncheck();
  await page.locator("s-button", { hasText: "Reject selected" }).first().click();
  await modalButton(page, "review-reject", "Reject selected").click();
  await expectToast(page, "1 draft discarded. It won't be published.");
  await expect(intro).toHaveText(new RegExp(`^${before - 1} `));
  await expect(modal(page, "review-reject")).toHaveCount(1);
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

test("choosing a language and then 'All languages' again shows everything", async ({ page }) => {
  await openApp(page, "full", "/app/review");
  const intro = page.getByText(/translations waiting for review/);
  const all = Number((await intro.innerText()).match(/\d+/)![0]);
  const language = page.getByRole("combobox", { name: "Language", exact: true });
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await language.selectOption({ label: "French" });
  await apply.click();
  await expect(page).toHaveURL(/lang=fr/);
  await language.selectOption({ label: "All languages" });
  await apply.click();
  await expect(page).toHaveURL(/lang=all/);
  await expect(page.getByText(`${all} on this page. Untick the ones you don't want to change.`)).toBeVisible();
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
