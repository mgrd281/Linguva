/**
 * Original and translation side by side, and HTML shown rendered in a
 * sandboxed frame: formatting visible, nothing in it can run or reach the
 * app. Editor and Review.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

const SOURCE_FRAME = 'iframe[title="Description, English original"]';
const TARGET_FRAME = 'iframe[title="Description, French preview"]';

test("the editor shows HTML rendered and safe beside the original, the code one click away @responsive", async ({ page }, info) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openApp(page, "full", "/app/products/5?lang=fr");
  const description = page.locator('s-section[accessibilitylabel="Description"]');

  // The original, rendered: bold text is bold, no tags as text.
  const source = page.frameLocator(SOURCE_FRAME);
  await expect(source.locator("b")).toHaveText("jacket");
  await expect(source.locator("body")).toHaveText("Warm jacket number 5.");
  expect(await page.locator(SOURCE_FRAME).getAttribute("sandbox")).toBe("");
  // No raw HTML until the merchant asks for it.
  await expect(page.locator('s-text-area[name="value:body_html"]')).toHaveCount(0);

  // "Edit HTML": the code, focus in it, the original's code beside it (side by side on a wide screen, stacked on a phone).
  await description.getByRole("button", { name: "Edit HTML" }).click();
  const code = page.locator('s-text-area[name="value:body_html"] textarea');
  await expect(code).toBeVisible();
  // Focus is inside the Polaris field (its host is the document's active element).
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("value:body_html");
  await expect(page.locator(SOURCE_FRAME)).toHaveCount(0);
  const original = description.getByText("<p>Warm <b>jacket</b> number 5.</p>");
  await expect(original).toBeVisible();
  const originalBox = (await original.boundingBox())!;
  const codeBox = (await code.boundingBox())!;
  if (info.project.name === "mobile") expect(codeBox.y).toBeGreaterThan(originalBox.y + originalBox.height - 1);
  else {
    expect(codeBox.x).toBeGreaterThan(originalBox.x + originalBox.width - 1);
    expect(Math.abs(codeBox.y - originalBox.y)).toBeLessThan(80);
  }

  // What the merchant types is previewed live, and can't run anything.
  const attack = `<p>Veste <strong>chaude</strong></p><img src=x onerror="parent.__xss=1;alert(1)"><script>parent.__xss=2;alert(2)</script>`;
  await code.fill(attack);
  const target = page.frameLocator(TARGET_FRAME);
  await expect(target.locator("strong")).toHaveText("chaude");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);

  // "Hide HTML": both rendered again, the typed text kept.
  await description.getByRole("button", { name: "Hide HTML" }).click();
  await expect(page.locator(SOURCE_FRAME)).toHaveCount(1);
  await expect(page.frameLocator(TARGET_FRAME).locator("strong")).toHaveText("chaude");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

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
