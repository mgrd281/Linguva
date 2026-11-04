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
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";
import { findShopByDomain } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { SMART_DEFAULT_TYPES, SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { testEnv } from "../support/env";
import { clickSaveBarButton, expectAccessible, expectNoHorizontalScroll, expectToast, openApp, saveBarShown, sessionToken, setWorkerRunning } from "./helpers";
import { stoppedJob } from "./stopped-jobs";

// The smart schedule runs in the worker: these pages are tested with background jobs running.
test.beforeAll(() => setWorkerRunning(true));
test.afterAll(() => setWorkerRunning(false));

const option = (page: Page, card: string, name: string) => page.locator(card).getByRole("group", { name, exact: true });
const choose = (page: Page, card: string, name: string) => option(page, card, name).getByRole("button").first().click();
const isCurrent = (page: Page, card: string, name: string) => expect(option(page, card, name).getByText("Current setting")).toBeVisible();
/** Shortly after saving's languages and its button, in the panel under Settings' choices. */
const languagesPanel = (page: Page) => page.locator("#settings-changes").getByRole("group", { name: "Languages for “Shortly after saving”", exact: true });
const post = async (page: Page, shop: UiShopKey, path: string, form: Record<string, string>) => {
  const response = await page.request.post(new URL(path, UI_ENV.appUrl).toString(), { headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS[shop].domain)}` }, form });
  expect(response.ok()).toBe(true);
  return response.text();
};

/** Skipped checks of days long past, as the schedule leaves them; `remove()` takes them away again (the store is shared). */
async function pastChecks(shop: UiShopKey, count: number) {
  const db = new PrismaClient({ datasources: { db: { url: testEnv.DATABASE_URL } } });
  const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
  const shopId = (await findShopByDomain(UI_SHOPS[shop].domain, db))!.id;
  const ids = Array.from({ length: count }, () => randomUUID());
  const day = 86_400_000;
  await withTenant(
    shopId,
    (tx) =>
      tx.smartAutoRun.createMany({
        data: ids.map((id, i) => {
          const at = new Date(Date.now() - (30 + i) * day);
          return { id, shopId, trigger: "SCHEDULED" as const, occurrenceAt: at, status: "SKIPPED" as const, errorCode: "PAUSED", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [], createdAt: at, finishedAt: at };
        }),
      }),
    db,
  );
  return {
    async remove() {
      try {
        await owner.$transaction([owner.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`, owner.$executeRaw`DELETE FROM "SmartAutoRun" WHERE "id" = ANY(${ids}::uuid[])`]);
      } finally {
        await Promise.all([db.$disconnect(), owner.$disconnect()]);
      }
    },
  };
}

/**
 * Counted for the smart schedule's suggestion (every language and the usual content read in full, `chars`
 * characters of German product titles missing); `remove()` makes the store uncounted again (it is shared).
 */
async function counted(shop: UiShopKey, chars: number) {
  const db = new PrismaClient({ datasources: { db: { url: testEnv.DATABASE_URL } } });
  const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
  const shopId = (await findShopByDomain(UI_SHOPS[shop].domain, db))!.id;
  const locales = UI_SHOPS[shop].locales.filter((l) => !l.primary).map((l) => l.locale);
  await withTenant(
    shopId,
    async (tx) => {
      await tx.coverageSegment.createMany({ data: locales.flatMap((locale) => SMART_DEFAULT_TYPES.map((resourceType) => ({ shopId, locale, resourceType, status: "SCANNED" as const, scannedAt: new Date() }))) });
      await tx.coverageCount.create({ data: { shopId, locale: locales[0]!, resourceType: "PRODUCT", fieldGroup: "title", state: "missing", count: 1, chars } });
    },
    db,
  );
  return {
    async remove() {
      try {
        // The store was never counted: all it has is this.
        await owner.$transaction([
          owner.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
          owner.$executeRaw`DELETE FROM "CoverageCount" WHERE "shopId" = ${shopId}::uuid`,
          owner.$executeRaw`DELETE FROM "CoverageSegment" WHERE "shopId" = ${shopId}::uuid`,
        ]);
      } finally {
        await Promise.all([db.$disconnect(), owner.$disconnect()]);
      }
    },
  };
}

