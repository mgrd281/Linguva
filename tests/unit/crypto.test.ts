import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DecryptionError,
  TokenCipher,
  parseKeyring,
} from "../../app/.server/lib/crypto";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");

describe("TokenCipher", () => {
  const cipher = TokenCipher.fromKeyring(`k1:${key(1)}`);

  it("round-trips a token", () => {
    const token = "shpat_example_token_value";
    const envelope = cipher.encrypt(token);
    expect(envelope).not.toContain(token);
    expect(envelope.startsWith("v1.k1.")).toBe(true);
    expect(cipher.decrypt(envelope)).toBe(token);
  });

  it("uses a fresh IV for every encryption", () => {
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const parts = cipher.encrypt("secret").split(".");
    const ct = Buffer.from(parts[4]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString("base64url");
    expect(() => cipher.decrypt(parts.join("."))).toThrow(DecryptionError);
  });

  it("rejects a ciphertext relabelled with another key id", () => {
    const rotated = TokenCipher.fromKeyring(`k2:${key(2)},k1:${key(1)}`);
    const envelope = rotated.encrypt("secret").replace("v1.k2.", "v1.k1.");
    expect(() => rotated.decrypt(envelope)).toThrow(DecryptionError);
  });

  it("rejects plaintext and unknown formats", () => {
    expect(() => cipher.decrypt("shpat_plaintext")).toThrow(DecryptionError);
    expect(() => cipher.decrypt("v1.unknown.a.b.c")).toThrow(/unknown key id/);
  });

  it("decrypts old values after key rotation and flags them", () => {
    const old = cipher.encrypt("legacy");
    const rotated = TokenCipher.fromKeyring(`k2:${key(2)},k1:${key(1)}`);
    expect(rotated.decrypt(old)).toBe("legacy");
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt("new"))).toBe(false);
  });
});

describe("parseKeyring", () => {
  it("rejects short keys, duplicates and empty input", () => {
    expect(() => parseKeyring(`k1:${Buffer.alloc(16).toString("base64")}`)).toThrow(
      /32 bytes/,
    );
    expect(() => parseKeyring(`k1:${key(1)},k1:${key(2)}`)).toThrow(/Duplicate/);
    expect(() => parseKeyring("")).toThrow(/No encryption keys/);
    expect(() => parseKeyring("nokeyid")).toThrow(/Malformed/);
  });
});

describe("TokenCipher context (merchant engine keys)", () => {
  const cipher = TokenCipher.fromKeyring(`k1:${key(1)}`);
  const context = (shopId: string, engine = "deepl", location = "eu", region = "") => ["engine-credential", shopId, engine, location, region].join("\u0000");
  const plaintext = JSON.stringify({ v: 1, apiKey: "mock-deepl-key" });

  it("round-trips a value bound to its context, in the same envelope format", () => {
    const envelope = cipher.encrypt(plaintext, context("shop-a"));
    expect(envelope).toMatch(/^v1\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain("mock-deepl-key");
    expect(cipher.decrypt(envelope, context("shop-a"))).toBe(plaintext);
  });

  it("refuses a context envelope without its context, and a session envelope with one", () => {
    const bound = cipher.encrypt(plaintext, context("shop-a"));
    expect(() => cipher.decrypt(bound)).toThrow(DecryptionError);
    const session = cipher.encrypt("session-value");
    expect(() => cipher.decrypt(session, context("shop-a"))).toThrow(/authentication failed/);
    // An empty context is a context too.
    expect(() => cipher.decrypt(session, "")).toThrow(DecryptionError);
    expect(cipher.decrypt(session)).toBe("session-value");
  });

  it("refuses a value copied to another shop, engine, data location or region", () => {
    const envelope = cipher.encrypt(plaintext, context("shop-a", "azure", "eu", "westeurope"));
    for (const other of [
      context("shop-b", "azure", "eu", "westeurope"),
      context("shop-a", "google", "eu", "westeurope"),
      context("shop-a", "azure", "global", "westeurope"),
      context("shop-a", "azure", "eu", "northeurope"),
      context("shop-a", "azure", "eu"),
    ]) {
      expect(() => cipher.decrypt(envelope, other)).toThrow(DecryptionError);
    }
    expect(cipher.decrypt(envelope, context("shop-a", "azure", "eu", "westeurope"))).toBe(plaintext);
  });

  it("keeps session envelopes exactly as before: AAD v1.<kid> without a context", () => {
    // A ciphertext made by hand with the old AAD rule decrypts unchanged.
    const iv = Buffer.alloc(12, 9);
    const raw = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), iv);
    raw.setAAD(Buffer.from("v1.k1"));
    const ct = Buffer.concat([raw.update("legacy-session", "utf8"), raw.final()]);
    const envelope = ["v1", "k1", iv.toString("base64url"), raw.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    expect(cipher.decrypt(envelope)).toBe("legacy-session");
  });
});

