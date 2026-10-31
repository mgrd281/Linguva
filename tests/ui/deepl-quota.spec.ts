/**
 * The DeepL keys' quota on the Overview: the operator's own store only
 * (OPERATOR_SHOPS), one ring per key, never on a merchant's store.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

test("the operator's store sees each DeepL key's quota as a ring @responsive", async ({ page }) => {
  await openApp(page, "owner", "/app");
  const card = page.locator("s-section").filter({ has: page.getByRole("heading", { name: "DeepL quota" }) });
  await expect(card.getByText("Only you see this")).toBeVisible();
  await expect(card.getByText("Together: 800,000 of 2,000,000 characters left")).toBeVisible();

  await expect(card.getByRole("img", { name: "Key 1: 75% left" })).toBeVisible();
  await expect(card.getByText("750,000 of 1,000,000 characters left")).toBeVisible();
  await expect(card.getByText("Free · …0001")).toBeVisible();

  await expect(card.getByRole("img", { name: "Key 2: 5% left" })).toBeVisible();
  await expect(card.getByRole("img", { name: "Key 3: ∞ left" })).toBeVisible();
  await expect(card.getByText("No limit · 7 characters used")).toBeVisible();
  await expect(card.getByText("Pro · …0003")).toBeVisible();
  // Never the key itself.
  expect(await card.innerText()).not.toContain("ui-key");

  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("a merchant's store never sees the operator's DeepL quota", async ({ page }) => {
  await openApp(page, "full", "/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DeepL quota" })).toHaveCount(0);
});
