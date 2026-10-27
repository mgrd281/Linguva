/**
 * Opens the embedded app the way the Shopify admin does: with shop, host,
 * embedded=1 and a signed session token. App Bridge is replaced by a small
 * stub (the real one redirects to the admin outside of its iframe) that,
 * like App Bridge, adds the session token to the app's own fetch requests.
 * Polaris web components load from Shopify's CDN unchanged.
 */
import { createHmac, randomUUID } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** A session token as App Bridge would issue it (HS256, signed with the app secret). */
export function sessionToken(shopDomain: string, userId = "42"): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: `https://${shopDomain}/admin`,
      dest: `https://${shopDomain}`,
      aud: UI_ENV.apiKey,
      sub: userId,
      exp: now + 3600,
      nbf: now - 5,
      iat: now - 5,
      jti: randomUUID(),
      sid: randomUUID(),
    }),
  );
  const signature = createHmac("sha256", UI_ENV.apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function appBridgeStub(token: string, shopDomain: string) {
  return `(() => {
    const token = ${JSON.stringify(token)};
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set("Authorization", "Bearer " + token);
        init = { ...init, headers };
      }
      return realFetch(input, init);
    };
    window.__toasts = [];
    window.__loading = [];
    // In the admin, App Bridge renders the navigation outside the app frame.
    const style = document.createElement("style");
    style.textContent = "s-app-nav { display: none !important; }";
    document.head.appendChild(style);
    window.shopify = {
      config: { apiKey: ${JSON.stringify(UI_ENV.apiKey)}, shop: ${JSON.stringify(shopDomain)} },
      environment: { embedded: true, mobile: false },
      idToken: async () => token,
      toast: { show: (message) => { window.__toasts.push(message); return "t"; }, hide() {} },
      loading: (on) => { window.__loading.push(on); },
      saveBar: { show: async () => {}, hide: async () => {}, toggle: async () => {} },
      modal: { show: async () => {}, hide: async () => {}, toggle: async () => {} },
    };
  })();`;
}

/** Opens a page of the embedded app for one of the test shops. */
export async function openApp(page: Page, shopKey: UiShopKey, path: string) {
  const shop = UI_SHOPS[shopKey];
  const token = sessionToken(shop.domain);
  await page.route("https://cdn.shopify.com/shopifycloud/app-bridge.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: appBridgeStub(token, shop.domain) }),
  );
  const url = new URL(path, UI_ENV.appUrl);
  url.searchParams.set("embedded", "1");
  url.searchParams.set("shop", shop.domain);
  url.searchParams.set("host", Buffer.from(`admin.shopify.com/store/${shop.domain.replace(".myshopify.com", "")}`).toString("base64"));
  url.searchParams.set("id_token", token);
  const response = await page.goto(url.toString());
  // Polaris custom elements are defined once polaris.js has run.
  await page.waitForFunction(() => Boolean(customElements.get("s-page")), undefined, { timeout: 20_000 });
  return response;
}

/**
 * No serious or critical accessibility violations (axe-core, WCAG 2.1 A/AA).
 *
 * One rule is replaced, not skipped: Polaris web components set ARIA roles
 * through ElementInternals, which axe can't read, so axe reports
 * "aria-required-children" on every <s-table> although Chromium exposes a
 * correct grid > row > columnheader/gridcell tree. expectAccessibleTables
 * checks that tree directly.
 */
export async function expectAccessible(page: Page) {
  // Store content previews are sandboxed frames axe can't run in (and their
  // content is the merchant's, not the app's): the app around them is
  // checked, including that every frame has a title.
  const hasFrames = (await page.locator("iframe").count()) > 0;
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["aria-required-children"])
    .setLegacyMode(hasFrames)
    .analyze();
  if (hasFrames) {
    const untitled = await page.locator("iframe:not([title]), iframe[title='']").count();
    expect(untitled, "every preview frame has a title").toBe(0);
  }
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  await expectAccessibleTables(page);
}

/**
 * Every table is exposed to assistive technology: as a grid with rows,
 * column headers and cells, or, on narrow screens where Polaris renders
 * tables as lists, as headed items with labelled values.
 */
export async function expectAccessibleTables(page: Page) {
  const tables = await page.locator("s-table").count();
  if (!tables) return;
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: Array<{ role?: { value?: string } }> };
  await cdp.detach();
  const count = (...roles: string[]) => nodes.filter((n) => roles.includes(n.role?.value ?? "")).length;
  if (count("grid", "table") >= tables) {
    expect(count("columnheader")).toBeGreaterThan(0);
    expect(count("row")).toBeGreaterThan(tables);
    expect(count("gridcell", "cell")).toBeGreaterThan(0);
  } else {
    expect(page.viewportSize()!.width, "tables render as lists only on narrow screens").toBeLessThan(768);
    expect(count("heading")).toBeGreaterThan(0);
    expect(count("term", "DescriptionListTerm")).toBeGreaterThan(0);
    expect(count("definition", "DescriptionListDetail")).toBeGreaterThan(0);
  }
}

/** Nothing wider than the viewport (no horizontal scrolling). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
