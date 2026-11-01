/**
 * Several translation engines (docs/AI_ENGINES.md), on a second server with
 * DeepL, Microsoft Azure and Google Cloud configured with fictional keys
 * (playwright.config.ts, project "engines"; preload.ts answers only their
 * free checks and language lists). Nothing is translated here.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp } from "./helpers";

test("the operator's store sees the translation services: order, DeepL keys, an Azure and a Google tile", async ({ page }) => {
  await openApp(page, "owner", "/app");
  const card = page.locator("s-section").filter({ has: page.getByRole("heading", { name: "Translation services" }) });
  await expect(card.getByText("Only you see this")).toBeVisible();
  await expect(card.getByText("Order: DeepL → Microsoft Azure → Google Cloud")).toBeVisible();
  await expect(card.getByRole("heading", { name: "DeepL keys" })).toBeVisible();
  await expect(card.getByRole("img", { name: "Key 1: 75% left" })).toBeVisible();
  await expect(card.getByText("Key accepted")).toBeVisible();
  await expect(card.getByText("Region westeurope · …0000")).toBeVisible();
  await expect(card.getByText("EU data centres")).toBeVisible();
  await expect(card.getByText("Refused by Google Cloud")).toBeVisible();
  // This store's consent covers DeepL only: Azure and Google translate nothing for it yet.
  await expect(card.getByText("Not allowed in this store yet:")).toHaveCount(2);
  await expect(card.getByRole("link", { name: "Settings" })).toHaveCount(2);
  await expect(card.getByText("First choice for 1 of 1 languages")).toHaveCount(1);
  // DeepL alone's card is replaced, never shown next to it.
  await expect(page.getByRole("heading", { name: "DeepL quota" })).toHaveCount(0);
  // Never a key beyond its last four characters.
  const text = await card.innerText();
  for (const key of ["uiazurekey0004", "ui-google-key-0005", "ui-key-one"]) expect(text).not.toContain(key);
  await expectAccessible(page);
});

test("a merchant's store sees no translation services card", async ({ page }) => {
  await openApp(page, "engines", "/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Translation services" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "DeepL quota" })).toHaveCount(0);
});

test("the Languages page names the engine of each language", async ({ page }) => {
  await openApp(page, "engines", "/app/languages");
  const german = page.locator("s-table-row").filter({ hasText: "de" }).filter({ hasText: "German" });
  await expect(german.getByText("Available")).toBeVisible();
  await expect(german.getByText("with DeepL")).toBeVisible();
  // DeepL's (fictional) list has no Thai: Microsoft Azure translates it.
  const thai = page.locator("s-table-row").filter({ hasText: "Thai" });
  await expect(thai.getByText("with Microsoft Azure")).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
});

test("a DeepL-only consent: the language only Azure serves waits for consent, Settings ask to allow the others", async ({ page }) => {
  await openApp(page, "enginesLegacy", "/app/languages");
  const thai = page.locator("s-table-row").filter({ hasText: "Thai" });
  await expect(thai.getByText("Available with Microsoft Azure once you allow it in Settings")).toBeVisible();
  await expect(thai.getByRole("link", { name: "Open Settings" })).toBeVisible();
  const german = page.locator("s-table-row").filter({ hasText: "German" });
  await expect(german.getByText("with DeepL")).toBeVisible();

  await openApp(page, "enginesLegacy", "/app/settings");
  // The permission the shop gave: today's DeepL text, word for word.
  await expect(page.getByText("Linguva sends only your store's texts (such as products, pages and menus) to DeepL SE in Germany, no customer or order data.")).toBeVisible();
  const extra = page.locator("s-box").filter({ has: page.getByRole("heading", { name: "More translation services" }) });
  await expect(extra.getByText(/Linguva is also set up to use Microsoft Ireland Operations Ltd\. .* and Google Cloud EMEA Ltd\. .*Until you allow it, Linguva uses only DeepL\./)).toBeVisible();
  // Before the click: every service, their order and the failover (the notice the stored version stands for).
  await expect(extra.getByText(/Texts go to DeepL first; only if it can't translate them are they sent to Microsoft Azure, then Google Cloud\./)).toBeVisible();
  await expect(extra.getByText(/may contain personal data; they only go to these services/)).toBeVisible();
  await expect(extra.getByRole("button", { name: "Allow these too" })).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
});

test("the smart schedule names the services next to its Allow button, and says when their list changed", async ({ page }) => {
  await openApp(page, "enginesNoConsent", "/app/settings/automatic");
  const status = page.locator("#smart-status");
  await expect(status.getByText("Allow AI translation first.")).toBeVisible();
  await expect(status.getByRole("button", { name: "Allow AI translation" })).toBeVisible();
  // The services the button agrees to, by their legal names, and in which order.
  await expect(status.getByText(/Linguva sends only your store's texts .* to DeepL SE .*Microsoft Ireland Operations Ltd\. .*Google Cloud EMEA Ltd\. .*Texts go to DeepL first/)).toBeVisible();
  await expect(status.getByText("Metaobjects and payment methods may contain personal data")).toBeVisible();
  await expectAccessible(page);
  // A page from before an engine was added (only DeepL in its list): nothing is stored, and the page says why.
  await status.locator('input[name="consentTokens"]').evaluate((input) => ((input as HTMLInputElement).value = "deepl"));
  await status.getByRole("button", { name: "Allow AI translation" }).click();
  await expect(status.getByText("The list of translation services has changed. Check it and allow again.")).toBeVisible();
  await expect(status.getByText("Allow AI translation first.")).toBeVisible();
});

test("allowing the other services too keeps focus on the permission card", async ({ page }) => {
  await openApp(page, "enginesExtend", "/app/settings");
  const extra = page.locator("s-box").filter({ has: page.getByRole("heading", { name: "More translation services" }) });
  await extra.getByRole("button", { name: "Allow these too" }).click();
  await expectToast(page, "AI translation is allowed.");
  await expect(page.getByRole("heading", { name: "More translation services" })).toHaveCount(0);
  await expect(page.locator("#settings-ai-heading")).toBeFocused();
});

test("the editor's permission names the services and their order", async ({ page }) => {
  await openApp(page, "enginesNoConsent", "/app/products/1?lang=de");
  const banner = page.locator("s-banner").filter({ has: page.getByRole("button", { name: "Allow AI processing" }) });
  await expect(banner.getByText(/our translation providers \(DeepL SE .*Google Cloud EMEA Ltd\. .*\)/)).toBeVisible();
  await expect(banner.getByText(/Texts go to DeepL first; only if it can't translate them are they sent to Microsoft Azure, then Google Cloud\./)).toBeVisible();
});

test("with the Own key plan shown, the website names it: the pricing card across the grid, the homepage's fifth plan, the privacy section", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/preise");
  const card = page.locator("article.plan-wide");
  await expect(card.getByRole("heading", { level: 2, name: "Own key" })).toBeVisible();
  await expect(card.getByText("Nur monatlich")).toBeVisible();
  await expect(card.getByText(/Lege bei deinem Dienst ein Kostenlimit oder Budget fest/)).toBeVisible();
  // Its stylesheet loads under the page's CSP: the card spans the four columns of the plans grid.
  const grid = (await page.locator(".plans").boundingBox())!;
  const wide = (await card.boundingBox())!;
  expect(Math.abs(wide.width - grid.width)).toBeLessThanOrEqual(1);
  await expect(page.locator(".plans article.plan")).toHaveCount(5);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);

  await page.goto("/");
  await expect(page.getByRole("list", { name: "Die fünf Tarife" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByText("Glossar ab Pro und in Own key")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Stores on the Own key plan" })).toBeVisible();
  await expect(page.locator("#de").getByRole("heading", { name: "Shops im Tarif Own key" })).toBeAttached();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/preise", "/"]) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
  expect(errors).toEqual([]);
});

test("with the Own key plan shown, a merchant's Plan page has its card beside the four", async ({ page }) => {
  await openApp(page, "engines", "/app/plan");
  await expect(page.getByRole("group", { name: "Own key", exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
