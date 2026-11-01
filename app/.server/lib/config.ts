import { z } from "zod";
import { ENGINE_IDS, ENGINE_NAMES, isEngineId, type ConsentToken, type EngineId } from "../../lib/engines";
import { AZURE_EU_ENDPOINT, AZURE_GLOBAL_ENDPOINT } from "../providers/azure";
import { parseServiceAccount, type ServiceAccountCredentials } from "../providers/google-auth";

const keyEntry = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43}=$/;
const shopDomain = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/**
 * Stores a staging deployment must never serve, whatever ALLOWED_SHOPS says:
 * the operator's production stores (test translations must not reach them).
 * KARINEX's admin domain is 45dv93-bk.myshopify.com, without its name in it.
 */
export const STAGING_DENIED_SHOP_NAMES = ["karinex", "softwarefach", "45dv93-bk"] as const;

/** Comma-separated shop domains, trimmed and lower-cased; empty entries dropped. */
export function shopList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A value as people paste it into a hosting dashboard: surrounding spaces,
 * line breaks and quotes are dropped; empty means not set.
 */
export function pasted(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim();
  return v === "" ? undefined : v;
}

/** A character count with thousands separators as people type them: 450000, 450.000, 450,000 or 450 000. */
function charCount(value: unknown): unknown {
  const v = pasted(value);
  return typeof v === "string" && /^\d{1,3}([.,' _]\d{3})+$/.test(v) ? v.replace(/[.,' _]/g, "") : v;
}

/** DeepL's base address; a pasted ".../v2" or trailing slash is dropped (the client adds /v2). */
function deeplBaseUrl(value: unknown): unknown {
  const v = pasted(value);
  return typeof v === "string" ? v.replace(/\/+$/, "").replace(/\/v2$/i, "").replace(/\/+$/, "") : v;
}

/** Every request to it carries the API key and merchant text: https only. */
function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Azure's "Location/Region" as the portal shows it ("West Europe" → westeurope); "global" means none. */
export function azureRegion(value: unknown): unknown {
  const v = pasted(value);
  if (typeof v !== "string") return v;
  const region = v.toLowerCase().replace(/\s+/g, "");
  return region === "global" ? undefined : region;
}

/** A pasted endpoint without its query, a trailing slash or a "/translate" path (the client adds it). */
function azureEndpoint(value: unknown): unknown {
  const v = pasted(value);
  return typeof v === "string" ? v.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\/translate$/i, "").replace(/\/+$/, "") : v;
}

/**
 * Engine variables (docs/AI_ENGINES.md). Validated twice: in the schema with
 * a fallback (a value that doesn't validate turns its engine off and never
 * stops the start: a typo in a new Azure or Google variable must not take
 * KARINEX down), and by engineConfigProblems for warnings and preflight.
 */
const engineFields = {
  AZURE_TRANSLATOR_KEY: z.preprocess(
    pasted,
    z.string().regex(/^[A-Za-z0-9]{16,128}$/, "doesn't look like a Translator key (Azure portal: Keys and Endpoint, Key 1)").optional(),
  ),
  AZURE_TRANSLATOR_REGION: z.preprocess(
    azureRegion,
    z.string().regex(/^[a-z0-9]{2,32}$/, "must be the resource's Location/Region, for example westeurope").optional(),
  ),
  // The key never goes to another host: only Microsoft's EU and global endpoints.
  AZURE_TRANSLATOR_ENDPOINT: z.preprocess(
    azureEndpoint,
    z
      .string()
      .refine(isHttps, "must be an https:// address")
      .refine((v): boolean => v === AZURE_EU_ENDPOINT || v === AZURE_GLOBAL_ENDPOINT, `must be empty (EU endpoint), ${AZURE_EU_ENDPOINT} or ${AZURE_GLOBAL_ENDPOINT}`)
      .optional(),
  ),
  GOOGLE_TRANSLATE_API_KEY: z.preprocess(
    pasted,
    z.string().regex(/^[A-Za-z0-9._-]{20,200}$/, "doesn't look like a Google Cloud API key").optional(),
  ),
  GOOGLE_TRANSLATE_CREDENTIALS: z.preprocess(
    pasted,
    z
      .string()
      .transform((value, ctx): ServiceAccountCredentials => {
        const credentials = parseServiceAccount(value);
        if (credentials) return credentials;
        ctx.addIssue({ code: "custom", message: "must be the service account's JSON key file, or that file in base64" });
        return z.NEVER;
      })
      .optional(),
  ),
} as const;

