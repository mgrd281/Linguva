/**
 * The admin console (/admin) in the production build with ADMIN_CONSOLE=on,
 * against the UI test database: an admin seeded as the operator tool does
 * (owner role), signed in with password and a TOTP code computed here.
 * Every page renders in English and Arabic (right to left) without axe
 * violations, inline-style or script errors, or horizontal scrolling on a
 * phone; a wrong code is refused with the generic message; signing out
 * ends the session. @responsive
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { hashPassword } from "../../app/.server/admin/password";
import { base32Decode, generateTotpSecret, hotp, sealTotpSecret, totpStep } from "../../app/.server/admin/totp";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { testEnv } from "../support/env";
import { UI_ENV } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll } from "./helpers";

const PASSWORD = "ui test password for the console";
const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });

type Account = { email: string; secret: string };
let account: Account;
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
let shopId: string;
// Its own sign-in limit per run (the limit of 20 attempts per client is kept in Redis across runs).
const client = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

const code = (secret: string, offset = 0) => hotp(base32Decode(secret)!, totpStep(Date.now()) + offset);

/** An account as `pnpm ops:admin add` creates it; one per project, as each code works once per account. */
async function seedAccount(project: string): Promise<Account> {
  const id = randomUUID();
  const secret = generateTotpSecret();
  const email = `ui-admin-${project}@linguva.test`;
  await owner.adminUser.deleteMany({ where: { email } });
  const cipher = TokenCipher.fromKeyring(testEnv.TOKEN_ENCRYPTION_KEYS!);
  await owner.adminUser.create({ data: { id, email, role: "OWNER", passwordHash: await hashPassword(PASSWORD), totpSecret: sealTotpSecret(cipher, id, secret) } });
  return { email, secret };
}

async function signIn(page: Page, who: Account) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(code(who.secret));
  await Promise.all([page.waitForURL(`${UI_ENV.appUrl}/admin`), page.getByRole("button", { name: "Sign in" }).click()]);
}

/** The project's own context (desktop or phone) with the session of beforeAll. */
async function useSession(context: BrowserContext) {
  await context.addCookies(sessionCookies);
  await context.setExtraHTTPHeaders({ "X-Forwarded-For": client });
}

/** Errors the browser reports: a refused inline style or script (the console's policy) shows here. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    // Shopify's font CDN may be unreachable from a test machine; the page doesn't depend on it.
    if (m.type() === "error" && !/cdn\.shopify\.com|ERR_TUNNEL|ERR_NAME|ERR_CONNECTION/.test(`${m.text()} ${m.location().url}`)) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  account = await seedAccount(testInfo.project.name);
  const shop = await owner.shop.findFirst({ select: { id: true }, orderBy: { installedAt: "desc" } });
  shopId = shop!.id;
  const context = await browser.newContext({ baseURL: UI_ENV.appUrl, extraHTTPHeaders: { "X-Forwarded-For": client } });
  const page = await context.newPage();
  await signIn(page, account);
  sessionCookies = await context.cookies();
  await context.close();
});

test.afterAll(async () => {
  await owner.$disconnect();
});

test("the sign-in page is accessible and answers a wrong code with the generic message @responsive", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "X-Forwarded-For": client });
  const errors = watchErrors(page);
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toHaveAttribute("autocomplete", "one-time-code");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // An unknown e-mail, new each run (it gets locked after 5 attempts like an account): the same message as any other mistake.
  const nobody = `nobody-${randomUUID()}@linguva.test`;
  await page.getByLabel("E-mail").fill(nobody);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("E-mail, password or code is wrong.");
  await expect(page.getByLabel("E-mail")).toHaveValue(nobody);
  await expect(page.getByLabel("Password")).toHaveValue("");

  // The language switch: Arabic, right to left, kept in a cookie for the console.
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "تسجيل الدخول" })).toBeVisible();
  expect(page.url()).toBe(`${UI_ENV.appUrl}/admin/login`);
  await expectAccessible(page);
  // The refused sign-in answers 401 (the browser notes the status); nothing else.
  expect(errors.filter((e) => !/status of 401/.test(e))).toEqual([]);
});

test("a page asked for without a session leads to the sign-in page, with the way back", async ({ page }) => {
  await page.goto("/admin/prices");
  await expect(page).toHaveURL(`${UI_ENV.appUrl}/admin/login?next=%2Fadmin%2Fprices`);
});

const PAGES = [
  { path: () => "/admin", en: "Overview", ar: "نظرة عامة" },
  { path: () => "/admin/customers", en: "Customers", ar: "العملاء" },
  { path: () => `/admin/customers/${shopId}`, en: null, ar: null },
  { path: () => "/admin/subscriptions", en: "Subscriptions", ar: "الاشتراكات" },
  { path: () => "/admin/prices", en: "Prices", ar: "الأسعار" },
  { path: () => "/admin/activity", en: "Activity", ar: "النشاط" },
];

for (const locale of ["en", "ar"] as const) {
  test(`every console page renders in ${locale === "en" ? "English" : "Arabic"}, accessible and without horizontal scrolling @responsive`, async ({ context, page }) => {
    await useSession(context);
    await context.addCookies([{ name: "lv_admin_lang", value: locale, url: `${UI_ENV.appUrl}/admin` }]);
    const errors = watchErrors(page);
    for (const p of PAGES) {
      const response = await page.goto(p.path());
      expect(response?.status(), p.path()).toBe(200);
      expect(response!.headers()["x-frame-options"]).toBe("DENY");
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveCount(1);
      if (p[locale]) await expect(heading).toHaveText(p[locale]!);
      const nav = page.getByRole("navigation", { name: locale === "en" ? "Console" : "لوحة التحكم" });
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
    }
    expect(errors).toEqual([]);
  });
}

test("the navigation and filters work, and a wrong code saves no price", async ({ context, page }) => {
  await useSession(context);
  const errors = watchErrors(page);
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await page.getByLabel("Search").fill("no-store-is-called-this");
  await page.getByLabel("Search").press("Enter");
  await expect(page.getByText("No stores match")).toBeVisible();
  expect(page.url()).toContain("q=no-store-is-called-this");

  await page.goto("/admin/prices");
  await page.getByLabel("Reason").fill("UI test: never saved");
  // A code from long ago: wrong now.
  await page.getByLabel("Authenticator code").fill(code(account.secret, -100));
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.locator("#prices-errors")).toContainText("That code is wrong or was already used.");
  await expect(page.getByLabel("Authenticator code")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Reason")).toHaveValue("UI test: never saved");
  expect(await owner.planPriceChange.count({ where: { reason: "UI test: never saved" } })).toBe(0);
  // The refused save answers 400 (the browser notes the status); nothing else.
  expect(errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
});

test("signing out ends the session", async ({ context, page }) => {
  await useSession(context);
  await page.goto("/admin/activity");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${UI_ENV.appUrl}/admin/login`);
  await page.goto("/admin");
  await expect(page).toHaveURL(`${UI_ENV.appUrl}/admin/login`);
});
