/**
 * Admin console sign-in, sessions and write protection against the real
 * database as the runtime role (app/.server/admin/; docs/SECURITY_MODEL.md
 * §5s). Accounts are seeded as the operator tool does, with the owner role.
 */
import { randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminCipher, keyPart, requireAdmin, verifyFreshCode, type AdminContext } from "../../app/.server/admin/auth";
import { LOGIN_ATTEMPTS_PER_CLIENT, signIn, signOut, type SignInDeps } from "../../app/.server/admin/login";
import { hashPassword } from "../../app/.server/admin/password";
import { readSession, tokenHash } from "../../app/.server/admin/session";
import { base32Decode, generateTotpSecret, hotp, sealTotpSecret, totpStep } from "../../app/.server/admin/totp";
import { resetConfigCache } from "../../app/.server/lib/config";
import { createRedis } from "../../app/.server/queue/redis";
import { MemoryCounters, RedisCounters } from "../../app/.server/usage/request-limits";
import { ownerDb, resetDatabase } from "../support/db";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";
const MINUTE = 60_000;

type Seeded = { id: string; email: string; secret: string };

/** An account as `pnpm ops:admin add` creates it (owner role: the runtime role can't). */
async function seedAdmin(email = "owner@example.com", role: AdminRole = "OWNER"): Promise<Seeded> {
  const id = randomUUID();
  const secret = generateTotpSecret();
  await ownerDb.adminUser.create({
    data: { id, email, role, passwordHash: await hashPassword(PASSWORD), totpSecret: sealTotpSecret(adminCipher(), id, secret) },
  });
  return { id, email, secret };
}

const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret)!, totpStep(at.getTime()));
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);

function loginRequest(headers: Record<string, string> = {}, origin = ORIGIN) {
  return new Request(`${origin}/admin/login`, { method: "POST", headers: { origin, ...headers } });
}

/** A fresh sign-in limiter per test (one test checks the shared Redis one). */
let deps: SignInDeps;
beforeEach(async () => {
  await resetDatabase();
  deps = { counters: new MemoryCounters() };
});

const env = { ADMIN_CONSOLE: process.env.ADMIN_CONSOLE, ADMIN_HOST: process.env.ADMIN_HOST };
beforeAll(() => {
  process.env.ADMIN_CONSOLE = "on";
  delete process.env.ADMIN_HOST;
  resetConfigCache();
});
afterAll(async () => {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetConfigCache();
  await ownerDb.$disconnect();
});

async function signedIn(user: Seeded, at = new Date()) {
  const result = await signIn(loginRequest(), { email: user.email, password: PASSWORD, code: codeAt(user.secret, at) }, { ...deps, now: at });
  if (!result.ok) throw new Error(`sign-in failed: ${result.error}`);
  return { cookie: result.cookie.split(";")[0]!, token: result.cookie.split(";")[0]!.split("=")[1]! };
}

const audits = (action: string) => ownerDb.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

