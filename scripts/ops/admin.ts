/**
 * Operator tool for the admin console's accounts (docs/ADMIN_CONSOLE.md,
 * docs/SECURITY_MODEL.md §5s). Runs with the owner database role
 * (MIGRATION_DATABASE_URL): the app's runtime role can't create an account,
 * change an e-mail, password, TOTP secret or role, or enable one. Needs the
 * console's TOKEN_ENCRYPTION_KEYS too (TOTP secrets are stored encrypted).
 *
 *   pnpm ops:admin add          --email owner@example.com --role OWNER
 *   pnpm ops:admin set-password --email owner@example.com
 *   pnpm ops:admin reset-totp   --email owner@example.com
 *   pnpm ops:admin set-role     --email owner@example.com --role READONLY
 *   pnpm ops:admin disable      --email owner@example.com
 *   pnpm ops:admin enable       --email owner@example.com
 *   pnpm ops:admin list
 *
 * Roles: OWNER, FINANCE, SUPPORT, READONLY. The password comes from
 * ADMIN_PASSWORD or, better, a prompt that doesn't echo; it is never printed.
 * `add` and `reset-totp` print the authenticator setup once (otpauth URI and
 * secret): scan or type it into the authenticator app, then clear the
 * terminal. A new password, a new TOTP secret and `disable` end the
 * account's sessions. Every change is audited (actor "cli:<os user>").
 */
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { PrismaClient, type AdminRole, type Prisma } from "@prisma/client";
import { hashPassword, passwordProblem, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../app/.server/admin/password";
import { generateTotpSecret, sealTotpSecret, totpUri } from "../../app/.server/admin/totp";
import { TokenCipher } from "../../app/.server/lib/crypto";

const ROLES: readonly AdminRole[] = ["OWNER", "FINANCE", "SUPPORT", "READONLY"];
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const IDLE_MS = 30 * 60 * 1000;

class AdminToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminToolError";
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: "string" }, role: { type: "string" } },
});

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL (owner role) is not set");
  process.exit(1);
}
const owner = new PrismaClient({ datasources: { db: { url } } });

function operator(): string {
  try {
    return `cli:${userInfo().username}`.slice(0, 100);
  } catch {
    return "cli:unknown";
  }
}

function email(): string {
  const value = (values.email ?? "").trim().toLowerCase();
  if (!value) throw new AdminToolError("--email is required");
  if (value.length > 254 || !EMAIL.test(value)) throw new AdminToolError("--email must be an e-mail address");
  return value;
}

function role(): AdminRole {
  const value = (values.role ?? "").trim().toUpperCase();
  if (!(ROLES as readonly string[]).includes(value)) throw new AdminToolError(`--role must be one of ${ROLES.join(", ")}`);
  return value as AdminRole;
}

function cipher(): TokenCipher {
  const keyring = process.env.TOKEN_ENCRYPTION_KEYS;
  if (!keyring) throw new AdminToolError("TOKEN_ENCRYPTION_KEYS (the console's keys) is not set");
  try {
    return TokenCipher.fromKeyring(keyring);
  } catch {
    throw new AdminToolError("TOKEN_ENCRYPTION_KEYS is not a valid keyring (kid:base64key entries with 32-byte keys)");
  }
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.reject(new AdminToolError("Set ADMIN_PASSWORD, or run this in a terminal to be asked for the password"));
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new AdminToolError("Cancelled"));
          return;
        }
        value = char === "\u007f" || char === "\b" ? [...value].slice(0, -1).join("") : value + char;
      }
    };
    stdin.on("data", onData);
  });
}

async function newPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  const password = fromEnv ?? (await promptHidden(`New password (${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters): `));
  const problem = passwordProblem(password);
  if (problem === "TOO_SHORT") throw new AdminToolError(`The password needs at least ${PASSWORD_MIN_LENGTH} characters (a passphrase of several words is best)`);
  if (problem === "TOO_LONG") throw new AdminToolError(`The password may have at most ${PASSWORD_MAX_LENGTH} characters`);
  if (fromEnv === undefined && (await promptHidden("Repeat it: ")) !== password) throw new AdminToolError("The passwords differ");
  return password;
}

async function account(address: string) {
  const user = await owner.adminUser.findUnique({ where: { email: address }, select: { id: true, role: true, disabledAt: true } });
  if (!user) throw new AdminToolError("No account has this e-mail (pnpm ops:admin list)");
  return user;
}

async function audit(action: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  await owner.auditLog.createMany({ data: [{ actorType: "ADMIN", actorId: operator(), action, targetType: "AdminUser", targetId, metadata }] });
}

