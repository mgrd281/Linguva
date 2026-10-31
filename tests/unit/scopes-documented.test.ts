/**
 * Every access scope the app requests (required and optional) is explained in
 * docs/SECURITY_MODEL.md §1a, and write_locales stays unrequested (requirement
 * 3.2: no scope without a feature).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync("shopify.app.toml", "utf8");
const doc = readFileSync("docs/SECURITY_MODEL.md", "utf8");

function scopes(): string[] {
  const required = /^scopes = "([^"]*)"$/m.exec(toml)![1]!.split(",");
  const optional = JSON.parse(/^optional_scopes = (.*)$/m.exec(toml)![1]!) as string[];
  return [...required, ...optional];
}

describe("access scopes", () => {
  it("each has a row in SECURITY_MODEL.md's scope table", () => {
    const missing = scopes().filter((scope) => !new RegExp(`^\\| \`${scope}\` \\|`, "m").test(doc));
    expect(missing).toEqual([]);
  });

  it("never asks for write_locales: Linguva doesn't add or publish languages", () => {
    expect(scopes()).not.toContain("write_locales");
  });
});