test("Settings shows the smart schedule as the current way changes are translated, with real values @responsive", async ({ page }) => {
  // The sections' tiles (a grid on a phone, a row above the section on a wide page): the way changes are translated.
  await openApp(page, "business", "/app/settings");
  const entry = page.getByRole("navigation", { name: "Settings sections" }).locator("li").filter({ hasText: "Translating changes" });
  await expect(entry).toHaveText(/^Translating changes\s*On a schedule$/, { useInnerText: true });
  await openApp(page, "business", "/app/settings?section=changes");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("On");
  // When it checks next, in the schedule's own time zone, on the interface language's clock (12-hour in English).
  await expect(card.getByText(/^Next check: .*11:00\s?PM \(Europe\/Berlin\)$/)).toBeVisible();
  await isCurrent(page, "#settings-changes", "On a schedule");
  const smart = option(page, "#settings-changes", "On a schedule");
  await expect(smart.getByText("Business", { exact: true })).toBeVisible();
  // The current way's summary and actions, in the panel under the choices.
  const schedule = card.getByRole("group", { name: "Your schedule", exact: true });
  // The time in the interface language's clock, as the next checks ("11:00 PM" in English).
  await expect(schedule.getByText(/^Every day at 11:00\sPM · French and German$/)).toBeVisible();
  await expect(schedule.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(schedule.getByRole("link", { name: "Schedule and options" })).toHaveAttribute("href", "/app/settings/automatic");
  // The other way that would follow the same changes says it would replace this one.
  await expect(option(page, "#settings-changes", "Shortly after saving").getByText("Current setting")).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("lower plans see the schedule's lock with the way to Business, not an advert or its actions", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const smart = option(page, "#settings-changes", "On a schedule");
  await expect(smart.getByText("Business", { exact: true })).toBeVisible();
  // The one plan with it: its badge says it (no line repeating it), and the plans link stays beside the badge.
  const badge = smart.locator("s-badge[icon='lock']");
  await expect(badge).toHaveText("Business");
  await expect(smart.locator(".lv-option__foot s-text")).toHaveCount(0);
  await expect(smart.getByRole("link", { name: "See plans" })).toBeVisible();
  // A Polaris host draws no box of its own (display: contents): the badge by where its word is.
  const lock = await badge.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    return box.y + box.height / 2;
  });
  const plans = (await smart.getByRole("link", { name: "See plans" }).boundingBox())!;
  expect(Math.abs(lock - (plans.y + plans.height / 2))).toBeLessThan(4);
  await expect(smart.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("switching between the three ways: one step each, the other way turned off, focus on the new choice", async ({ page }) => {
  await openApp(page, "businessSwitch", "/app/settings");
  const card = "#settings-changes";
  await isCurrent(page, card, "On a schedule");

  // Shortly after saving replaces the schedule (the form says so: replaceSmart).
  await choose(page, card, "Shortly after saving");
  const basic = languagesPanel(page);
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
  await expect(basic).toHaveCount(0);

  // Start it yourself: whichever way is on is turned off.
  await choose(page, card, "Start it yourself");
  await expectToast(page, "Smart schedule is off.");
  await isCurrent(page, card, "Start it yourself");
  await expect(page.locator("#settings-changes-manual")).toBeFocused();
  // Off: the current choice says it; the heading has no badge.
  await expect(page.locator(`${card} h2 ~ s-badge`)).toHaveCount(0);

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
  await languagesPanel(page).getByRole("button", { name: "Turn on", exact: true }).click();
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
  // The status row says so too: the one thing that needs the merchant.
  await expect(page.locator("#settings-status")).toHaveText(/^Smart schedule is paused\s*Not in your plan$/, { useInnerText: true });

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
  await expect(languagesPanel(page).getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  // The two never run together: the schedule was turned off (and is kept).
  await openApp(page, "smartDowngraded", "/app/settings/automatic");
  await expect(page.locator("#smart-status s-badge").first()).toHaveText("Off");
  await expect(page.locator("#smart-status").getByText("Your plan doesn't include the smart schedule. Your settings stay saved and apply again once you move to Business.")).toBeVisible();
});

test("the smart page: summary, recent checks and exclusions first, then the schedule and budgets @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Smart schedule");
  // The way back leads to Settings' section it was opened from (the trail on a wide page, the 44 px back row on a phone).
  await expect(page.getByRole("link", { name: "Translating changes", exact: true })).toHaveAttribute("href", "/app/settings?section=changes");
  const order = await page.locator("[id^='smart-']:is(section)").evaluateAll((sections) => sections.map((s) => s.id));
  expect(order.slice(0, 4)).toEqual(["smart-status", "smart-activity", "smart-exclusions", "smart-schedule"]);
  const status = page.locator("#smart-status");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Every day at 11:00\sPM$/);
  // The next check as a day and a time; the zone is the store's own, so it isn't repeated.
  await expect(status.getByText(/^Next check: (today|tomorrow), 11:00\s?PM$/)).toBeVisible();
  await expect(status.getByText("3 changes in 12 fields")).toBeVisible();
  // Nothing being translated: no line for it.
  await expect(status.getByText("Translating now")).toHaveCount(0);
  // The actions with their icons; Turn off is the quiet red one, and one line says how it differs from Pause.
  await expect(status.locator('[data-button][data-tone="critical"]')).toHaveText("Turn off");
  await expect(status.locator('[data-button][data-tone="critical"]')).toHaveAttribute("data-variant", "tertiary");
  await expect(status.getByText("Pause stops it and keeps everything. Turn off switches to “Start it yourself”.")).toBeVisible();
  const activity = page.locator("#smart-activity");
  // A check's figures, each with its name in the app's words; sent and reused, no estimate beside them.
  const check = activity.getByRole("listitem").first();
  await expect(check).toContainText(/Checked\s*64\s*Needed translation\s*3\s*\(12 fields\)\s*AI characters\s*1,200\s*From translation memory\s*640/, { useInnerText: true });
  await expect(check).not.toContainText("1,840");
  await expect(check.locator(".lv-figure-row")).toHaveText(["64", "3", "1,200", "640"]);
  await expect(activity.getByText("On schedule").first()).toBeVisible();
  await expect(activity.getByText("The schedule was paused.")).toBeVisible();
  // A job by its one name, as Jobs and the job's page say it.
  await expect(activity.getByRole("link", { name: "French · Products" })).toBeVisible();
  // Two checks: no fold for earlier ones.
  await expect(activity.locator("details")).toHaveCount(0);
  await expect(page.locator("#smart-exclusions").getByText("No exclusions")).toBeVisible();
  // The schedule: "How often" as five tiles (native radios), the time, the next three checks in its zone.
  const often = page.getByRole("group", { name: "How often" });
  await expect(often.getByRole("radio")).toHaveCount(5);
  await expect(page.getByRole("radio", { name: /^Every day/ })).toBeChecked();
  await expect(often.getByRole("radio", { name: "Only on demand", exact: true })).toHaveAccessibleDescription("When you press “Check now”");
  await expect(page.getByRole("combobox", { name: "Time", exact: true })).toHaveValue("23:00");
  const schedule = page.locator("#smart-schedule");
  // The chosen way's title leads its panel; the next checks are named like the Time field and don't repeat the store's own zone.
  await expect(schedule.getByRole("heading", { level: 3, name: "Every day" })).toBeVisible();
  await expect(schedule.getByRole("heading", { level: 4, name: "Next checks" })).toBeVisible();
  const next = schedule.getByRole("list", { name: "Next checks" }).getByRole("listitem");
  await expect(next).toHaveCount(3);
  for (const text of await next.allInnerTexts()) expect(text).not.toContain("Europe/Berlin");
  // No lead under the card's heading that only says it again: "How often" says what the card adds.
  await expect(schedule.getByText("When Linguva checks your store.")).toHaveCount(0);
  // The zone in one line; its list only after "Change".
  await expect(schedule.getByText("Time zone: Europe/Berlin (your store's time zone)")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveCount(0);
  await schedule.getByRole("button", { name: "Change: Time zone" }).click();
  await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveValue("Europe/Berlin");
  // Budgets with the saved value written out, and each one's meter.
  const budgets = page.locator("#smart-budgets");
  await expect(budgets.getByText("Saved: 50,000 characters")).toBeVisible();
  await expect(budgets.getByRole("progressbar", { name: "Used today: 0 of 50,000" })).toBeVisible();
  await expect(budgets.getByRole("progressbar", { name: /^Used in \w+ \d{4}: 0 of 1,000,000$/ })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("before setup, the first check's figure is the suggestion's only: other content in the form hides it, Discard brings it back", async ({ page }) => {
  const store = await counted("businessEdit", 1234);
  try {
    await openApp(page, "businessEdit", "/app/settings/automatic");
    const status = page.locator("#smart-status");
    const figure = status.getByText(/^At most 1,234 AI characters/);
    await expect(figure).toBeVisible();
    // Menus weren't counted: "At most" would be wrong for them, so no figure is said.
    await page.locator("#smart-scope").getByRole("checkbox", { name: "Menus", exact: true }).check();
    await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
    await expect(status.getByText("At the first check")).toHaveCount(0);
    // Discard: the suggestion as it was counted, with its figure.
    await clickSaveBarButton(page, "smart-auto-save-bar", 1);
    await expect(figure).toBeVisible();
  } finally {
    await store.remove();
  }
});

test("setting it up in one trip: the suggestions, then saved and turned on together", async ({ page }) => {
  await openApp(page, "businessEdit", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.locator("s-badge").first()).toHaveText("Off");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Not set up yet$/);
  await expect(status.getByText("The suggestions below suit most stores. Adjust them, or turn the schedule on right away.")).toBeVisible();
  // The suggestion itself, in the summary: what "Turn on with these settings" would use, and the first check's characters.
  await expect(status.getByText(/^Every day at 3:00\sAM$/)).toBeVisible();
  await expect(status.getByText("Products, Collections, Pages, Blog posts, and Blogs")).toBeVisible();
  await expect(status.getByText("At the first check")).toBeVisible();
  // A figure is only the suggestion's (the test before); a store never counted says so whatever the form holds.
  const menus = page.locator("#smart-scope").getByRole("checkbox", { name: "Menus", exact: true });
  await menus.check();
  // Read by the form (its save bar shows), and still said.
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
  await expect(status.getByText("At the first check")).toBeVisible();
  await expect(status.getByRole("link", { name: "Count translations" })).toBeVisible();
  await menus.uncheck();
  // "Adjust" goes to the form's first card.
  await status.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.locator("#smart-schedule-heading")).toBeFocused();
  // Nothing to show yet, so no empty cards before the form; and never a disabled primary button.
  await expect(page.locator("#smart-activity, #smart-exclusions")).toHaveCount(0);
  await expect(page.locator('[data-button][data-variant="primary"]:disabled')).toHaveCount(0);
  // The plan's languages are chosen by default, the safe content types too, review first.
  for (const name of ["French", "German", "Spanish"]) await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await isCurrent(page, "#smart-publishing", "Review first");

  await page.getByRole("radio", { name: /^On chosen weekdays/ }).check();
  // The days as one row of seven toggles, each named by its whole day.
  await expect(page.getByRole("group", { name: "Days", exact: true }).getByRole("checkbox")).toHaveCount(7);
  for (const day of ["Tuesday", "Wednesday", "Friday", "Saturday", "Sunday"]) await page.getByRole("checkbox", { name: day, exact: true }).uncheck();
  await page.getByRole("combobox", { name: "Time", exact: true }).selectOption("09:00");
  const next = page.getByRole("list", { name: "Next checks" }).getByRole("listitem");
  await expect(next).toHaveCount(3);
  // The store's own zone isn't named (every other time in the admin is the store's).
  for (const text of await next.allInnerTexts()) expect(text).toMatch(/^(Mon|Thu), .*9:00\s?AM$/);
  // The summary's suggestion follows the form.
  await expect(status.getByText(/^Every Monday and Thursday at 9:00\sAM$/)).toBeVisible();
  // The save bar saves and turns on in this state too.
  await expect.poll(() => saveBarShown(page, "smart-auto-save-bar")).toBe(true);
  await expect(page.locator("ui-save-bar#smart-auto-save-bar button").first()).toHaveText("Save and turn on");

  await status.getByRole("button", { name: "Turn on with these settings" }).click();
  await expectToast(page, "Saved. The smart schedule is on.");
  await expect(status.getByRole("heading", { level: 2 })).toHaveText(/Every Monday and Thursday at 9:00\sAM$/);
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
  const schedule = page.locator("#smart-schedule");
  await page.getByRole("radio", { name: /^Several times a day/ }).check();
  // Only the times in use: one, the time the schedule had, and a way to add more (as far from it as it can be).
  await expect(page.getByRole("combobox", { name: /^Check \d$/ })).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Check 1", exact: true })).toHaveValue("09:00");
  await page.getByRole("combobox", { name: "Check 1", exact: true }).selectOption("09:00");
  await schedule.getByRole("button", { name: "Add a time" }).click();
  await expect(page.getByRole("combobox", { name: "Check 2", exact: true })).toHaveValue("21:00");
  await page.getByRole("combobox", { name: "Check 2", exact: true }).selectOption("09:30");
  // Said live where the next checks would be, before saving.
  await expect(schedule.getByText("Checks need to be at least an hour apart.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Next checks" })).toHaveCount(0);
  await clickSaveBarButton(page, "smart-auto-save-bar", 0);
  const banner = page.locator('s-banner[heading="Not saved"]');
  await expect(banner).toContainText("Checks need to be at least an hour apart.");
  const top = page.locator("div:has(> s-banner[heading='Not saved'])");
  await expect(top).toBeFocused();
  await expect(top).toBeInViewport();
  // A time taken away: the problem is gone and the next checks are back.
  await schedule.getByRole("button", { name: "Remove check 2" }).click();
  await expect(page.getByRole("list", { name: "Next checks" }).getByRole("listitem")).toHaveCount(3);
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
  // Settings' status row: the reason as its title (the badge says "Paused"), what happens next under it.
  const row = status.locator(".lv-status[data-tone='warning']");
  await expect(row.locator(".lv-status__title")).toHaveText("Paused by you");
  await expect(row).toContainText("Nothing is checked or translated until you resume.");
  await expect(status.locator("s-banner")).toHaveCount(0);
  await status.getByRole("button", { name: "Resume" }).click();
  await expectToast(page, "Resumed.");
  await status.getByRole("button", { name: "Check now" }).click();
  await expectToast(page, /^Check (started|queued)/);
  // The check shows in the activity (no worker runs in the UI tests: it stays queued or running).
  await expect(page.locator("#smart-activity").getByText("Started by you")).toBeVisible();
});

test("waiting for the background service: Settings' status row says why once, and Turn off stays the quiet word @responsive", async ({ page }, info) => {
  await setWorkerRunning(false);
  try {
    await openApp(page, "business", "/app/settings/automatic");
    const status = page.locator("#smart-status");
    await expect(status.locator("s-badge").first()).toHaveText("Waiting");
    // The app's status row, not a banner: the reason as its title (the badge says "Waiting"), what happens next under it.
    const row = status.locator(".lv-status[data-tone='warning']");
    await expect(row.locator(".lv-status__title")).toHaveText("Linguva's background service isn't running");
    await expect(row).toContainText("Checks start again by themselves once it's back.");
    await expect(status.locator("s-banner")).toHaveCount(0);
    await expect(status.getByText("Smart schedule is waiting")).toHaveCount(0);
    // Turn off, the one action while it waits: the quiet red word at the card's edge, never the main action's full-width place.
    const turnOff = status.locator('[data-button][data-tone="critical"]');
    await expect(turnOff).toHaveText("Turn off");
    await expect(turnOff).toHaveAttribute("data-variant", "tertiary");
    if (info.project.name === "mobile") {
      const [button, heading] = await Promise.all([turnOff.boundingBox(), page.locator("#smart-status-heading").boundingBox()]);
      expect(Math.abs(button!.x - heading!.x)).toBeLessThanOrEqual(1);
      expect(button!.width).toBeLessThan(heading!.width / 2);
    }
    // The next check's figure in words that aren't the state's, its link set apart.
    await expect(status.getByText("For the next check")).toBeVisible();
    await expect(status).toContainText("Not counted yet · Count translations");
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
    // Settings' section says it in the same look.
    await openApp(page, "business", "/app/settings?section=changes");
    const changes = page.locator("#settings-changes");
    await expect(changes.locator(".lv-status .lv-status__title")).toHaveText("Linguva's background service isn't running");
    await expect(changes.locator("s-banner")).toHaveCount(0);
  } finally {
    await setWorkerRunning(true);
  }
});

test("earlier checks fold behind one line that says what it does; the list it opens is named by what it holds", async ({ page }) => {
  const checks = await pastChecks("businessPause", 4);
  try {
    await openApp(page, "businessPause", "/app/settings/automatic");
    const activity = page.locator("#smart-activity");
    await expect(activity.getByRole("list", { name: "Recent checks", exact: true }).getByRole("listitem")).toHaveCount(3);
    const fold = activity.locator("details summary");
    await expect(fold).toHaveText(/^Show \d+ earlier checks?$/);
    await fold.click();
    // Not named again by the fold's line (a screen reader heard "Show 2 earlier checks, list").
    await expect(activity.getByRole("list", { name: "Earlier checks", exact: true })).toBeVisible();
    await expect(activity.getByRole("list", { name: /^Show/ })).toHaveCount(0);
  } finally {
    await checks.remove();
  }
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
  // By its name as Shopify has it (not its number), with its kind under it.
  await expect(section.getByRole("link", { name: "Product 1 jacket", exact: true })).toBeVisible();
  await expect(section.getByText("Product", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Remove: Product 1 jacket" }).click();
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
  // The ways in the merchant's words, the one that differs from Settings' "Selbst starten" named apart.
  for (const name of ["Kurz nach jeder Änderung", "Jeden Tag", "An gewählten Wochentagen", "Mehrmals täglich", "Nur auf Knopfdruck"]) {
    await expect(page.getByRole("group", { name: "Wie oft" }).getByRole("radio", { name, exact: true })).toBeAttached();
  }
  await expect(page.locator("#smart-activity").getByText("Der Zeitplan war pausiert.")).toBeVisible();
  // Only certain fields: the Coverage page's names for the field groups (Review's words), never their codes ("seo_title").
  await page.getByRole("radio", { name: "Nur bestimmte Felder" }).check();
  const groups = page.locator("#smart-scope");
  for (const name of ["Titel und Namen", "Beschreibungen", "Google-Titel", "Google-Beschreibungen", "Bildbeschreibungen", "Zusatzinfos", "Weitere Texte"]) {
    await expect(groups.getByRole("checkbox", { name, exact: true })).toBeVisible();
  }
  // The option that includes them, in the same card, in the same words (never "benutzerdefinierte Felder").
  await expect(groups.getByRole("checkbox", { name: "Auch Bildbeschreibungen und Zusatzinfos", exact: true })).toBeVisible();
  expect(await groups.innerText()).not.toMatch(/\b(seo_title|seo_description|title|description|alt|value|other)\b/);
  await expectAccessible(page);
});

test("the smart page fits a tablet and an iPhone without sideways scrolling", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await openApp(page, "business", "/app/settings/automatic");
    await expectNoHorizontalScroll(page);
    await openApp(page, "business", "/app/settings");
    await expectNoHorizontalScroll(page);
    await openApp(page, "business", "/app/settings?section=changes");
    await expectNoHorizontalScroll(page);
  }
});

test("a job the schedule stopped for its budget: its card leads back once the budget allows it, as the page's one primary button", async ({ page }) => {
  // Its daily budget (50,000) isn't used up today: the stop's cause is gone.
  const job = await stoppedJob("business", "SMART_BUDGET_DAILY", { requestedBy: SMART_REQUESTED_BY });
  try {
    await openApp(page, "business", `/app/settings/automatic?job=${job.id}#smart-budgets`);
    const budgets = page.locator("#smart-budgets");
    const back = budgets.locator(`[data-button][href="/app/jobs/${job.id}"]`);
    await expect(back).toBeVisible();
    await expect(back).toHaveText("Back to the job");
    await expect(back).toHaveAttribute("data-variant", "primary");
    await expect(budgets.getByText("German · Products can go on")).toBeVisible();
    // Only there, and the hero's own main button steps back.
    await expect(page.locator("#smart-scope").locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
    await expect(page.locator('#smart-status [data-button][data-variant="primary"]')).toHaveCount(0);
    await expectAccessible(page);
    // Without the job in the address, nothing.
    await openApp(page, "business", "/app/settings/automatic");
    await expect(page.locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
  } finally {
    await job.remove();
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
  await expect(page.getByRole("button", { name: /^Turn on/ })).toHaveCount(0);
  await expectAccessible(page);
});

test("the smart page groups content by the Content page's areas, under four labels of one level @responsive", async ({ page }) => {
  await openApp(page, "business", "/app/settings/automatic");
  const scope = page.locator("#smart-scope");
  await expect(scope.getByRole("heading", { level: 3 })).toHaveText(["Languages", "Content", "Fields", "Outdated translations"]);
  const menus = scope.getByRole("group", { name: "Menus & filters" });
  for (const name of ["Menus", "Menu links", "Storefront filters"]) await expect(menus.getByRole("checkbox", { name, exact: true })).toBeVisible();
  // An area with one kind of content is that checkbox alone (named like the Content page's area); the saved choice is kept.
  await expect(scope.getByRole("checkbox", { name: "Products", exact: true })).toBeChecked();
  // The languages as rows like the content's: a flag where an area has its icon, so every checkbox starts at one edge.
  const languages = scope.getByRole("list", { name: "Languages" });
  await expect(languages.getByRole("listitem")).toHaveCount(2);
  await expect(languages.locator("img[src='/flags/FR.svg']")).toHaveCount(1);
  for (const name of ["German", "French"]) await expect(languages.getByRole("checkbox", { name, exact: true })).toBeChecked();
  const [french, products] = await Promise.all([languages.getByRole("checkbox", { name: "French", exact: true }).boundingBox(), scope.getByRole("checkbox", { name: "Products", exact: true }).boundingBox()]);
  expect(Math.abs(french!.x - products!.x)).toBeLessThanOrEqual(1);
  // Each area's picture in its own tint, as on the Content page (Products blue, Collections violet).
  const areas = scope.getByRole("list", { name: "Content" });
  await expect(areas.getByRole("listitem").first().locator(".lv-icon-square")).toHaveAttribute("data-tint", "blue");
  await expect(areas.getByRole("listitem").nth(1).locator(".lv-icon-square")).toHaveAttribute("data-tint", "violet");
  await expect(scope.getByRole("checkbox", { name: "Size charts & more (Metaobjects)" })).not.toBeChecked();
  await expect(scope.getByRole("checkbox", { name: "Menus", exact: true })).not.toBeChecked();
  await expect(scope.getByRole("radio", { name: "All fields (except web addresses)" })).toBeChecked();
  // Outdated translations: two tiles, the saved choice chosen.
  const outdated = scope.getByRole("group", { name: "Outdated translations" });
  await expect(outdated.getByRole("radio")).toHaveCount(2);
  await expect(outdated.getByRole("radio", { name: "Translate again", exact: true })).toBeChecked();
  const keep = outdated.getByRole("radio", { name: "Keep them as they are", exact: true });
  await expect(keep).not.toBeChecked();
  // A tile's line is its radio's description.
  await expect(keep).toHaveAccessibleDescription("They stay and are marked “Outdated”.");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});
