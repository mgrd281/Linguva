import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAppConfig,
  checkEncryptionKeys,
  checkNodeVersion,
  checkOwnKeyPlan,
  checkProviderCost,
  checkStoreTargets,
  checkTranslationEngines,
  isDeniedStore,
  routeFileFor,
  tomlString,
  webhookUris,
} from "../../scripts/ops/preflight-checks";

const ROOT = join(__dirname, "..", "..");
const BASE = { DATABASE_URL: "postgresql://u:p@localhost:5432/db", TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}` };
// Fictional keys that pass the validation (never real).
const AZURE_KEY = "uiazurekey0004fictional0000000000";
const GOOGLE_KEY = "ui-google-key-0005-fictional0000";
const PRIVACY = readFileSync(join(ROOT, "site", "privacy.html"), "utf8");
const toml = readFileSync(join(ROOT, "shopify.app.toml"), "utf8");

describe("app configuration (shopify.app.toml)", () => {
  it("has what the Shopify CLI and App Store review need", () => {
    expect(tomlString(toml, "name")).toBe("Linguva");
    expect(toml).toMatch(/^embedded = true$/m);
    expect(toml).toMatch(/^automatically_update_urls_on_dev = true$/m);
    expect(toml).toMatch(/^redirect_urls = \["https:\/\/example\.com\/auth\/callback"\]$/m);
    // The webhook API version matches the app's Admin API version.
    expect(tomlString(toml, "api_version")).toBe("2026-10");
    // Never a production store or URL in the development configuration.
    expect(tomlString(toml, "application_url")).toBe("https://example.com");
    expect(isDeniedStore(toml)).toBe(false);
  });

  it("requests exactly the reviewed scopes; feature scopes only as optional", () => {
    // Changing scopes needs merchant re-approval and a SECURITY_MODEL entry: update this test deliberately.
    expect(tomlString(toml, "scopes")!.split(",").sort()).toEqual(
      ["read_content", "read_locales", "read_online_store_pages", "read_products", "read_translations", "write_translations"],
    );
    const optional = JSON.parse(/^optional_scopes = (.*)$/m.exec(toml)![1]!) as string[];
    expect(optional.sort()).toEqual(
      ["read_legal_policies", "read_markets", "read_metaobjects", "read_online_store_navigation", "read_shipping", "read_themes"],
    );
    // Only read scopes are optional; the content pages request nothing else.
    expect(optional.every((scope) => scope.startsWith("read_"))).toBe(true);
    // No customer or order data (ADR-007).
    expect(`${tomlString(toml, "scopes")} ${/^optional_scopes = (.*)$/m.exec(toml)![1]}`).not.toMatch(/customer|order/);
  });

  it("has a route for every webhook subscription, including the compliance topics", () => {
    const uris = webhookUris(toml);
    expect(uris).toEqual(
      expect.arrayContaining(["/webhooks/app/uninstalled", "/webhooks/customers/data_request", "/webhooks/customers/redact", "/webhooks/shop/redact"]),
    );
    expect(routeFileFor("/webhooks/app/scopes_update")).toBe("webhooks.app.scopes_update.tsx");
    const results = checkAppConfig(ROOT);
    expect(results.filter((r) => r.level === "fail" && r.name !== "App linked")).toEqual([]);
  });

  it("flags an unlinked app, missing routes and a production dev store", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-"));
    mkdirSync(join(dir, "app", "routes"), { recursive: true });
    writeFileSync(
      join(dir, "shopify.app.toml"),
      'client_id = ""\nembedded = true\nredirect_urls = ["https://x"]\ndev_store_url = "karinex.myshopify.com"\nuri = "/webhooks/app/uninstalled"\n',
    );
    const results = checkAppConfig(dir);
    expect(results.find((r) => r.name === "App linked")?.level).toBe("fail");
    expect(results.find((r) => r.name.endsWith("webhooks"))).toMatchObject({ level: "fail", detail: expect.stringContaining("/webhooks/app/uninstalled") });
    expect(results.find((r) => r.name.endsWith("dev_store_url"))?.level).toBe("fail");
  });
});

describe("environment checks", () => {
  it("refuses production stores by pattern and by an extra deny list", () => {
    expect(isDeniedStore("KARINEX.myshopify.com")).toBe(true);
    expect(isDeniedStore("softwarefach-de.myshopify.com")).toBe(true);
    expect(isDeniedStore("linguva-dev.myshopify.com")).toBe(false);
    expect(checkStoreTargets({ SHOPIFY_DEV_STORE: "shop-x.myshopify.com", PREFLIGHT_DENY_DOMAINS: "shop-x" })[0]!.level).toBe("fail");
    expect(checkStoreTargets({ LIVE_SHOPIFY_SHOP: "linguva-dev.myshopify.com" })[0]!.level).toBe("ok");
  });

  it("warns about paid provider keys and accepts mock or DeepL Free", () => {
    expect(checkProviderCost({ TRANSLATION_PROVIDER: "mock" }).level).toBe("ok");
    expect(checkProviderCost({ DEEPL_API_KEY: "abc:fx" }).level).toBe("ok");
    expect(checkProviderCost({ DEEPL_API_KEY: "abc" })).toMatchObject({ level: "warn", detail: expect.stringContaining("billed") });
    expect(checkProviderCost({}).level).toBe("warn");
    expect(checkProviderCost({ DEEPL_API_KEY: "a:fx", DEEPL_API_KEY_2: "b:fx", DEEPL_API_KEY_10: "c:fx" })).toMatchObject({ detail: expect.stringContaining("3 DeepL keys") });
    expect(checkProviderCost({ DEEPL_API_KEYS: "a:fx, b:fx" })).toMatchObject({ level: "warn", detail: expect.stringContaining("2 DeepL keys") });
  });

  it("reports DeepL's absence as fine when another engine is set up", () => {
    const env = { ...BASE, AZURE_TRANSLATOR_KEY: AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope" };
    expect(checkProviderCost(env)).toEqual({ level: "ok", name: "Translation provider", detail: "No DeepL key; other engines are set up (see below)" });
  });

  it("rejects the test and example encryption keys and never prints the value", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-"));
    writeFileSync(join(dir, ".env.example"), "TOKEN_ENCRYPTION_KEYS=k1:example\n");
    const testKey = `test:${Buffer.alloc(32, 7).toString("base64")}`;
    expect(checkEncryptionKeys({ TOKEN_ENCRYPTION_KEYS: testKey }, join(dir, ".env.example")).level).toBe("fail");
    expect(checkEncryptionKeys({ TOKEN_ENCRYPTION_KEYS: "k1:example" }, join(dir, ".env.example")).level).toBe("fail");
    const own = checkEncryptionKeys({ TOKEN_ENCRYPTION_KEYS: "k1:secret-value" }, join(dir, ".env.example"));
    expect(own.level).toBe("ok");
    expect(own.detail).not.toContain("secret-value");
  });

  it("needs Node.js 22.12 or later", () => {
    expect(checkNodeVersion("22.12.0").level).toBe("ok");
    expect(checkNodeVersion("22.11.9").level).toBe("fail");
    expect(checkNodeVersion("24.1.0").level).toBe("ok");
  });
});

describe("translation engines", () => {
  const engines = { ...BASE, DEEPL_API_KEY: "fictional:fx", AZURE_TRANSLATOR_KEY: AZURE_KEY, AZURE_TRANSLATOR_REGION: "westeurope", GOOGLE_TRANSLATE_API_KEY: GOOGLE_KEY };

  it("adds nothing with DeepL alone or the mock provider", () => {
    expect(checkTranslationEngines({ ...BASE, DEEPL_API_KEY: "fictional:fx" }, { privacy: PRIVACY })).toEqual([]);
    expect(checkTranslationEngines({ ...BASE, TRANSLATION_PROVIDER: "mock", AZURE_TRANSLATOR_KEY: AZURE_KEY }, { privacy: PRIVACY })).toEqual([]);
  });

  it("names each engine's cost, data location and the order", () => {
    const results = checkTranslationEngines(engines, { privacy: PRIVACY });
    expect(results.map((r) => r.detail)).toEqual([
      "Microsoft Azure Translator: region westeurope, EU endpoint (api-eur): billed beyond the free tier (F0: 2,000,000 characters a month). Use it only with the owner's approval",
      "Google Cloud Translation (API key, v2): global processing, no EU option on this path; billed after 500,000 free characters a month. Use it only with the owner's approval",
      "Engine order: DeepL → Microsoft Azure → Google Cloud",
    ]);
    expect(results.map((r) => r.level)).toEqual(["warn", "warn", "ok"]);
    expect(JSON.stringify(results)).not.toContain(AZURE_KEY);
    expect(JSON.stringify(results)).not.toContain(GOOGLE_KEY);
  });

  it("fails a variable that doesn't validate, naming it but not its value", () => {
    const results = checkTranslationEngines({ ...BASE, DEEPL_API_KEY: "fictional:fx", AZURE_TRANSLATOR_KEY: "SECRET-0001" }, { privacy: PRIVACY });
    expect(results).toEqual([{ level: "fail", name: "Translation engines", detail: "AZURE_TRANSLATOR_KEY: doesn't look like a Translator key (Azure portal: Keys and Endpoint, Key 1); Microsoft Azure is off" }]);
    expect(JSON.stringify(results)).not.toContain("SECRET");
  });

  it("fails in production with public pages while an engine's privacy section has open points", () => {
    const production = { ...engines, NODE_ENV: "production", REDIS_URL: "redis://localhost:6379", LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes", PUBLIC_PAGES: "on", LEGAL_TEXTS_REVIEWED: "yes" };
    const failed = checkTranslationEngines(production, { privacy: PRIVACY }).filter((r) => r.level === "fail");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail).toMatch(/draft notice .*azure, google/);
    const resolved = PRIVACY.replace(/<!--engine:(azure|google)-->[\s\S]*?<!--\/engine:\1-->/g, (block) => block.replace(/<mark class="open">[^<]*<\/mark>/g, ""));
    expect(checkTranslationEngines(production, { privacy: resolved }).filter((r) => r.level === "fail")).toEqual([]);
    // Not public: no draft notice to show.
    expect(checkTranslationEngines({ ...production, PUBLIC_PAGES: "off" }, { privacy: PRIVACY }).filter((r) => r.level === "fail")).toEqual([]);
  });

  it("fails in staging when an engine credential is set", () => {
    const staging = { ...BASE, NODE_ENV: "production", REDIS_URL: "redis://localhost:6379", LINGUVA_STAGE: "staging", TRANSLATION_PROVIDER: "mock", ALLOWED_SHOPS: "linguva-test-lab.myshopify.com", GOOGLE_TRANSLATE_API_KEY: GOOGLE_KEY };
    const results = checkTranslationEngines(staging, { privacy: PRIVACY });
    expect(results.some((r) => r.level === "fail" && r.detail.includes("GOOGLE_TRANSLATE_API_KEY must not be set in staging"))).toBe(true);
    expect(JSON.stringify(results)).not.toContain(GOOGLE_KEY);
  });

  it("names a service account's project, never its email", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const credentials = JSON.stringify({
      type: "service_account",
      project_id: "fictional-proj-1",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      client_email: "someone@fictional-proj-1.iam.gserviceaccount.com",
    });
    const results = checkTranslationEngines({ ...BASE, GOOGLE_TRANSLATE_CREDENTIALS: credentials }, { privacy: PRIVACY });
    expect(results[0]!.detail).toContain("service account, project fictional-proj-1, EU endpoint");
    expect(JSON.stringify(results)).not.toContain("someone@");
  });
});

describe("the Own key plan", () => {
  it("says whether the plan is shown, and never fails or warns either way", () => {
    expect(checkOwnKeyPlan({ OWN_KEY_PLAN_VISIBLE: "off" })).toEqual({ level: "ok", name: "Own key plan", detail: expect.stringMatching(/^hidden/) });
    expect(checkOwnKeyPlan({ OWN_KEY_PLAN_VISIBLE: "on" })).toEqual({ level: "ok", name: "Own key plan", detail: expect.stringMatching(/^shown/) });
  });
});