/**
 * What a region, endpoint or Google key file that doesn't validate becomes:
 * never a real value, so the helpers below see the variable was set and keep
 * the engine off (a missing region would otherwise send requests that Azure
 * refuses, and a broken key file would switch Google to the API key's global
 * processing).
 */
const INVALID = "(invalid)";

/** Engine credentials staging refuses, even when their value doesn't validate. */
const ENGINE_CREDENTIALS = ["AZURE_TRANSLATOR_KEY", "GOOGLE_TRANSLATE_API_KEY", "GOOGLE_TRANSLATE_CREDENTIALS"] as const;

/** Every configured DeepL key, in order and without repeats: DEEPL_API_KEY first, then DEEPL_API_KEYS. */
export function deeplApiKeys(env: { DEEPL_API_KEY?: string | undefined; DEEPL_API_KEYS?: string | undefined }): string[] {
  const listed = (env.DEEPL_API_KEYS ?? "").split(/[\s,;]+/).map((k) => k.replace(/^["']|["']$/g, "").trim());
  return [...new Set([env.DEEPL_API_KEY ?? "", ...listed].filter(Boolean))];
}

/**
 * Internal cost estimate for AI usage reports (USD per million characters
 * sent to the provider). Set it to the provider contract's price. Also read
 * on their own (costRatesFromEnv) by the operator's report.
 */
const costRateFields = {
  // DeepL's rate; also the rate of ledger rows without an engine.
  AI_COST_USD_PER_MILLION_CHARS: z.coerce.number().nonnegative().default(25),
  // Microsoft Azure Translator S1 and Google Cloud Translation NMT list prices.
  AI_COST_USD_PER_MILLION_CHARS_AZURE: z.preprocess(pasted, z.coerce.number().nonnegative().default(10)),
  AI_COST_USD_PER_MILLION_CHARS_GOOGLE: z.preprocess(pasted, z.coerce.number().nonnegative().default(20)),
} as const;

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().url(),
  // Comma-separated `kid:base64(32 bytes)` entries. The first entry encrypts;
  // all entries can decrypt (key rotation).
  TOKEN_ENCRYPTION_KEYS: z
    .string()
    .min(1)
    .refine(
      (v) => v.split(",").every((entry) => keyEntry.test(entry.trim())),
      "must be comma-separated kid:base64key entries with 32-byte keys",
    ),
  // AI translation is disabled when no provider key is configured (an empty value counts as none).
  DEEPL_API_KEY: z.preprocess(pasted, z.string().min(1).optional()),
  // More DeepL keys, separated by commas, spaces or line breaks: the next one is used when a key's quota is used up.
  DEEPL_API_KEYS: z.preprocess(pasted, z.string().min(1).optional()),
  DEEPL_API_URL: z.preprocess(deeplBaseUrl, z.string().url().refine(isHttps, "must be an https:// address").optional()),
  // More engines (optional; docs/AI_ENGINES.md). With only DeepL set, nothing changes.
  AZURE_TRANSLATOR_KEY: engineFields.AZURE_TRANSLATOR_KEY.catch(undefined),
  AZURE_TRANSLATOR_REGION: engineFields.AZURE_TRANSLATOR_REGION.catch(INVALID),
  // Empty: Microsoft's EU endpoint (texts processed in the EU only).
  AZURE_TRANSLATOR_ENDPOINT: engineFields.AZURE_TRANSLATOR_ENDPOINT.catch(INVALID),
  // Google Cloud Translation: an API key (v2, global) or a service account's JSON key file (v3, EU), which wins.
  GOOGLE_TRANSLATE_API_KEY: engineFields.GOOGLE_TRANSLATE_API_KEY.catch(undefined),
  // A key file that doesn't validate keeps Google off: never a silent fall back to the API key (global processing).
  GOOGLE_TRANSLATE_CREDENTIALS: z
    .unknown()
    .transform((value): ServiceAccountCredentials | typeof INVALID | undefined => {
      const result = engineFields.GOOGLE_TRANSLATE_CREDENTIALS.safeParse(value);
      return result.success ? result.data : INVALID;
    })
    .optional(),
  // Which engines and in which order (commas or spaces; default deepl,azure,google). DeepL, when used, is always first.
  TRANSLATION_ENGINES: z.preprocess(pasted, z.string().optional()),
  // Monthly AI character allowance per shop until plans are wired to billing.
  AI_MONTHLY_CHAR_LIMIT: z.preprocess(charCount, z.coerce.number().int().positive().default(20_000)),
  // Daily cap per shop (UTC day); defaults to the monthly allowance.
  AI_DAILY_CHAR_LIMIT: z.preprocess(charCount, z.coerce.number().int().positive().optional()),
  // Cost safety: AI characters across all shops per UTC day.
  AI_PLATFORM_DAILY_CHAR_LIMIT: z.preprocess(charCount, z.coerce.number().int().positive().default(100_000)),
  // Largest single interactive AI request (characters sent to the provider).
  AI_MAX_CHARS_PER_REQUEST: z.preprocess(charCount, z.coerce.number().int().positive().default(20_000)),
  // Interactive AI requests per minute, per staff member and per shop.
  AI_USER_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  AI_SHOP_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // Translation memory suggestions per minute and staff member.
  MEMORY_SUGGESTIONS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // Shopify App Pricing. Without these, billing is off and every shop gets
  // all features (development, before plans exist in the Partner Dashboard).
  SHOPIFY_PARTNER_ORG_ID: z.string().regex(/^\d+$/).optional(),
  SHOPIFY_PARTNER_API_TOKEN: z.string().min(10).optional(),
  SHOPIFY_APP_GID: z.string().regex(/^gid:\/\/shopify\/App\/\d+$/).optional(),
  SHOPIFY_APP_HANDLE: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  SHOPIFY_PARTNER_API_VERSION: z.string().regex(/^\d{4}-\d{2}$|^unstable$/).default("2026-10"),
  // "true": shops without a subscription are sent to the plan selection page.
  BILLING_REQUIRED: z.enum(["true", "false"]).default("false"),
  // The Own key plan's card on the Plan page and its texts on the website (PRICING_DECISION.md §9):
  // "on" only after the owner created the plan in the Partner Dashboard. Never changes what a subscriber gets.
  OWN_KEY_PLAN_VISIBLE: z.enum(["on", "off"]).default("off"),
  // Own key plan: key checks per minute and staff member (the shop gets twice as many).
  OWN_KEY_CHECKS_PER_MINUTE: z.coerce.number().int().positive().default(3),
  // The operator's own stores (*.myshopify.com, comma-separated): only they see operator details such as the translation engines' state.
  OPERATOR_SHOPS: z.string().optional(),
  // Owner complimentary access (BILLING_DESIGN §4): Shopify shop GIDs
  // (gid://shopify/Shop/<id>) of the operator's own stores. A store gets
  // free access only if it is listed here AND the operator tool granted it.
  COMPLIMENTARY_SHOP_GIDS: z
    .string()
    .optional()
    .refine(
      (v) => !v || v.split(",").every((gid) => /^gid:\/\/shopify\/Shop\/\d+$/.test(gid.trim())),
      "must be comma-separated gid://shopify/Shop/<id> values",
    ),
  ...costRateFields,
  // "engines" (default): the engines configured above; "deepl" is the older
  // spelling of the same and is what it is stored as, so every comparison
  // with "deepl" stays as it was. "mock" returns marked pseudo-translations
  // for development and tests.
  TRANSLATION_PROVIDER: z.preprocess((value) => {
    const v = pasted(value);
    return v === "engines" ? "deepl" : v;
  }, z.enum(["deepl", "mock"]).default("deepl")),
  // Background jobs are disabled when no Redis is configured.
  REDIS_URL: z.string().url().optional(),
  // Per-shop Shopify Admin API budget used by background jobs (points).
  SHOPIFY_JOB_BUCKET_SIZE: z.coerce.number().int().positive().default(800),
  SHOPIFY_JOB_RESTORE_PER_SECOND: z.coerce.number().positive().default(80),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  // Longest wait for one Shopify Admin API call before giving up (ms).
  SHOPIFY_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  // Hosted stage (docs/RAILWAY_STAGING.md). "staging": a production build
  // that serves only ALLOWED_SHOPS, with the mock provider and no AI key.
  LINGUVA_STAGE: z.enum(["staging", "production"]).optional(),
  // Comma-separated *.myshopify.com domains this deployment may serve.
  // Required for staging; optional for production (for example the first
  // custom-distribution store). Unset: every shop.
  ALLOWED_SHOPS: z
    .string()
    .optional()
    .refine((v) => shopList(v).every((d) => shopDomain.test(d)), "must be comma-separated *.myshopify.com domains"),
  // Set by Railway in every deployment: the environment's name.
  RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
  // "yes" only when the owner has approved a production release.
  LINGUVA_PRODUCTION_APPROVED: z.enum(["yes"]).optional(),
  // The app's own privacy policy (/privacy) and support page (/support):
  // "off" (default) answers 404 there and links neither from the website.
  PUBLIC_PAGES: z.enum(["on", "off"]).default("off"),
  // "yes" once a lawyer has reviewed those texts: hides their draft notice.
  LEGAL_TEXTS_REVIEWED: z.enum(["yes"]).optional(),
}).refine((c) => !(c.NODE_ENV === "production" && c.TRANSLATION_PROVIDER === "mock" && c.LINGUVA_STAGE !== "staging"), {
  message: "the mock translation provider can't be used in production",
  path: ["TRANSLATION_PROVIDER"],
}).refine(
  (c) =>
    c.BILLING_REQUIRED === "false" ||
    Boolean(c.SHOPIFY_PARTNER_ORG_ID && c.SHOPIFY_PARTNER_API_TOKEN && c.SHOPIFY_APP_GID && c.SHOPIFY_APP_HANDLE),
  {
    message: "needs SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_TOKEN, SHOPIFY_APP_GID and SHOPIFY_APP_HANDLE",
    path: ["BILLING_REQUIRED"],
  },
).refine((c) => !(c.NODE_ENV === "production" && !c.REDIS_URL), {
  // Rate limits must be shared by all app instances.
  message: "is required in production (shared rate limits)",
  path: ["REDIS_URL"],
}).refine((c) => c.LINGUVA_STAGE !== "staging" || c.TRANSLATION_PROVIDER === "mock", {
  // No paid AI calls from staging.
  message: "must be mock in staging",
  path: ["TRANSLATION_PROVIDER"],
}).refine((c) => c.LINGUVA_STAGE !== "staging" || !c.DEEPL_API_KEY, {
  message: "must not be set in staging",
  path: ["DEEPL_API_KEY"],
}).refine((c) => c.LINGUVA_STAGE !== "staging" || !c.DEEPL_API_KEYS, {
  message: "must not be set in staging",
  path: ["DEEPL_API_KEYS"],
}).refine((c) => c.LINGUVA_STAGE !== "staging" || shopList(c.ALLOWED_SHOPS).length > 0, {
  message: "is required in staging (the test stores it may serve)",
  path: ["ALLOWED_SHOPS"],
}).refine(
  (c) => c.LINGUVA_STAGE !== "staging" || !shopList(c.ALLOWED_SHOPS).some((d) => STAGING_DENIED_SHOP_NAMES.some((n) => d.includes(n))),
  { message: "must not list a production store in staging", path: ["ALLOWED_SHOPS"] },
).refine((c) => !c.RAILWAY_ENVIRONMENT_NAME || Boolean(c.LINGUVA_STAGE), {
  // A Railway deployment always says what it is.
  message: "must be set on Railway (staging or production)",
  path: ["LINGUVA_STAGE"],
}).refine((c) => !c.RAILWAY_ENVIRONMENT_NAME || !c.LINGUVA_STAGE || c.RAILWAY_ENVIRONMENT_NAME === c.LINGUVA_STAGE, {
  // Staging variables copied into the production environment (or the
  // other way round) stop the start instead of running in the wrong place.
  message: "must match the Railway environment's name",
  path: ["LINGUVA_STAGE"],
}).refine((c) => c.LINGUVA_STAGE !== "production" || c.LINGUVA_PRODUCTION_APPROVED === "yes", {
  // No accidental production release: the owner sets this when approving one.
  message: "production needs LINGUVA_PRODUCTION_APPROVED=yes (set by the owner for an approved release)",
  path: ["LINGUVA_STAGE"],
}).refine((c) => c.LINGUVA_STAGE !== "production" || c.PUBLIC_PAGES === "off" || c.LEGAL_TEXTS_REVIEWED === "yes", {
  // Production never shows a draft privacy policy.
  message: "PUBLIC_PAGES=on in production needs LEGAL_TEXTS_REVIEWED=yes (after the lawyer's review)",
  path: ["PUBLIC_PAGES"],
}).refine((c) => c.LINGUVA_STAGE !== "production" || c.OWN_KEY_PLAN_VISIBLE === "off" || partnerApiConfigured(c), {
  // With billing off every shop is unmetered on the operator's engines (subscription.ts): an Own key
  // subscriber would cost Linguva money. The same rule as partnerApiSettings.
  message: "OWN_KEY_PLAN_VISIBLE=on needs billing (SHOPIFY_PARTNER_*): without it an Own key subscriber would translate with Linguva's engines",
  path: ["OWN_KEY_PLAN_VISIBLE"],
});

/**
 * Whether this deployment may serve a shop: listed in ALLOWED_SHOPS (when
 * set) and, in staging, never one of the operator's production stores.
 */
export function isShopAllowed(shop: string | null | undefined, config: AppConfig = getConfig()): boolean {
  const domain = (shop ?? "").trim().toLowerCase();
  if (!domain) return false;
  if (config.LINGUVA_STAGE === "staging" && STAGING_DENIED_SHOP_NAMES.some((n) => domain.includes(n))) return false;
  const allowed = shopList(config.ALLOWED_SHOPS);
  // No list: every shop (custom shop domains included), as before stages existed.
  return allowed.length === 0 || allowed.includes(domain);
}

/** The AI character limits applied to every reservation. */
export function aiUsageLimits(config: AppConfig) {
  return {
    limit: config.AI_MONTHLY_CHAR_LIMIT,
    dailyLimit: Math.min(config.AI_DAILY_CHAR_LIMIT ?? config.AI_MONTHLY_CHAR_LIMIT, config.AI_MONTHLY_CHAR_LIMIT),
    platformDailyLimit: config.AI_PLATFORM_DAILY_CHAR_LIMIT,
  };
}

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Tests only: forget the validated environment so a changed process.env is read again. */
export function resetConfigCache() {
  cached = undefined;
}

/** DEEPL_API_KEY_2, DEEPL_API_KEY_3, ... join DEEPL_API_KEYS in numeric order (the list, if any, comes after them). */
function withNumberedDeeplKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const numbered = Object.keys(env)
    .map((name) => /^DEEPL_API_KEY_(\d+)$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => (env[m[0]] ?? "").trim())
    .filter(Boolean);
  if (numbered.length === 0) return env;
  return { ...env, DEEPL_API_KEYS: [...numbered, env.DEEPL_API_KEYS ?? ""].filter(Boolean).join(",") };
}

