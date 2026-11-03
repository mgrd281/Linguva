/**
 * The merchant's main flows end to end in the browser: translate, edit,
 * publish, verify; and the Plan page for each billing state. Shopify and the
 * Partner API are simulated; no charges can be created.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, openApp, expectToast, saveBarShown } from "./helpers";

test("translate with AI, edit and publish; the published value is read back from Shopify", async ({ page }) => {
  // Product 13 has no German texts yet (products 1–10 have a German name).
  await openApp(page, "full", "/app/products/13?lang=de");
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.getByText(/AI drafts are filled in below/)).toBeVisible();

  const title = page.locator('s-text-field[name="value:title"] input');
  await expect(title).toHaveValue("[de] Product 13 jacket");
  await title.fill("Warme Jacke Nummer 13");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);

  await openApp(page, "full", "/app/products/13?lang=de");
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Warme Jacke Nummer 13");
  // Nothing is open any more: AI offers to translate everything again, asking first.
  await expect(page.getByText("Nothing is missing or outdated: every text is translated.")).toBeVisible();
  // The previous state is in the history (the app's fold) and can be restored.
  const history = page.locator("summary", { hasText: /^History \(\d+\)$/ }).first();
  await history.click();
  await expect(page.locator("details", { has: history })).toHaveAttribute("open", "");
  await expect(page.getByText(/· (Manual|AI|Before Linguva)/).first()).toBeVisible();
});

test("AI fills only the open texts: a translation the merchant has stays", async ({ page }) => {
  // Product 9's German name was written before (Produkt 9 Jacke); its description isn't translated.
  await openApp(page, "full", "/app/products/9?lang=de");
  await expect(page.getByRole("button", { name: "Translate with AI: 1 open text" })).toBeVisible();
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-section[accessibilitylabel="Description"]').locator("s-badge").first()).toHaveText("AI draft");
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Produkt 9 Jacke");
  await expect(page.locator('s-section[accessibilitylabel="Name"]').locator("s-badge").first()).toHaveText("Translated");
});

test("image descriptions are translated with the product's texts and published with them", async ({ page }) => {
  await openApp(page, "full", "/app/products/1?lang=de");
  // One AI button for every open text of the page, the image's description and the custom field included.
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name$=":alt"] input')).toHaveValue("[de] Red wool jacket, front view");
  // They count as unpublished: the admin's save bar shows, leaving would ask.
  await expect.poll(() => saveBarShown(page, "linguva-editor-save-bar")).toBe(true);
  await page.getByRole("button", { name: "Publish translations" }).click();
  // The product's texts, the image's description and the custom field: one toast, no warning on the page.
  await expectToast(page, /^\d+ translations published$/);
  await expect(page.locator('s-banner[heading="Some texts weren\'t saved"]')).toHaveCount(0);
  await openApp(page, "full", "/app/products/1?lang=de");
  await expect(page.locator('s-text-field[name$=":alt"] input')).toHaveValue("[de] Red wool jacket, front view");
});

test.describe("plan page", () => {
  test("a subscribed store sees its plan and can change it on Shopify's page", async ({ page }) => {
    await openApp(page, "full", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: Pro" })).toBeVisible();
    const change = page.locator("[data-button]", { hasText: "Change plan" });
    await expect(change).toHaveAttribute("href", "https://admin.shopify.com/store/ui-full/charges/linguva-ui-test/pricing_plans");
    await expect(change).toHaveAttribute("target", "_top");
  });

  test("a store without a subscription is offered Shopify's plan selection (no charge is created by the app)", async ({ page }) => {
    await openApp(page, "empty", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: No plan chosen" })).toBeVisible();
    await expect(page.locator("[data-button]", { hasText: "Choose a plan" })).toHaveAttribute("href", /\/charges\/linguva-ui-test\/pricing_plans$/);
    await expectAccessible(page);
  });

  test("the owner's store has complimentary access with an internal cost estimate", async ({ page }) => {
    await openApp(page, "owner", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: Owner access" })).toBeVisible();
    await expect(page.getByText(/Estimated AI cost this month \(internal\): \$0 at \$25 per million characters/)).toBeVisible();
    await expect(page.getByText(/of 2,000,000/)).toBeVisible();
    // No plan to choose: no plan button anywhere, not on the cards either.
    await expect(page.locator("[data-button]", { hasText: /Choose|Change plan/ })).toHaveCount(0);
    await expectAccessible(page);
  });
});
