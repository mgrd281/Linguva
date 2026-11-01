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
