/**
 * Fictional engine credentials for tests: they pass the configuration's
 * validation (docs/AI_ENGINES.md) so the code really builds that engine, and
 * every test gives it a fake fetch. None of them is a real key.
 */
import { generateKeyPairSync } from "node:crypto";

export const FAKE_AZURE_KEY = "uiazurekey0004fictional0000000000";
export const FAKE_GOOGLE_KEY = "ui-google-key-0005-fictional0000";

/** A service account key file with a throwaway RSA key (generated per test run, never stored). */
export function fakeServiceAccount(projectId = "fictional-proj-1"): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key_id: "0000fictional",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: `linguva-test@${projectId}.iam.gserviceaccount.com`,
    token_uri: "https://accounts.google.com/o/oauth2/token",
  });
}

export const BASE_ENV = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
};

/**
 * Own key plan: fictional merchant keys in each engine's live format, numbered so tests can tell
 * them apart. Low-entropy on purpose and built at runtime (no key-shaped literal in the source).
 */
export function ownDeepLKey(n: number, free = true): string {
  return `${"d".repeat(8)}-${String(n).padStart(4, "0")}-${"e".repeat(4)}-${"f".repeat(12)}${free ? ":fx" : ""}`;
}

export function ownAzureKey(n: number): string {
  return `${"a".repeat(24)}${String(n).padStart(8, "0")}`;
}

export function ownGoogleKey(n: number): string {
  return `${"g".repeat(24)}-${String(n).padStart(6, "0")}`;
}

/** Fictional operator keys (env): the Own key plan's tests prove they are never sent. */
export const OPERATOR_ENV = {
  DEEPL_API_KEY: `${"o".repeat(8)}-${"p".repeat(4)}-${"q".repeat(12)}:fx`,
  AZURE_TRANSLATOR_KEY: `${"o".repeat(24)}00000000`,
  GOOGLE_TRANSLATE_API_KEY: `${"o".repeat(24)}-000000`,
} as const;
