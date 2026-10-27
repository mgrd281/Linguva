/**
 * Right-to-left languages in the editor: text is typed right to left with
 * the language set (screen readers, spell checking); URL handles stay left
 * to right.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, openApp } from "./helpers";


test("Arabic fields are right to left, the URL handle stays left to right @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/products/1?locale=ar");
  await expect(page.locator('s-banner[heading="Right-to-left language"]')).toBeVisible();

  const title = page.locator('s-text-field[name="value:title"] input');
  expect(await title.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  const host = page.locator('s-text-field[name="value:title"]');
  expect(await host.evaluate((el) => el.closest("[lang]")?.getAttribute("lang"))).toBe("ar");

  const handle = page.locator('s-text-field[name="value:handle"] input');
  expect(await handle.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");

  // HTML follows its first letter: the leading tag keeps it left to right.
  const body = page.locator('s-text-area[name="value:body_html"]');
  expect(await body.evaluate((el) => el.closest("[dir]")?.getAttribute("dir"))).toBe("auto");
  await expectAccessible(page);
});

test("left-to-right languages are unchanged", async ({ page }) => {
  await openApp(page, "full", "/app/products/1?locale=de");
  const title = page.locator('s-text-field[name="value:title"] input');
  expect(await title.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  expect(await page.locator('s-text-field[name="value:title"]').evaluate((el) => el.closest("[dir]"))).toBeNull();
});
