/**
 * Job report: how each item ended, grouped by reason, with timing, a
 * support reference and a CSV download of every item (in the interface
 * language, formula-safe).
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** The first job row of the list: the full store's seeded French job (still finding its items: running now). */
const firstJob = (page: import("@playwright/test").Page) =>
  page.locator('section[aria-labelledby="jobs-live"], section[aria-labelledby^="day-"]').locator('s-clickable[href^="/app/jobs/"]').first();

test("a job page explains every result and offers a report @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/jobs");
  await firstJob(page).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}/);
  // The results in detail are folded under the page's summary.
  const results = page.locator("details", { hasText: "Results in detail" });
  await results.locator("summary").click();
  // The seeded French job drafted every product for review.
  await expect(results.getByText("Saved as drafts for review")).toBeVisible();
  // In the store's time zone (Europe/Berlin in the fixtures), so without "UTC".
  await expect(page.getByText(/^Started (today|yesterday|on .+) at \d{1,2}:\d{2}\s?[AP]M( · |$)/)).toBeVisible();
  await expect(page.getByText(/^Started .+UTC/)).toHaveCount(0);
  await expect(results.getByText(/^Reference for support: [0-9a-f-]{36}$/)).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  const download = page.waitForEvent("download");
  await results.locator("[data-button]", { hasText: "Download report (CSV)" }).click();
  const file = await (await download).path();
  const csv = await readFile(file!, "utf8");
  const [header, ...rows] = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  expect(header).toBe("ID,Shopify ID,Status,Reason code,Reason,Fields translated,Fields held back,Attempts,Finished (UTC),Reference");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]).toMatch(/^\d+,gid:\/\/shopify\/Product\/\d+,Done,DRAFTED,Saved as drafts for review,\d+,\d+,1,\d{4}-\d\d-\d\dT[\d:.]+Z,[0-9a-f-]{36}$/);
});

test("the job report is German for a German admin user", async ({ page }) => {
  await openApp(page, "full", "/app/jobs", { locale: "de" });
  await firstJob(page).click();
  const results = page.locator("details", { hasText: "Ergebnisse im Detail" });
  await results.locator("summary").click();
  await expect(results.getByText("Als Entwurf zur Prüfung gespeichert")).toBeVisible();
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Französisch · Produkte");
  const download = page.waitForEvent("download");
  await results.locator("[data-button]", { hasText: "Bericht herunterladen (CSV)" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe("Nr.,Shopify-ID,Status,Grund-Code,Grund,Übersetzte Felder,Zurückgehaltene Felder,Versuche,Beendet (UTC),Referenz");
});

test("another store's job report can't be downloaded", async ({ page }) => {
  // The full store's job id, requested as the empty store.
  await openApp(page, "full", "/app/jobs");
  await firstJob(page).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}/);
  const jobId = /\/app\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1];
  await openApp(page, "empty", "/app");
  const status = await page.evaluate(async (id) => (await fetch(`/app/jobs/${id}/report`)).status, jobId);
  expect(status).toBe(404);
});
