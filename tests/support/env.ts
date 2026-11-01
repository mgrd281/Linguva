// A fixed, test-only key. Never used outside tests.
const TEST_KEYRING = `test:${Buffer.alloc(32, 7).toString("base64")}`;

export const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET: "test-api-secret",
  SHOPIFY_APP_URL: "https://linguva.test",
  SCOPES: "read_products,read_translations,write_translations",
  TOKEN_ENCRYPTION_KEYS: TEST_KEYRING,
  // Runtime role (subject to RLS) against the dedicated test database.
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://linguva_app:linguva_app_dev@localhost:5432/linguva_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379",
  MIGRATION_DATABASE_URL:
    process.env.TEST_MIGRATION_DATABASE_URL ??
    "postgresql://linguva_owner:linguva_owner_dev@localhost:5432/linguva_test",
  // Translation engine credentials are blanked (empty = unset), so a key
  // exported in the developer's shell never builds a real adapter in a test
  // run. Tests that need an engine inject a fake fetch with a fictional key.
  DEEPL_API_KEY: "",
  DEEPL_API_KEYS: "",
  AZURE_TRANSLATOR_KEY: "",
  GOOGLE_TRANSLATE_API_KEY: "",
  GOOGLE_TRANSLATE_CREDENTIALS: "",
};
