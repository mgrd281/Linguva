/**
 * The main pages with real data: content, accessibility (axe, WCAG 2.1 AA)
 * and, on a phone viewport (@responsive), no horizontal scrolling.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

const PAGES: Array<{ name: string; path: string; check: (page: Page) => Promise<void> }> = [
  {
    name: "Overview",
    path: "/app",
    check: async (page) => {
      // One next step, the only primary button: drafts wait in this store.
      await expect(page.locator('s-section[heading="Next"]').getByText(/^Approve \d+ translations?$/)).toBeVisible();
      await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
      // Languages with their storefront state, each opening its page.
      await expect(page.getByRole("link", { name: /^Arabic Hidden/ })).toHaveAttribute("href", "/app/languages/ar");
      // AI usage this month, in characters.
      await expect(page.getByText(/^AI translation this month: [\d,]+ of [\d,]+ characters$/)).toBeVisible();
    },
  },
  {
    name: "Languages",
    path: "/app/languages",
    check: async (page) => {
      await expect(page.getByText("Arabic (RTL)")).toBeVisible();
      await expect(page.getByText("Unpublished")).toBeVisible();
      await expect(page.getByText(/4 of 20 languages enabled, 3 published/)).toBeVisible();
      // Each additional language opens its own page; the original has none.
      await expect(page.getByRole("link", { name: "German" })).toHaveAttribute("href", "/app/languages/de");
      await expect(page.getByRole("link", { name: /^Arabic/ })).toHaveAttribute("href", "/app/languages/ar");
      await expect(page.getByRole("link", { name: /^English/ })).toHaveCount(0);
    },
  },
  {
    name: "Content",
    path: "/app/content",
    check: async (page) => {
      // Area by area, each a link with its figure; one primary button, for the missing permission.
      await expect(page.getByRole("link", { name: /^Products: \d+% translated\. / })).toBeVisible();
      await expect(page.locator('s-button[variant="primary"]')).toHaveCount(1);
      await expect(page.locator('s-button[variant="primary"]')).toHaveText("Allow access");
    },
  },
  {
    name: "Products",
    path: "/app/products?lang=de",
    check: async (page) => {
      await expect(page.getByRole("link", { name: "Product 1 jacket" })).toBeVisible();
      await expect(page.getByText("Outdated").first()).toBeVisible();
      await expect(page.getByText("Translate all into German")).toBeVisible();
    },
  },
  {
    name: "Editor",
    path: "/app/products/1?lang=de",
    check: async (page) => {
      await expect(page.getByText("English → German")).toBeVisible();
      await expect(page.getByText("Search engine listing")).toBeVisible();
      await expect(page.getByText("Images and custom fields")).toBeVisible();
      await expect(page.getByText("custom.care")).toBeVisible();
    },
  },
  {
    name: "Review",
    path: "/app/review",
    check: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Review translations" })).toBeVisible();
      // One card per item and language: its name, then its area and language.
      const card = page.locator('s-section[accessibilitylabel="Product 1 jacket, French"]');
      await expect(card.getByRole("heading", { level: 2, name: "Product 1 jacket", exact: true })).toBeVisible();
      await expect(card.getByText("French", { exact: true }).first()).toBeVisible();
      // The page's one primary action is in the first screen, without scrolling through the texts.
      await expect(page.getByRole("button", { name: /^Approve all \d+( on this page)?$/ })).toBeInViewport();
    },
  },
  {
    name: "Jobs",
    path: "/app/jobs",
    check: async (page) => {
      // Language names, not codes.
      await expect(page.locator("s-table").getByText("French", { exact: true })).toBeVisible();
      await expect(page.locator("s-table").getByText("Products", { exact: true })).toBeVisible();
    },
  },
  {
    name: "Plan",
    path: "/app/plan",
    check: async (page) => {
      await expect(page.getByRole("heading", { name: "Your plan: Pro" })).toBeVisible();
      await expect(page.getByText("AI characters this month", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("of 1,200,000", { exact: true })).toBeVisible();
      await expect(page.locator("s-button", { hasText: "Change plan" })).toBeVisible();
    },
  },
];

for (const p of PAGES) {
  test(`${p.name} shows its content and is accessible @responsive`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApp(page, "full", p.path);
    await p.check(page);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
}