/**
 * Validates environment configuration on first use and fails fast with a
 * message that names the invalid variables but never their values.
 */
export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  const result = schema.safeParse(withNumberedDeeplKeys(env));
  // No paid engine from staging, even with a value that doesn't validate
  // (the schema turns those engines off, so it can't see them).
  const stagingRefusals =
    env.LINGUVA_STAGE === "staging" ? ENGINE_CREDENTIALS.filter((name) => pasted(env[name]) !== undefined).map((name) => `${name}: must not be set in staging`) : [];
  if (!result.success || stagingRefusals.length) {
    const fields = [...(result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)), ...stagingRefusals].join("; ");
    throw new Error(`Invalid environment configuration (${fields})`);
  }
  if (env === process.env) cached = result.data;
  return result.data;
}

/**
 * The owner role's database URL is for the migration step and the operator
 * tools, which run as processes of their own before or beside the server
 * (docs/RAILWAY_STAGING.md §5.4). The web process drops it at start, so no
 * request, log line or child process of the server holds a connection
 * string for the owner of every table.
 */
export function dropMigrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): void {
  delete env.MIGRATION_DATABASE_URL;
}

/**
 * Settings that let the app start but need attention before merchants pay
 * (docs/PRICING_DECISION.md §8): with plans required, a platform cap below
 * 1,000,000 characters a day lets one store's first pass stop AI
 * translation for every store. Advice only: never a reason not to start.
 */
