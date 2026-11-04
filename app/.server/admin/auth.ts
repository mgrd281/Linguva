/**
 * The admin console's authentication root (reviewed like the Shopify
 * library's checks, tests/security/structure.test.ts): every loader and
 * action under /admin calls requireAdmin itself, except the sign-in page,
 * which calls requireAdminConsole. Off by default (ADMIN_CONSOLE), only on
 * ADMIN_HOST when set, and only over https on a hosted stage; then a
 * session, the role's capability, and for every write the Origin and the
 * session's CSRF token (docs/SECURITY_MODEL.md §5s).
 */
import { timingSafeEqual } from "node:crypto";
import type { AdminRole, PrismaClient } from "@prisma/client";
import { redirect } from "react-router";
import { getConfig, type AppConfig } from "../lib/config";
import { TokenCipher } from "../lib/crypto";
import { prisma as defaultClient } from "../lib/db";
import { ensureDatabasePosture } from "../lib/db-guard";
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

const notFound = () => new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const forbidden = () => new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });

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
  if (!adminConsoleAvailable(request)) throw notFound();
}

/**
 * A `next` value for after sign-in: an /admin path of this site, else
 * /admin. Never another origin ("//host", "/\host", a scheme).
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !/^\/admin(?:[/?#]|$)/.test(value) || value.includes("\\")) return "/admin";
  // Control characters (a browser drops tabs and line breaks from URLs, so "/admin\n/x" isn't what it seems).
  if ([...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return "/admin";
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
  return redirect(target, sessionToken(request) ? { headers: { "Set-Cookie": clearCookie(request) } } : undefined);
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
  if (!context.can(capability)) throw forbidden();
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!originAllowed(request)) throw forbidden();
    const submitted = await submittedCsrfToken(request);
    if (!submitted || !sameText(submitted, csrfToken)) throw forbidden();
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

/**
 * Records a wrong password or code: after MAX_FAILED_LOGINS in a row the
 * account locks for LOCK_MINUTES (its sessions stop working too). One
 * statement, so parallel attempts can't skip the lock.
 */
export async function noteFailedLogin(userId: string, now: Date = new Date(), client: PrismaClient = defaultClient): Promise<boolean> {
  const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
  const rows = await client.$queryRaw<Array<{ locked: boolean }>>`
    UPDATE "AdminUser"
    SET "failedLogins" = "failedLogins" + 1,
        "lockedUntil" = CASE WHEN ("failedLogins" + 1) % ${MAX_FAILED_LOGINS}::int = 0 THEN ${until}::timestamptz ELSE "lockedUntil" END,
        "updatedAt" = ${now}::timestamptz
    WHERE "id" = ${userId}::uuid
    RETURNING ("failedLogins" % ${MAX_FAILED_LOGINS}::int = 0) AS "locked"`;
  return rows[0]?.locked ?? false;
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
 * refused. A wrong code counts towards the account lock, so a stolen
 * session can't guess codes.
 */
export async function verifyFreshCode(
  ctx: AdminContext,
  code: string,
  { now = new Date(), client = defaultClient }: { now?: Date; client?: PrismaClient } = {},
): Promise<boolean> {
  const user = await client.adminUser.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, totpSecret: true, disabledAt: true, lockedUntil: true, failedLogins: true },
  });
  if (!user || user.disabledAt || (user.lockedUntil && user.lockedUntil > now)) return false;
  const secret = accountTotpSecret(user);
  const step = secret ? totpStepMatching(secret, code, now.getTime()) : null;
  if (step !== null && (await claimTotpStep(user.id, step, now, user.failedLogins > 0 ? { failedLogins: 0 } : {}, client))) return true;
  await noteFailedLogin(user.id, now, client);
  return false;
}
