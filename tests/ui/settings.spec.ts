/**
 * Settings: the translation style (form of address per language and the
 * store description for the AI) is saved and shown again after a reload.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

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
  await expect(section.getByText("Saved. New AI translations use this style.")).toBeVisible();

  await page.reload();
  await expect(section.getByRole("combobox", { name: "German", exact: true })).toHaveValue("less");
  await expect(section.getByRole("combobox", { name: "French", exact: true })).toHaveValue("more");
  await expect(section.getByRole("combobox", { name: "Arabic", exact: true })).toHaveValue("default");
  await expect(section.getByRole("textbox", { name: "About your store" })).toHaveValue("Outdoor clothing for families, friendly and simple.");
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
  await expect(section.locator('s-banner[heading="Saved"]')).toBeVisible();
  await page.reload();
  await expect(section.getByText("French, German")).toBeVisible();
  await expect(section.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Arabic", exact: true })).not.toBeChecked();

  // Off again (other tests use this store).
  await section.getByRole("button", { name: "Turn off" }).click();
  await expect(section.getByText("Changes are translated when you start a translation.")).toBeVisible();
});
