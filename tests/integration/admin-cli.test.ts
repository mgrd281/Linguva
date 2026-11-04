/**
 * The operator tool for admin console accounts (scripts/ops/admin.ts), bundled
 * as `pnpm build:ops` does and run in a clean environment with only the owner
 * role's URL and the encryption keys; the accounts it creates sign in through
 * the console's own code.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signIn } from "../../app/.server/admin/login";
import { readSession } from "../../app/.server/admin/session";
import { base32Decode, hotp, totpStep } from "../../app/.server/admin/totp";
import { resetConfigCache } from "../../app/.server/lib/config";
import { MemoryCounters } from "../../app/.server/usage/request-limits";
import { ownerDb, resetDatabase } from "../support/db";
import { testEnv } from "../support/env";

const PASSWORD = "a long passphrase for the console";
const ORIGIN = "http://localhost:3000";
// Under node_modules, so the bundle's external packages (Prisma) resolve as from build/ops.
const dir = join(process.cwd(), "node_modules", ".cache", "linguva-tests");
const file = join(dir, `admin-cli-${process.pid}.mjs`);

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["scripts/ops/admin.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bundle.outputFiles[0]!.text);
  process.env.ADMIN_CONSOLE = "on";
  resetConfigCache();
});
afterAll(async () => {
  rmSync(file, { force: true });
  delete process.env.ADMIN_CONSOLE;
  resetConfigCache();
  await ownerDb.$disconnect();
});
beforeEach(resetDatabase);

function cli(args: string[], extra: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [file, ...args], {
    env: {
      PATH: process.env.PATH ?? "",
      MIGRATION_DATABASE_URL: testEnv.MIGRATION_DATABASE_URL!,
      TOKEN_ENCRYPTION_KEYS: testEnv.TOKEN_ENCRYPTION_KEYS!,
      ...extra,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, output: `${run.stdout}${run.stderr}` };
}

const secretOf = (stdout: string) => /Secret: ([A-Z2-7 ]+)/.exec(stdout)![1]!.replace(/ /g, "");
const login = (email: string, secret: string, now: Date, password = PASSWORD) =>
  signIn(
    new Request(`${ORIGIN}/admin/login`, { method: "POST", headers: { origin: ORIGIN } }),
    { email, password, code: hotp(base32Decode(secret)!, totpStep(now.getTime())) },
    { counters: new MemoryCounters(), now },
  );

describe("pnpm ops:admin", () => {
  it("adds an account whose password and TOTP setup work in the console, printed once and never stored in plain", async () => {
    const added = cli(["add", "--email", " Owner@Example.com ", "--role", "owner"], { ADMIN_PASSWORD: PASSWORD });
    expect(added.status, added.stderr).toBe(0);
    expect(added.stdout).toContain("Created owner@example.com (OWNER).");
    expect(added.stdout).toMatch(/otpauth:\/\/totp\/Linguva%20Admin:owner%40example\.com\?secret=[A-Z2-7]{32}&issuer=Linguva%20Admin/);
    expect(added.output).not.toContain(PASSWORD);
    const secret = secretOf(added.stdout);

    const row = await ownerDb.adminUser.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    expect(row.role).toBe("OWNER");
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.totpSecret).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(await ownerDb.auditLog.findMany({ where: { action: "admin.account.created" } })).toMatchObject([
      { actorType: "ADMIN", actorId: expect.stringMatching(/^cli:/), targetType: "AdminUser", targetId: row.id, metadata: { role: "OWNER" } },
    ]);

    expect(await login("owner@example.com", secret, new Date())).toMatchObject({ ok: true, userId: row.id });
    // The same e-mail again: refused.
    const again = cli(["add", "--email", "owner@example.com", "--role", "OWNER"], { ADMIN_PASSWORD: PASSWORD });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("An account with this e-mail exists");
  });

  it("refuses short passwords, unknown roles, bad e-mails and a missing password without a terminal", () => {
    const short = cli(["add", "--email", "a@example.com", "--role", "OWNER"], { ADMIN_PASSWORD: "short" });
    expect(short.status).toBe(1);
    expect(short.stderr).toContain("at least 12 characters");
    expect(short.output).not.toContain("short\n");
    expect(cli(["add", "--email", "a@example.com", "--role", "ROOT"], { ADMIN_PASSWORD: PASSWORD }).stderr).toContain("--role must be one of OWNER, FINANCE, SUPPORT, READONLY");
    expect(cli(["add", "--email", "not-an-email", "--role", "OWNER"], { ADMIN_PASSWORD: PASSWORD }).stderr).toContain("--email must be an e-mail address");
    expect(cli(["add", "--email", "a@example.com", "--role", "OWNER"]).stderr).toContain("Set ADMIN_PASSWORD");
    expect(cli(["add", "--email", "a@example.com", "--role", "OWNER"], { ADMIN_PASSWORD: PASSWORD, TOKEN_ENCRYPTION_KEYS: "" }).stderr).toContain("TOKEN_ENCRYPTION_KEYS");
    expect(cli(["frobnicate"]).status).toBe(1);
  });

  it("changes roles, passwords and TOTP secrets, disables and enables accounts, ending sessions where it must", async () => {
    const secret = secretOf(cli(["add", "--email", "ops@example.com", "--role", "SUPPORT"], { ADMIN_PASSWORD: PASSWORD }).stdout);
    const start = new Date();
    const signedIn = await login("ops@example.com", secret, start);
    expect(signedIn.ok).toBe(true);
    const cookie = signedIn.ok ? signedIn.cookie.split(";")[0]! : "";
    const session = (at = new Date()) => readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }), at);

    expect(cli(["set-role", "--email", "ops@example.com", "--role", "FINANCE"]).stdout).toContain("Role SUPPORT → FINANCE");
    // The session stays and has the new role at once.
    expect((await session())?.user.role).toBe("FINANCE");

    const disabled = cli(["disable", "--email", "ops@example.com"]);
    expect(disabled.stdout).toContain("Disabled; 1 session(s) ended.");
    expect(await session()).toBeNull();
    expect(await login("ops@example.com", secret, new Date(start.getTime() + 30_000))).toEqual({ ok: false, error: "INVALID" });
    expect(cli(["enable", "--email", "ops@example.com"]).status).toBe(0);
    expect((await login("ops@example.com", secret, new Date(start.getTime() + 60_000))).ok).toBe(true);

    const newPassword = "another long passphrase here";
    expect(cli(["set-password", "--email", "ops@example.com"], { ADMIN_PASSWORD: newPassword }).stdout).toContain("New password set; 1 session(s) ended.");
    expect(await login("ops@example.com", secret, new Date(start.getTime() + 90_000))).toEqual({ ok: false, error: "INVALID" });
    expect((await login("ops@example.com", secret, new Date(start.getTime() + 120_000), newPassword)).ok).toBe(true);

    const reset = cli(["reset-totp", "--email", "ops@example.com"]);
    expect(reset.stdout).toContain("New TOTP secret; the old codes no longer work and 1 session(s) ended.");
    const newSecret = secretOf(reset.stdout);
    expect(newSecret).not.toBe(secret);
    expect(await login("ops@example.com", secret, new Date(start.getTime() + 150_000), newPassword)).toEqual({ ok: false, error: "INVALID" });
    expect((await login("ops@example.com", newSecret, new Date(start.getTime() + 180_000), newPassword)).ok).toBe(true);

    const list = cli(["list"]);
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain("ops@example.com");
    expect(list.stdout).toContain("FINANCE");
    expect(list.output).not.toMatch(/scrypt\$|v1\./);

    const actions = (await ownerDb.auditLog.findMany({ where: { action: { startsWith: "admin.account." } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual([
      "admin.account.created",
      "admin.account.role_set",
      "admin.account.disabled",
      "admin.account.enabled",
      "admin.account.password_set",
      "admin.account.totp_reset",
    ]);
    expect(cli(["disable", "--email", "nobody@example.com"]).stderr).toContain("No account has this e-mail");
  });

  it("needs the owner role's database URL", () => {
    const run = spawnSync(process.execPath, [file, "list"], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 60_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("MIGRATION_DATABASE_URL (owner role) is not set");
  });
});
