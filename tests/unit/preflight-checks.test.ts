import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAppConfig,
  checkEncryptionKeys,
  checkNodeVersion,
  checkProviderCost,
  checkStoreTargets,
  isDeniedStore,
  routeFileFor,
  tomlString,
  webhookUris,
} from "../../scripts/ops/preflight-checks";

const ROOT = join(__dirname, "..", "..");
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
      ["read_content", "read_locales", "read_online_store_pages", "read_products", "read_translations", "write_locales", "write_translations"],
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
