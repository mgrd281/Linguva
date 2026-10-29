/**
 * The editor shows each field's state at the top of the field: translated,
 * outdated or not translated, so a merchant sees what needs work without
 * reading every input. The original description shows in full.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, openApp } from "./helpers";

test("each field starts with its state @responsive", async ({ page }) => {
  // Demo catalog: the jacket's German title is translated, its description outdated, its SEO description missing.
  await openApp(page, "demo", "/app/products/2?lang=de");
  const field = (heading: string) => page.locator(`s-section[heading="${heading}"]`);
  await expect(field("Title").locator("s-badge").first()).toHaveText("Translated");
  await expect(field("Description").locator("s-badge").first()).toHaveText("Outdated");
  await expect(field("SEO description").locator("s-badge").first()).toHaveText("Not translated");
  // The URL handle is never machine-translated: said next to its state.
  await expect(field("URL handle").locator("s-badge", { hasText: "Manual only" })).toBeVisible();
  // The original description's frame is tall enough for its last list item.
  // (The frame is sandboxed: its content is measured inside the frame.)
  const frame = field("Description").locator("iframe").first();
  const clientHeight = await frame.evaluate((f: HTMLIFrameElement) => f.clientHeight);
  const contentHeight = await (await frame.elementHandle())!.contentFrame().then((f) => f!.evaluate(() => document.documentElement.scrollHeight));
  expect(contentHeight).toBeLessThanOrEqual(clientHeight);
  await expectAccessible(page);
});