describe("signing in", () => {
  it("starts a session for the right e-mail, password and code: an HttpOnly, SameSite=Strict cookie, only the token's hash stored", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const result = await signIn(loginRequest(), { email: "  Owner@Example.COM ", password: PASSWORD, code: codeAt(user.secret, now) }, { ...deps, now });
    expect(result).toMatchObject({ ok: true, userId: user.id });
    const cookie = result.ok ? result.cookie : "";
    expect(cookie).toMatch(/^lv_admin=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Strict$/);
    const token = cookie.split(";")[0]!.split("=")[1]!;

    const [session] = await ownerDb.adminSession.findMany({ where: { adminUserId: user.id } });
    expect(session!.tokenHash).toBe(tokenHash(token));
    expect(session!.tokenHash).not.toContain(token);
    expect(session!.expiresAt.getTime() - now.getTime()).toBe(8 * 60 * MINUTE);
    const row = await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLogins: 0, lockedUntil: null, lastTotpStep: totpStep(now.getTime()), lastLoginAt: now });

    const [signedInAudit] = await audits("admin.signed_in");
    expect(signedInAudit).toMatchObject({ actorType: "ADMIN", actorId: user.id, targetType: "AdminSession", targetId: session!.id });
  });

  it("sets a __Host- prefixed, Secure cookie over https (Railway's proxy forwards https)", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const request = new Request("http://admin.linguva.test/admin/login", {
      method: "POST",
      headers: { origin: "https://admin.linguva.test", "x-forwarded-proto": "https" },
    });
    const result = await signIn(request, { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) }, { ...deps, now });
    expect(result.ok && result.cookie).toMatch(/^__Host-lv_admin=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/);
  });

  it("answers INVALID alike for a wrong password, a wrong code or an unknown e-mail, and audits why without the e-mail or password", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const code = codeAt(user.secret, now);
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const attempts = [
      { email: user.email, password: "wrong password here", code },
      { email: user.email, password: PASSWORD, code: wrongCode },
      { email: user.email, password: PASSWORD, code: "" },
      { email: "nobody@example.com", password: PASSWORD, code },
      { email: "", password: "", code: "" },
    ];
    for (const attempt of attempts) {
      expect(await signIn(loginRequest(), attempt, { ...deps, now })).toEqual({ ok: false, error: "INVALID" });
    }
    const failures = await audits("admin.sign_in_failed");
    expect(failures.map((f) => [f.actorId, f.metadata])).toEqual([
      [user.id, { reason: "wrong_password" }],
      [user.id, { reason: "wrong_code" }],
      [user.id, { reason: "wrong_code" }],
      [null, { reason: "unknown_account" }],
      [null, { reason: "unknown_account" }],
    ]);
    const logged = JSON.stringify(failures);
    for (const secret of ["owner@example.com", "nobody@example.com", PASSWORD, "wrong password here"]) expect(logged).not.toContain(secret);
    expect(await ownerDb.adminSession.count()).toBe(0);
  });

  it("accepts each code once, even for two requests at the same moment", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const input = { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) };
    expect((await signIn(loginRequest(), input, { ...deps, now })).ok).toBe(true);
    // The same code again: refused (someone who saw it can't use it).
    expect(await signIn(loginRequest(), input, { ...deps, now: later(now, 5_000) })).toEqual({ ok: false, error: "INVALID" });
    // An older step's code too, though it is inside the window.
    expect(await signIn(loginRequest(), { ...input, code: codeAt(user.secret, later(now, -30_000)) }, { ...deps, now })).toEqual({ ok: false, error: "INVALID" });
    // The next step's code, twice in parallel: one wins.
    const next = later(now, 30_000);
    const parallel = await Promise.all(
      [1, 2].map(() => signIn(loginRequest(), { ...input, code: codeAt(user.secret, next) }, { ...deps, now: next })),
    );
    expect(parallel.filter((r) => r.ok)).toHaveLength(1);
    expect((await audits("admin.sign_in_failed")).map((f) => (f.metadata as { reason: string }).reason)).toEqual(["reused_code", "reused_code", "reused_code"]);
  });

  it("locks the account for 15 minutes after five wrong attempts in a row; sessions of a locked account stop working", async () => {
    const user = await seedAdmin();
    const start = new Date();
    const { cookie } = await signedIn(user, start);
    const at = later(start, 30_000);
    for (let i = 0; i < 5; i++) {
      expect(await signIn(loginRequest(), { email: user.email, password: "wrong password here", code: "000000" }, { ...deps, now: at })).toEqual({
        ok: false,
        error: "INVALID",
      });
    }
    const right = (when: Date) => signIn(loginRequest(), { email: user.email, password: PASSWORD, code: codeAt(user.secret, when) }, { ...deps, now: when });
    // Even the right password and code now: LOCKED.
    expect(await right(later(at, 60_000))).toEqual({ ok: false, error: "LOCKED" });
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }), later(at, 60_000))).toBeNull();
    expect((await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).toEqual(later(at, 15 * MINUTE));
    // After 15 minutes: in again, and the count starts over.
    expect((await right(later(at, 15 * MINUTE + 30_000))).ok).toBe(true);
    expect((await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })).failedLogins).toBe(0);
    expect((await audits("admin.sign_in_failed")).map((f) => (f.metadata as { reason: string }).reason).at(-1)).toBe("locked");
  });

  it("answers an unknown or disabled account the same way, lock included: no answer tells which accounts exist", async () => {
    const disabled = await seedAdmin("former@example.com");
    await ownerDb.adminUser.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
    const now = new Date();
    for (const email of ["nobody@example.com", disabled.email]) {
      const answers = [];
      for (let i = 0; i < 6; i++) answers.push((await signIn(loginRequest(), { email, password: PASSWORD, code: codeAt(disabled.secret, now) }, { ...deps, now })) as { error: string });
      expect(answers.map((a) => a.error), email).toEqual(["INVALID", "INVALID", "INVALID", "INVALID", "INVALID", "LOCKED"]);
    }
    expect(await ownerDb.adminSession.count()).toBe(0);
  });

  it("counts an account and an e-mail without one in the same way over time: a run is forgotten a day after its last attempt, alike", async () => {
    const owner = await seedAdmin();
    const disabled = await seedAdmin("former@example.com");
    await ownerDb.adminUser.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
    const start = Date.now();
    let clock = start;
    const counters = new MemoryCounters(() => clock);
    const answers: Record<string, string[]> = {};
    for (const [i, email] of [owner.email, "nobody@example.com", disabled.email].entries()) {
      const attempt = async () => {
        const result = await signIn(loginRequest({ "x-forwarded-for": `203.0.113.${i}` }), { email, password: "wrong password here", code: "000000" }, { counters, now: new Date(clock) });
        return result.ok ? "OK" : result.error;
      };
      const seen: string[] = [];
      clock = start;
      for (let n = 0; n < 4; n++) seen.push(await attempt());
      // A day and an hour later the four are forgotten: five more before the lock...
      clock = start + 25 * 60 * MINUTE;
      for (let n = 0; n < 6; n++) seen.push(await attempt());
      // ...which ends 15 minutes after it began.
      clock = start + 25 * 60 * MINUTE + 15 * MINUTE;
      seen.push(await attempt());
      answers[email] = seen;
    }
    const expected = [...Array<string>(9).fill("INVALID"), "LOCKED", "INVALID"];
    expect(answers).toEqual({ [owner.email]: expected, "nobody@example.com": expected, [disabled.email]: expected });
    // The account's lock is in the database (authoritative: its sessions stop too).
    const row = await ownerDb.adminUser.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.lockedUntil).toEqual(new Date(start + 25 * 60 * MINUTE + 15 * MINUTE));
    expect(row.failedLogins).toBe(10);
  }, 30_000);

  it("starts a new run with each accepted code: only wrong attempts in a row lock", async () => {
    const user = await seedAdmin();
    const start = new Date();
    const wrong = () => signIn(loginRequest(), { email: user.email, password: "wrong password here", code: "000000" }, { ...deps, now: start });
    for (let i = 0; i < 4; i++) expect(await wrong()).toEqual({ ok: false, error: "INVALID" });
    await signedIn(user, start);
    for (let i = 0; i < 4; i++) expect(await wrong()).toEqual({ ok: false, error: "INVALID" });
    expect(await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLogins: 4, lockedUntil: null });
    // The fifth in a row.
    expect(await wrong()).toEqual({ ok: false, error: "INVALID" });
    expect(await wrong()).toEqual({ ok: false, error: "LOCKED" });
  });

  it("limits each client to 20 attempts in 15 minutes across instances (Redis), whatever is forged left in X-Forwarded-For", async () => {
    const user = await seedAdmin();
    const redis = createRedis(process.env.REDIS_URL!);
    try {
      const shared: SignInDeps = { counters: new RedisCounters(redis) };
      // New names each run: the counters live in Redis, beyond this test's database.
      const run = randomUUID().slice(0, 8);
      const client = `198.18.0.1-${run}`;
      const now = new Date();
      const attempt = (forged: string) =>
        signIn(loginRequest({ "x-forwarded-for": `${forged}, ${client}` }), { email: `${run}-${forged}@example.com`, password: "wrong", code: "000000" }, { ...shared, now });
      const answers = await Promise.all(Array.from({ length: LOGIN_ATTEMPTS_PER_CLIENT }, (_, i) => attempt(`198.51.100.${i}`)));
      expect(answers.every((a) => !a.ok && a.error === "INVALID")).toBe(true);
      expect(await attempt("198.51.100.250")).toEqual({ ok: false, error: "RATE_LIMITED" });
      // Even with the right credentials, until the window passes.
      const right = await signIn(
        loginRequest({ "x-forwarded-for": client }),
        { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) },
        { ...shared, now },
      );
      expect(right).toEqual({ ok: false, error: "RATE_LIMITED" });
      // Another client is not affected.
      const other = loginRequest({ "x-forwarded-for": `198.18.0.2-${run}` });
      expect((await signIn(other, { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) }, { ...shared, now })).ok).toBe(true);
      // One audit row for the refused attempts, not one each.
      expect((await audits("admin.sign_in_failed")).filter((f) => (f.metadata as { reason: string }).reason === "rate_limited")).toHaveLength(1);
      const keys = await redis.keys("lv:test:admin-login:*");
      expect(keys.length).toBeGreaterThan(0);
      // Keys carry no address, e-mail or account id (the signed-in account's run is there too).
      const all = (await redis.keys(`lv:test:admin-login*`)).join(" ");
      expect(all).not.toMatch(/198\.|example\.com/);
      expect(all).not.toContain(user.id);
      // The account's sign-in was counted (before it was checked) in its run, under a hash.
      expect(await redis.get(`lv:test:admin-login-fails:a:${keyPart(`${user.id}:0`)}`)).toBe("1");
    } finally {
      await redis.quit();
    }
  });

  it("refuses a sign-in posted from another site's page, and the whole console while it is off", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const input = { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) };
    const foreign = new Request(`${ORIGIN}/admin/login`, { method: "POST", headers: { origin: "https://evil.example" } });
    await expect(signIn(foreign, input, { ...deps, now })).rejects.toMatchObject({ status: 403 });
    process.env.ADMIN_CONSOLE = "off";
    resetConfigCache();
    try {
      await expect(signIn(loginRequest(), input, { ...deps, now })).rejects.toMatchObject({ status: 404 });
      await expect(requireAdmin(new Request(`${ORIGIN}/admin`))).rejects.toMatchObject({ status: 404 });
    } finally {
      process.env.ADMIN_CONSOLE = "on";
      resetConfigCache();
    }
    expect(await ownerDb.adminSession.count()).toBe(0);
    expect(await ownerDb.auditLog.count()).toBe(0);
  });
});

