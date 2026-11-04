/**
 * Admin console sessions: a random token in an HttpOnly, SameSite=Strict
 * cookie (`__Host-` prefixed and Secure over https), and only its SHA-256 in
 * AdminSession, so a database copy holds no usable session. Sessions end
 * after 8 hours, after 30 idle minutes, on sign-out, and as soon as the
 * account is disabled or locked (docs/SECURITY_MODEL.md §5s).
 */
import { createHash, randomBytes } from "node:crypto";
import type { AdminRole, AdminSession, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** lastSeenAt is written at most this often: not one UPDATE per request. */
const TOUCH_INTERVAL_MS = 60 * 1000;

const SECURE_COOKIE = "__Host-lv_admin";
const PLAIN_COOKIE = "lv_admin";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (text: string) => createHash("sha256").update(text).digest("base64url");

/**
 * Whether the browser reached us over https: the request URL, or the
 * right-most X-Forwarded-Proto (the hop Railway's proxy adds; the server
 * itself listens on plain http behind it). The same rule as HSTS.
 */
export function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded?.split(",").at(-1)?.trim().toLowerCase() === "https";
}

/** The origin the browser sees (scheme as above, host and port from the request): what Origin must be. */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${isHttps(request) ? "https:" : url.protocol}//${url.host}`;
}

/**
 * `__Host-lv_admin` over https: the prefix makes the browser refuse it
 * unless Secure, host-only and Path=/, so a sibling subdomain can't plant
 * one. `lv_admin` only for local development over http.
 */
export function cookieName(request: Request | null): string {
  return !request || isHttps(request) ? SECURE_COOKIE : PLAIN_COOKIE;
}

function serialize(request: Request | null, value: string, maxAge: number): string {
  const secure = !request || isHttps(request);
  return [`${cookieName(request)}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", ...(secure ? ["Secure"] : []), "SameSite=Strict"].join("; ");
}

/** The session token from the request's cookie (only the name for this scheme), or null when absent or malformed. */
export function sessionToken(request: Request): string | null {
  const name = cookieName(request);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (TOKEN.test(value)) return value;
  }
  return null;
}

/** What AdminSession.tokenHash stores for a token. */
export function tokenHash(token: string): string {
  return sha256(token);
}

/** The CSRF token of a session: derived from its secret token, so it needs no storage and dies with the session. */
export function csrfTokenFor(token: string): string {
  return sha256(`csrf\u0000${token}`);
}

/**
 * Starts a session for an account (after a complete sign-in only). The
 * cookie is built for `request`'s scheme; without one, the https variant.
 */
export async function createSession(
  userId: string,
  now: Date = new Date(),
  request: Request | null = null,
  client: PrismaClient = defaultClient,
): Promise<{ token: string; cookie: string; sessionId: string }> {
  const token = randomBytes(32).toString("base64url");
  const session = await client.adminSession.create({
    data: {
      adminUserId: userId,
      tokenHash: tokenHash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    },
    select: { id: true },
  });
  return { token, cookie: serialize(request, token, SESSION_MAX_AGE_SECONDS), sessionId: session.id };
}

export interface SessionUser {
  id: string;
  email: string;
  role: AdminRole;
}

export interface ReadSession {
  session: Pick<AdminSession, "id" | "adminUserId" | "createdAt" | "lastSeenAt" | "expiresAt">;
  user: SessionUser;
  /** The cookie's token (for the CSRF token); never stored or logged. */
  token: string;
}

/**
 * The request's valid session and its account, or null: no or malformed
 * cookie, unknown token, revoked, past 8 hours, idle for 30 minutes, or the
 * account disabled or locked. Notes activity at most once a minute.
 */
export async function readSession(request: Request, now: Date = new Date(), client: PrismaClient = defaultClient): Promise<ReadSession | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await client.adminSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true,
      adminUserId: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
      adminUser: { select: { id: true, email: true, role: true, disabledAt: true, lockedUntil: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  const at = now.getTime();
  if (row.expiresAt.getTime() <= at || row.lastSeenAt.getTime() + SESSION_IDLE_MS <= at) return null;
  const user = row.adminUser;
  if (user.disabledAt || (user.lockedUntil && user.lockedUntil.getTime() > at)) return null;
  let lastSeenAt = row.lastSeenAt;
  if (at - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await client.adminSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastSeenAt: now } });
    lastSeenAt = now;
  }
  return {
    session: { id: row.id, adminUserId: row.adminUserId, createdAt: row.createdAt, lastSeenAt, expiresAt: row.expiresAt },
    user: { id: user.id, email: user.email, role: user.role },
    token,
  };
}

/** Ends a session (sign-out); a revoked session never authenticates again. */
export async function revokeSession(sessionId: string, now: Date = new Date(), client: PrismaClient = defaultClient): Promise<void> {
  await client.adminSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
}

/** Set-Cookie that removes the session cookie of `request`'s scheme. */
export function clearCookie(request: Request): string {
  return serialize(request, "", 0);
}
