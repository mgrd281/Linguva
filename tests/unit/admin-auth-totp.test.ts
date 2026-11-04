/** TOTP for the admin console (app/.server/admin/totp.ts) against the RFC 4226 and RFC 6238 test vectors. */
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  openTotpSecret,
  sealTotpSecret,
  totpStep,
  totpStepMatching,
  totpUri,
} from "../../app/.server/admin/totp";
import { TokenCipher } from "../../app/.server/lib/crypto";

// The RFCs' SHA-1 key: the ASCII string "12345678901234567890".
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_SECRET = base32Encode(RFC_KEY);

describe("base32 (RFC 4648)", () => {
  it("encodes and decodes the RFC test vectors, without padding", () => {
    const vectors: Array<[string, string]> = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded)?.toString()).toBe(plain);
    }
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("reads a secret as people copy it, and refuses what isn't base32", () => {
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq====")).toEqual(RFC_KEY);
    expect(base32Decode("GEZDGNB1")).toBeNull();
    expect(base32Decode("not base32!")).toBeNull();
  });
});

describe("HOTP (RFC 4226 appendix D)", () => {
  it("matches every test vector", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expect(expected.map((_, counter) => hotp(RFC_KEY, counter))).toEqual(expected);
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  // The RFC lists 8 digits; a 6-digit code is the last six of them (the same number modulo 10^6).
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it("matches every test vector with 8 digits, and their last six digits with 6", () => {
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_KEY, totpStep(seconds * 1000), 8)).toBe(code);
      expect(totpStepMatching(RFC_SECRET, code.slice(2), seconds * 1000)).toBe(totpStep(seconds * 1000));
    }
  });

  it("accepts one step of clock drift either way, and no more", () => {
    const at = 1234567890 * 1000;
    const step = totpStep(at);
    const code = hotp(RFC_KEY, step);
    expect(totpStepMatching(RFC_SECRET, code, at - 30_000)).toBe(step);
    expect(totpStepMatching(RFC_SECRET, code, at + 30_000)).toBe(step);
    expect(totpStepMatching(RFC_SECRET, code, at - 60_000)).toBeNull();
    expect(totpStepMatching(RFC_SECRET, code, at + 60_000)).toBeNull();
  });

  it("refuses anything that isn't six digits for this secret", () => {
    const at = 1111111111 * 1000;
    const code = hotp(RFC_KEY, totpStep(at));
    expect(totpStepMatching(RFC_SECRET, ` ${code.slice(0, 3)} ${code.slice(3)} `, at)).toBe(totpStep(at));
    // An Arabic keyboard's digits are the same code (the console has an Arabic interface).
    expect(code).toBe("050471");
    expect(totpStepMatching(RFC_SECRET, "٠٥٠٤٧١", at)).toBe(totpStep(at));
    expect(totpStepMatching(RFC_SECRET, "۰۵۰۴۷۱", at)).toBe(totpStep(at));
    for (const wrong of ["", "12345", "1234567", "abcdef", `${code}0`, "٠٥٠٤٧٢", "０５０４７１", String((Number(code) + 1) % 1_000_000).padStart(6, "0")]) {
      expect(totpStepMatching(RFC_SECRET, wrong, at), wrong).toBeNull();
    }
    expect(totpStepMatching("not base32!", code, at)).toBeNull();
    expect(totpStepMatching("", code, at)).toBeNull();
  });
});

describe("secrets", () => {
  it("are 160 random bits in base32", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("are offered as an otpauth:// URI with issuer and account", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "owner+admin@example.com");
    expect(uri).toBe(
      "otpauth://totp/Linguva%20Admin:owner%2Badmin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Linguva%20Admin&algorithm=SHA1&digits=6&period=30",
    );
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("issuer")).toBe("Linguva Admin");
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("are stored only encrypted, bound to their account", () => {
    const cipher = TokenCipher.fromKeyring(`k1:${Buffer.alloc(32, 3).toString("base64")}`);
    const secret = generateTotpSecret();
    const envelope = sealTotpSecret(cipher, "11111111-1111-4111-8111-111111111111", secret);
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(secret);
    expect(openTotpSecret(cipher, "11111111-1111-4111-8111-111111111111", envelope)).toBe(secret);
    // Copied to another account's row, it doesn't open.
    expect(() => openTotpSecret(cipher, "22222222-2222-4222-8222-222222222222", envelope)).toThrow(/authentication failed/);
  });
});
