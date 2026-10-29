/**
 * Checks for `pnpm preflight` that need no network: app configuration
 * files, webhook routes, store safety and provider costs. Pure functions,
 * unit-tested (tests/unit/preflight-checks.test.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CheckLevel = "ok" | "warn" | "fail";
export interface CheckResult {
  level: CheckLevel;
  name: string;
  detail: string;
}

/** Production stores the tooling must never target (plus PREFLIGHT_DENY_DOMAINS). */
export const DENIED_STORE_PATTERNS = [/karinex/i, /softwarefach/i];

export function isDeniedStore(domain: string, extra: readonly string[] = []): boolean {
  const d = domain.trim().toLowerCase();
  return DENIED_STORE_PATTERNS.some((p) => p.test(d)) || extra.some((x) => x && d.includes(x.trim().toLowerCase()));
}

/** The app config TOML files (shopify.app.toml and shopify.app.<name>.toml). */
export function appConfigFiles(root: string): string[] {
  return readdirSync(root)
    .filter((f) => /^shopify\.app(\.[\w-]+)?\.toml$/.test(f))
    .sort();
}

/** Minimal reader for the few TOML values preflight needs (no nested tables). */
export function tomlString(toml: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml);
  return match ? match[1]! : null;
}

export function webhookUris(toml: string): string[] {
  return [...toml.matchAll(/^\s*uri\s*=\s*"([^"]+)"/gm)].map((m) => m[1]!);
}

/** React Router flat route file for a webhook path, e.g. /webhooks/app/uninstalled → webhooks.app.uninstalled.tsx. */
export function routeFileFor(uri: string): string {
  return `${uri.replace(/^\//, "").replace(/\//g, ".")}.tsx`;
}

export function checkAppConfig(root: string): CheckResult[] {
  const results: CheckResult[] = [];
  const files = appConfigFiles(root);
  if (!files.length) return [{ level: "fail", name: "App configuration", detail: "No shopify.app.toml found" }];
  const linked = files.filter((f) => (tomlString(readFileSync(join(root, f), "utf8"), "client_id") ?? "") !== "");
  results.push(
    linked.length
      ? { level: "ok", name: "App linked", detail: `client_id set in ${linked.join(", ")}` }
      : {
          level: "fail",
          name: "App linked",
          detail: "client_id is empty: run `pnpm config:link` and create or choose the Linguva development app",
        },
  );
  for (const file of files) {
    const toml = readFileSync(join(root, file), "utf8");
    if (!/^\s*embedded\s*=\s*true/m.test(toml)) results.push({ level: "fail", name: file, detail: "embedded = true is missing" });
    if (!/^\s*redirect_urls\s*=/m.test(toml)) results.push({ level: "fail", name: file, detail: "[auth] redirect_urls is missing" });
    const missing = webhookUris(toml).filter((uri) => uri.startsWith("/webhooks/") && !existsSync(join(root, "app", "routes", routeFileFor(uri))));
    results.push(
      missing.length
        ? { level: "fail", name: `${file} webhooks`, detail: `No route for ${missing.join(", ")}` }
        : { level: "ok", name: `${file} webhooks`, detail: `${webhookUris(toml).length} subscriptions, every one has a route` },
    );
    const store = tomlString(toml, "dev_store_url");
    if (store && isDeniedStore(store)) {
      results.push({ level: "fail", name: `${file} dev_store_url`, detail: `${store} is a production store: never use it for development` });
    }
  }
  return results;
}

export function checkStoreTargets(env: NodeJS.ProcessEnv): CheckResult[] {
  const extra = (env.PREFLIGHT_DENY_DOMAINS ?? "").split(",").filter(Boolean);
  const targets = ["SHOPIFY_DEV_STORE", "LIVE_SHOPIFY_SHOP"].filter((k) => env[k]);
  const denied = targets.filter((k) => isDeniedStore(env[k]!, extra));
  if (denied.length) return [{ level: "fail", name: "Store safety", detail: `${denied.join(", ")} names a production store` }];
  return [{ level: "ok", name: "Store safety", detail: targets.length ? `${targets.join(", ")} allowed` : "No store configured here" }];
}

export function checkProviderCost(env: NodeJS.ProcessEnv): CheckResult {
  const provider = env.TRANSLATION_PROVIDER ?? "deepl";
  if (provider === "mock") return { level: "ok", name: "Translation provider", detail: "mock (no costs, marked pseudo-translations)" };
  const key = env.DEEPL_API_KEY ?? "";
  if (!key) return { level: "warn", name: "Translation provider", detail: "No DeepL key: AI translation is off (manual translation works)" };
  return key.endsWith(":fx")
    ? { level: "ok", name: "Translation provider", detail: "DeepL API Free key (free monthly allowance)" }
    : { level: "warn", name: "Translation provider", detail: "DeepL API Pro key: usage is billed. Use it only with the owner's approval" };
}

export function checkNodeVersion(version: string = process.versions.node): CheckResult {
  const [major, minor] = version.split(".").map(Number);
  const ok = major! > 22 || (major === 22 && minor! >= 12);
  return { level: ok ? "ok" : "fail", name: "Node.js", detail: ok ? version : `${version}; needs 22.12 or later` };
}

/** The encryption keys must not be the example or test values. */
export function checkEncryptionKeys(env: NodeJS.ProcessEnv, exampleFile: string): CheckResult {
  const value = env.TOKEN_ENCRYPTION_KEYS ?? "";
  const example = existsSync(exampleFile) ? /^TOKEN_ENCRYPTION_KEYS=(.*)$/m.exec(readFileSync(exampleFile, "utf8"))?.[1] ?? "" : "";
  const testKey = `test:${Buffer.alloc(32, 7).toString("base64")}`;
  if (!value) return { level: "fail", name: "Token encryption keys", detail: "TOKEN_ENCRYPTION_KEYS is not set" };
  if ((example && value === example) || value.includes(testKey)) {
    return { level: "fail", name: "Token encryption keys", detail: "Uses the example or test key: generate your own (see .env.example)" };
  }
  return { level: "ok", name: "Token encryption keys", detail: "Set (value not shown)" };
}
