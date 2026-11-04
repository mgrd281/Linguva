/**
 * The admin console's authentication root (reviewed like the Shopify
 * library's checks, tests/security/structure.test.ts): every loader and
 * action under /admin calls requireAdmin itself, except the sign-in page,
 * which calls requireAdminConsole. Off by default (ADMIN_CONSOLE), only on
 * ADMIN_HOST when set, and only over https on a hosted stage; then a
 * session, the role's capability, and for every write the Origin and the
 * session's CSRF token (docs/SECURITY_MODEL.md §5s).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminRole, PrismaClient } from "@prisma/client";
import { getConfig, type AppConfig } from "../lib/config";
import { TokenCipher } from "../lib/crypto";
import { prisma as defaultClient } from "../lib/db";
import { ensureDatabasePosture } from "../lib/db-guard";
import { adminRedirect, adminResponse } from "../lib/security-headers";
import { createRedis, keyPrefix } from "../queue/redis";
import { MemoryCounters, RedisCounters, type Counters } from "../usage/request-limits";
import { clearCookie, csrfTokenFor, isHttps, publicOrigin, readSession, sessionToken } from "./session";
import { openTotpSecret, totpStepMatching } from "./totp";

export type AdminCapability = "view" | "refresh" | "prices";

export interface AdminContext {
  user: { id: string; email: string; role: AdminRole };
  session: { id: string; expiresAt: string };
  /** Put it in every form as `_csrf` (or send it as X-CSRF-Token). */
  csrfToken: string;
  can(capability: AdminCapability): boolean;
}

const CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  OWNER: ["view", "refresh", "prices"],
  FINANCE: ["view", "refresh", "prices"],
  SUPPORT: ["view", "refresh"],
  READONLY: ["view"],
};

export function roleCan(role: AdminRole, capability: AdminCapability): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Consecutive wrong passwords or codes (sign-in and fresh codes together) before the account locks. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
/** A run of wrong attempts is forgotten this long after its last one (for an account and an unknown e-mail alike). */
export const FAILURES_KEPT_SECONDS = 24 * 60 * 60;

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
/** The console's 404 (off, another host) and 403, with its headers: thrown, they are answered as they are. */
export const notFound = (request: Request) => adminResponse(request, "Not Found", { status: 404, headers: TEXT });
export const forbidden = (request: Request) => adminResponse(request, "Forbidden", { status: 403, headers: TEXT });

/**
 * Whether this request may reach the console at all: ADMIN_CONSOLE=on, the
 * host is ADMIN_HOST (when set), and on a hosted stage the browser came
 * over https (so the session cookie is always Secure there).
 */
export function adminConsoleAvailable(request: Request, config: AppConfig = getConfig()): boolean {
  if (config.ADMIN_CONSOLE !== "on") return false;
  if (config.ADMIN_HOST && new URL(request.url).hostname.toLowerCase() !== config.ADMIN_HOST) return false;
  if (config.LINGUVA_STAGE && !isHttps(request)) return false;
  return true;
}

/** Throws 404 unless the console is available here; nothing else (no database) happens before. */
export async function requireAdminConsole(request: Request): Promise<void> {
  if (!adminConsoleAvailable(request)) throw notFound(request);
}

const NEXT_BASE = "http://next.invalid";