export function configWarnings(config: AppConfig, env?: NodeJS.ProcessEnv | Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  if (config.BILLING_REQUIRED === "true" && config.AI_PLATFORM_DAILY_CHAR_LIMIT < 1_000_000) {
    warnings.push(
      "AI_PLATFORM_DAILY_CHAR_LIMIT is below 1,000,000 while BILLING_REQUIRED=true: one store's first pass can stop AI translation for every store (docs/PRICING_DECISION.md §8: 3,000,000 at launch)",
    );
  }
  if (config.OWN_KEY_PLAN_VISIBLE === "on" && !partnerApiConfigured(config)) {
    // Production refuses this (the schema above); elsewhere it is advice.
    warnings.push("OWN_KEY_PLAN_VISIBLE=on: the Own key plan is shown, but billing is off: no store can be on it");
  }
  warnings.push(...engineWarnings(config, env));
  return warnings;
}

/** Logs configWarnings once, at start. Never throws: an invalid configuration is reported where it is used. */
export function logConfigWarnings(log: (message: string) => void, env: NodeJS.ProcessEnv = process.env): void {
  try {
    for (const warning of configWarnings(getConfig(env), env)) log(warning);
  } catch {
    // Not this function's concern (getConfig reports it on first use).
  }
}

// ---------------------------------------------------------------- translation engines

