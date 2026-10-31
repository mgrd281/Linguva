/**
 * Smart Auto-Translate (Business) in the browser: the Settings card with
 * real values, the Business card for lower plans, the smart page (schedule
 * picker with live next checks, scope, publishing confirmation, budgets,
 * activity), pause and resume, Check now, forged requests, German texts,
 * accessibility and the phone layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS } from "./fixtures/shops";
import { clickSaveBarButton, expectAccessible, expectNoHorizontalScroll, expectToast, openApp, saveBarShown, sessionToken, setWorkerRunning } from "./helpers";

// The smart schedule runs in the worker: these pages are tested with background jobs running.
test.beforeAll(() => setWorkerRunning(true));
test.afterAll(() => setWorkerRunning(false));

const card = (page: Page) => page.locator("#settings-smart");

test("Settings shows the smart schedule with real values and its actions @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings");
  const section = card(page);
  await expect(section.locator("s-badge").first()).toHaveText("On");
  await expect(section.getByText("Business", { exact: true })).toBeVisible();
  await expect(section.getByText("French and German")).toBeVisible();
  await expect(section.getByText("Every day at 23:00")).toBeVisible();
  // The next check in the schedule's own time zone, named.
  await expect(section.getByText(/23:00 \(Europe\/Berlin\)/).first()).toBeVisible();
  await expect(section.getByText("3 changes, fields to translate: 12")).toBeVisible();
  await expect(section.getByText("0 items")).toBeVisible();
  // The schedule's own publishing, not bulk translation's.
  await expect(section.getByText("Drafts for review", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Schedule and options" }).or(section.getByRole("button", { name: "Schedule and options" }))).toBeVisible();
  // The basic switch says the smart schedule replaces it.
  await expect(page.getByText(/The smart schedule is on and replaces automatic translation of changes/)).toBeVisible();
  // No second set of controls that would follow the same changes.
  await expect(page.getByRole("button", { name: "Turn on automatic translation" })).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("lower plans see what the smart schedule adds, with the way to the Business plan", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  await expect(card(page).locator("s-badge")).toHaveText("Business");
  await expect(page.getByText(/With the Business plan, Linguva checks your whole store on your schedule/)).toBeVisible();
  await expect(card(page).getByRole("link", { name: "See plans" }).or(card(page).getByRole("button", { name: "See plans" }))).toBeVisible();
  // No smart actions on a plan without it.
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("the smart page shows the schedule, recent checks and budgets @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Smart schedule");
  await expect(page.getByRole("radio", { name: /^Every day/ })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Time", exact: true })).toHaveValue("23:00");
  // The next three checks, in the schedule's zone.
  await expect(page.locator("s-ordered-list s-list-item")).toHaveCount(3);
  // Recent checks with what they found, and a skipped one with its reason.
  const activity = page.locator("#smart-activity");
  await expect(activity.getByText("64 items checked · 3 needed translation (fields: 12, about 1,840 characters)")).toBeVisible();
  await expect(activity.getByText("paused")).toBeVisible();
  // Billed and reused kept apart, from the check's own job.
  await expect(activity.getByText("1,200 characters sent to AI, 640 not sent")).toBeVisible();
  await expect(activity.getByRole("link", { name: "Products · French" })).toBeVisible();
  await expect(page.getByText("Used by the smart schedule: 0 today, 0 this month")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("setting it up: the schedule picker updates the next checks live, then it is saved and turned on", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  // Off and not set up yet: turning on waits for saved settings.
  await expect(page.locator("#smart-status s-badge").first()).toHaveText("Off");
  await expect(page.locator("#smart-status").getByRole("heading", { level: 2 })).toHaveText(/Not set up yet/);
  await expect(page.getByRole("button", { name: "Turn on smart schedule" })).toBeDisabled();
  // The plan's languages are chosen by default, the safe content types too, drafts for review.
  for (const name of ["French", "German", "Spanish"]) await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^Drafts for review/ })).toBeChecked();

  await page.getByRole("radio", { name: /^On chosen weekdays/ }).check();
  await expect(page.getByRole("group", { name: "Days" })).toBeVisible();
  // Only Monday and Thursday.
  for (const day of ["Tuesday", "Wednesday", "Friday", "Saturday", "Sunday"]) await page.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await page.getByRole("combobox", { name: "Time", exact: true }).selectOption("09:00");
  const next = page.locator("s-ordered-list s-list-item");
  await expect(next).toHaveCount(3);
  for (const text of await next.allInnerTexts()) expect(text).toMatch(/^(Mon|Thu), .*09:00 \(Europe\/Berlin\)$/);

  await page.getByRole("button", { name: "Save" }).last().click();
  await expectToast(page, "Saved. The next check follows these settings.");
  // Saved: the save bar is gone, and the next change brings it back.
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(false);
  await page.getByRole("checkbox", { name: "Friday", exact: true }).check();
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
  await clickSaveBarButton(page, "smart-auto-save-bar", 1);
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(false);
  await page.reload();
  await expect(page.getByRole("radio", { name: /^On chosen weekdays/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Monday", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Tuesday", exact: true })).not.toBeChecked();

  await page.getByRole("button", { name: "Turn on smart schedule" }).click();
  await expectToast(page, "Smart schedule is on.");
  await expect(page.getByText("Every Monday and Thursday at 09:00")).toBeVisible();
});

test("automatic publishing needs the explicit confirmation", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  await page.getByRole("radio", { name: /^Publish automatically/ }).check();
  await expect(page.getByRole("checkbox", { name: "I understand that translations will go live without review" })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.locator('s-banner[heading="Not saved"]')).toContainText("Tick the confirmation to publish automatically.");
  // Back to drafts: nothing changed.
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Drafts for review/ })).toBeChecked();
});

test("pause, resume and Check now", async ({ page }) => {
  await openApp(page, "businessPause", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await status.getByRole("button", { name: "Pause" }).click();
  await expectToast(page, "Paused. Nothing is translated until you resume.");
  await expect(status.locator('s-banner[heading="Smart schedule is paused"]')).toContainText("You paused it.");
  await status.getByRole("button", { name: "Resume" }).click();
  await expectToast(page, "Resumed.");
  await status.getByRole("button", { name: "Check now" }).click();
  await expectToast(page, /^Check (started|queued)/);
  // The check shows in the activity (no worker runs in the UI tests: it stays queued or running).
  await expect(page.locator("#smart-activity").getByText("Started by you")).toBeVisible();
});

test("forged requests: a lower plan can't save, and forged values are refused with nothing written", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  const post = async (shop: keyof typeof UI_SHOPS, form: Record<string, string>) => {
    const response = await page.request.post(new URL("/app/settings/automatic.data", UI_ENV.appUrl).toString(), {
      headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS[shop].domain)}` },
      form,
    });
    expect(response.ok()).toBe(true);
    return response.text();
  };
  const valid = { intent: "save", mode: "daily", time: "03:00", timeZone: "Europe/Berlin", locale: "de", type: "PRODUCT" };
  // Pro plan: refused, whatever the form says.
  expect(await post("full", { intent: "turn-on" })).toContain("PLAN");
  expect(await post("full", { ...valid, version: "0" })).toContain("PLAN");
  // Business, with the current version: each forged value is refused by the server's validation.
  const version = await page.locator('input[name="version"]').inputValue();
  const before = await page.locator("#smart-schedule").innerText();
  expect(await post("businessEdit", { ...valid, version, mode: "hourly" })).toContain("MODE");
  expect(await post("businessEdit", { ...valid, version, timeZone: "+05:30" })).toContain("TIME_ZONE");
  expect(await post("businessEdit", { ...valid, version, type: "ONLINE_STORE_THEME" })).toContain("UNKNOWN_TYPE");
  expect(await post("businessEdit", { ...valid, version, locale: "it" })).toContain("UNKNOWN_LANGUAGE");
  await page.reload();
  await expect(page.locator('input[name="version"]')).toHaveValue(version);
  expect(await page.locator("#smart-schedule").innerText()).toBe(before);
  // Basic automatic translation can't be turned on beside a smart schedule that is on.
  const basic = await page.request.post(new URL("/app/settings.data", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS.business.domain)}` },
    form: { intent: "auto", enabled: "true", locale: "de" },
  });
  expect(await basic.text()).toContain("SMART_ON");
});

test("after a move to a plan without the smart schedule, basic automatic translation can be turned on (it replaces the schedule)", async ({ page }) => {
  await openApp(page, "smartDowngraded", "/app/settings");
  const section = page.locator("#settings-auto");
  await section.getByRole("checkbox", { name: "German", exact: true }).check();
  await section.getByRole("button", { name: "Turn on automatic translation" }).click();
  await expectToast(page, /translated about a minute later/);
  await page.reload();
  await expect(section.getByRole("button", { name: "Turn off" })).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  // The two never run together: the smart schedule was turned off.
  await openApp(page, "smartDowngraded", "/app/settings/automatic");
  await expect(page.locator("#smart-status s-badge").first()).toHaveText("Off");
});

test("an item is left out of the smart schedule from its editor, and taken back in on the smart page", async ({ page }) => {
  await openApp(page, "businessPause", "/app/products/1?lang=de");
  const box = page.getByRole("checkbox", { name: "Leave out of the smart schedule" });
  await box.check();
  await expectToast(page, "Left out of the smart schedule.");
  await page.reload();
  await expect(box).toBeChecked();
  await openApp(page, "businessPause", "/app/settings/automatic");
  const section = page.locator("#smart-exclusions");
  await expect(section.getByRole("link", { name: "Product 1" })).toBeVisible();
  await section.getByRole("button", { name: "Remove" }).click();
  await expectToast(page, "Removed from the exclusions.");
  await expect(section.getByText("Nothing is left alone.")).toBeVisible();
});

test("the smart page is German for a German admin user", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic", { locale: "de" });
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Intelligenter Zeitplan");
  const text = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
  // Interface words only (zone names and times are data).
  expect(text).not.toMatch(/\b(the|your|and|Translate|Settings|Save|Schedule|Check|Every day|items|changes)\b/);
  await expect(page.getByText("Jeden Tag um 23:00").first()).toBeVisible();
  await expectAccessible(page);
});

test("the smart page fits a tablet and an iPhone without sideways scrolling", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openApp(page, "business", "/app/settings/automatic");
    await expectNoHorizontalScroll(page);
    await openApp(page, "business", "/app/settings");
    await expectNoHorizontalScroll(page);
  }
});

test("the smart page on a plan without it shows the lock and the way to Business, not a button that can't work", async ({ page }) => {
  await openApp(page, "full", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.getByText("Part of the Business plan")).toBeVisible();
  await expect(status.getByRole("link", { name: "See plans" }).or(status.getByRole("button", { name: "See plans" }))).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on smart schedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" }).last()).toBeDisabled();
  await expectAccessible(page);
});

test("the smart page groups content by the Content page's areas @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  const scope = page.locator("#smart-scope");
  const menus = scope.getByRole("group", { name: "Menus & filters" });
  for (const name of ["Menus", "Menu links", "Storefront filters"]) await expect(menus.getByRole("checkbox", { name, exact: true })).toBeVisible();
  // An area with one kind of content is that checkbox alone; the saved choice is kept.
  await expect(scope.getByRole("checkbox", { name: "Products", exact: true })).toBeChecked();
  await expect(scope.getByRole("checkbox", { name: "Menus", exact: true })).not.toBeChecked();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
