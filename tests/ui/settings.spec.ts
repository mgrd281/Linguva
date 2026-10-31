/**
 * Settings: the overview at the top (each state in words, a link to its
 * card), the translation style (form of address per language and the store
 * description for the AI) saved and shown again after a reload, publishing
 * and translation memory as two choices with the current one marked,
 * automatic translation in all its states, the AI usage, and the tools
 * outside the navigation.
 */
import { expect, test } from "@playwright/test";
import { UI_ENV, UI_SHOPS } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp, sessionToken } from "./helpers";

test("the overview names every state in words and links to its card @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const glance = page.getByRole("navigation", { name: "At a glance" });
  const tiles: Array<[RegExp, string]> = [
    [/^AI translation\s*Allowed/, "#settings-ai"],
    [/^Publishing\s*Review first/, "#settings-publish"],
    [/^Automatic translation\s*Off/, "#settings-auto"],
    [/^AI characters\s*\d+ %/, "#settings-usage"],
  ];
  for (const [name, href] of tiles) await expect(glance.getByRole("link", { name })).toHaveAttribute("href", href);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // A tile jumps to its card.
  await glance.getByRole("link", { name: /^AI characters/ }).click();
  await expect(page).toHaveURL(/#settings-usage$/);
  await expect(page.locator("#settings-usage")).toBeInViewport();
});

test("the translation style is saved per language @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator("#settings-style");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Translation style");
  // One choice per non-primary language, by name.
  for (const name of ["German", "French", "Arabic"]) {
    await expect(section.getByRole("combobox", { name, exact: true })).toBeVisible();
  }
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  await section.getByRole("combobox", { name: "German", exact: true }).selectOption("less");
  await section.getByRole("combobox", { name: "French", exact: true }).selectOption("more");
  await section.getByRole("textbox", { name: "About your store" }).fill("Outdoor clothing for families, friendly and simple.");
  await section.getByRole("button", { name: "Save translation style" }).click();
  await expectToast(page, "Saved. New AI translations use this style.");

  await page.reload();
  await expect(section.getByRole("combobox", { name: "German", exact: true })).toHaveValue("less");
  await expect(section.getByRole("combobox", { name: "French", exact: true })).toHaveValue("more");
  await expect(section.getByRole("combobox", { name: "Arabic", exact: true })).toHaveValue("default");
  await expect(section.getByRole("textbox", { name: "About your store" })).toHaveValue("Outdoor clothing for families, friendly and simple.");
});

test("publishing shows both choices with the current one marked, and automatic publishing needs the confirmation", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator("#settings-publish");
  const review = section.getByRole("group", { name: "Review first" });
  const auto = section.getByRole("group", { name: "Automatic publishing" });
  await expect(review.getByText("Current setting")).toBeVisible();
  await expect(review.getByText("Recommended")).toBeVisible();
  await expect(auto.getByText("Current setting")).toHaveCount(0);

  // Without the confirmation nothing changes.
  await auto.getByRole("button", { name: "Switch to automatic" }).click();
  await expect(section.locator('s-banner[heading="Please confirm"]')).toBeVisible();
  await page.reload();
  await expect(review.getByText("Current setting")).toBeVisible();

  await auto.getByRole("checkbox", { name: /^I understand that machine translations/ }).check();
  await auto.getByRole("button", { name: "Switch to automatic" }).click();
  await expect(auto.getByText("Current setting")).toBeVisible();
  // The card's state follows: the first badge is the card's own.
  await expect(section.locator("s-badge").first()).toHaveText("Automatic publishing");
  // Back to review first (other tests use this store).
  await review.getByRole("button", { name: "Switch back to review first" }).click();
  await expect(review.getByText("Current setting")).toBeVisible();
});

test("translation memory shows the current choice and switches to the other one", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator("#settings-memory");
  const approved = section.getByRole("group", { name: "Approved only" });
  const machine = section.getByRole("group", { name: "Also machine translations" });
  const current = async () => ((await approved.getByText("Current setting").count()) ? "approved" : "machine");
  const before = await current();
  const other = before === "approved" ? machine : approved;
  await other.getByRole("button").click();
  await expect(other.getByText("Current setting")).toBeVisible();
  await page.reload();
  await expect(other.getByText("Current setting")).toBeVisible();
  // Back as it was (other tests use this store).
  await (before === "approved" ? approved : machine).getByRole("button").click();
  await expect((before === "approved" ? approved : machine).getByText("Current setting")).toBeVisible();
});

test("the tools outside the navigation open from Settings, one link each @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const tools = page.locator("#settings-tools");
  const links: Array<[RegExp, string]> = [
    [/^Languages/, "/app/languages"],
    [/^Countries & markets/, "/app/markets"],
    [/^Coverage in detail/, "/app/coverage"],
    [/^Glossary/, "/app/glossary"],
    [/^Translation memory/, "/app/memory"],
    [/^Import & export/, "/app/translations"],
    [/^Plan/, "/app/plan"],
  ];
  for (const [name, href] of links) await expect(tools.getByRole("link", { name })).toHaveAttribute("href", href);
  // Each says what it is for, inside its link.
  await expect(tools.getByRole("link", { name: /^Glossary\s*Brand names and fixed terms/ })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  await tools.getByRole("link", { name: /^Glossary/ }).click();
  await expect(page).toHaveURL(/\/app\/glossary(\?|$)/);
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Glossary");
});

