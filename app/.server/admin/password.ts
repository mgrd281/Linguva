/**
 * Admin console passwords: scrypt (node:crypto, no dependency), stored as
 * `scrypt$<N>$<r>$<p>$<salt>$<hash>` with base64url salt (16 bytes) and hash
 * (32 bytes). The parameters travel with the hash, so they can be raised
 * later without breaking existing accounts. docs/SECURITY_MODEL.md §5s.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 32768;
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
// 128 * N * r = 32 MiB for these parameters; Node refuses anything above maxmem.
const MAX_MEMORY = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** A valid hash of no password anyone knows: unknown e-mails are verified against it, so they take as long as real ones. */
export const DUMMY_HASH = "scrypt$32768$8$3$iOKT4Xk6-iHlBTZvWK_2JA$oGocm5uuDrO8BSDOthe3pnK2aoORRDDpoWy2w-qqtzM";

const FORMAT = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{43,})$/;

function derive(plain: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFC: the same password typed on another keyboard or system gives the same bytes.
    scrypt(plain.normalize("NFC"), salt, length, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(plain, salt, { N, r: R, p: P }, HASH_BYTES);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/**
 * Whether `plain` is the password of `stored`, compared in constant time.
 * False for anything malformed, including parameters outside what this
 * module would write (a tampered row can't make a sign-in slow or crash it).
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const match = FORMAT.exec(stored);
  if (!match) return false;
  const [n, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (n < 2 || n > 2 ** 17 || (n & (n - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 8 || 128 * n * r > MAX_MEMORY) return false;
  const salt = Buffer.from(match[4]!, "base64url");
  const expected = Buffer.from(match[5]!, "base64url");
  if (salt.length < SALT_BYTES || expected.length < HASH_BYTES) return false;
  try {
    const actual = await derive(plain, salt, { N: n, r, p }, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Why a new password can't be used, or null. Length only: a long passphrase beats character rules. */
export function passwordProblem(plain: string): "TOO_SHORT" | "TOO_LONG" | null {
  const length = [...plain.normalize("NFC")].length;
  if (length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (length > PASSWORD_MAX_LENGTH) return "TOO_LONG";
  return null;
}
