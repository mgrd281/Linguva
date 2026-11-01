/**
 * UI tests (pnpm test:ui): the production build of the embedded app, served
 * by react-router-serve, against PostgreSQL/Redis and a simulated Shopify
 * (tests/ui/server/preload.ts). See docs/UI_TESTING.md.
 */
import { defineConfig, devices } from "@playwright/test";
import { testEnv } from "./tests/support/env";
import { UI_ENV } from "./tests/ui/fixtures/shops";

const serverEnv: Record<string, string> = {
  ...testEnv,
  // test, not production: the mock provider is allowed and posture issues only warn.
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  PORT: String(UI_ENV.port),
  SHOPIFY_API_KEY: UI_ENV.apiKey,
  SHOPIFY_API_SECRET: UI_ENV.apiSecret,
  SHOPIFY_APP_URL: UI_ENV.appUrl,
  SCOPES: "read_products,read_content,read_online_store_pages,read_translations,write_translations,read_locales",
  TRANSLATION_PROVIDER: "mock",
  // Billing on (simulated Partner API), but no forced plan selection.
  SHOPIFY_PARTNER_ORG_ID: "1",
  SHOPIFY_PARTNER_API_TOKEN: "ui-test-partner-token",
  SHOPIFY_APP_GID: "gid://shopify/App/1",
  SHOPIFY_APP_HANDLE: "linguva-ui-test",
  BILLING_REQUIRED: "false",
  COMPLIMENTARY_SHOP_GIDS: "gid://shopify/Shop/91005",
  // The operator's own store sees the DeepL keys' quota (fictional keys, answered by the fake in preload.ts).
  OPERATOR_SHOPS: "ui-owner.myshopify.com",
  DEEPL_API_KEY: "ui-key-one-0001:fx",
  DEEPL_API_KEY_2: "ui-key-two-0002:fx",
  DEEPL_API_KEY_3: "ui-key-pro-0003",
  AI_MONTHLY_CHAR_LIMIT: "1000000",
  AI_USER_REQUESTS_PER_MINUTE: "1000",
  AI_SHOP_REQUESTS_PER_MINUTE: "1000",
  // The Own key plan's key checks (mock mode: offline): own-keys.spec.ts saves and checks more than 3 a minute.
  OWN_KEY_CHECKS_PER_MINUTE: "100",
  // Short, so the timeout test doesn't wait 15 s.
  SHOPIFY_TIMEOUT_MS: "3000",
  // The app's privacy policy and support page, as drafts (no LEGAL_TEXTS_REVIEWED).
  PUBLIC_PAGES: "on",
};
// A second server with DeepL, Microsoft Azure and Google Cloud (fictional keys that pass the
// configuration's checks, so it really has three engines; preload.ts answers only their free
// checks and language lists and refuses anything that would translate). Only engines.spec.ts uses it.
const enginesEnv: Record<string, string> = {
  ...serverEnv,
  PORT: String(UI_ENV.enginesPort),
  SHOPIFY_APP_URL: UI_ENV.enginesUrl,
  TRANSLATION_PROVIDER: "engines",
  AZURE_TRANSLATOR_KEY: "uiazurekey0004fictional0000000000",
  AZURE_TRANSLATOR_REGION: "westeurope",
  GOOGLE_TRANSLATE_API_KEY: "ui-google-key-0005-fictional0000",
  // The Own key plan shown (its Plan page card and website texts); the main server keeps it off.
  OWN_KEY_PLAN_VISIBLE: "on",
};
// The global setup seeds the same database with the app's own modules.
Object.assign(process.env, serverEnv);

// Behind an HTTPS proxy (cloud sessions) the browser uses it; TLS stays verified.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;

export default defineConfig({
  testDir: "tests/ui",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/ui/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Screenshot comparisons: CI (GitHub's Ubuntu runners) is the reference.
  // Its images are committed (*-ci.png). Other machines can render text
  // differently (for example with Inter installed as a system font), so they
  // compare against their own images (*-local.png, not committed), created
  // on the first run.
  snapshotPathTemplate: `{testDir}/{testFileName}-snapshots/{arg}-{projectName}-${process.env.CI ? "ci" : "local"}{ext}`,
  updateSnapshots: process.env.CI ? "none" : "missing",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: UI_ENV.appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: proxy ? { proxy } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, testIgnore: /engines\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@responsive/, testIgnore: /engines\.spec\.ts/ },
    // No screenshots: the engines server's pages are checked by their texts.
    { name: "engines", testMatch: /engines\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, baseURL: UI_ENV.enginesUrl } },
  ],
  webServer: [
    {
      command: "node --import ./build/ui-test/preload.js ./node_modules/@react-router/serve/bin.js ./build/server/index.js",
      // The public landing route answers 200 once the server is up.
      url: `${UI_ENV.appUrl}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: serverEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node --import ./build/ui-test/preload.js ./node_modules/@react-router/serve/bin.js ./build/server/index.js",
      url: `${UI_ENV.enginesUrl}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: enginesEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
