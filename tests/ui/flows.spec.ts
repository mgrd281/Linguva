/**
 * The merchant's main flows end to end in the browser: translate, edit,
 * publish, verify; and the Plan page for each billing state. Shopify and the
 * Partner API are simulated; no charges can be created.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, openApp, expectToast } from "./helpers";

test("translate with AI, edit and publish; the published value is read back from Shopify", async ({ page }) => {
  await openApp(page, "full", "/app/products/5?lang=de");
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.getByText(/AI drafts are filled in below/)).toBeVisible();

  const title = page.locator('s-text-field[name="value:title"] input');
  await expect(title).toHaveValue("[de] Product 5 jacket");
  await title.fill("Warme Jacke Nummer 5");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);

  await openApp(page, "full", "/app/products/5?lang=de");
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Warme Jacke Nummer 5");
  // The previous state is in the history and can be restored.
  const history = page.getByRole("button", { name: /^Show history \(\d+\)$/ }).first();
  await history.click();
  await expect(page.getByRole("button", { name: "Hide history" }).first()).toBeVisible();
  await expect(page.getByText(/· (Manual|AI|Before Linguva)/).first()).toBeVisible();
});

test("image alt text is translated and published separately", async ({ page }) => {
  await openApp(page, "full", "/app/products/1?lang=de");
  await page.getByRole("button", { name: "Translate missing alt text and fields with AI" }).click();
  await expect(page.locator('s-text-field[name$=":alt"] input')).toHaveValue("[de] Red wool jacket, front view");
  await page.getByRole("button", { name: "Publish alt text and fields" }).click();
  // Alt text and the custom field, both saved: confirmed by a toast, no warning on the page.
  await expectToast(page, "2 translations published");
  await expect(page.locator('s-banner[heading="Some fields weren\'t saved"]')).toHaveCount(0);
});

test.describe("plan page", () => {
  test("a subscribed store sees its plan and can change it on Shopify's page", async ({ page }) => {
    await openApp(page, "full", "/app/plan");
    await expect(page.getByText("Current plan: Pro")).toBeVisible();
    const change = page.locator("s-button", { hasText: "Change plan" });
    await expect(change).toHaveAttribute("href", "https://admin.shopify.com/store/ui-full/charges/linguva-ui-test/pricing_plans");
    await expect(change).toHaveAttribute("target", "_top");
  });

  test("a store without a subscription is offered Shopify's plan selection (no charge is created by the app)", async ({ page }) => {
    await openApp(page, "empty", "/app/plan");
    await expect(page.getByText("Current plan: none")).toBeVisible();
    await expect(page.locator("s-button", { hasText: "Choose a plan" })).toHaveAttribute("href", /\/charges\/linguva-ui-test\/pricing_plans$/);
    await expectAccessible(page);
  });

  test("the owner's store has complimentary access with an internal cost estimate", async ({ page }) => {
    await openApp(page, "owner", "/app/plan");
    await expect(page.getByText("Current plan: Complimentary access")).toBeVisible();
    await expect(page.getByText(/Estimated AI cost this month \(internal\): \$0\.00/)).toBeVisible();
    await expect(page.getByText(/of 2,000,000/)).toBeVisible();
    await expect(page.locator("s-button", { hasText: /Choose a plan|Change plan/ })).toHaveCount(0);
    await expectAccessible(page);
  });
});
