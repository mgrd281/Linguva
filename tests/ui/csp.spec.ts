/**
 * The script policy (Content-Security-Policy script-src) on the production
 * build: the app works under it (Polaris from Shopify's CDN, React Router's
 * inline data with the page's nonce, previews, dialogs, a language's
 * pictures and flags), nothing is reported as blocked, and an injected
 * inline script doesn't run.
 * App Bridge is simulated; the real one is checked on the development store.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectToast, openApp } from "./helpers";

/** Records every blocked script, style or frame the browser reports. */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|evaluate)/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => [...violations, ...((await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp)) ?? [])];
}

test("pages send a script policy with a new nonce each time", async ({ page }) => {
  const first = await openApp(page, "full", "/app");
  const policy = first!.headers()["content-security-policy"]!;
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' https:\/\/cdn\.shopify\.com;/);
  expect(policy).toContain("object-src 'none'");
  const second = await openApp(page, "full", "/app");
  expect(second!.headers()["content-security-policy"]).not.toBe(policy);
});

test("the app works under the policy and nothing is blocked", async ({ page }) => {
  const violations = await watchViolations(page);

  // Editor: AI drafts, the HTML preview frames, publishing with a toast.
  await openApp(page, "full", "/app/products/16?lang=de");
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Product 16 jacket");
  await page.getByRole("button", { name: "Publish translations" }).click();
  await expectToast(page, /translations? published$/);

  // Review with rendered drafts, a confirmation dialog, Settings, Glossary.
  await openApp(page, "full", "/app/review");
  await page.locator("s-button", { hasText: "Reject selected" }).first().click();
  await expect(page.getByRole("dialog", { name: "Reject the selected translations?" })).toBeVisible();
  for (const path of ["/app/settings", "/app/glossary", "/app/coverage", "/app/jobs", "/app/plan"]) await openApp(page, "full", path);

  // A language's page loads its examples and the store's pictures after the page; flags come from the app.
  await openApp(page, "demo", "/app/languages/de");
  const products = page.locator('s-section[accessibilitylabel="Products"]');
  await expect.poll(() => products.locator("img").evaluateAll((imgs) => imgs.length > 0 && (imgs as HTMLImageElement[]).every((img) => img.complete && img.naturalWidth > 0))).toBe(true);
  await expect.poll(() => page.locator('img[src^="/flags/"]').evaluateAll((imgs) => imgs.length > 0 && (imgs as HTMLImageElement[]).every((img) => img.naturalWidth > 0))).toBe(true);
  await openApp(page, "catalog", "/app/languages/de/products");
  await expect(page.getByRole("navigation", { name: "Show" })).toBeVisible();
  // The Content page: its tiles' pictures (the language's previews) and the chips' flags.
  await openApp(page, "demo", "/app/content");
  await expect.poll(() => page.locator('img[src*="/__fixtures/img/"]').evaluateAll((imgs) => imgs.length > 0 && (imgs as HTMLImageElement[]).every((img) => img.complete && img.naturalWidth > 0))).toBe(true);
  await expect.poll(() => page.locator('img[src^="/flags/"]').evaluateAll((imgs) => imgs.length > 0 && (imgs as HTMLImageElement[]).every((img) => img.naturalWidth > 0))).toBe(true);

  expect(await violations()).toEqual([]);
});

test("an injected inline script doesn't run", async ({ page }) => {
  await openApp(page, "full", "/app");
  const ran = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = true;";
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (window as unknown as { __injected?: boolean }).__injected ?? false;
  });
  expect(ran).toBe(false);
});
