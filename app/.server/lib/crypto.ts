import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;

export interface EncryptionKey {
  id: string;
  key: Buffer;
}

export class DecryptionError extends Error {
  constructor(reason: string) {
    super(`Unable to decrypt value: ${reason}`);
    this.name = "DecryptionError";
  }
}

/** Parses `kid:base64key,kid2:base64key`. The first key is the active one. */
export function parseKeyring(raw: string): EncryptionKey[] {
  const keys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) throw new Error("Malformed encryption key entry");
      const id = entry.slice(0, separator);
      const key = Buffer.from(entry.slice(separator + 1), "base64");
      if (key.length !== 32) {
        throw new Error(`Encryption key "${id}" must be 32 bytes`);
      }
      return { id, key };
    });
  if (keys.length === 0) throw new Error("No encryption keys configured");
  if (new Set(keys.map((k) => k.id)).size !== keys.length) {
    throw new Error("Duplicate encryption key ids");
  }
  return keys;
}

/**
 * AES-256-GCM envelope: `v1.<kid>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * The key id is bound as additional authenticated data, so a ciphertext can't
 * be replayed under a different key id.
 */
export class TokenCipher {
  private readonly active: EncryptionKey;
  private readonly byId: Map<string, EncryptionKey>;

  constructor(keys: EncryptionKey[]) {
    if (keys.length === 0) throw new Error("No encryption keys configured");
    this.active = keys[0]!;
    this.byId = new Map(keys.map((k) => [k.id, k]));
  }

  static fromKeyring(raw: string): TokenCipher {
    return new TokenCipher(parseKeyring(raw));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.active.key, iv);
    cipher.setAAD(Buffer.from(`${VERSION}.${this.active.id}`));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      VERSION,
      this.active.id,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new DecryptionError("unrecognised format");
    }
    const [, keyId, iv, tag, ciphertext] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    const key = this.byId.get(keyId);
    if (!key) throw new DecryptionError(`unknown key id "${keyId}"`);
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        key.key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(Buffer.from(`${VERSION}.${keyId}`));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new DecryptionError("authentication failed");
    }
  }

  /** True when the value was encrypted with a key other than the active one. */
  needsRotation(envelope: string): boolean {
    return envelope.split(".")[1] !== this.active.id;
  }
}
