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
import { openApp, setWorkerRunning } from "./helpers";
import type { UiShopKey } from "./fixtures/shops";

// The smart schedule runs in the worker: these pages are tested with background jobs running.
test.beforeAll(() => setWorkerRunning(true));
test.afterAll(() => setWorkerRunning(false));

const OUT = process.env.UI_REVIEW_SCREENSHOTS;
test.skip(!OUT, "Design review screenshots on demand (UI_REVIEW_SCREENSHOTS=<folder>).");

const SCREENS: Array<{ name: string; shop: UiShopKey; path: string; phone?: boolean }> = [
  { name: "overview", shop: "full", path: "/app", phone: true },
  { name: "coverage", shop: "full", path: "/app/coverage", phone: true },
  { name: "coverage-language", shop: "full", path: "/app/coverage?lang=de" },
  { name: "coverage-items", shop: "full", path: "/app/coverage/items?lang=de&type=PRODUCT" },
  { name: "products", shop: "demo", path: "/app/products?lang=de" },
  { name: "editor", shop: "demo", path: "/app/products/2?lang=de", phone: true },
  { name: "review", shop: "demo", path: "/app/review", phone: true },
  // Review, redesigned (UI_REVIEW_SCREENSHOTS=docs/ui-review/redesign2): nothing waiting.
  { name: "review-empty", shop: "visual", path: "/app/review", phone: true },
  { name: "import-export", shop: "full", path: "/app/translations", phone: true },
  { name: "jobs", shop: "full", path: "/app/jobs" },
  { name: "empty-overview", shop: "empty", path: "/app" },
  // The redesign (UI_REVIEW_SCREENSHOTS=docs/ui-review/redesign): the Overview by country, a language, one of its areas.
  { name: "overview-countries", shop: "demo", path: "/app", phone: true },
  { name: "language", shop: "demo", path: "/app/languages/de", phone: true },
  { name: "language-not-counted", shop: "measure", path: "/app/languages/de" },
  { name: "category", shop: "demo", path: "/app/languages/de/products", phone: true },
  { name: "category-list", shop: "catalog", path: "/app/languages/de/products", phone: true },
  // Smart Auto-Translate (UI_REVIEW_SCREENSHOTS=docs/ui-review/smart-auto).
  { name: "smart-settings", shop: "business", path: "/app/settings", phone: true },
  { name: "smart-page", shop: "business", path: "/app/settings/automatic", phone: true },
  { name: "smart-upsell", shop: "full", path: "/app/settings", phone: true },
];

/** The smart schedule's screens also on a tablet and an iPhone (Chromium with their viewports). */
const DEVICES = [
  { name: "tablet", viewport: { width: 820, height: 1180 }, scale: 2, mobile: false },
  { name: "iphone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
];
const SMART = SCREENS.filter((s) => s.name.startsWith("smart-"));

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

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, deviceScaleFactor: device.scale, isMobile: device.mobile, hasTouch: device.mobile });
    for (const screen of SMART) {
      test(`${screen.name} on a ${device.name}`, async ({ page }, info) => {
        test.skip(info.project.name === "mobile", "Taken once, in the desktop project");
        await openApp(page, screen.shop, screen.path);
        await settle(page);
        const image = await page.screenshot({ path: `${OUT}/${screen.name}-${device.name}.png`, fullPage: true, animations: "disabled", caret: "hide" });
        expect(image.length).toBeGreaterThan(5_000);
      });
    }
  });
}
