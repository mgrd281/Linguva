/**
 * Keyboard-only use: the main flows work with Tab, Shift+Tab, Enter and
 * Space, focus is always visible on a control, and focus goes where the
 * merchant needs it (the "Leave?" question).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, expectToast } from "./helpers";

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
      // The app's buttons (components/Button.tsx) and Polaris' own (a dialog's).
      button: Boolean(host?.hasAttribute("data-button") || host?.tagName === "S-BUTTON"),
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
  // Product 12 has no German texts yet: AI fills its name and description.
  await openApp(page, "full", "/app/products/12?lang=de");
  await page.locator("body").focus();

  // The button names how many open texts it translates ("Translate with AI" and its count).
  const ai = await tabTo(page, (f) => f.button && f.text.startsWith("Translate with AI"));
  expect(ai.visible).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Product 12 jacket");

  // Into the name field, replace the draft.
  const title = await tabTo(page, (f) => f.tag === "s-text-field" && f.name === "value:title");
  expect(title.visible).toBe(true);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Jacke Nummer 12");

  // Shift+Tab goes back the same way (no keyboard trap).
  const back = await tabTo(page, (f) => f.button, 10, "Shift+Tab");
  expect(back.visible).toBe(true);

  // "Edit HTML" opens the description's code and moves into it.
  await tabTo(page, (f) => f.button && f.text === "Edit HTML", 40);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await focused(page)).name).toBe("value:body_html");

  await tabTo(page, (f) => f.button && f.text === "Publish translations", 80);
  await page.keyboard.press("Enter");
  await expectToast(page, /translations? published$/);
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Jacke Nummer 12");
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

test("Review: reach a text's Approve and the page's primary by keyboard, approve with Enter", async ({ page }) => {
  await openApp(page, "full", "/app/review?lang=fr");
  await page.locator("body").focus();
  const first = await tabTo(page, (f) => f.button && f.text === "Approve", 80);
  expect(first.visible).toBe(true);
  const primary = await tabTo(page, (f) => f.button && /^Approve all \d+/.test(f.text), 20, "Shift+Tab");
  expect(primary.visible).toBe(true);
  await tabTo(page, (f) => f.button && f.text === "Approve", 20);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Approved – customers see it now.").first()).toBeVisible();
  // Focus moves on to the next text's Approve.
  await expect.poll(async () => (await focused(page)).text).toBe("Approve");
  expect((await focused(page)).visible).toBe(true);
});

test("Plan: the plan links and both lists of details are reached by keyboard, Enter opens them", async ({ page }) => {
  await openApp(page, "full", "/app/plan");
  await page.locator("body").focus();
  const change = await tabTo(page, (f) => f.button && f.text === "Change plan", 30);
  expect(change.visible).toBe(true);
  const choose = await tabTo(page, (f) => f.button && f.text === "Choose Starter", 30);
  expect(choose.visible).toBe(true);

  const table = await tabTo(page, (f) => f.tag === "summary" && f.text.startsWith("Compare all features"), 40);
  expect(table.visible).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("details", { hasText: "Compare all features" })).toHaveAttribute("open", "");

  const question = await tabTo(page, (f) => f.tag === "summary" && f.text === "What counts as an AI character?", 60);
  expect(question.visible).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Every character of your original text that the AI translates/)).toBeVisible();
});

test("Glossary: the rule is one choice of tiles; Tab reaches it with a visible focus, the arrow keys change it", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  await page.locator("body").focus();
  const rule = await tabTo(page, (f) => f.tag === "input" && f.name === "rule", 40);
  expect(rule.visible).toBe(true);
  const rules = page.getByRole("group", { name: "Rule" });
  await expect(rules.getByRole("radio", { name: "Never translate" })).toBeFocused();
  // A radio group: the arrow keys move to the next rule and choose it; only "Always translate as" asks for a translation.
  await page.keyboard.press("ArrowRight");
  await expect(rules.getByRole("radio", { name: "Always translate as" })).toBeChecked();
  await expect(page.locator('s-text-field[name="translation"]')).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(rules.getByRole("radio", { name: "Never use" })).toBeChecked();
  await expect(page.locator('s-text-field[name="translation"]')).toHaveCount(0);
});
