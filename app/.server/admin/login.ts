/**
 * Signing in to the admin console: e-mail, password and a TOTP code in one
 * form, one generic answer whatever was wrong. Per client at most 20
 * attempts in 15 minutes; per account 5 wrong attempts in a row lock it for
 * 15 minutes (unknown e-mails behave the same, so the answers don't tell
 * which accounts exist); each code works once. Every attempt is audited
 * without the e-mail or password (docs/SECURITY_MODEL.md §5s).
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { ensureDatabasePosture } from "../lib/db-guard";
import { createRedis, keyPrefix } from "../queue/redis";
import { MemoryCounters, RedisCounters, type Counters } from "../usage/request-limits";
import { accountTotpSecret, adminConsoleAvailable, claimTotpStep, LOCK_MINUTES, MAX_FAILED_LOGINS, noteFailedLogin, originAllowed } from "./auth";
import { DUMMY_HASH, PASSWORD_MAX_LENGTH, verifyPassword } from "./password";
import { clearCookie, createSession, readSession, revokeSession, sessionToken, tokenHash } from "./session";
import { totpStepMatching } from "./totp";

export type SignInError = "INVALID" | "LOCKED" | "RATE_LIMITED";
export type SignInResult = { ok: true; cookie: string; userId: string } | { ok: false; error: SignInError };

/** Sign-in attempts per client address and window, whatever their outcome. */
export const LOGIN_ATTEMPTS_PER_CLIENT = 20;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
/** Sign-ins are kept this long after they ended, for the console's list of recent sign-ins; older ones are deleted at the next sign-in. */
export const SESSION_HISTORY_DAYS = 30;

const COUNTER_TTL_SECONDS = 24 * 60 * 60;

/** Why an attempt failed, as audited (never shown: the page says only INVALID, LOCKED or RATE_LIMITED). */
type FailureReason = "unknown_account" | "disabled" | "locked" | "wrong_password" | "wrong_code" | "reused_code" | "rate_limited";

export interface SignInDeps {
  client?: PrismaClient;
  counters?: Counters;
  config?: AppConfig;
  now?: Date;
}

let sharedCounters: Counters | undefined;

/** Redis when configured (all instances share the limits; required in production), else this process's memory. */
function loginCounters(config: AppConfig): Counters {
  sharedCounters ??= config.REDIS_URL ? new RedisCounters(createRedis(config.REDIS_URL)) : new MemoryCounters();
  return sharedCounters;
}

/** Hashed, so Redis keys carry no addresses or e-mails. */
const keyPart = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * The client, for the per-client limit: the right-most X-Forwarded-For
 * entry, which Railway's proxy appends (entries left of it come from the
 * client and can be anything), else "local".
 */
export function clientAddress(request: Request): string {
  const last = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return last && last.length <= 64 ? last : "local";
}

type AuditRow = Omit<Prisma.AuditLogCreateManyInput, "actorType">;

async function audit(client: PrismaClient, row: AuditRow): Promise<void> {
  // createMany: the runtime role may insert audit rows but not read them back (no RETURNING).
  await client.auditLog.createMany({ data: [{ actorType: "ADMIN", ...row }] });
}

const failed = (client: PrismaClient, actorId: string | null, reason: FailureReason) =>
  audit(client, { actorId, action: "admin.sign_in_failed", targetType: actorId ? "AdminUser" : null, targetId: actorId, metadata: { reason } });

/**
 * Checks e-mail, password and code, and on success starts a session
 * (`cookie` is its Set-Cookie). Throws 404 when the console isn't available
 * here and 403 for a POST from another origin.
 */
