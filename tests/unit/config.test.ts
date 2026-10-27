import { describe, expect, it } from "vitest";
import { getConfig } from "../../app/.server/lib/config";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
};

describe("getConfig", () => {
  it("accepts a valid environment and applies defaults", () => {
    const config = getConfig({ ...valid } as NodeJS.ProcessEnv);
    expect(config.NODE_ENV).toBe("development");
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("rejects a weak encryption key without echoing its value", () => {
    const weak = "k1:c2hvcnQ=";
    let message = "";
    try {
      getConfig({ ...valid, TOKEN_ENCRYPTION_KEYS: weak } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/TOKEN_ENCRYPTION_KEYS/);
    expect(message).not.toContain(weak);
  });

  it("requires DATABASE_URL", () => {
    expect(() =>
      getConfig({
        TOKEN_ENCRYPTION_KEYS: valid.TOKEN_ENCRYPTION_KEYS,
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