test("usage on Settings uses the plan's allowance, like the Overview and Plan page", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const usage = page.locator("#settings-usage");
  await expect(usage.getByRole("heading", { level: 2 })).toHaveText(/^AI usage in [A-Z][a-z]+ \d{4}$/);
  // The full store is on the Pro plan (1,200,000 characters), not the server default.
  await expect(usage.getByText("of 1,200,000 AI characters", { exact: true })).toBeVisible();
  await expect(usage.getByRole("progressbar", { name: "AI characters used this month" })).toHaveCount(1);
  await expect(usage.getByText(/^New AI characters on [A-Z][a-z]+ \d{1,2}$/)).toBeVisible();
});

test("automatic translation is off by default and turned on per language @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator("#settings-auto");
  await expect(section.locator("s-badge").first()).toHaveText("Off");
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
  await expect(section.getByText(/only missing or\s+outdated texts are translated/i)).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Turning it on without a language is refused.
  await section.getByRole("button", { name: "Turn on automatic translation" }).click();
  await expect(section.locator('s-banner[heading="Choose at least one language"]')).toBeVisible();

  await section.getByRole("checkbox", { name: "German", exact: true }).check();
  await section.getByRole("checkbox", { name: "French", exact: true }).check();
  await section.getByRole("button", { name: "Turn on automatic translation" }).click();
  await expectToast(page, /translated about a minute later/);
  await page.reload();
  await expect(section.locator("s-badge").first()).toHaveText("On");
  await expect(section.getByText("Languages: French and German")).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Arabic", exact: true })).not.toBeChecked();
  // The overview says so too.
  await expect(page.getByRole("navigation", { name: "At a glance" }).getByRole("link", { name: /^Automatic translation\s*On\s*French and German/ })).toBeVisible();

  // Off again (other tests use this store).
  await section.getByRole("button", { name: "Turn off" }).click();
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
});

test("automatic translation says why it waits, and offers only the plan's languages @responsive", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const section = page.locator("#settings-auto");
  // Spanish was chosen, but the Starter plan's three languages are French, German and Italian.
  await expect(section.locator("s-badge").first()).toHaveText("Paused");
  await expect(section.getByText("Languages: German", { exact: true })).toBeVisible();
  const paused = section.locator('s-banner[heading="Automatic translation is paused"]');
  await expect(paused).toBeVisible();
  await expect(paused).toContainText(/Today's AI allowance is used up\. It continues by itself after .+ UTC, with everything changed meanwhile\./);
  // Only the plan's languages can be chosen; the others are named, with the way to more.
  for (const name of ["French", "German", "Italian"]) await expect(section.getByRole("checkbox", { name, exact: true })).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "Spanish", exact: true })).toHaveCount(0);
  await expect(section.getByText("Spanish isn't among your plan's languages.")).toBeVisible();
  await expect(section.getByRole("link", { name: "See plans" })).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(section.getByRole("button", { name: "Turn off" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a forged request can't add a language outside the plan or lift a pause", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const response = await page.request.post(new URL("/app/settings.data", UI_ENV.appUrl).toString(), {
    headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS.autoLimits.domain)}` },
    form: { intent: "auto", enabled: "true", locale: "de,es" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  const section = page.locator("#settings-auto");
  // Nothing was written: still German only, and still paused.
  await expect(section.getByText("Languages: German", { exact: true })).toBeVisible();
  await expect(section.locator("s-badge").first()).toHaveText("Paused");
  await expect(section.locator('s-banner[heading="Automatic translation is paused"]')).toBeVisible();
});

test("automatic translation waits while AI translation isn't allowed", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const section = page.locator("#settings-auto");
  const ai = page.locator("#settings-ai");
  await ai.getByRole("button", { name: "Withdraw permission" }).click();
  await expect(ai.locator("s-badge").first()).toHaveText("Not allowed");
  const waiting = section.locator('s-banner[heading="Automatic translation is waiting for your permission"]');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("changes made meanwhile are translated then");
  // Allowed again (the other tests use this store).
  await ai.getByRole("button", { name: "Allow AI processing" }).click();
  await expect(waiting).toHaveCount(0);
  await expect(ai.locator("s-badge").first()).toHaveText("Allowed");
});

test("automatic translation left on after a downgrade can still be turned off", async ({ page }) => {
  await openApp(page, "downgraded", "/app/settings");
  const section = page.locator("#settings-auto");
  await expect(section.getByText("Automatic translation is part of the plans with bulk translation")).toBeVisible();
  await expect(section.getByRole("link", { name: "See plans" }).or(section.getByRole("button", { name: "See plans" }))).toBeVisible();
  await expect(section.locator("s-badge").first()).toHaveText("On");
  await expect(section.getByText("Languages: German", { exact: true })).toBeVisible();
  // Automatic publishing isn't part of Free: the option says so instead of offering the switch.
  const auto = page.locator("#settings-publish").getByRole("group", { name: "Automatic publishing" });
  await expect(auto.getByText("Part of the Pro and Business plans.")).toBeVisible();
  await expect(auto.getByRole("button", { name: "Switch to automatic" })).toHaveCount(0);

  await section.getByRole("button", { name: "Turn off" }).click();
  await expectToast(page, "Automatic translation is off.");
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Turn off" })).toHaveCount(0);
});

test("Settings is German for a German admin user", async ({ page }) => {
  await openApp(page, "full", "/app/settings", { locale: "de" });
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Einstellungen");
  await expect(page.getByRole("navigation", { name: "Auf einen Blick" })).toBeVisible();
  const text = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
  // Interface words only (language and store names are data).
  expect(text).not.toMatch(/\b(the|your|and|Settings|Save|Publishing|Current setting|Recommended|Turn on|Tools)\b/);
  await expectAccessible(page);
});
