/**
 * Time-based one-time codes for the admin console (RFC 6238 over RFC 4226:
 * HMAC-SHA-1, 6 digits, 30-second steps, one step of clock drift either
 * way), as every authenticator app reads them from an otpauth:// URI. The
 * secret is stored only as a TokenCipher envelope bound to its account
 * (sealTotpSecret); each accepted step is remembered by the caller, so a
 * code works once (docs/SECURITY_MODEL.md §5s).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TokenCipher } from "../lib/crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Steps accepted before and after the current one (clock drift between phone and server). */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, upper case, without padding (what authenticator apps expect). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 as people copy it: any case, spaces, hyphens and padding ignored. Null when it isn't base32. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]*$/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, RFC 4226's recommendation) in base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The otpauth:// URI an authenticator app scans or imports. */
export function totpUri(secret: string, email: string, issuer = "Linguva Admin"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}

/** RFC 4226 HOTP: the code for one counter value, with leading zeros. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

/** The 30-second step a moment falls in. */
export function totpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

/** Arabic-Indic and Eastern Arabic-Indic digits as 0-9: what an Arabic or Persian keyboard types into the code field. */
function westernDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/**
 * The step whose code `code` is (current step ± TOTP_WINDOW), or null. Every
 * candidate is compared in constant time, all of them each time, so the
 * answer's timing says nothing about which step or digit differed. The
 * caller accepts the code only if the step is later than the last one it
 * accepted (replay protection).
 */
export function totpStepMatching(secret: string, code: string, now: number = Date.now()): number | null {
  const key = base32Decode(secret);
  const given = westernDigits(code.replace(/\s/g, ""));
  if (!key || key.length === 0 || !/^\d{6}$/.test(given)) return null;
  const givenBytes = Buffer.from(given);
  const current = totpStep(now);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (step < 0) continue;
    const equal = timingSafeEqual(Buffer.from(hotp(key, step)), givenBytes);
    // The latest matching step: a replayed code can never move the remembered step backwards.
    if (equal) matched = step;
  }
  return matched;
}

/** AAD context: a secret copied to another account's row doesn't decrypt. */
export function totpSecretContext(adminUserId: string): string {
  return ["admin-totp", adminUserId].join("\u0000");
}

/** The secret as stored in AdminUser.totpSecret: encrypted with the active key of TOKEN_ENCRYPTION_KEYS, bound to the account. */
export function sealTotpSecret(cipher: TokenCipher, adminUserId: string, secret: string): string {
  return cipher.encrypt(secret, totpSecretContext(adminUserId));
}

/** The secret of a stored envelope; throws DecryptionError when it belongs to another account or key. */
export function openTotpSecret(cipher: TokenCipher, adminUserId: string, envelope: string): string {
  return cipher.decrypt(envelope, totpSecretContext(adminUserId));
}
