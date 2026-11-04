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
      await expect(page.getByRole("region", { name: "Next", exact: true }).getByText(/^Approve \d+ translations?$/)).toBeVisible();
      await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
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
      // One row per language, the main one first; the hidden one and the right-to-left one say so in words.
      const rows = page.getByRole("list", { name: "Languages" }).getByRole("listitem");
      await expect(rows.first()).toContainText("Main language · your originals");
      const arabic = rows.filter({ hasText: "Arabic" });
      await expect(arabic.getByText(/written right to left/)).toBeVisible();
      await expect(arabic.locator("s-badge", { hasText: "Hidden" })).toBeVisible();
      await expect(page.getByText(/4 of 20 languages in your store, 3 visible to customers/)).toBeVisible();
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
      await expect(page.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
      await expect(page.locator('[data-button][data-variant="primary"]')).toHaveText("Allow access");
    },
  },
  {
    name: "Products",
    path: "/app/languages/de/products",
    check: async (page) => {
      // The app's one list of products (the area's): it opens as every page does, the languages as Content's chips, visible ones first.
      await expect(page.getByRole("heading", { level: 1, name: "Products in German" })).toBeVisible();
      const chips = page.getByRole("navigation", { name: "Choose a language" });
      await expect(chips.locator('.lv-lang[aria-current="page"]')).toContainText("German");
      await expect(chips.getByRole("link", { name: "Arabic (hidden)" })).toHaveAttribute("href", "/app/languages/ar/products");
      await expect(page.getByRole("link", { name: "Open: Product 1 jacket" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "Outdated" })).toBeVisible();
      // Each text by its name and state (the web address is never one), no "1 / 2".
      await expect(page.locator("s-chip[accessibilitylabel='Description, outdated']").first()).toBeAttached();
      await expect(page.getByText(/^\d+ \/ \d+$/)).toHaveCount(0);
      // Translating asks first: the next step's one button.
      await expect(page.getByRole("region", { name: "Progress: Products", exact: true }).getByRole("button", { name: "Translate" })).toBeVisible();
    },
  },
  {
    name: "Editor",
    path: "/app/products/1?lang=de",
    check: async (page) => {
      await expect(page.getByText("English → German")).toBeVisible();
      // Review's words: how it looks on Google, the image descriptions and extra details.
      await expect(page.getByRole("heading", { name: "On Google", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Image descriptions and extra details", exact: true })).toBeVisible();
      await expect(page.getByText("custom.care")).toBeVisible();
    },
  },
  {
    name: "Editor of a page",
    path: "/app/pages/1?lang=de",
    check: async (page) => {
      // A page's first text is its title, and every text that mentions it says so.
      await expect(page.getByRole("heading", { level: 2, name: "Title", exact: true })).toBeVisible();
      await expect(page.getByText("No Google title: Shopify uses the translated title.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Suggest from the translated title" })).toBeVisible();
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
      // Language names, not codes: one name per job.
      await expect(page.getByText("French · Products", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    },
  },
  {
    name: "Plan",
    path: "/app/plan",
    check: async (page) => {
      await expect(page.getByRole("heading", { name: "Your plan: Pro" })).toBeVisible();
      await expect(page.getByText("AI characters this month", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("of 1,200,000", { exact: true })).toBeVisible();
      await expect(page.locator("[data-button]", { hasText: "Change plan" })).toBeVisible();
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
