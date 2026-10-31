import { z } from "zod";

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
function pasted(value: unknown): unknown {
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

/** Every configured DeepL key, in order and without repeats: DEEPL_API_KEY first, then DEEPL_API_KEYS. */
export function deeplApiKeys(env: { DEEPL_API_KEY?: string | undefined; DEEPL_API_KEYS?: string | undefined }): string[] {
  const listed = (env.DEEPL_API_KEYS ?? "").split(/[\s,;]+/).map((k) => k.replace(/^["']|["']$/g, "").trim());
  return [...new Set([env.DEEPL_API_KEY ?? "", ...listed].filter(Boolean))];
}

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
  // The operator's own stores (*.myshopify.com, comma-separated): only they see operator details such as the DeepL keys' quota.
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
  // Internal cost estimate for AI usage reports (USD per million characters
  // sent to the provider). Set it to the provider contract's price.
  AI_COST_USD_PER_MILLION_CHARS: z.coerce.number().nonnegative().default(25),
  // "mock" returns marked pseudo-translations for development and tests.
  TRANSLATION_PROVIDER: z.preprocess(pasted, z.enum(["deepl", "mock"]).default("deepl")),
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
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
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
export function configWarnings(config: AppConfig): string[] {
  const warnings: string[] = [];
  if (config.BILLING_REQUIRED === "true" && config.AI_PLATFORM_DAILY_CHAR_LIMIT < 1_000_000) {
    warnings.push(
      "AI_PLATFORM_DAILY_CHAR_LIMIT is below 1,000,000 while BILLING_REQUIRED=true: one store's first pass can stop AI translation for every store (docs/PRICING_DECISION.md §8: 3,000,000 at launch)",
    );
  }
  return warnings;
}

/** Logs configWarnings once, at start. Never throws: an invalid configuration is reported where it is used. */
export function logConfigWarnings(log: (message: string) => void, env: NodeJS.ProcessEnv = process.env): void {
  try {
    for (const warning of configWarnings(getConfig(env))) log(warning);
  } catch {
    // Not this function's concern (getConfig reports it on first use).
  }
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
