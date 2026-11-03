/**
 * Translation import and export in three steps: the CSV comes from the real
 * export route (session token via fetch) in the language chosen, its next
 * part only for the choice it continues, a filled row comes back as a draft
 * on Review, rows that can't be trusted are listed with their line.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("exports what's missing, imports translations as drafts and lists skipped rows @responsive", async ({ page }) => {
  await openApp(page, "owner", "/app/translations");
  await expect(page.getByRole("heading", { level: 1, name: "Import & export" })).toBeVisible();
  await expect(page.getByText(/Imported translations wait on Review; nothing goes live until you approve it/)).toBeVisible();
  // Three numbered steps: download, fill in, import.
  for (const step of ["Download what to translate", "Fill in the translations", "Import the file"]) await expect(page.getByRole("heading", { level: 2, name: step })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = (await readFile((await (await download).path())!, "utf8")).replace(/^\uFEFF/, "");
  const [header, ...rows] = csv.trim().split("\r\n");
  expect(header).toBe("resource_id,content_type,field,language,source_digest,original,translation,status");
  // 5 products × title, description, URL handle: all missing.
  expect(rows).toHaveLength(15);
  await expect(page.getByText("Downloaded 15 texts to translate into German.")).toBeVisible();

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
  const card = page.locator('s-section[accessibilitylabel="Product 1 jacket, German"]');
  await expect(card.getByRole("heading", { name: "Product 1 jacket", exact: true })).toBeVisible();
  // Same content checks as AI drafts: the number in the original is missing; the text says where it came from.
  await expect(card.locator("s-badge", { hasText: /^Note: Number/ }).first()).toBeVisible();
  await expect(card.locator("s-badge", { hasText: "From your import" })).toBeVisible();
});

test("the export is in the language chosen, not the list's first one, and says so @responsive", async ({ page }) => {
  // German comes first (published languages first); French is chosen.
  await openApp(page, "full", "/app/translations");
  await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("linguva-product-fr.csv");
  const csv = (await readFile((await file.path())!, "utf8")).replace(/^\uFEFF/, "");
  const rows = csv.trim().split("\r\n").slice(1).filter((r) => r.startsWith("gid://"));
  expect(rows.length).toBeGreaterThan(0);
  // The language column (the fourth: id, type and field have no commas).
  expect(new Set(rows.map((r) => r.split(",")[3]))).toEqual(new Set(["fr"]));
  await expect(page.getByText(/^Downloaded \d+ texts? to translate into French\.$/)).toBeVisible();
});

test("the next part is offered only for the language, content and choice of the part downloaded", async ({ page }) => {
  // As in a catalog of more than 2,000 items: each part names the cursor where the next one starts.
  const asked: Array<Record<string, string>> = [];
  await page.route(/\/app\/translations\/export\?/, async (route) => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    asked.push(params);
    await route.fulfill({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      headers: { "X-Linguva-Rows": "3", "X-Linguva-Next": `after-${params.lang}-${asked.length}` },
      body: "resource_id,content_type,field,language,source_digest,original,translation,status\r\n",
    });
  });
  await openApp(page, "full", "/app/translations");
  const language = page.getByRole("combobox", { name: "Language" });
  const content = page.getByRole("combobox", { name: "Content" });
  const gaps = page.getByRole("checkbox", { name: "Only missing and outdated texts" });
  const next = page.getByRole("button", { name: "Download the next part" });

  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.getByText("Downloaded 3 texts to translate into German.")).toBeVisible();
  await expect(next).toBeVisible();
  // German's cursor would start French after German's first part: French starts with its own first part.
  await language.selectOption({ label: "French" });
  await expect(next).toHaveCount(0);
  await language.selectOption({ label: "German" });
  await expect(next).toBeVisible();
  // The same for another content type, and for translated texts too.
  await content.selectOption("COLLECTION");
  await expect(next).toHaveCount(0);
  await content.selectOption("PRODUCT");
  await gaps.uncheck();
  await expect(next).toHaveCount(0);
  await gaps.check();

  // Back on the part's own choice, the next part continues it.
  const part = page.waitForEvent("download");
  await next.click();
  expect((await part).suggestedFilename()).toBe("linguva-product-de.csv");
  expect(asked[1]).toEqual({ lang: "de", type: "PRODUCT", gaps: "1", after: "after-de-1" });
  // Another language starts at its first part, with a next part of its own.
  await language.selectOption({ label: "French" });
  const first = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await first).suggestedFilename()).toBe("linguva-product-fr.csv");
  expect(asked[2]).toEqual({ lang: "fr", type: "PRODUCT", gaps: "1" });
  await expect(page.getByText("Downloaded 3 texts to translate into French.")).toBeVisible();
  await expect(next).toBeVisible();
});

test("the import and export page is German for a German admin user", async ({ page }) => {
  await openApp(page, "owner", "/app/translations", { locale: "de" });
  await expect(page.getByRole("button", { name: "CSV herunterladen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Als Entwürfe importieren" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Übersetzungen eintragen" })).toBeVisible();
  await expectAccessible(page);
});
