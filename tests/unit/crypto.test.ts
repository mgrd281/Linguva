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