describe("requireAdmin", () => {
  const page = (path: string, cookie?: string, init: RequestInit = {}) =>
    new Request(`${ORIGIN}${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...((init.headers as Record<string, string>) ?? {}) } });

  it("gives the signed-in admin's context: account, session, CSRF token and capabilities", async () => {
    const user = await seedAdmin("finance@example.com", "FINANCE");
    const { cookie, token } = await signedIn(user);
    const ctx = await requireAdmin(page("/admin", cookie));
    expect(ctx.user).toEqual({ id: user.id, email: "finance@example.com", role: "FINANCE" });
    expect(ctx.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ctx.csrfToken).not.toBe(token);
    expect(new Date(ctx.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect([ctx.can("view"), ctx.can("refresh"), ctx.can("prices")]).toEqual([true, true, true]);
  });

  it("sends a visitor without a valid session to the sign-in page, with the page they wanted, and removes a stale cookie", async () => {
    const none = (await requireAdmin(page("/admin/customers?q=shoe")).catch((e: unknown) => e)) as Response;
    expect(none.status).toBe(302);
    expect(none.headers.get("Location")).toBe("/admin/login?next=%2Fadmin%2Fcustomers%3Fq%3Dshoe");
    expect(none.headers.get("Set-Cookie")).toBeNull();
    const stale = (await requireAdmin(page("/admin/prices.data", `lv_admin=${"x".repeat(43)}`)).catch((e: unknown) => e)) as Response;
    expect(stale.headers.get("Location")).toBe("/admin/login?next=%2Fadmin%2Fprices");
    expect(stale.headers.get("Set-Cookie")).toBe("lv_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
    const index = (await requireAdmin(page("/admin")).catch((e: unknown) => e)) as Response;
    expect(index.headers.get("Location")).toBe("/admin/login");
  });

  it("answers 403 when the role lacks the capability", async () => {
    const user = await seedAdmin("viewer@example.com", "READONLY");
    const { cookie } = await signedIn(user);
    expect((await requireAdmin(page("/admin", cookie), "view")).user.role).toBe("READONLY");
    await expect(requireAdmin(page("/admin/prices", cookie), "prices")).rejects.toMatchObject({ status: 403 });
    await expect(requireAdmin(page("/admin/customers/x", cookie), "refresh")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses every write without the session's CSRF token or from another origin, and leaves the form readable", async () => {
    const user = await seedAdmin();
    const { cookie } = await signedIn(user);
    const { csrfToken } = await requireAdmin(page("/admin", cookie));
    const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
      page("/admin/prices", cookie, { method: "POST", body: new URLSearchParams(fields), headers: { origin: ORIGIN, ...headers } });

    await expect(requireAdmin(form({ "pro.monthly": "49" }))).rejects.toMatchObject({ status: 403 });
    await expect(requireAdmin(form({ _csrf: `${csrfToken.slice(0, -1)}A` }))).rejects.toMatchObject({ status: 403 });
    await expect(requireAdmin(form({ _csrf: csrfToken }, { origin: "https://evil.example" }))).rejects.toMatchObject({ status: 403 });
    await expect(requireAdmin(form({ _csrf: csrfToken }, { origin: "null" }))).rejects.toMatchObject({ status: 403 });
    // Another session's token is no good either.
    const other = await signedIn(await seedAdmin("second@example.com"));
    const { csrfToken: otherToken } = await requireAdmin(page("/admin", other.cookie));
    await expect(requireAdmin(form({ _csrf: otherToken }))).rejects.toMatchObject({ status: 403 });
    // A JSON body isn't read for the token.
    const json = page("/admin/prices", cookie, { method: "POST", body: JSON.stringify({ _csrf: csrfToken }), headers: { "content-type": "application/json" } });
    await expect(requireAdmin(json)).rejects.toMatchObject({ status: 403 });

    const ok = form({ _csrf: csrfToken, "pro.monthly": "49" });
    expect((await requireAdmin(ok, "prices")).user.id).toBe(user.id);
    // The route reads the same form afterwards.
    expect((await ok.formData()).get("pro.monthly")).toBe("49");
    // As a header (fetch), and multipart forms.
    expect((await requireAdmin(page("/admin/prices", cookie, { method: "POST", headers: { "x-csrf-token": csrfToken } }))).user.id).toBe(user.id);
    const multipart = new FormData();
    multipart.set("_csrf", csrfToken);
    expect((await requireAdmin(page("/admin/prices", cookie, { method: "POST", body: multipart }))).user.id).toBe(user.id);
    // Reading needs no token.
    expect((await requireAdmin(page("/admin/prices", cookie, { method: "HEAD" }))).user.id).toBe(user.id);
  });
});

describe("sessions", () => {
  const at = (cookie: string) => new Request(`${ORIGIN}/admin`, { headers: { cookie } });

  it("end after 30 idle minutes and after 8 hours at the latest, and note activity at most once a minute", async () => {
    const user = await seedAdmin();
    const start = new Date();
    const { cookie } = await signedIn(user, start);
    const lastSeen = async () => (await ownerDb.adminSession.findFirstOrThrow({ where: { adminUserId: user.id } })).lastSeenAt;

    expect(await readSession(at(cookie), later(start, 30_000))).not.toBeNull();
    expect(await lastSeen()).toEqual(start);
    expect(await readSession(at(cookie), later(start, 29 * MINUTE))).not.toBeNull();
    expect(await lastSeen()).toEqual(later(start, 29 * MINUTE));
    // Kept alive by activity...
    for (let minutes = 55; minutes < 8 * 60; minutes += 25) expect(await readSession(at(cookie), later(start, minutes * MINUTE)), `${minutes}`).not.toBeNull();
    // ...but not past 8 hours.
    expect(await readSession(at(cookie), later(start, 8 * 60 * MINUTE))).toBeNull();

    const second = await signedIn(user, later(start, 30_000));
    expect(await readSession(at(second.cookie), later(start, 30_000 + 30 * MINUTE))).toBeNull();
  });

  it("end on sign-out (audited), and when the account is disabled or locked", async () => {
    const user = await seedAdmin();
    const { cookie } = await signedIn(user);
    const cleared = await signOut(at(cookie));
    expect(cleared).toBe("lv_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
    expect(await readSession(at(cookie))).toBeNull();
    expect((await ownerDb.adminSession.findFirstOrThrow()).revokedAt).not.toBeNull();
    expect(await audits("admin.signed_out")).toMatchObject([{ actorId: user.id, targetType: "AdminSession" }]);
    // Signing out without a session only clears the cookie.
    expect(await signOut(at(cookie))).toBe(cleared);
    expect(await audits("admin.signed_out")).toHaveLength(1);

    const next = await signedIn(user, later(new Date(), 30_000));
    expect(await readSession(at(next.cookie))).not.toBeNull();
    await ownerDb.adminUser.update({ where: { id: user.id }, data: { lockedUntil: later(new Date(), MINUTE) } });
    expect(await readSession(at(next.cookie))).toBeNull();
    await ownerDb.adminUser.update({ where: { id: user.id }, data: { lockedUntil: null, disabledAt: new Date() } });
    expect(await readSession(at(next.cookie))).toBeNull();
  });

  it("end when the same browser signs in again (the old cookie's session doesn't stay valid unseen)", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const first = await signedIn(user, now);
    const next = later(now, 30_000);
    const again = await signIn(loginRequest({ cookie: first.cookie }), { email: user.email, password: PASSWORD, code: codeAt(user.secret, next) }, { ...deps, now: next });
    expect(again.ok).toBe(true);
    expect(await readSession(at(first.cookie), next)).toBeNull();
    expect(await readSession(at(again.ok ? again.cookie.split(";")[0]! : ""), next)).not.toBeNull();
  });

  it("are kept 30 days after they end, for the list of recent sign-ins, then deleted at the next sign-in", async () => {
    const user = await seedAdmin();
    const start = new Date(Date.now() - 40 * 24 * 60 * MINUTE);
    await signedIn(user, start);
    await signedIn(user, later(start, 20 * 24 * 60 * MINUTE));
    expect(await ownerDb.adminSession.count()).toBe(2);
    await signedIn(user, new Date());
    // The 40-day-old one is gone; the 20-day-old one stays.
    expect(await ownerDb.adminSession.count()).toBe(2);
  });
});

describe("fresh codes for sensitive actions", () => {
  async function context(user: Seeded, now: Date): Promise<{ ctx: AdminContext; cookie: string }> {
    const { cookie } = await signedIn(user, now);
    return { ctx: await requireAdmin(new Request(`${ORIGIN}/admin/prices`, { headers: { cookie } }), "prices"), cookie };
  }

  it("accept a new code once, never the one used to sign in", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const { ctx } = await context(user, now);
    const { counters } = deps;
    expect(await verifyFreshCode(ctx, codeAt(user.secret, now), { now, counters })).toBe(false);
    const next = later(now, 30_000);
    expect(await verifyFreshCode(ctx, codeAt(user.secret, next), { now: next, counters })).toBe(true);
    expect(await verifyFreshCode(ctx, codeAt(user.secret, next), { now: next, counters })).toBe(false);
    expect(await verifyFreshCode(ctx, "12345", { now: next, counters })).toBe(false);
  });

  it("count wrong codes towards the lock, so a stolen session can't guess codes", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const { ctx, cookie } = await context(user, now);
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(await verifyFreshCode(ctx, "000000", { now, counters: deps.counters })).toBe(false);
    const row = await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).toEqual(later(now, 15 * MINUTE));
    // Locked: even the right code is refused, and the session no longer works.
    const next = later(now, 30_000);
    expect(await verifyFreshCode(ctx, codeAt(user.secret, next), { now: next, counters: deps.counters })).toBe(false);
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).toBeNull();
    await expect(requireAdmin(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).rejects.toMatchObject({ status: 302 });
  });

  it("count in the same run as wrong sign-ins", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const { ctx } = await context(user, now);
    for (let i = 0; i < 3; i++) expect(await verifyFreshCode(ctx, "000000", { now, counters: deps.counters })).toBe(false);
    for (let i = 0; i < 2; i++) {
      expect(await signIn(loginRequest(), { email: user.email, password: "wrong password here", code: "000000" }, { ...deps, now })).toEqual({ ok: false, error: "INVALID" });
    }
    expect((await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).toEqual(later(now, 15 * MINUTE));
    const next = later(now, 30_000);
    expect(await signIn(loginRequest(), { email: user.email, password: PASSWORD, code: codeAt(user.secret, next) }, { ...deps, now: next })).toEqual({ ok: false, error: "LOCKED" });
  });

  it("are never checked without being counted first", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const { ctx } = await context(user, now);
    const down = new Error("Redis is not reachable");
    const unreachable = { get: () => Promise.reject(down), incr: () => Promise.reject(down), once: () => Promise.reject(down) };
    const next = later(now, 30_000);
    // The right code: refused with the error, and still unused.
    await expect(verifyFreshCode(ctx, codeAt(user.secret, next), { now: next, counters: unreachable })).rejects.toBe(down);
    expect((await ownerDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })).lastTotpStep).toBe(totpStep(now.getTime()));
    expect(await verifyFreshCode(ctx, codeAt(user.secret, next), { now: next, counters: deps.counters })).toBe(true);
  });
});
