/**
 * Translation import and export: the CSV comes from the real export route
 * (session token via fetch), a filled row comes back as a draft on Review,
 * rows that can't be trusted are listed with their line.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("exports what's missing, imports translations as drafts and lists skipped rows @responsive", async ({ page }) => {
  await openApp(page, "owner", "/app/translations");
  await expect(page.getByText(/Imported translations wait on Review; nothing goes live until you approve it/)).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = (await readFile((await (await download).path())!, "utf8")).replace(/^\uFEFF/, "");
  const [header, ...rows] = csv.trim().split("\r\n");
  expect(header).toBe("resource_id,content_type,field,language,source_digest,original,translation,status");
  // 5 products × title, description, URL handle: all missing.
  expect(rows).toHaveLength(15);
  await expect(page.getByText("Downloaded 15 fields.")).toBeVisible();

  // Fill one title; change another row's digest (as if the original had changed since).
  const title = rows.findIndex((r) => r.startsWith("gid://shopify/Product/1,PRODUCT,title,"));
  const filled = rows.map((r, i) => (i === title ? r.replace(/,missing$/, "").replace(/,$/, ",Jacke eins,missing") : r));
  const stale = filled.findIndex((r) => r.startsWith("gid://shopify/Product/2,PRODUCT,title,"));
  filled[stale] = filled[stale]!.replace(/,[0-9a-f]{64},/, `,${"0".repeat(64)},`).replace(/,,missing$/, ",Jacke zwei,missing");
  await page.locator('s-drop-zone[name="file"] input[type="file"]').setInputFiles({
    name: "translations.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([header, ...filled].join("\r\n")),
  });
  await page.getByRole("button", { name: "Import as drafts" }).click();
  await expect(page.getByText("1 translation waits on Review.")).toBeVisible();
  const skipped = page.locator('s-section[heading="Skipped rows"]');
  await expect(skipped.locator("s-table-row", { hasText: `Line ${stale + 2}` })).toContainText("The original changed since the export");
  await expect(skipped.locator("s-table-row", { hasText: "No translation filled in." }).first()).toBeVisible();
  await expectAccessible(page);

  // The draft waits on Review; nothing was published.
  await page.getByRole("link", { name: "Open Review" }).click();
  await expect(page.getByText("Product 1 jacket · Title · German")).toBeVisible();
  // Same content checks as AI drafts: the number in the original is missing.
  await expect(page.getByText("Check: Numbers changed").first()).toBeVisible();
});

test("the import and export page is German for a German admin user", async ({ page }) => {
  await openApp(page, "owner", "/app/translations", { locale: "de" });
  await expect(page.getByRole("button", { name: "CSV herunterladen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Als Entwürfe importieren" })).toBeVisible();
  await expectAccessible(page);
});
