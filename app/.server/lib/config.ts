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
});

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
