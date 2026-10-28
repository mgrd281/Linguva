/**
 * The live tests' "app session" credentials (LIVE_USE_APP_SESSION=yes): the
 * offline token of exactly the configured shop is read from the database
 * named in a .env file and decrypted with that file's key.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { appSessionToken } from "../live/admin-client";
import { ownerDb, resetDatabase } from "../support/db";
import { testEnv } from "../support/env";

const app = new PrismaClient();
beforeEach(resetDatabase);
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

function envFile(keys: string) {
  const dir = mkdtempSync(join(tmpdir(), "linguva-env-"));
  const file = join(dir, ".env");
  writeFileSync(file, `DATABASE_URL=${testEnv.DATABASE_URL}\nTOKEN_ENCRYPTION_KEYS=${keys}\n`);
  return file;
}

describe("live tests with the app's own session", () => {
  it("decrypts the offline token of exactly the configured shop", async () => {
    const keys = `k1:${randomBytes(32).toString("base64")}`;
    const cipher = TokenCipher.fromKeyring(keys);
    await app.session.createMany({
      data: [
        { id: "offline_linguva-test-lab.myshopify.com", shop: "linguva-test-lab.myshopify.com", state: "", isOnline: false, accessToken: cipher.encrypt("shpat_dev_store") },
        { id: "offline_other.myshopify.com", shop: "other.myshopify.com", state: "", isOnline: false, accessToken: cipher.encrypt("shpat_other") },
        { id: "online_1", shop: "linguva-test-lab.myshopify.com", state: "", isOnline: true, accessToken: cipher.encrypt("shpat_online") },
      ],
    });
    expect(await appSessionToken("linguva-test-lab.myshopify.com", envFile(keys))).toBe("shpat_dev_store");
  });

  it("explains what's missing instead of guessing", async () => {
    const keys = `k1:${randomBytes(32).toString("base64")}`;
    await expect(appSessionToken("linguva-test-lab.myshopify.com", envFile(keys))).rejects.toThrow(/no offline session/);
    await expect(appSessionToken("x.myshopify.com", "/nonexistent/.env")).rejects.toThrow(/no \.env/);
  });
});
