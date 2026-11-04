/** Admin console passwords (app/.server/admin/password.ts): scrypt, constant-time, refusing malformed hashes. */
import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from "../../app/.server/admin/password";

const FORMAT = /^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
// The database CHECK on AdminUser.passwordHash (migration 20261107090000_admin_console).
const DB_CHECK = /^scrypt\$[0-9]{1,8}\$[0-9]{1,3}\$[0-9]{1,3}\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{43,}$/;

describe("admin passwords", () => {
  it("hashes with scrypt N=32768, r=8, p=3, a 16-byte salt and a 32-byte hash, in the stored format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(FORMAT);
    expect(hash).toMatch(DB_CHECK);
    expect(hash).not.toContain("correct horse");
    // A new salt each time.
    expect(await hashPassword("correct horse battery staple")).not.toBe(hash);
  });

  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("treats the same text in another Unicode form as the same password", async () => {
    const composed = "Grüße aus Köln, Tür 12";
    const hash = await hashPassword(composed);
    expect(await verifyPassword(composed.normalize("NFD"), hash)).toBe(true);
  });

  it("returns false for malformed or tampered hashes instead of throwing", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [, n, r, p, salt, digest] = hash.split("$");
    for (const stored of [
      "",
      "plaintext",
      "bcrypt$10$abc",
      hash.replace("scrypt", "SCRYPT"),
      `scrypt$${n}$${r}$${p}$${salt}`,
      `scrypt$${n}$${r}$${p}$${salt}$${digest!.slice(0, 20)}`,
      // Parameters this module never writes: too costly, not a power of two, zero.
      `scrypt$1048576$8$3$${salt}$${digest}`,
      `scrypt$30000$8$3$${salt}$${digest}`,
      `scrypt$32768$0$3$${salt}$${digest}`,
      `scrypt$32768$8$99$${salt}$${digest}`,
      `scrypt$32768$8$3$${salt}$${"A".repeat(43)}`,
    ]) {
      expect(await verifyPassword("correct horse battery staple", stored), stored).toBe(false);
    }
  });

  it("has a dummy hash in the stored format that no password matches", async () => {
    expect(DUMMY_HASH).toMatch(FORMAT);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("correct horse battery staple", DUMMY_HASH)).toBe(false);
  });

  it("takes about as long for the dummy hash as for a real one (unknown e-mails aren't faster)", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const time = async (stored: string) => {
      const started = performance.now();
      await verifyPassword("wrong password, long enough", stored);
      return performance.now() - started;
    };
    await time(hash);
    const [real, dummy] = [await time(hash), await time(DUMMY_HASH)];
    expect(dummy).toBeGreaterThan(real / 3);
    expect(dummy).toBeLessThan(real * 3);
  });

  it("asks for 12 to 256 characters, counted as characters, not bytes", () => {
    expect(passwordProblem("short")).toBe("TOO_SHORT");
    expect(passwordProblem("elevenchars")).toBe("TOO_SHORT");
    expect(passwordProblem("twelve chars")).toBeNull();
    expect(passwordProblem("ü".repeat(12))).toBeNull();
    expect(passwordProblem("😀".repeat(12))).toBeNull();
    expect(passwordProblem("x".repeat(256))).toBeNull();
    expect(passwordProblem("x".repeat(257))).toBe("TOO_LONG");
  });
});
