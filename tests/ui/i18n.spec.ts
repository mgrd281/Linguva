/**
 * The interface in the admin user's language: Shopify's `locale`
 * parameter (German, French, Spanish here), the browser's language for
 * pages without it, English otherwise. German pages keep the accessibility
 * and phone layout checks; all show no English interface text.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

// English interface words that must not appear on a German page (merchant data aside).
const ENGLISH = /\b(the|your|and|Translate|Translated|Settings|Review|Save|Search|Language|Products|Overview|Status|Show|Jobs|allowance)\b/;

async function interfaceText(page: Page) {
  // Text of the page itself; product data and previews are the merchant's.
  return page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
}

const GERMAN_PAGES = [
  { path: "/app", heading: "Übersicht" },
  { path: "/app/settings", heading: "Einstellungen" },
  { path: "/app/jobs", heading: "Übersetzungsaufträge" },
  // Review lists the store's own (English) texts, so only the interface parts are checked there.
  { path: "/app/review", heading: "Übersetzungen prüfen", merchantText: true },
  { path: "/app/coverage", heading: "Übersetzungsabdeckung" },
  { path: "/app/glossary", heading: "Glossar" },
  { path: "/app/memory", heading: "Übersetzungsspeicher" },
  { path: "/app/plan", heading: "Tarif" },
  { path: "/app/languages", heading: null },
  { path: "/app/content", heading: "Inhalte" },
  // A language and one of its areas, with the store's own names and pictures in them.
  { path: "/app/languages/fr", heading: "Französisch" },
  { path: "/app/languages/fr/products", heading: "Produkte auf Französisch" },
];

for (const { path, heading, merchantText } of GERMAN_PAGES as Array<{ path: string; heading: string | null; merchantText?: boolean }>) {
  test(`${path} is German for a German admin user @responsive`, async ({ page }) => {
    await openApp(page, "full", path, { locale: "de" });
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    if (heading) await expect(page.locator("s-page")).toHaveAttribute("heading", heading);
    const text = merchantText
      ? await page.locator("s-page s-button, s-page s-badge, s-page s-section").evaluateAll((els) =>
          els.map((el) => (el.tagName === "S-SECTION" ? (el.getAttribute("heading") ?? "") : (el as HTMLElement).innerText)).join("\n"),
        )
      : await interfaceText(page);
    expect(text.match(ENGLISH)?.[0] ?? null, text.slice(0, 2000)).toBeNull();
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });
}

// French and Spanish (texts still to be reviewed by native speakers, docs/I18N_REVIEW.md):
// the same pages, no English interface text, accessible names that match.
for (const { locale, nav } of [
  { locale: "fr", nav: "Paramètres" },
  { locale: "es", nav: "Configuración" },
]) {
  for (const { path, merchantText } of GERMAN_PAGES as Array<{ path: string; merchantText?: boolean }>) {
    test(`${path} is in ${locale} for a ${locale} admin user`, async ({ page }) => {
      await openApp(page, "full", path, { locale });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("s-app-nav s-link", { hasText: nav })).toHaveCount(1);
      const text = merchantText
        ? await page.locator("s-page s-button, s-page s-badge, s-page s-section").evaluateAll((els) =>
            els.map((el) => (el.tagName === "S-SECTION" ? (el.getAttribute("heading") ?? "") : (el as HTMLElement).innerText)).join("\n"),
          )
        : await interfaceText(page);
      expect(text.match(ENGLISH)?.[0] ?? null, text.slice(0, 2000)).toBeNull();
      await expectAccessible(page);
    });
  }
}

test("navigation, product list and editor are German; merchant content stays as it is", async ({ page }) => {
  await openApp(page, "full", "/app/products?lang=fr", { locale: "de" });
  // Five entries; every list opens from Inhalte, the tools from Einstellungen.
  await expect(page.locator("s-app-nav s-link")).toHaveText(["Übersicht", "Inhalte", "Prüfen", "Aufträge", "Einstellungen"]);
  await expect(page.getByText("Product 1 jacket").first()).toBeVisible();
  // Language names in German, not Shopify's English names.
  await expect(page.locator("s-badge", { hasText: "Französisch" })).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Alle in Französisch übersetzen" })).toBeVisible();
  await page.getByText("Product 1 jacket").first().click();
  await expect(page).toHaveURL(/\/app\/products\/1\?lang=fr/);
  // The interface stays German after moving inside the app (no `locale` on in-app links).
  await expect(page.locator("s-app-nav s-link", { hasText: "Übersicht" })).toHaveCount(1);
  await expect(page.locator("s-page")).not.toHaveAttribute("heading", /^Translate/);
});

test("the app's target language never changes the interface language", async ({ page }) => {
  // ?lang=de is the language to translate into; the admin user is English.
  await openApp(page, "full", "/app/products?lang=de");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("s-app-nav s-link", { hasText: "Content" })).toHaveCount(1);
});

test("an error page is German for a German admin user", async ({ page }) => {
  await openApp(page, "full", "/app/products/999999?lang=de", { locale: "de" });
  await expect(page.locator('s-banner[heading="Diese Seite wurde nicht gefunden"]')).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Zur Übersicht" })).toBeVisible();
});

test.describe("without Shopify's locale parameter", () => {
  test.use({ locale: "de-DE" });
  test("the browser's language is used", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});
