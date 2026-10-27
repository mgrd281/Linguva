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
      // Setup checklist: languages, consent and a published translation are done in this store.
      await expect(page.locator('s-section[heading="Get started"]')).toHaveCount(1);
      await expect(page.getByText(/of 5 steps done/)).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "Setup progress" })).toBeVisible();
      // Languages with their storefront state.
      await expect(page.locator("s-table").getByText("Arabic", { exact: true })).toBeVisible();
      await expect(page.locator("s-table").getByText("Hidden")).toBeVisible();
      await expect(page.getByText(/translations? to review/)).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "AI usage this month" })).toBeVisible();
    },
  },
  {
    name: "Languages",
    path: "/app/languages",
    check: async (page) => {
      await expect(page.getByText("Arabic (RTL)")).toBeVisible();
      await expect(page.getByText("Unpublished")).toBeVisible();
      await expect(page.getByText(/4 of 20 languages enabled, 3 published/)).toBeVisible();
    },
  },
  {
    name: "Products",
    path: "/app/products?locale=de",
    check: async (page) => {
      await expect(page.getByRole("link", { name: "Product 1 jacket" })).toBeVisible();
      await expect(page.getByText("Outdated").first()).toBeVisible();
      await expect(page.getByText("Translate all into German")).toBeVisible();
    },
  },
  {
    name: "Editor",
    path: "/app/products/1?locale=de",
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
      await expect(page.getByText(/translations waiting for review/)).toBeVisible();
      await expect(page.getByText("Product 1 jacket · Title · French")).toBeVisible();
      // The actions are reachable without scrolling through every draft.
      await expect(page.getByRole("button", { name: "Approve and publish selected" }).first()).toBeInViewport();
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
      await expect(page.getByText("Current plan: Pro")).toBeVisible();
      await expect(page.getByText(/AI characters this month: [\d,]+ of 1,200,000/)).toBeVisible();
      await expect(page.getByText("Change plan")).toBeVisible();
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
