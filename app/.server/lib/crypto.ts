import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;

export interface EncryptionKey {
  id: string;
  key: Buffer;
}

/**
 * Why a value didn't decrypt, as a code callers decide on (never the message text):
 * "format" = not an envelope, "unknown-kid" = a key id this keyring doesn't have,
 * "auth" = the key id is known but authentication failed (tampered, or another context).
 */
export type DecryptionCause = "format" | "unknown-kid" | "auth";

export class DecryptionError extends Error {
  constructor(
    reason: string,
    readonly cause: DecryptionCause,
  ) {
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

/** Where a value belongs, bound as AAD: no context (sessions) keeps exactly `v1.<kid>`. */
function aad(keyId: string, context: string | undefined): Buffer {
  return Buffer.from(context === undefined ? `${VERSION}.${keyId}` : `${VERSION}.${keyId}\u0000${context}`);
}

/**
 * AES-256-GCM envelope: `v1.<kid>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * The key id is bound as additional authenticated data, so a ciphertext can't
 * be replayed under a different key id. An optional context (for example the
 * shop and engine a merchant key belongs to) is bound the same way: a value
 * copied to another context doesn't decrypt. Without a context the AAD is
 * exactly what it always was, so session envelopes are unchanged.
 */
export class TokenCipher {
  private readonly active: EncryptionKey;
  private readonly byId: Map<string, EncryptionKey>;
  /** HMAC keys for fingerprint(), derived from the active key once per purpose. */
  private readonly fingerprintKeys = new Map<string, Buffer>();

  constructor(keys: EncryptionKey[]) {
    if (keys.length === 0) throw new Error("No encryption keys configured");
    this.active = keys[0]!;
    this.byId = new Map(keys.map((k) => [k.id, k]));
  }

  static fromKeyring(raw: string): TokenCipher {
    return new TokenCipher(parseKeyring(raw));
  }

  encrypt(plaintext: string, context?: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.active.key, iv);
    cipher.setAAD(aad(this.active.id, context));
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

  /** `context` must be the one the value was encrypted with (none for none); otherwise "authentication failed". */
  decrypt(envelope: string, context?: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new DecryptionError("unrecognised format", "format");
    }
    const [, keyId, iv, tag, ciphertext] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    const key = this.byId.get(keyId);
    if (!key) throw new DecryptionError(`unknown key id "${keyId}"`, "unknown-kid");
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        key.key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(aad(keyId, context));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new DecryptionError("authentication failed", "auth");
    }
  }

  /** The key id an envelope names, or null when it isn't an envelope. Reads nothing else. */
  keyIdOf(envelope: string): string | null {
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION || !parts[1]) return null;
    return parts[1];
  }

  /** True when this keyring has the key id (a value under it can be decrypted here). */
  knows(keyId: string): boolean {
    return this.byId.has(keyId);
  }

  /** The id of the key new values are encrypted with. */
  activeKeyId(): string {
    return this.active.id;
  }

  /**
   * A stable, non-reversible id for a secret (process state keys, caches): HMAC-SHA256 with a key
   * derived by HKDF-SHA256 from the active keyring key (info "linguva/fingerprint/v1/<purpose>"),
   * base64url, first 22 characters (132 bits). Never stored; changes when the active key changes.
   */
  fingerprint(purpose: string, material: string): string {
    let key = this.fingerprintKeys.get(purpose);
    if (!key) {
      key = Buffer.from(hkdfSync("sha256", this.active.key, Buffer.alloc(0), `linguva/fingerprint/v1/${purpose}`, 32));
      this.fingerprintKeys.set(purpose, key);
    }
    return createHmac("sha256", key).update(material, "utf8").digest("base64url").slice(0, 22);
  }

  /** True when the value was encrypted with a key other than the active one. */
  needsRotation(envelope: string): boolean {
    return envelope.split(".")[1] !== this.active.id;
  }
}
