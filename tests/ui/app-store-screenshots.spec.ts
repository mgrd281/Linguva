/**
 * App Store screenshots of the real app (production build, demo store from
 * fixtures/demo-store.ts): 1600 × 900 px as Shopify asks, no browser chrome,
 * no pricing, no merchant data. Runs only on demand:
 *
 *   APP_STORE_SCREENSHOTS=1 pnpm test:ui tests/ui/app-store-screenshots.spec.ts
 *
 * Writes docs/app-store/screenshots/ and the feature image in English and
 * German (docs/app-store/feature-image-{en,de}.png). Alt texts:
 * docs/APP_STORE_LISTING.md. No image shows the Plan page.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openApp } from "./helpers";

const OUT = "docs/app-store/screenshots";

test.skip(!process.env.APP_STORE_SCREENSHOTS, "Generates the App Store screenshots on demand (APP_STORE_SCREENSHOTS=1).");

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(["400", "450", "500", "550", "600", "650", "700"].map((w) => document.fonts.load(`${w} 14px Inter`)));
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

const DESKTOP = [
  { file: "1-products.png", path: "/app/products?lang=de" },
  { file: "2-editor.png", path: "/app/products/1?lang=de" },
  { file: "3-outdated.png", path: "/app/products/2?lang=de" },
  { file: "4-review.png", path: "/app/review" },
  { file: "5-glossary.png", path: "/app/glossary" },
  { file: "6-settings.png", path: "/app/settings" },
  { file: "7-overview.png", path: "/app" },
  { file: "9-language.png", path: "/app/languages/de", scrollTo: "Area by area" },
  { file: "10-content.png", path: "/app/content" },
];

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25 });
  for (const shot of DESKTOP) {
    test(shot.file, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "Desktop screenshots once");
      await openApp(page, "demo", shot.path);
      await settle(page);
      // To a section by its heading (a section's own element has no box to scroll to).
      if (shot.scrollTo) await page.getByRole("heading", { name: shot.scrollTo, exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(200);
      const image = await page.screenshot({ path: `${OUT}/${shot.file}`, animations: "disabled", caret: "hide" });
      expect(image.length).toBeGreaterThan(10_000);
    });
  }
});

test("8-mobile-editor.png @responsive", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "mobile", "Phone screenshot once");
  await openApp(page, "demo", "/app/products/1?lang=de");
  await settle(page);
  const phone = await page.screenshot({ animations: "disabled", caret: "hide" });
  // Shopify wants 1600 × 900: the phone view in a simple frame on a grey background.
  const canvas = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await canvas.setContent(
    `<body style="margin:0;height:900px;display:flex;align-items:center;justify-content:center;background:#f1f1f1">
       <div style="background:#202020;padding:12px;border-radius:36px">
         <img src="data:image/png;base64,${phone.toString("base64")}" style="display:block;height:840px;border-radius:24px">
       </div>
     </body>`,
  );
  await canvas.screenshot({ path: `${OUT}/8-mobile-editor.png` });
  await canvas.close();
});

// The feature image (docs/BRAND_ASSETS.md §2): one line on the left, the Review
// queue cropped large on the right. No logo, no price, no statistics.
const FEATURE = [
  { locale: "en", line: "Approve every translation before it goes live" },
  { locale: "de", line: "Jede Übersetzung freigeben, bevor sie online geht" },
] as const;

for (const feature of FEATURE) {
  test(`feature-image-${feature.locale}.png`, async ({ page, browser }, info) => {
    test.skip(info.project.name !== "desktop", "Desktop once");
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page, "demo", "/app/review", { locale: feature.locale });
    await settle(page);
    // The page without its empty left margin.
    const review = await page.screenshot({ animations: "disabled", caret: "hide", clip: { x: 130, y: 0, width: 1150, height: 800 } });
    const icon = readFileSync("docs/brand/linguva-icon.svg", "utf8");
    const canvas = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await canvas.setContent(
      `<html lang="${feature.locale}"><body style="margin:0;width:1600px;height:900px;overflow:hidden;background:#F1F1F1;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
         <div style="position:absolute;left:96px;top:0;bottom:0;width:440px;display:flex;flex-direction:column;justify-content:center;gap:32px">
           <div style="width:88px;height:88px;border-radius:22px;overflow:hidden">${icon.replace("<svg ", '<svg width="88" height="88" ')}</div>
           <p style="margin:0;font-size:52px;line-height:62px;font-weight:700;letter-spacing:-0.02em;color:#1D1D1F">${feature.line}</p>
         </div>
         <img src="data:image/png;base64,${review.toString("base64")}"
              style="position:absolute;left:600px;top:90px;width:1120px;border-radius:20px;box-shadow:0 24px 64px rgba(0,0,0,.18)">
       </body></html>`,
    );
    await canvas.waitForTimeout(200);
    const image = await canvas.screenshot({ path: `docs/app-store/feature-image-${feature.locale}.png` });
    expect(image.readUInt32BE(16)).toBe(1600);
    expect(image.readUInt32BE(20)).toBe(900);
    await canvas.close();
  });
}
