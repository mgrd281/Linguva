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

test("translate everything again by keyboard: focus comes back to the button once the drafts are in, and the result is said", async ({ page }) => {
  // Product 17 has no German texts yet: translated and published first, so nothing is open.
  await openApp(page, "full", "/app/products/17?lang=de");
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Product 17 jacket");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);
  await openApp(page, "full", "/app/products/17?lang=de");
  // Nothing is open: the header says every text is done.
  await expect(page.getByText(/^In German · (done|all \d+ texts done)$/)).toBeVisible();
  await page.locator("body").focus();

  await tabTo(page, (f) => f.button && f.text === "Translate everything again");
  await page.keyboard.press("Enter");
  // The question takes focus; confirming closes it with its button.
  await expect.poll(async () => (await focused(page)).text).toBe("Translate again");
  await page.keyboard.press("Enter");
  // The result is said in a status region, and focus is back where it was, not on the page's start.
  await expect(page.getByRole("status").filter({ hasText: "AI drafts are filled in below" })).toHaveCount(1);
  await expect.poll(async () => (await focused(page)).text).toBe("Translate everything again");
  expect((await focused(page)).visible).toBe(true);
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

test("Glossary: the rule is one choice of option cards; Tab reaches the others with a visible focus, Enter and Space choose", async ({ page }) => {
  await openApp(page, "full", "/app/glossary");
  await page.locator("body").focus();
  // "Never translate" is the chosen rule (no button); Tab reaches the next one, a button with a visible focus.
  const other = await tabTo(page, (f) => f.tag === "button" && f.text.startsWith("Always translate as"), 40);
  expect(other.visible).toBe(true);
  const rules = page.getByRole("group", { name: "Rule" });
  const rule = (name: string) => rules.getByRole("group", { name, exact: true });
  // Enter chooses it, and the focus stays on the chosen rule's name; only "Always translate as" asks for a translation.
  await page.keyboard.press("Enter");
  await expect(rule("Always translate as")).toContainText("Chosen");
  await expect(rule("Always translate as").locator(".lv-option__title")).toBeFocused();
  await expect(page.locator('s-text-field[name="translation"]')).toHaveCount(1);
  // The next Tab goes on to the next rule; Space chooses it.
  const next = await tabTo(page, (f) => f.tag === "button" && f.text.startsWith("Never use"), 3);
  expect(next.visible).toBe(true);
  await page.keyboard.press("Space");
  await expect(rule("Never use")).toContainText("Chosen");
  await expect(page.locator('s-text-field[name="translation"]')).toHaveCount(0);
});
