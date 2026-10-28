/**
 * Keyboard-only use: the main flows work with Tab, Shift+Tab, Enter and
 * Space, focus is always visible on a control, and focus goes where the
 * merchant needs it (the "Leave?" question).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/** The focused element, through shadow roots: its host's tag and name, and whether focus is shown. */
async function focused(page: Page) {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    const hosts: Element[] = [];
    while (el?.shadowRoot?.activeElement) {
      hosts.push(el);
      el = el.shadowRoot.activeElement;
    }
    const host = hosts[0] ?? el;
    const inner = el as HTMLElement | null;
    const style = inner ? getComputedStyle(inner) : null;
    const visible =
      !!inner &&
      (inner.matches(":focus-visible") ||
        (style!.outlineStyle !== "none" && style!.outlineWidth !== "0px") ||
        style!.boxShadow !== "none");
    return {
      tag: host?.tagName.toLowerCase() ?? "",
      name: host?.getAttribute("name") ?? "",
      text: (host?.textContent ?? "").trim().slice(0, 60),
      label: host?.getAttribute("label") ?? "",
      visible,
    };
  });
}

/** Tabs until a control matches, at most `limit` times. */
async function tabTo(page: Page, match: (f: Awaited<ReturnType<typeof focused>>) => boolean, limit = 60, key = "Tab") {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(key);
    const f = await focused(page);
    if (match(f)) return f;
  }
  throw new Error(`no matching control within ${limit} presses of ${key}`);
}

test("translate, edit and publish a product with the keyboard only", async ({ page }) => {
  await openApp(page, "full", "/app/products/6?lang=de");
  await page.locator("body").focus();

  const ai = await tabTo(page, (f) => f.tag === "s-button" && f.text === "Translate with AI");
  expect(ai.visible).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Product 6 jacket");

  // Into the title field, replace the draft.
  const title = await tabTo(page, (f) => f.tag === "s-text-field" && f.name === "value:title");
  expect(title.visible).toBe(true);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Jacke Nummer 6");

  // Shift+Tab goes back the same way (no keyboard trap).
  const back = await tabTo(page, (f) => f.tag === "s-button", 10, "Shift+Tab");
  expect(back.visible).toBe(true);

  await tabTo(page, (f) => f.tag === "s-button" && f.text === "Publish translations", 80);
  await page.keyboard.press("Enter");
  await expect(page.locator('s-banner[heading="Translations published"]')).toBeVisible();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Jacke Nummer 6");
});

test("leaving with unpublished changes: focus is on Stay, Enter stays", async ({ page }) => {
  await openApp(page, "full", "/app/products/7?lang=fr");
  // A slow machine (CI runners are): the notice's button may not take focus in its first frame.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.locator('s-text-field[name="value:title"] input').fill("Veste 7");
  await page.locator('s-link[slot="breadcrumb-actions"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('s-banner[heading="Leave without publishing?"]')).toBeVisible();
  await expect.poll(async () => (await focused(page)).text).toBe("Stay on this page");
  await page.keyboard.press("Enter");
  await expect(page.locator('s-banner[heading="Leave without publishing?"]')).toHaveCount(0);
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Veste 7");
});

test("Review: untick a draft with Space and reach the actions by keyboard", async ({ page }) => {
  await openApp(page, "full", "/app/review");
  await page.locator("body").focus();
  const first = await tabTo(page, (f) => f.tag === "s-checkbox" && f.name === "draft", 80);
  expect(first.visible).toBe(true);
  const box = page.locator('s-checkbox[name="draft"]').first();
  await expect(box).toHaveJSProperty("checked", true);
  await page.keyboard.press("Space");
  await expect(box).toHaveJSProperty("checked", false);
  await page.keyboard.press("Space");
  await expect(box).toHaveJSProperty("checked", true);
  const action = await tabTo(page, (f) => f.tag === "s-button" && /^(Approve and publish selected|Reject selected)$/.test(f.text), 20, "Shift+Tab");
  expect(action.visible).toBe(true);
});
