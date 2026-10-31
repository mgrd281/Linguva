/**
 * Smart Auto-Translate (Business) in the browser: the schedule as one of the
 * three ways changes are translated on Settings (with real values, its lock
 * on lower plans, and paused after a move to a plan without it), switching
 * between the three ways with the server's explicit flags, the smart page
 * (summary, recent checks and exclusions first, the schedule picker with
 * live next checks, publishing in its dialog, budgets), setting it up and
 * turning it on in one step, the preview without Business and the read-only
 * page after a downgrade, pause and resume, Check now, forged requests,
 * German texts, accessibility and the phone layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";
import { clickSaveBarButton, expectAccessible, expectNoHorizontalScroll, expectToast, openApp, saveBarShown, sessionToken, setWorkerRunning } from "./helpers";

// The smart schedule runs in the worker: these pages are tested with background jobs running.
test.beforeAll(() => setWorkerRunning(true));
test.afterAll(() => setWorkerRunning(false));

const option = (page: Page, card: string, name: string) => page.locator(card).getByRole("group", { name, exact: true });
const choose = (page: Page, card: string, name: string) => option(page, card, name).getByRole("button").first().click();
const isCurrent = (page: Page, card: string, name: string) => expect(option(page, card, name).getByText("Current setting")).toBeVisible();
const post = async (page: Page, shop: UiShopKey, path: string, form: Record<string, string>) => {
  const response = await page.request.post(new URL(path, UI_ENV.appUrl).toString(), { headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS[shop].domain)}` }, form });
  expect(response.ok()).toBe(true);
  return response.text();
};

test("Settings shows the smart schedule as the current way changes are translated, with real values @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("On");
  // When it checks next, in the schedule's own time zone.
  await expect(card.getByText(/^Next check: .*23:00 \(Europe\/Berlin\)$/)).toBeVisible();
  await isCurrent(page, "#settings-changes", "On a schedule");
  const smart = option(page, "#settings-changes", "On a schedule");
  await expect(smart.getByText("Business", { exact: true })).toBeVisible();
  await expect(smart.getByText("Every day at 23:00 · French and German")).toBeVisible();
  await expect(smart.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(smart.getByRole("link", { name: "Schedule and options" })).toHaveAttribute("href", "/app/settings/automatic");
  await expect(page.getByRole("region", { name: "At a glance" }).locator("li").nth(1)).toHaveText(/On\s*Every day at 23:00$/, { useInnerText: true });
  // The other way that would follow the same changes says it would replace this one.
  await expect(option(page, "#settings-changes", "Shortly after saving").getByText("Current setting")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("lower plans see the schedule's lock with the way to Business, not an advert or its actions", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const smart = option(page, "#settings-changes", "On a schedule");
  await expect(smart.getByText("Business", { exact: true })).toBeVisible();
  await expect(smart.getByText("In the Business plan.")).toBeVisible();
  await expect(smart.getByRole("link", { name: "See plans" })).toBeVisible();
  await expect(smart.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("switching between the three ways: one step each, the other way turned off, focus on the new choice", async ({ page }) => {
  await openApp(page, "businessSwitch", "/app/settings");
  const card = "#settings-changes";
  await isCurrent(page, card, "On a schedule");

  // Shortly after saving replaces the schedule (the form says so: replaceSmart).
  await choose(page, card, "Shortly after saving");
  const basic = option(page, card, "Shortly after saving");
  await expect(basic.getByText("Replaces the smart schedule.")).toBeVisible();
  for (const name of ["German", "French"]) await expect(basic.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await basic.getByRole("button", { name: "Turn on", exact: true }).click();
  await expectToast(page, /translated about a minute later/);
  await isCurrent(page, card, "Shortly after saving");
  await expect(page.locator("#settings-changes-basic")).toBeFocused();
  await expect(option(page, card, "On a schedule").getByText("Replaces translating shortly after saving.")).toBeVisible();

  // On a schedule again: it replaces translating shortly after saving (replaceBasic).
  await choose(page, card, "On a schedule");
  await expectToast(page, "Smart schedule is on.");
  await isCurrent(page, card, "On a schedule");
  await expect(page.locator("#settings-changes-smart")).toBeFocused();
  await page.reload();
  await expect(basic.getByRole("checkbox")).toHaveCount(0);

  // Start it yourself: whichever way is on is turned off.
  await choose(page, card, "Start it yourself");
  await expectToast(page, "Smart schedule is off.");
  await isCurrent(page, card, "Start it yourself");
  await expect(page.locator("#settings-changes-manual")).toBeFocused();
  await expect(page.locator(`${card} s-badge`).first()).toHaveText("Off");

  // As it was (other tests use this store).
  await choose(page, card, "On a schedule");
  await isCurrent(page, card, "On a schedule");
});

test("a stale form never switches silently: without the explicit flag the server refuses, and the page says why", async ({ page }) => {
  // Translating shortly after saving can't be turned on beside a schedule that is on.
  expect(await post(page, "businessSwitch", "/app/settings.data", { intent: "auto", enabled: "true", locale: "de" })).toContain("SMART_ON");
  // With the flag it replaces the schedule; then the schedule can't be turned on beside it without its own flag.
  expect(await post(page, "businessSwitch", "/app/settings.data", { intent: "auto", enabled: "true", locale: "de", replaceSmart: "true" })).toContain("autoEnabled");
  expect(await post(page, "businessSwitch", "/app/settings/automatic.data", { intent: "turn-on" })).toContain("BASIC_ON");
  await openApp(page, "businessSwitch", "/app/settings");
  await isCurrent(page, "#settings-changes", "Shortly after saving");
  expect(await post(page, "businessSwitch", "/app/settings/automatic.data", { intent: "turn-on", replaceBasic: "true" })).toContain('"on"');
  await page.reload();
  await isCurrent(page, "#settings-changes", "On a schedule");

  // A page opened while the schedule was off, then turned on elsewhere: the refusal is explained.
  await post(page, "businessSwitch", "/app/settings/automatic.data", { intent: "turn-off" });
  await page.reload();
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await post(page, "businessSwitch", "/app/settings/automatic.data", { intent: "turn-on" });
  await choose(page, "#settings-changes", "Shortly after saving");
  await option(page, "#settings-changes", "Shortly after saving").getByRole("button", { name: "Turn on", exact: true }).click();
  const refused = page.locator('#settings-changes s-banner[heading="The smart schedule is on"]');
  await expect(refused).toContainText("Turn it off, or choose “Shortly after saving” to replace it.");
  await page.reload();
  await isCurrent(page, "#settings-changes", "On a schedule");
});

test("after a move to a plan without the schedule: paused with the plan named, its settings kept read-only, and the same languages shortly after saving instead", async ({ page }) => {
  await openApp(page, "smartDowngraded", "/app/settings");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("Paused");
  await expect(card.locator("s-badge").nth(1)).toHaveText("Business");
  await expect(card.getByText("Your plan no longer includes the smart schedule. Since then, changes aren't translated automatically. Your settings stay saved.")).toBeVisible();
  await expect(card.getByRole("link", { name: "View schedule" })).toHaveAttribute("href", "/app/settings/automatic");
  await expect(page.getByRole("region", { name: "At a glance" }).locator("li").nth(1)).toHaveText(/Paused\s*Not in your plan$/, { useInnerText: true });

  // The page shows the kept settings, read-only, and no action that can't work.
  await openApp(page, "smartDowngraded", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.locator("s-badge").first()).toHaveText("Paused");
  await expect(status.getByText("Your schedule is paused because your plan no longer includes it. Your settings stay saved and apply again once you move to Business.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Shortly after each change/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
  await expect(page.locator("ui-save-bar")).toHaveCount(0);
  await expectAccessible(page);

  await openApp(page, "smartDowngraded", "/app/settings");
  await card.getByRole("button", { name: "Translate automatically instead" }).click();
  await expectToast(page, /translated about a minute later/);
  await isCurrent(page, "#settings-changes", "Shortly after saving");
  await expect(option(page, "#settings-changes", "Shortly after saving").getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  // The two never run together: the schedule was turned off (and is kept).
  await openApp(page, "smartDowngraded", "/app/settings/automatic");
  await expect(page.locator("#smart-status s-badge").first()).toHaveText("Off");
  await expect(page.locator("#smart-status").getByText("Your plan doesn't include the smart schedule. Your settings stay saved and apply again once you move to Business.")).toBeVisible();
});

test("the smart page: summary, recent checks and exclusions first, then the schedule and budgets @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Smart schedule");
  const order = await page.locator("[id^='smart-']:is(section)").evaluateAll((sections) => sections.map((s) => s.id));
  expect(order.slice(0, 4)).toEqual(["smart-status", "smart-activity", "smart-exclusions", "smart-schedule"]);
  const status = page.locator("#smart-status");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Every day at 23:00$/);
  await expect(status.getByText("3 changes in 12 fields")).toBeVisible();
  // Nothing being translated: no line for it.
  await expect(status.getByText("Translating now")).toHaveCount(0);
  const activity = page.locator("#smart-activity");
  await expect(activity.getByText("64 items checked · 3 needed translation (fields: 12, about 1,840 characters)", { exact: false })).toBeVisible();
  await expect(activity.getByText("1,200 characters sent to AI, 640 not sent", { exact: false })).toBeVisible();
  await expect(activity.getByText("On schedule").first()).toBeVisible();
  await expect(activity.getByText("paused")).toBeVisible();
  await expect(activity.getByRole("link", { name: "Products · French" })).toBeVisible();
  await expect(page.locator("#smart-exclusions").getByText("No exclusions")).toBeVisible();
  // The schedule: "How often", the time, the next three checks in its zone.
  await expect(page.getByRole("radiogroup", { name: "How often" }).or(page.getByRole("group", { name: "How often" })).first()).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Every day/ })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Time", exact: true })).toHaveValue("23:00");
  await expect(page.locator("s-ordered-list s-list-item")).toHaveCount(3);
  // Budgets with the saved value written out.
  await expect(page.locator("#smart-budgets").getByText("Saved: 50,000 characters")).toBeVisible();
  await expect(page.getByText("Used by the smart schedule: 0 today, 0 this month")).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("setting it up in one trip: the suggestions, then saved and turned on together", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.locator("s-badge").first()).toHaveText("Off");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Not set up yet$/);
  await expect(status.getByText("The suggestions below suit most stores. Adjust them, or turn the schedule on right away.")).toBeVisible();
  // Nothing to show yet, so no empty cards before the form; and never a disabled primary button.
  await expect(page.locator("#smart-activity, #smart-exclusions")).toHaveCount(0);
  await expect(page.locator('s-button[variant="primary"][disabled]')).toHaveCount(0);
  // The plan's languages are chosen by default, the safe content types too, review first.
  for (const name of ["French", "German", "Spanish"]) await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await isCurrent(page, "#smart-publishing", "Review first");

  await page.getByRole("radio", { name: /^On chosen weekdays/ }).check();
  for (const day of ["Tuesday", "Wednesday", "Friday", "Saturday", "Sunday"]) await page.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await page.getByRole("combobox", { name: "Time", exact: true }).selectOption("09:00");
  const next = page.locator("s-ordered-list s-list-item");
  await expect(next).toHaveCount(3);
  for (const text of await next.allInnerTexts()) expect(text).toMatch(/^(Mon|Thu), .*09:00 \(Europe\/Berlin\)$/);
  // The save bar saves and turns on in this state too.
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
  await expect(page.locator("ui-save-bar#smart-auto-save-bar button").first()).toHaveText("Save and turn on");

  await status.getByRole("button", { name: "Turn on with these settings" }).click();
  await expectToast(page, "Saved. The smart schedule is on.");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Every Monday and Thursday at 09:00$/);
  await expect(status.locator("s-badge").first()).toHaveText("On");
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(false);
  await page.reload();
  await expect(page.getByRole("radio", { name: /^On chosen weekdays/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Tuesday", exact: true })).not.toBeChecked();

  // Set up: the save bar only saves.
  await page.getByRole("checkbox", { name: "Friday", exact: true }).check();
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
  await expect(page.locator("ui-save-bar#smart-auto-save-bar button").first()).toHaveText("Save");
  await clickSaveBarButton(page, "smart-auto-save-bar", 0);
  await expectToast(page, "Saved. The next check follows these settings.");
});

test("a refused save is shown at the top and focused; Discard brings back what is saved", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  await page.getByRole("radio", { name: /^Several times a day/ }).check();
  await page.getByRole("combobox", { name: "Check 1", exact: true }).selectOption("09:00");
  await page.getByRole("combobox", { name: "Check 2", exact: true }).selectOption("09:30");
  await clickSaveBarButton(page, "smart-auto-save-bar", 0);
  const banner = page.locator('s-banner[heading="Not saved"]');
  await expect(banner).toContainText("Checks need to be at least an hour apart.");
  const top = page.locator("div:has(> s-banner[heading='Not saved'])");
  await expect(top).toBeFocused();
  await expect(top).toBeInViewport();
  await clickSaveBarButton(page, "smart-auto-save-bar", 1);
  await expect(page.getByRole("radio", { name: /^On chosen weekdays/ })).toBeChecked();
});

test("automatic publishing on the smart page asks first in the same dialog, and the server still needs the confirmation", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  await expect(page.locator("#smart-publishing").getByText("Applies to the smart schedule's translations.")).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Publish automatically?" });
  await choose(page, "#smart-publishing", "Publish automatically");
  await expect(dialog).toBeVisible();
  await page.locator("s-modal#smart-publish-confirm").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await isCurrent(page, "#smart-publishing", "Review first");
  expect(await saveBarShown(page, "smart-auto-save-bar")).toBe(false);

  await choose(page, "#smart-publishing", "Publish automatically");
  await page.locator("s-modal#smart-publish-confirm").getByRole("button", { name: "Publish automatically", exact: true }).click();
  await isCurrent(page, "#smart-publishing", "Publish automatically");
  await expect(page.locator("#smart-publish-auto")).toBeFocused();
  await clickSaveBarButton(page, "smart-auto-save-bar", 0);
  await expectToast(page, "Saved. The next check follows these settings.");
  await page.reload();
  await isCurrent(page, "#smart-publishing", "Publish automatically");

  // Back to review first; a save switching to automatic without the confirmation is refused.
  await choose(page, "#smart-publishing", "Review first");
  await clickSaveBarButton(page, "smart-auto-save-bar", 0);
  await expectToast(page, "Saved. The next check follows these settings.");
  const version = await page.locator('input[name="version"]').inputValue();
  const forged = await post(page, "businessEdit", "/app/settings/automatic.data", {
    intent: "save",
    version,
    mode: "daily",
    time: "03:00",
    timeZone: "Europe/Berlin",
    locale: "de",
    type: "PRODUCT",
    publishMode: "AUTO_PUBLISH",
  });
  expect(forged).toContain("CONFIRMATION_REQUIRED");
  await page.reload();
  await isCurrent(page, "#smart-publishing", "Review first");
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
  const valid = { intent: "save", mode: "daily", time: "03:00", timeZone: "Europe/Berlin", locale: "de", type: "PRODUCT" };
  // Pro plan: refused, whatever the form says.
  expect(await post(page, "full", "/app/settings/automatic.data", { intent: "turn-on" })).toContain("PLAN");
  expect(await post(page, "full", "/app/settings/automatic.data", { ...valid, version: "0" })).toContain("PLAN");
  expect(await post(page, "full", "/app/settings/automatic.data", { ...valid, version: "0", turnOn: "true" })).toContain("PLAN");
  // Business, with the current version: each forged value is refused by the server's validation.
  const version = await page.locator('input[name="version"]').inputValue();
  const before = await page.locator("#smart-schedule").innerText();
  expect(await post(page, "businessEdit", "/app/settings/automatic.data", { ...valid, version, mode: "hourly" })).toContain("MODE");
  expect(await post(page, "businessEdit", "/app/settings/automatic.data", { ...valid, version, timeZone: "+05:30" })).toContain("TIME_ZONE");
  expect(await post(page, "businessEdit", "/app/settings/automatic.data", { ...valid, version, type: "ONLINE_STORE_THEME" })).toContain("UNKNOWN_TYPE");
  expect(await post(page, "businessEdit", "/app/settings/automatic.data", { ...valid, version, locale: "it" })).toContain("UNKNOWN_LANGUAGE");
  await page.reload();
  await expect(page.locator('input[name="version"]')).toHaveValue(version);
  expect(await page.locator("#smart-schedule").innerText()).toBe(before);
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
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Exclusions");
  await expect(section.getByRole("link", { name: "Product 1" })).toBeVisible();
  await section.getByRole("button", { name: "Remove" }).click();
  await expectToast(page, "Removed from the exclusions.");
  await expect(section.getByText("No exclusions")).toBeVisible();
});

test("the smart page asks for the permission where it is needed, and turning on follows", async ({ page }) => {
  // Business in its trial, without the permission yet.
  await openApp(page, "planTrial", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.getByText("Allow AI translation first.")).toBeVisible();
  await status.getByRole("button", { name: "Allow AI translation" }).click();
  await expectToast(page, "AI translation is allowed.");
  await expect(status.getByRole("button", { name: "Turn on with these settings" })).toBeVisible();
  await expect(page.locator("#smart-status-heading")).toBeFocused();
  // As it was (other tests use this store).
  await post(page, "planTrial", "/app/settings.data", { intent: "revoke-consent" });
});

test("the smart page is German for a German admin user, with one word for each thing", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic", { locale: "de" });
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Intelligenter Zeitplan");
  const text = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
  // Interface words only (zone names and times are data).
  expect(text).not.toMatch(/\b(the|your|and|Translate|Settings|Save|Schedule|Check|Every day|items|changes)\b/);
  expect(text).not.toMatch(/Ausgenommen|Maschinenübersetz|maschinell|Kontingent|URL-Handles|In Echtzeit|live gehen|Geplant\b/);
  await expect(page.getByText("Jeden Tag um 23:00").first()).toBeVisible();
  await expect(page.getByText("3 Änderungen in 12 Feldern")).toBeVisible();
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

test("the smart page on a plan without it shows what it would add and the way to Business, not a form", async ({ page }) => {
  await openApp(page, "full", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText("Part of the Business plan");
  await expect(status.getByText("With Business, Linguva checks your store on your schedule and translates only what is missing or outdated.")).toBeVisible();
  await expect(status.getByRole("link", { name: "See plans" }).or(status.getByRole("button", { name: "See plans" })).first()).toBeVisible();
  await expect(page.locator("#smart-schedule")).toHaveCount(0);
  await expect(page.locator("ui-save-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn on smart schedule" })).toHaveCount(0);
  await expectAccessible(page);
});

test("the smart page groups content by the Content page's areas, under three labels of one level @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  const scope = page.locator("#smart-scope");
  await expect(scope.getByRole("heading", { level: 3 })).toHaveText(["Languages", "Content", "Fields"]);
  const menus = scope.getByRole("group", { name: "Menus & filters" });
  for (const name of ["Menus", "Menu links", "Storefront filters"]) await expect(menus.getByRole("checkbox", { name, exact: true })).toBeVisible();
  // An area with one kind of content is that checkbox alone; the saved choice is kept.
  await expect(scope.getByRole("checkbox", { name: "Products", exact: true })).toBeChecked();
  await expect(scope.getByRole("checkbox", { name: "Menus", exact: true })).not.toBeChecked();
  await expect(scope.getByRole("radio", { name: "All fields (except web addresses)" })).toBeChecked();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