export async function signIn(
  request: Request,
  input: { email: string; password: string; code: string },
  deps: SignInDeps = {},
): Promise<SignInResult> {
  const config = deps.config ?? getConfig();
  if (!adminConsoleAvailable(request, config)) throw new Response("Not Found", { status: 404 });
  if (!originAllowed(request)) throw new Response("Forbidden", { status: 403 });
  const client = deps.client ?? defaultClient;
  if (!deps.client) await ensureDatabasePosture();
  const counters = deps.counters ?? loginCounters(config);
  const now = deps.now ?? new Date();
  const prefix = keyPrefix(config.NODE_ENV);

  const attempts = await counters.incr(`${prefix}:admin-login:${keyPart(clientAddress(request))}`, LOGIN_WINDOW_SECONDS);
  if (attempts > LOGIN_ATTEMPTS_PER_CLIENT) {
    // One audit row per window, not one per refused attempt.
    if (attempts === LOGIN_ATTEMPTS_PER_CLIENT + 1) await failed(client, null, "rate_limited");
    return { ok: false, error: "RATE_LIMITED" };
  }

  const email = input.email.trim().toLowerCase();
  const password = input.password.length <= PASSWORD_MAX_LENGTH * 4 ? input.password : "";
  const user =
    email && email.length <= 254
      ? await client.adminUser.findUnique({
          where: { email },
          select: { id: true, passwordHash: true, totpSecret: true, disabledAt: true, lockedUntil: true, lastTotpStep: true },
        })
      : null;

  if (!user || user.disabledAt) {
    // As long as a real check, and the same lock after the same number of attempts.
    await verifyPassword(password, DUMMY_HASH);
    const account = keyPart(email);
    if ((await counters.get(`${prefix}:admin-login-lock:${account}`)) > 0) {
      await failed(client, user?.id ?? null, "locked");
      return { ok: false, error: "LOCKED" };
    }
    const fails = await counters.incr(`${prefix}:admin-login-fails:${account}`, COUNTER_TTL_SECONDS);
    if (fails % MAX_FAILED_LOGINS === 0) await counters.once(`${prefix}:admin-login-lock:${account}`, LOCK_MINUTES * 60);
    await failed(client, user?.id ?? null, user ? "disabled" : "unknown_account");
    return { ok: false, error: "INVALID" };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await verifyPassword(password, DUMMY_HASH);
    await failed(client, user.id, "locked");
    return { ok: false, error: "LOCKED" };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  const secret = accountTotpSecret(user);
  const step = secret ? totpStepMatching(secret, input.code, now.getTime()) : null;
  const reason: FailureReason | null = !passwordOk ? "wrong_password" : step === null ? "wrong_code" : step <= user.lastTotpStep ? "reused_code" : null;
  // The step is claimed atomically: of two requests with the same code, one wins.
  if (reason || !(await claimTotpStep(user.id, step!, now, { failedLogins: 0, lockedUntil: null, lastLoginAt: now }, client))) {
    await noteFailedLogin(user.id, now, client);
    await failed(client, user.id, reason ?? "reused_code");
    return { ok: false, error: "INVALID" };
  }

  await client.adminSession.deleteMany({
    where: { adminUserId: user.id, expiresAt: { lt: new Date(now.getTime() - SESSION_HISTORY_DAYS * 24 * 60 * 60 * 1000) } },
  });
  // Signing in again in the same browser replaces its session: the old one ends instead of staying valid unseen.
  const previous = sessionToken(request);
  if (previous) await client.adminSession.updateMany({ where: { tokenHash: tokenHash(previous), revokedAt: null }, data: { revokedAt: now } });
  const session = await createSession(user.id, now, request, client);
  await audit(client, { actorId: user.id, action: "admin.signed_in", targetType: "AdminSession", targetId: session.sessionId });
  return { ok: true, cookie: session.cookie, userId: user.id };
}

/** Ends the request's session (if any) and returns the Set-Cookie that removes the cookie. */
export async function signOut(request: Request, deps: Pick<SignInDeps, "client" | "now"> = {}): Promise<string> {
  const client = deps.client ?? defaultClient;
  const now = deps.now ?? new Date();
  const found = await readSession(request, now, client);
  if (found) {
    await revokeSession(found.session.id, now, client);
    await audit(client, { actorId: found.user.id, action: "admin.signed_out", targetType: "AdminSession", targetId: found.session.id });
  }
  return clearCookie(request);
}
