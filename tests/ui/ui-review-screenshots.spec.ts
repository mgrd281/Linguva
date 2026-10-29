/**
 * Screenshots of the key screens for the design review (docs/UI_REVIEW.md):
 * the production build with the simulated stores, desktop and phone. Runs
 * only on demand, into the folder given:
 *
 *   UI_REVIEW_SCREENSHOTS=docs/ui-review/after pnpm test:ui tests/ui/ui-review-screenshots.spec.ts
 *
 * Fictional stores only; no merchant data.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";
import type { UiShopKey } from "./fixtures/shops";

const OUT = process.env.UI_REVIEW_SCREENSHOTS;
test.skip(!OUT, "Design review screenshots on demand (UI_REVIEW_SCREENSHOTS=<folder>).");

const SCREENS: Array<{ name: string; shop: UiShopKey; path: string; phone?: boolean }> = [
  { name: "overview", shop: "full", path: "/app", phone: true },
  { name: "coverage", shop: "full", path: "/app/coverage", phone: true },
  { name: "coverage-language", shop: "full", path: "/app/coverage?lang=de" },
  { name: "coverage-items", shop: "full", path: "/app/coverage/items?lang=de&type=PRODUCT" },
  { name: "products", shop: "demo", path: "/app/products?lang=de" },
  { name: "editor", shop: "demo", path: "/app/products/2?lang=de", phone: true },
  { name: "review", shop: "demo", path: "/app/review" },
  { name: "import-export", shop: "full", path: "/app/translations", phone: true },
  { name: "jobs", shop: "full", path: "/app/jobs" },
  { name: "empty-overview", shop: "empty", path: "/app" },
];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

for (const screen of SCREENS) {
  test(`${screen.name} @responsive`, async ({ page }, info) => {
    const phone = info.project.name === "mobile";
    test.skip(phone && !screen.phone, "Phone screenshot only for the main screens");
    await openApp(page, screen.shop, screen.path);
    await settle(page);
    const image = await page.screenshot({ path: `${OUT}/${screen.name}-${phone ? "phone" : "desktop"}.png`, fullPage: true, animations: "disabled", caret: "hide" });
    expect(image.length).toBeGreaterThan(5_000);
  });
}