export interface AzureTranslatorSettings {
  key: string;
  region?: string;
  endpoint: typeof AZURE_EU_ENDPOINT | typeof AZURE_GLOBAL_ENDPOINT;
  /** eu: Microsoft's EU endpoint (France Central or West Europe); global: the closest data centre, possibly outside the EU. */
  dataLocation: "eu" | "global";
}

/** Azure Translator, or null when it isn't set up (or one of its variables doesn't validate). */
export function azureTranslatorSettings(config: AppConfig): AzureTranslatorSettings | null {
  const key = config.AZURE_TRANSLATOR_KEY;
  if (!key || config.AZURE_TRANSLATOR_REGION === INVALID || config.AZURE_TRANSLATOR_ENDPOINT === INVALID) return null;
  const endpoint = config.AZURE_TRANSLATOR_ENDPOINT === AZURE_GLOBAL_ENDPOINT ? AZURE_GLOBAL_ENDPOINT : AZURE_EU_ENDPOINT;
  return {
    key,
    ...(config.AZURE_TRANSLATOR_REGION ? { region: config.AZURE_TRANSLATOR_REGION } : {}),
    endpoint,
    dataLocation: endpoint === AZURE_EU_ENDPOINT ? "eu" : "global",
  };
}

export type GoogleTranslateSettings =
  | { kind: "apiKey"; apiKey: string; dataLocation: "global" }
  | { kind: "serviceAccount"; credentials: ServiceAccountCredentials; dataLocation: "eu" };

