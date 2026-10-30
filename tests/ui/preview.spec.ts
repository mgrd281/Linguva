/**
 * Original and translation side by side, and HTML shown rendered in a
 * sandboxed frame: formatting visible, nothing in it can run or reach the
 * app. Editor and Review.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

const SOURCE_FRAME = 'iframe[title="Description, English original"]';
const TARGET_FRAME = 'iframe[title="Description, French preview"]';

test("the editor shows HTML rendered and safe, next to the translation @responsive", async ({ page }, info) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openApp(page, "full", "/app/products/5?lang=fr");

  // The original, rendered: bold text is bold, no tags as text.
  const source = page.frameLocator(SOURCE_FRAME);
  await expect(source.locator("b")).toHaveText("jacket");
  await expect(source.locator("body")).toHaveText("Warm jacket number 5.");
  expect(await page.locator(SOURCE_FRAME).getAttribute("sandbox")).toBe("");

  // Side by side on a wide screen, stacked on a phone.
  const sourceBox = (await page.locator(SOURCE_FRAME).boundingBox())!;
  const fieldBox = (await page.locator('s-text-area[name="value:body_html"] textarea').boundingBox())!;
  if (info.project.name === "mobile") expect(fieldBox.y).toBeGreaterThan(sourceBox.y + sourceBox.height - 1);
  else {
    expect(fieldBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width - 1);
    expect(Math.abs(fieldBox.y - sourceBox.y)).toBeLessThan(80);
  }

  // What the merchant types is previewed live, and can't run anything.
  const attack = `<p>Veste <strong>chaude</strong></p><img src=x onerror="parent.__xss=1;alert(1)"><script>parent.__xss=2;alert(2)</script>`;
  await page.locator('s-text-area[name="value:body_html"] textarea').fill(attack);
  const target = page.frameLocator(TARGET_FRAME);
  await expect(target.locator("strong")).toHaveText("chaude");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);

  // The code is one click away.
  await page.getByRole("button", { name: "Show HTML" }).first().click();
  await expect(page.locator(SOURCE_FRAME)).toHaveCount(0);
  await expect(page.getByText("<p>Warm <b>jacket</b> number 5.</p>")).toBeVisible();
  await page.getByRole("button", { name: "Show preview" }).first().click();
  await expect(page.locator(SOURCE_FRAME)).toHaveCount(1);

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("Review shows HTML drafts rendered next to the editable translation @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/review");
  const frames = page.locator('iframe[title$=", Description, original"]');
  expect(await frames.count()).toBeGreaterThan(0);
  const first = page.frameLocator('iframe[title$=", Description, original"]').first();
  await expect(first.locator("b")).toHaveText("jacket");
  await expect(page.locator('iframe[title$=", Description, translation preview"]').first()).toHaveAttribute("sandbox", "");
  // The translation is rendered too, without opening the editor: the sanitised draft.
  const translation = page.frameLocator('iframe[title$=", Description, translation preview"]').first();
  await expect(translation.locator("body")).toContainText(/^\[fr\] Warm jacket number \d+\.$/);
  await expect(translation.locator("b")).toHaveText("jacket");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
