/**
 * Checks for `pnpm preflight` that need no network: app configuration
 * files, webhook routes, store safety and provider costs. Pure functions,
 * unit-tested (tests/unit/preflight-checks.test.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  azureTranslatorSettings,
  engineConfigProblems,
  getConfig,
  googleTranslateSettings,
  translationEngineOrder,
  type AppConfig,
} from "../../app/.server/lib/config";
import { engineSectionsWithOpenMarks, pageEngineTags } from "../../app/.server/site/engine-blocks";
import { ENGINE_NAMES } from "../../app/lib/engines";

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
  const numbered = Object.keys(env)
    .map((name) => /^DEEPL_API_KEY_(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => env[m[0]] ?? "");
  const keys = [...new Set([env.DEEPL_API_KEY ?? "", ...numbered, ...(env.DEEPL_API_KEYS ?? "").split(/[\s,;]+/)].map((k) => k.trim()).filter(Boolean))];
  if (keys.length === 0) {
    // Azure or Google without DeepL: they are reported by checkTranslationEngines.
    if (otherEnginesSetUp(env)) return { level: "ok", name: "Translation provider", detail: "No DeepL key; other engines are set up (see below)" };
    return { level: "warn", name: "Translation provider", detail: "No DeepL key: AI translation is off (manual translation works)" };
  }
  if (keys.length > 1) return { level: "warn", name: "Translation provider", detail: `${keys.length} DeepL keys (the next is used when one runs out): ${keys.filter((k) => !k.endsWith(":fx")).length} Pro key(s) are billed. Use them only with the owner's approval` };
  const key = keys[0]!;
  return key.endsWith(":fx")
    ? { level: "ok", name: "Translation provider", detail: "DeepL API Free key (free monthly allowance)" }
    : { level: "warn", name: "Translation provider", detail: "DeepL API Pro key: usage is billed. Use it only with the owner's approval" };
}

/** The environment as the app reads it, or null when it doesn't validate (reported elsewhere). */
function configOf(env: NodeJS.ProcessEnv): AppConfig | null {
  try {
    return getConfig({ SHOPIFY_API_KEY: "preflight", ...env });
  } catch {
    return null;
  }
}

function otherEnginesSetUp(env: NodeJS.ProcessEnv): boolean {
  const config = configOf(env);
  return Boolean(config && (azureTranslatorSettings(config) || googleTranslateSettings(config)));
}

const ENGINE_CREDENTIALS = ["AZURE_TRANSLATOR_KEY", "GOOGLE_TRANSLATE_API_KEY", "GOOGLE_TRANSLATE_CREDENTIALS"] as const;

/**
 * Microsoft Azure and Google Cloud (docs/AI_ENGINES.md): whether their
 * variables validate, what they cost, where they process, the order, and
 * whether their privacy section is ready. Nothing with DeepL alone. Names,
 * never a key or a service account's email.
 */
export function checkTranslationEngines(env: NodeJS.ProcessEnv, pages: { privacy: string }): CheckResult[] {
  const name = "Translation engines";
  const results: CheckResult[] = [];
  // Also refused by the configuration: no paid engine from staging.
  if (env.LINGUVA_STAGE === "staging") {
    const set = ENGINE_CREDENTIALS.filter((variable) => (env[variable] ?? "").trim() !== "");
    if (set.length) results.push({ level: "fail", name, detail: `${set.join(", ")} must not be set in staging` });
  }
  const engineOf: Record<string, string> = {
    AZURE_TRANSLATOR_KEY: "Microsoft Azure",
    AZURE_TRANSLATOR_REGION: "Microsoft Azure",
    AZURE_TRANSLATOR_ENDPOINT: "Microsoft Azure",
    GOOGLE_TRANSLATE_API_KEY: "Google Cloud",
    GOOGLE_TRANSLATE_CREDENTIALS: "Google Cloud",
  };
  for (const problem of engineConfigProblems(env)) {
    results.push({ level: "fail", name, detail: `${problem.variable}: ${problem.message}; ${engineOf[problem.variable] ?? "that engine"} is off` });
  }
  let config: AppConfig;
  try {
    config = getConfig({ SHOPIFY_API_KEY: "preflight", ...env });
  } catch (error) {
    // The message names the variables, never their values. Without an engine credential the
    // "Environment" check reports it already (DeepL alone: the same output as before).
    if (ENGINE_CREDENTIALS.some((variable) => (env[variable] ?? "").trim() !== "")) {
      results.push({ level: "fail", name, detail: error instanceof Error ? error.message : String(error) });
    }
    return results;
  }
  const order = translationEngineOrder(config);
  if (!order.some((id) => id !== "deepl")) return results;

  const azure = azureTranslatorSettings(config);
  if (azure && order.includes("azure")) {
    const where = azure.dataLocation === "eu" ? "EU endpoint (api-eur)" : "global endpoint (texts may be processed outside the EU)";
    const region = azure.region ? `region ${azure.region}` : "no region (only a Global resource works without it; a regional one answers 401)";
    results.push({
      level: "warn",
      name,
      detail: `Microsoft Azure Translator: ${region}, ${where}: billed beyond the free tier (F0: 2,000,000 characters a month). Use it only with the owner's approval`,
    });
  }
  const google = googleTranslateSettings(config);
  if (google && order.includes("google")) {
    results.push({
      level: "warn",
      name,
      detail:
        google.kind === "apiKey"
          ? "Google Cloud Translation (API key, v2): global processing, no EU option on this path; billed after 500,000 free characters a month. Use it only with the owner's approval"
          : `Google Cloud Translation (service account, project ${google.credentials.projectId}, EU endpoint): billed after 500,000 free characters a month. Use it only with the owner's approval`,
    });
  }
  results.push({ level: "ok", name, detail: `Engine order: ${order.map((id) => ENGINE_NAMES[id]).join(" → ")}` });
  // A preflight check, not a refused start: a variable change must never take a store down.
  if (config.LINGUVA_STAGE === "production" && config.PUBLIC_PAGES === "on") {
    const open = engineSectionsWithOpenMarks(pages.privacy, pageEngineTags(config));
    if (open.length) {
      results.push({
        level: "fail",
        name,
        detail: `the privacy page would show the draft notice (open points in the ${open.join(", ")} section): the lawyer resolves the Azure/Google section before the key is added`,
      });
    }
  }
  return results;
}

/** Whether the Own key plan's card and website texts are shown (OWN_KEY_PLAN_VISIBLE). Information only, never a failure. */
export function checkOwnKeyPlan(config: Pick<AppConfig, "OWN_KEY_PLAN_VISIBLE">): CheckResult {
  return config.OWN_KEY_PLAN_VISIBLE === "on"
    ? { level: "ok", name: "Own key plan", detail: "shown (OWN_KEY_PLAN_VISIBLE=on)" }
    : { level: "ok", name: "Own key plan", detail: "hidden (OWN_KEY_PLAN_VISIBLE=off; a subscriber still gets the plan)" };
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