/**
 * Google Cloud Translation: the service account (v3, EU endpoint) wins over an API key (v2, global).
 * A key file that is set but doesn't validate turns Google off: the operator chose EU processing.
 */
export function googleTranslateSettings(config: AppConfig): GoogleTranslateSettings | null {
  if (config.GOOGLE_TRANSLATE_CREDENTIALS === INVALID) return null;
  if (config.GOOGLE_TRANSLATE_CREDENTIALS) return { kind: "serviceAccount", credentials: config.GOOGLE_TRANSLATE_CREDENTIALS, dataLocation: "eu" };
  if (config.GOOGLE_TRANSLATE_API_KEY) return { kind: "apiKey", apiKey: config.GOOGLE_TRANSLATE_API_KEY, dataLocation: "global" };
  return null;
}

/** TRANSLATION_ENGINES as written: known engines in order (DeepL first), and what was ignored or moved. Pure. */
export function parseEngineList(value: string | undefined): { engines: EngineId[]; unknown: string[]; repeated: EngineId[]; deeplMoved: boolean } {
  const names = (value ?? "").split(/[\s,;]+/).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const engines: EngineId[] = [];
  const unknown: string[] = [];
  const repeated: EngineId[] = [];
  for (const name of names) {
    if (!isEngineId(name)) unknown.push(name);
    else if (engines.includes(name)) repeated.push(name);
    else engines.push(name);
  }
  // DeepL, when used, is always first: the legal and settings texts ("only when DeepL can't translate") stay true.
  const deeplMoved = engines.indexOf("deepl") > 0;
  if (deeplMoved) engines.sort((a, b) => (a === "deepl" ? -1 : b === "deepl" ? 1 : 0));
  return { engines, unknown, repeated, deeplMoved };
}

