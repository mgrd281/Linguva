import { z } from "zod";

const keyEntry = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43}=$/;

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
  // AI translation is disabled when no provider key is configured.
  DEEPL_API_KEY: z.string().min(1).optional(),
  DEEPL_API_URL: z.string().url().optional(),
  // Monthly AI character allowance per shop until plans are wired to billing.
  AI_MONTHLY_CHAR_LIMIT: z.coerce.number().int().positive().default(20_000),
  // Daily cap per shop (UTC day); defaults to the monthly allowance.
  AI_DAILY_CHAR_LIMIT: z.coerce.number().int().positive().optional(),
  // Cost safety: AI characters across all shops per UTC day.
  AI_PLATFORM_DAILY_CHAR_LIMIT: z.coerce.number().int().positive().default(100_000),
  // Largest single interactive AI request (characters sent to the provider).
  AI_MAX_CHARS_PER_REQUEST: z.coerce.number().int().positive().default(20_000),
  // Interactive AI requests per minute, per staff member and per shop.
  AI_USER_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  AI_SHOP_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // Translation memory suggestions per minute and staff member.
  MEMORY_SUGGESTIONS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // "mock" returns marked pseudo-translations for development and tests.
  TRANSLATION_PROVIDER: z.enum(["deepl", "mock"]).default("deepl"),
  // Background jobs are disabled when no Redis is configured.
  REDIS_URL: z.string().url().optional(),
  // Per-shop Shopify Admin API budget used by background jobs (points).
  SHOPIFY_JOB_BUCKET_SIZE: z.coerce.number().int().positive().default(800),
  SHOPIFY_JOB_RESTORE_PER_SECOND: z.coerce.number().positive().default(80),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
}).refine((c) => !(c.NODE_ENV === "production" && c.TRANSLATION_PROVIDER === "mock"), {
  message: "the mock translation provider can't be used in production",
  path: ["TRANSLATION_PROVIDER"],
}).refine((c) => !(c.NODE_ENV === "production" && !c.REDIS_URL), {
  // Rate limits must be shared by all app instances.
  message: "is required in production (shared rate limits)",
  path: ["REDIS_URL"],
});

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

/**
 * Validates environment configuration on first use and fails fast with a
 * message that names the invalid variables but never their values.
 */
export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration (${fields})`);
  }
  if (env === process.env) cached = result.data;
  return result.data;
}