/**
 * A `next` value for after sign-in: an /admin path of this site, exactly as
 * a URL serializer writes it (printable ASCII, so always a valid Location
 * header), else /admin. Never another origin ("//host", "/\host", a scheme),
 * nothing a browser would read differently (control characters, spaces,
 * dot segments, backslashes) and no doubled or encoded slash in the path.
 * The console's own links (signInRedirect: a URL's path and query) always
 * pass unchanged.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) return "/admin";
  let url: URL;
  try {
    url = new URL(value, NEXT_BASE);
  } catch {
    return "/admin";
  }
  if (url.origin !== NEXT_BASE || `${url.pathname}${url.search}` !== value) return "/admin";
  if (!/^\/admin(?:\/|$)/.test(url.pathname) || /\/\/|%2f|%5c/i.test(url.pathname)) return "/admin";
  return value;
}

/** Where a request without a session goes: the sign-in page, with this page as `next` (GET only). */
function signInRedirect(request: Request): Response {
  const url = new URL(request.url);
  // Client navigations ask for /admin/x.data; the page is /admin/x.
  url.searchParams.delete("_routes");
  const path = url.pathname.replace(/\.data$/, "") || "/admin";
  const next = request.method === "GET" ? safeNext(`${path}${url.search}`) : "/admin";
  const target = next === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(next)}`;
  // A stale cookie is removed on the way.
  return adminRedirect(request, target, sessionToken(request) ? { headers: { "Set-Cookie": clearCookie(request) } } : undefined);
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Origin, when the browser sends one, is this site's: a write from another site's page is refused. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === publicOrigin(request);
}

async function submittedCsrfToken(request: Request): Promise<string | null> {
  const header = request.headers.get("x-csrf-token");
  if (header) return header;
  const type = request.headers.get("content-type") ?? "";
  if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(type)) return null;
  try {
    const value = (await request.clone().formData()).get("_csrf");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in admin, or a thrown Response: 404 when the console isn't
 * available here, a redirect to the sign-in page without a valid session,
 * 403 without the capability, and 403 for a write (anything but GET and
 * HEAD) from another origin or without the session's CSRF token.
 */
export async function requireAdmin(request: Request, capability: AdminCapability = "view"): Promise<AdminContext> {
  await requireAdminConsole(request);
  await ensureDatabasePosture();
  const found = await readSession(request);
  if (!found) throw signInRedirect(request);
  const { session, user, token } = found;
  const csrfToken = csrfTokenFor(token);
  const context: AdminContext = {
    user,
    session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    csrfToken,
    can: (wanted) => roleCan(user.role, wanted),
  };
  if (!context.can(capability)) throw forbidden(request);
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!originAllowed(request)) throw forbidden(request);
    const submitted = await submittedCsrfToken(request);
    if (!submitted || !sameText(submitted, csrfToken)) throw forbidden(request);
  }
  return context;
}

let memo: { keyring: string; cipher: TokenCipher } | undefined;

/** The cipher of the TOTP secrets: TOKEN_ENCRYPTION_KEYS, like sessions and merchant keys. */
export function adminCipher(config: Pick<AppConfig, "TOKEN_ENCRYPTION_KEYS"> = getConfig()): TokenCipher {
  if (memo?.keyring !== config.TOKEN_ENCRYPTION_KEYS) {
    memo = { keyring: config.TOKEN_ENCRYPTION_KEYS, cipher: TokenCipher.fromKeyring(config.TOKEN_ENCRYPTION_KEYS) };
  }
  return memo.cipher;
}

/** The account's TOTP secret, or null when its envelope doesn't open here (another key or account). */
export function accountTotpSecret(user: { id: string; totpSecret: string }, cipher: TokenCipher = adminCipher()): string | null {
  try {
    return openTotpSecret(cipher, user.id, user.totpSecret);
  } catch {
    return null;
  }
}

let sharedCounters: Counters | undefined;

/** The sign-in counters: Redis when configured (all instances share them; required in production), else this process's memory. */
export function loginCounters(config: Pick<AppConfig, "REDIS_URL"> = getConfig()): Counters {
  sharedCounters ??= config.REDIS_URL ? new RedisCounters(createRedis(config.REDIS_URL)) : new MemoryCounters();
  return sharedCounters;
}

/** Hashed, so Redis keys carry no addresses, e-mails or account ids. */
export const keyPart = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Whose attempt it is: an enabled account, with its last accepted code step
 * (an accepted code, at sign-in or as a fresh code, starts a new run of
 * wrong attempts), or an e-mail without one (unknown, or a disabled
 * account's).
 */
export type Attempter = { userId: string; lastTotpStep: number } | { email: string };

export interface AttemptDeps {
  client?: PrismaClient;
  counters?: Counters;
  config?: AppConfig;
}

function attemptKeys(who: Attempter, config: Pick<AppConfig, "NODE_ENV">) {
  const prefix = keyPrefix(config.NODE_ENV);
  const id = "userId" in who ? `a:${keyPart(`${who.userId}:${who.lastTotpStep}`)}` : keyPart(who.email);
  return { fails: `${prefix}:admin-login-fails:${id}`, lock: `${prefix}:admin-login-lock:${id}` };
}

/**
 * Counts an attempt before it is checked (one that can't be counted is
 * never checked), and returns its number in its run, for noteFailedLogin.
 * Accounts and e-mails without one share this one count, in Redis, each run
 * forgotten FAILURES_KEPT_SECONDS after its last attempt: neither the
 * answers nor when they change tell which accounts exist
 * (docs/SECURITY_MODEL.md §5s).
 */
export async function countAttempt(who: Attempter, { counters, config = getConfig() }: AttemptDeps = {}): Promise<number> {
  return (counters ?? loginCounters(config)).incr(attemptKeys(who, config).fails, FAILURES_KEPT_SECONDS);
}

/**
 * After a wrong password or code, with its number from countAttempt: every
 * MAX_FAILED_LOGINS-th in a run locks for LOCK_MINUTES (from the latest),
 * and returns true. An account's lock is its lockedUntil, authoritative:
 * sign-in refuses it, its sessions stop working, the operator tool lifts
 * it; its failedLogins counts the wrong attempts since its last accepted
 * code, for the operator's list. An e-mail without an account is locked
 * in Redis, for exactly as long.
 */
export async function noteFailedLogin(
  who: Attempter,
  attempt: number,
  now: Date = new Date(),
  { client = defaultClient, counters, config = getConfig() }: AttemptDeps = {},
): Promise<boolean> {
  const locks = attempt % MAX_FAILED_LOGINS === 0;
  if ("userId" in who) {
    const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    // One statement: parallel attempts each count.
    await client.adminUser.updateMany({
      where: { id: who.userId },
      data: { failedLogins: { increment: 1 }, updatedAt: now, ...(locks ? { lockedUntil } : {}) },
    });
  } else if (locks) {
    // incr, not once: like lockedUntil, the latest lock decides when it ends.
    await (counters ?? loginCounters(config)).incr(attemptKeys(who, config).lock, LOCK_MINUTES * 60);
  }
  return locks;
}

/** Whether an e-mail without an account is locked (an account's lock is its lockedUntil). */
export async function emailLocked(email: string, { counters, config = getConfig() }: AttemptDeps = {}): Promise<boolean> {
  return (await (counters ?? loginCounters(config)).get(attemptKeys({ email }, config).lock)) > 0;
}

/**
 * Accepts a code once: only if its step is later than the account's last
 * accepted step, and the account is neither disabled nor locked at that
 * moment (one atomic update, so the same code can't win twice even in
 * parallel requests, nor slip past a lock or a disable that just happened).
 */
export async function claimTotpStep(
  userId: string,
  step: number,
  now: Date,
  data: { failedLogins?: 0; lockedUntil?: null; lastLoginAt?: Date } = {},
  client: PrismaClient = defaultClient,
): Promise<boolean> {
  const claimed = await client.adminUser.updateMany({
    where: { id: userId, lastTotpStep: { lt: step }, disabledAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { lastTotpStep: step, ...data },
  });
  return claimed.count === 1;
}

/**
 * A new TOTP code for a sensitive action (saving prices), with the same
 * replay protection as sign-in: a code used to sign in, or once here, is
 * refused. A wrong code counts towards the account lock (in the same run
 * as wrong sign-ins), so a stolen session can't guess codes.
 */
export async function verifyFreshCode(
  ctx: AdminContext,
  code: string,
  { now = new Date(), client = defaultClient, counters }: { now?: Date; client?: PrismaClient; counters?: Counters } = {},
): Promise<boolean> {
  const user = await client.adminUser.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, totpSecret: true, disabledAt: true, lockedUntil: true, failedLogins: true, lastTotpStep: true },
  });
  if (!user || user.disabledAt || (user.lockedUntil && user.lockedUntil > now)) return false;
  const who = { userId: user.id, lastTotpStep: user.lastTotpStep };
  const attempt = await countAttempt(who, { counters });
  const secret = accountTotpSecret(user);
  const step = secret ? totpStepMatching(secret, code, now.getTime()) : null;
  if (step !== null && (await claimTotpStep(user.id, step, now, user.failedLogins > 0 ? { failedLogins: 0 } : {}, client))) return true;
  await noteFailedLogin(who, attempt, now, { client, counters });
  return false;
}
