/**
 * App Store screenshots of the real app (production build, demo store from
 * fixtures/demo-store.ts): 1600 × 900 px as Shopify asks, no browser chrome,
 * no pricing, no merchant data. Runs only on demand:
 *
 *   APP_STORE_SCREENSHOTS=1 pnpm test:ui tests/ui/app-store-screenshots.spec.ts
 *
 * Writes docs/app-store/screenshots/. Alt texts: docs/APP_STORE_LISTING.md.
 */
import { expect, test, type Page } from "@playwright/test";
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
  { file: "6-settings.png", path: "/app/settings", scrollTo: "Translating changes" },
  { file: "7-overview.png", path: "/app" },
  { file: "9-language.png", path: "/app/languages/de", scrollTo: "Area by area" },
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
