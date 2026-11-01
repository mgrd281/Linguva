/**
 * The app's privacy policy (/privacy) and support page (/support), served by
 * the production build with PUBLIC_PAGES=on and no LEGAL_TEXTS_REVIEWED: drafts
 * with their notice and open points. Static pages: no cookies, no request to
 * another host, nothing from the shop in the HTML. @responsive
 */
import { expect, test } from "@playwright/test";
import { UI_ENV, UI_SHOPS } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll } from "./helpers";

const PAGES = [
  { path: "/privacy", en: "Privacy policy for the Linguva app", de: "Datenschutzerklärung der App Linguva", draft: ["Draft.", "Entwurf."] },
  { path: "/support", en: "Help and support", de: "Hilfe und Support", draft: ["Draft.", "Entwurf."] },
] as const;

for (const p of PAGES) {
  test(`${p.path} shows the draft in English and German, from the app's own origin only @responsive`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    // Shopify's parameters are ignored: nothing about the shop reaches the page.
    const shop = UI_SHOPS.full;
    const response = await page.goto(new URL(`${p.path}?shop=${shop.domain}&host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvdWk`, UI_ENV.appUrl).toString());
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    expect(headers["set-cookie"]).toBeUndefined();
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    const html = await response!.text();
    expect(html).not.toContain(shop.domain);
    expect(html).not.toContain(shop.domain.replace(".myshopify.com", ""));

    await expect(page.getByRole("heading", { level: 1, name: p.en })).toBeVisible();
    await expect(page.locator("#de").getByRole("heading", { level: 1, name: p.de })).toBeAttached();
    await expect(page.locator("#de")).toHaveAttribute("lang", "de");
    for (const notice of p.draft) await expect(page.locator(".draft", { hasText: notice })).toHaveCount(1);
    expect(await page.locator("mark.open").count()).toBeGreaterThan(0);

    // The footer links both pages (PUBLIC_PAGES=on).
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Datenschutz der App" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Hilfe und FAQ" })).toHaveAttribute("href", "/support#faq");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length)).toBe(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
    expect(requests.filter((url) => new URL(url).origin !== new URL(UI_ENV.appUrl).origin)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the support page's FAQ opens at #faq and answers the reviewer's questions @responsive", async ({ page }) => {
  await page.goto(new URL("/support#faq", UI_ENV.appUrl).toString());
  await expect(page.locator("#faq")).toBeInViewport();
  const faq = page.locator("#en .faq details");
  expect(await faq.count()).toBeGreaterThanOrEqual(8);
  expect(await page.locator("#de .faq details").count()).toBe(await faq.count());
  await page.getByText("What is sent to DeepL, and when?").click();
  await expect(page.getByText("Nothing until someone in your store agrees to it")).toBeVisible();
  // The contact address is a mailto link.
  await expect(page.locator('#en a[href^="mailto:shop@softwarekey.de"]')).toHaveCount(1);
});

test("the website links the app's privacy policy from its own privacy page", async ({ page }) => {
  await page.goto(new URL("/datenschutz", UI_ENV.appUrl).toString());
  await page.getByRole("main").getByRole("link", { name: "Datenschutz der App" }).click();
  await expect(page).toHaveURL(/\/privacy#de$/);
  await expect(page.locator("#de")).toBeInViewport();
});