/** Ends every session of the account (it must sign in again). */
async function endSessions(adminUserId: string): Promise<number> {
  const ended = await owner.adminSession.updateMany({ where: { adminUserId, revokedAt: null }, data: { revokedAt: new Date() } });
  return ended.count;
}

function printTotpSetup(secret: string, address: string) {
  console.log("Add the account to an authenticator app now (shown only this once):");
  console.log(`  ${totpUri(secret, address)}`);
  console.log(`  Secret: ${secret.replace(/(.{4})/g, "$1 ").trim()}`);
}

async function main() {
  const command = positionals[0];
  if (command === "add") {
    const address = email();
    const accountRole = role();
    const keys = cipher();
    if (await owner.adminUser.findUnique({ where: { email: address }, select: { id: true } })) throw new AdminToolError("An account with this e-mail exists");
    const password = await newPassword();
    // The id is chosen here: the TOTP secret's envelope is bound to it.
    const id = randomUUID();
    const secret = generateTotpSecret();
    await owner.adminUser.create({
      data: { id, email: address, passwordHash: await hashPassword(password), totpSecret: sealTotpSecret(keys, id, secret), role: accountRole },
    });
    await audit("admin.account.created", id, { role: accountRole });
    console.log(`Created ${address} (${accountRole}).`);
    printTotpSetup(secret, address);
  } else if (command === "set-password") {
    const user = await account(email());
    const password = await newPassword();
    await owner.adminUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    const ended = await endSessions(user.id);
    await audit("admin.account.password_set", user.id, { sessionsEnded: ended });
    console.log(`New password set; ${ended} session(s) ended.`);
  } else if (command === "reset-totp") {
    const address = email();
    const keys = cipher();
    const user = await account(address);
    const secret = generateTotpSecret();
    await owner.adminUser.update({ where: { id: user.id }, data: { totpSecret: sealTotpSecret(keys, user.id, secret) } });
    const ended = await endSessions(user.id);
    await audit("admin.account.totp_reset", user.id, { sessionsEnded: ended });
    console.log(`New TOTP secret; the old codes no longer work and ${ended} session(s) ended.`);
    printTotpSetup(secret, address);
  } else if (command === "set-role") {
    const user = await account(email());
    const accountRole = role();
    await owner.adminUser.update({ where: { id: user.id }, data: { role: accountRole } });
    await audit("admin.account.role_set", user.id, { from: user.role, to: accountRole });
    console.log(`Role ${user.role} → ${accountRole} (from the next request on).`);
  } else if (command === "disable") {
    const user = await account(email());
    await owner.adminUser.update({ where: { id: user.id }, data: { disabledAt: user.disabledAt ?? new Date() } });
    const ended = await endSessions(user.id);
    await audit("admin.account.disabled", user.id, { sessionsEnded: ended });
    console.log(`Disabled; ${ended} session(s) ended.`);
  } else if (command === "enable") {
    const user = await account(email());
    await owner.adminUser.update({ where: { id: user.id }, data: { disabledAt: null, failedLogins: 0, lockedUntil: null } });
    await audit("admin.account.enabled", user.id);
    console.log("Enabled (and unlocked).");
  } else if (command === "list") {
    const now = new Date();
    const users = await owner.adminUser.findMany({
      orderBy: { email: "asc" },
      select: {
        email: true,
        role: true,
        disabledAt: true,
        lockedUntil: true,
        failedLogins: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - IDLE_MS) } } } } },
      },
    });
    if (users.length === 0) console.log("No accounts yet: pnpm ops:admin add --email … --role OWNER");
    else
      console.table(
        users.map((u) => ({
          email: u.email,
          role: u.role,
          state: u.disabledAt ? "disabled" : u.lockedUntil && u.lockedUntil > now ? "locked" : "active",
          "failed attempts": u.failedLogins,
          "last sign-in": u.lastLoginAt?.toISOString() ?? "never",
          "active sessions": u._count.sessions,
          created: u.createdAt.toISOString().slice(0, 10),
        })),
      );
  } else {
    console.error("Usage: add | set-password | reset-totp | set-role | disable | enable | list (see the header of scripts/ops/admin.ts)");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    // Only the tool's own messages: a database error can repeat the arguments of the failed call (a hash, an envelope).
    const err = error as { name?: unknown; code?: unknown };
    console.error(
      error instanceof AdminToolError
        ? error.message
        : `Failed: ${typeof err?.name === "string" ? err.name : "error"}${typeof err?.code === "string" ? ` (${err.code})` : ""}`,
    );
    process.exitCode = 1;
  })
  .finally(() => owner.$disconnect());