function engineConfigured(config: AppConfig, id: EngineId): boolean {
  if (id === "deepl") return deeplApiKeys(config).length > 0;
  if (id === "azure") return azureTranslatorSettings(config) !== null;
  return googleTranslateSettings(config) !== null;
}

/** The engines TRANSLATION_ENGINES selects; unset, or naming no engine at all (a typo), the default order. */
function listedEngines(config: AppConfig): EngineId[] {
  const listed = config.TRANSLATION_ENGINES === undefined ? [] : parseEngineList(config.TRANSLATION_ENGINES).engines;
  // A list without a single known engine never switches AI translation off.
  return listed.length ? listed : [...ENGINE_IDS];
}

/** Configured engines in routing order (TRANSLATION_ENGINES or the default), DeepL first; [] with the mock provider. */
export function translationEngineOrder(config: AppConfig): EngineId[] {
  if (config.TRANSLATION_PROVIDER === "mock") return [];
  return listedEngines(config).filter((id) => engineConfigured(config, id));
}

/** The consent token of an engine in use: the engine plus where it processes. */
export function engineConsentToken(config: AppConfig, id: EngineId): ConsentToken {
  if (id === "deepl") return "deepl";
  if (id === "azure") return azureTranslatorSettings(config)?.dataLocation === "global" ? "azure-global" : "azure-eu";
  return googleTranslateSettings(config)?.dataLocation === "eu" ? "google-eu" : "google-global";
}

/** Consent / legal-text tokens of the engines in use, in routing order; mock or none → ["deepl"] (today's texts). */
export function engineConsentTokens(config: AppConfig): ConsentToken[] {
  const order = translationEngineOrder(config);
  return order.length ? order.map((id) => engineConsentToken(config, id)) : ["deepl"];
}

