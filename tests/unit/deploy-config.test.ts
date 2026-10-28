/**
 * Hosting configuration (docs/RAILWAY_STAGING.md): the staging and
 * production Shopify app templates ask for exactly the development app's
 * scopes and webhooks, never use a development tunnel or store, and the
 * image runs unprivileged without local secrets.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const section = (toml: string, name: string) => toml.slice(toml.indexOf(`[${name}]`)).split(/\n\[(?!\[)/)[0]!;
const dev = read("shopify.app.toml");

describe.each(["staging", "production"])("Shopify app template: %s", (stage) => {
  const toml = read(`deploy/shopify/shopify.app.${stage}.toml`);

  it("has the development app's scopes and webhooks", () => {
    expect(section(toml, "access_scopes")).toBe(section(dev, "access_scopes"));
    expect(toml.slice(toml.indexOf("[webhooks]"))).toBe(dev.slice(dev.indexOf("[webhooks]")));
  });

  it("keeps its fixed URL and names no development store", () => {
    expect(toml).toMatch(/^automatically_update_urls_on_dev = false$/m);
    expect(toml).not.toMatch(/^dev_store_url/m);
    expect(toml).not.toMatch(/trycloudflare|ngrok|example\.com/);
  });

  it("isn't linked to an app yet (client ID filled in on approval)", () => {
    expect(toml).toMatch(/^client_id = ""$/m);
  });
});

describe("container image", () => {
  const dockerfile = read("Dockerfile");
  const ignore = read(".dockerignore").split("\n");

  it("runs the last stage as the unprivileged node user, with production dependencies only", () => {
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM "));
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toMatch(/COPY --from=prod-deps \/app\/node_modules/);
    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile --prod &&/);
  });

  it("never copies local secrets or tooling state into the build", () => {
    for (const entry of [".env", ".env.*", ".git", ".shopify"]) expect(ignore).toContain(entry);
  });
});
