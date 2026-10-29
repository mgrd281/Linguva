import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync("shopify.app.toml", "utf8");

describe("shopify.app.toml", () => {
  it.each([
    ["customers/data_request", "app/routes/webhooks.customers.data_request.tsx"],
    ["customers/redact", "app/routes/webhooks.customers.redact.tsx"],
    ["shop/redact", "app/routes/webhooks.shop.redact.tsx"],
  ])("subscribes to mandatory compliance topic %s with a route", (topic, route) => {
    expect(toml).toContain(`compliance_topics = ["${topic}"]`);
    expect(existsSync(route)).toBe(true);
  });

  it("removes deleted products and collections from coverage, with a route for their topics", () => {
    expect(toml).toContain('topics = ["products/delete", "collections/delete"]\n  uri = "/webhooks/content/delete"');
    expect(existsSync("app/routes/webhooks.content.delete.tsx")).toBe(true);
  });

  it("uses the current stable webhook API version", () => {
    expect(toml).toMatch(/api_version = "2026-10"/);
  });

  it("requests no customer or order scopes", () => {
    const scopes = /scopes = "([^"]*)"/.exec(toml)![1]!.split(",");
    expect(scopes.some((s) => /customer|order/.test(s))).toBe(false);
  });
});