describe("DecryptionError cause", () => {
  const cipher = TokenCipher.fromKeyring(`k1:${key(1)}`);

  it("names format, unknown key id and authentication failure as codes, with the messages unchanged", () => {
    const failure = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error as DecryptionError;
      }
      throw new Error("expected a failure");
    };
    const format = failure(() => cipher.decrypt("not-an-envelope"));
    expect(format).toBeInstanceOf(DecryptionError);
    expect(format.cause).toBe("format");
    expect(format.message).toBe("Unable to decrypt value: unrecognised format");
    const unknown = failure(() => cipher.decrypt("v1.gone.a.b.c"));
    expect(unknown.cause).toBe("unknown-kid");
    expect(unknown.message).toBe('Unable to decrypt value: unknown key id "gone"');
    const parts = cipher.encrypt("secret").split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    parts[3] = tag.toString("base64url");
    const auth = failure(() => cipher.decrypt(parts.join(".")));
    expect(auth.cause).toBe("auth");
    expect(auth.message).toBe("Unable to decrypt value: authentication failed");
    expect(failure(() => cipher.decrypt(cipher.encrypt("x", "a"), "b")).cause).toBe("auth");
  });
});

describe("TokenCipher key ids", () => {
  it("reads an envelope's key id without decrypting, and knows which ids it has", () => {
    const rotated = TokenCipher.fromKeyring(`k2:${key(2)},k1:${key(1)}`);
    expect(rotated.activeKeyId()).toBe("k2");
    expect(rotated.keyIdOf(rotated.encrypt("x"))).toBe("k2");
    expect(rotated.keyIdOf(TokenCipher.fromKeyring(`k9:${key(9)}`).encrypt("x", "ctx"))).toBe("k9");
    for (const malformed of ["", "plaintext", "v1.k1.a.b", "v2.k1.a.b.c", "v1..a.b.c", "v1.k1.a.b.c.d"]) {
      expect(rotated.keyIdOf(malformed), malformed).toBeNull();
    }
    expect(rotated.knows("k1")).toBe(true);
    expect(rotated.knows("k2")).toBe(true);
    expect(rotated.knows("k9")).toBe(false);
    expect(rotated.knows("")).toBe(false);
  });
});

describe("TokenCipher fingerprint", () => {
  const cipher = TokenCipher.fromKeyring(`k1:${key(1)}`);
  const material = `deepl\u0000${"a".repeat(36)}:fx`;

  it("is deterministic, 22 characters of base64url, and never contains the material", () => {
    const first = cipher.fingerprint("engine-credential", material);
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(cipher.fingerprint("engine-credential", material)).toBe(first);
    // Another instance with the same keyring derives the same value.
    expect(TokenCipher.fromKeyring(`k1:${key(1)}`).fingerprint("engine-credential", material)).toBe(first);
    expect(first).not.toContain("aaaa");
    expect(material).not.toContain(first);
  });

  it("differs by purpose, by material and with the active key", () => {
    const base = cipher.fingerprint("engine-credential", material);
    expect(cipher.fingerprint("other-purpose", material)).not.toBe(base);
    expect(cipher.fingerprint("engine-credential", `${material}x`)).not.toBe(base);
    expect(TokenCipher.fromKeyring(`k2:${key(2)},k1:${key(1)}`).fingerprint("engine-credential", material)).not.toBe(base);
    // Only the active key counts: an extra older key doesn't change it.
    expect(TokenCipher.fromKeyring(`k1:${key(1)},k0:${key(5)}`).fingerprint("engine-credential", material)).toBe(base);
  });
});