/** Problems with the engine variables (names and rules only, never a value). */
export function engineConfigProblems(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Array<{ variable: string; message: string }> {
  const problems: Array<{ variable: string; message: string }> = [];
  for (const [variable, field] of Object.entries(engineFields)) {
    const result = field.safeParse(env[variable]);
    if (!result.success) problems.push({ variable, message: result.error.issues[0]?.message ?? "doesn't validate" });
  }
  return problems;
}

/** USD per million characters for a ledger provider value (null, "mock", unknown → DeepL's rate). */
export function costRatePerMillion(config: AppConfig, provider: string | null): number {
  if (provider === "azure") return config.AI_COST_USD_PER_MILLION_CHARS_AZURE;
  if (provider === "google") return config.AI_COST_USD_PER_MILLION_CHARS_GOOGLE;
  return config.AI_COST_USD_PER_MILLION_CHARS;
}

/** Cost rates per engine (USD per million characters). */
export function costRates(config: AppConfig): Record<EngineId, number> {
  return { deepl: costRatePerMillion(config, "deepl"), azure: costRatePerMillion(config, "azure"), google: costRatePerMillion(config, "google") };
}

/**
 * The same rates read from the three rate variables alone, validated as the
 * app reads them: for the operator's report (scripts/ops/complimentary.ts),
 * which runs with its own database URL and none of the app's other variables.
 */
export function costRatesFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Record<EngineId, number> {
  const rates = z.object(costRateFields).parse(env);
  return { deepl: rates.AI_COST_USD_PER_MILLION_CHARS, azure: rates.AI_COST_USD_PER_MILLION_CHARS_AZURE, google: rates.AI_COST_USD_PER_MILLION_CHARS_GOOGLE };
}

/** Advice about the engine variables (never fatal; names, never values). */
function engineWarnings(config: AppConfig, env?: NodeJS.ProcessEnv | Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  if (env) {
    for (const problem of engineConfigProblems(env)) warnings.push(`${problem.variable} ${problem.message}: it is ignored, that engine is off`);
  }
  if (config.TRANSLATION_PROVIDER === "mock") return warnings;
  const withCredentials = ENGINE_IDS.filter((id) => engineConfigured(config, id));
  if (config.TRANSLATION_ENGINES !== undefined) {
    const list = parseEngineList(config.TRANSLATION_ENGINES);
    if (list.engines.length === 0) warnings.push("TRANSLATION_ENGINES names no engine (deepl, azure, google): the default order is used");
    for (const id of withCredentials.filter((e) => list.engines.length > 0 && !list.engines.includes(e))) {
      warnings.push(`${ENGINE_NAMES[id]} has credentials but TRANSLATION_ENGINES doesn't list it: it isn't used`);
    }
    for (const id of list.engines.filter((e) => !withCredentials.includes(e))) {
      warnings.push(`TRANSLATION_ENGINES lists ${id} without its credentials: it is skipped`);
    }
    // Only a short, name-shaped entry is echoed (a typo like "bing"); anything else may be a key
    // pasted into the wrong field (they sit next to each other), so it is counted, never shown.
    const named = list.unknown.filter((n) => /^[a-z][a-z0-9-]{0,11}$/.test(n));
    for (const name of named) warnings.push(`TRANSLATION_ENGINES: "${name}" isn't an engine: ignored`);
    const unnamed = list.unknown.length - named.length;
    if (unnamed) warnings.push(`TRANSLATION_ENGINES has ${unnamed} ${unnamed === 1 ? "entry that isn't an engine name" : "entries that aren't engine names"} (not shown, it may be a key): ignored`);
    for (const id of list.repeated) warnings.push(`TRANSLATION_ENGINES lists ${id} twice: once is enough`);
    if (list.deeplMoved) warnings.push("TRANSLATION_ENGINES: DeepL always comes first (it is moved to the front)");
  }
  if (config.GOOGLE_TRANSLATE_CREDENTIALS && config.GOOGLE_TRANSLATE_CREDENTIALS !== INVALID && config.GOOGLE_TRANSLATE_API_KEY) {
    warnings.push("GOOGLE_TRANSLATE_API_KEY and GOOGLE_TRANSLATE_CREDENTIALS are both set: the service account is used");
  }
  const order = translationEngineOrder(config);
  const azure = azureTranslatorSettings(config);
  if (azure && order.includes("azure")) {
    if (azure.dataLocation === "global") {
      warnings.push(
        "Microsoft Azure uses the global endpoint: texts may be processed outside the EU; the privacy texts say so. Leave AZURE_TRANSLATOR_ENDPOINT empty for the EU endpoint",
      );
    }
    if (!azure.region) warnings.push("AZURE_TRANSLATOR_REGION is empty: only a Global resource works without it; a regional one answers 401");
  }
  if (googleTranslateSettings(config)?.dataLocation === "global" && order.includes("google")) {
    warnings.push("Google Cloud uses the API key (v2): texts may be processed outside the EU; the privacy texts say so");
  }
  return warnings;
}

/** Whether a store is one of the operator's own (OPERATOR_SHOPS). No list: none is. */
export function isOperatorShop(shop: string | null | undefined, config: AppConfig = getConfig()): boolean {
  const domain = (shop ?? "").trim().toLowerCase();
  return domain !== "" && shopList(config.OPERATOR_SHOPS).includes(domain);
}

/** The Shopify shop GIDs eligible for owner complimentary access. */
export function complimentaryShopGids(config: AppConfig): string[] {
  return (config.COMPLIMENTARY_SHOP_GIDS ?? "")
    .split(",")
    .map((gid) => gid.trim())
    .filter(Boolean);
}

/** Partner API settings, or null when billing isn't configured. */
export function partnerApiSettings(config: AppConfig) {
  if (!config.SHOPIFY_PARTNER_ORG_ID || !config.SHOPIFY_PARTNER_API_TOKEN || !config.SHOPIFY_APP_GID) return null;
  return {
    orgId: config.SHOPIFY_PARTNER_ORG_ID,
    token: config.SHOPIFY_PARTNER_API_TOKEN,
    appGid: config.SHOPIFY_APP_GID,
    version: config.SHOPIFY_PARTNER_API_VERSION,
  };
}

/**
 * Billing is configured: partnerApiSettings would not be null (the same rule). Typed without
 * AppConfig so the schema's own refinements can use it.
 */
function partnerApiConfigured(c: { SHOPIFY_PARTNER_ORG_ID?: string | undefined; SHOPIFY_PARTNER_API_TOKEN?: string | undefined; SHOPIFY_APP_GID?: string | undefined }): boolean {
  return Boolean(c.SHOPIFY_PARTNER_ORG_ID && c.SHOPIFY_PARTNER_API_TOKEN && c.SHOPIFY_APP_GID);
}
