/**
 * Settings: the translation style (form of address per language and the
 * store description for the AI) is saved and shown again after a reload;
 * the tools outside the navigation open from here.
 */
import { expect, test } from "@playwright/test";
import { UI_ENV, UI_SHOPS } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp, sessionToken } from "./helpers";

test("the translation style is saved per language @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator('s-section[heading="Translation style"]');
  await expect(section).toHaveCount(1);
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

test("the tools outside the navigation open from Settings, one link each @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const tools = page.locator('s-section[heading="Tools"]');
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
  const usage = page.locator("s-section[heading^='AI usage in ']");
  await expect(usage).toHaveAttribute("heading", /^AI usage in [A-Z][a-z]+ \d{4}$/);
  // The full store is on the Pro plan (1,200,000 characters), not the server default.
  await expect(usage.getByText(/ of 1,200,000 AI\s+characters used/)).toBeVisible();
  await expect(usage.getByRole("progressbar", { name: "AI characters used this month" })).toHaveCount(1);
});


test("automatic translation is off by default and turned on per language @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator('s-section[heading="Automatic translation"]');
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
  await expect(section.getByText("French and German")).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Arabic", exact: true })).not.toBeChecked();

  // Off again (other tests use this store).
  await section.getByRole("button", { name: "Turn off" }).click();
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
});

test("automatic translation says why it waits, and offers only the plan's languages @responsive", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const section = page.locator('s-section[heading="Automatic translation"]');
  const status = section.locator("s-paragraph").filter({ has: page.locator("s-badge") });
  // Spanish was chosen, but the Starter plan's three languages are French, German and Italian.
  await expect(status).toHaveText(/^\s*On\s+German\s*$/);
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
  const section = page.locator('s-section[heading="Automatic translation"]');
  // Nothing was written: still German only, and still paused.
  await expect(section.locator("s-paragraph").filter({ has: page.locator("s-badge") })).toHaveText(/^\s*On\s+German\s*$/);
  await expect(section.locator('s-banner[heading="Automatic translation is paused"]')).toBeVisible();
});

test("automatic translation waits while AI translation isn't allowed", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const section = page.locator('s-section[heading="Automatic translation"]');
  const ai = page.locator('s-section[heading="AI translation"]');
  await ai.getByRole("button", { name: "Withdraw permission" }).click();
  const waiting = section.locator('s-banner[heading="Automatic translation is waiting for your permission"]');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("changes made meanwhile are translated then");
  // Allowed again (the other tests use this store).
  await ai.getByRole("button", { name: "Allow AI processing" }).click();
  await expect(waiting).toHaveCount(0);
});

test("automatic translation left on after a downgrade can still be turned off", async ({ page }) => {
  await openApp(page, "downgraded", "/app/settings");
  const section = page.locator('s-section[heading="Automatic translation"]');
  await expect(section.locator('s-banner[heading="Automatic translation is part of the plans with bulk translation"]')).toBeVisible();
  await expect(section.locator("s-paragraph").filter({ has: page.locator("s-badge") }).first()).toHaveText(/^\s*On\s+German\s*$/);
  await section.getByRole("button", { name: "Turn off" }).click();
  await expectToast(page, "Automatic translation is off.");
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Turn off" })).toHaveCount(0);
});
