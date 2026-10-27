/**
 * Screenshot comparisons of the main pages (desktop and phone) against
 * reviewed baselines in visual.spec.ts-snapshots/. Catches unintended layout
 * and style changes. Dates are masked; the "visual" store's data is fixed.
 *
 * After an intended change, or when Shopify updates Polaris (loaded from
 * its CDN): `pnpm test:visual:update`, look at every changed image, commit.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const PAGES: Array<[string, string]> = [
  ["overview", "/app"],
  ["products", "/app/products?locale=de"],
  ["editor", "/app/products/2?locale=de"],
  ["review-empty", "/app/review"],
  ["glossary", "/app/glossary"],
  ["settings", "/app/settings"],
  ["plan", "/app/plan"],
];

const DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b|\b[A-Z][a-z]{2} \d{1,2}, \d{4}/;

async function settle(page: Page) {
  // Polaris uses the Inter web font. `document.fonts.ready` doesn't wait for
  // faces that haven't been requested yet: load every weight the admin uses,
  // and fail clearly if the font isn't there (a fallback font changes every
  // pixel of text, which is what CI showed before this).
  const loaded = await page.evaluate(async () => {
    await Promise.all(["400", "450", "500", "550", "600", "650", "700"].map((w) => document.fonts.load(`${w} 14px Inter`)));
    await document.fonts.ready;
    return document.fonts.check("600 14px Inter") && document.fonts.check("400 14px Inter");
  });
  expect(loaded, "Inter web font loaded").toBe(true);
  // Dates change every day: replace them with a fixed one (Polaris text has
  // no box of its own, so masking can't cover it).
  await page.evaluate((source) => {
    const pattern = new RegExp(source, "g");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (pattern.test(node.nodeValue ?? "")) node.nodeValue = node.nodeValue!.replace(pattern, "January 1, 2026");
      pattern.lastIndex = 0;
    }
  }, DATE.source);
  // Web components render after hydration; wait until layout is stable.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

for (const [name, path] of PAGES) {
  test(`${name} looks as reviewed @responsive`, async ({ page }) => {
    await openApp(page, "visual", path);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    });
  });
}
