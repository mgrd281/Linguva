/**
 * The admin console's switches and request checks that need no database
 * (app/.server/admin/auth.ts, session.ts, login.ts; config ADMIN_CONSOLE,
 * ADMIN_HOST). Sign-in and sessions: tests/integration/admin-auth.test.ts.
 */
import pino from "pino";
import { describe, expect, it } from "vitest";
import { adminConsoleAvailable, originAllowed, requireAdminConsole, roleCan, safeNext } from "../../app/.server/admin/auth";
import { clientAddress } from "../../app/.server/admin/login";
import { clearCookie, cookieName, csrfTokenFor, isHttps, publicOrigin, sessionToken, tokenHash } from "../../app/.server/admin/session";
import { getConfig } from "../../app/.server/lib/config";
import { loggerOptions } from "../../app/.server/lib/logger";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64")}`,
  NODE_ENV: "test",
};
const config = (env: Record<string, string>) => getConfig({ ...base, ...env } as NodeJS.ProcessEnv);
const production = { ...base, NODE_ENV: "production", REDIS_URL: "redis://localhost:6379", LINGUVA_STAGE: "production", LINGUVA_PRODUCTION_APPROVED: "yes" };
const req = (url: string, headers: Record<string, string> = {}, method = "GET") => new Request(url, { headers, method });
const TOKEN = "a".repeat(43);

describe("configuration", () => {
  it("keeps the console off unless ADMIN_CONSOLE=on", () => {
    expect(config({}).ADMIN_CONSOLE).toBe("off");
    expect(config({ ADMIN_CONSOLE: "on" }).ADMIN_CONSOLE).toBe("on");
    expect(() => config({ ADMIN_CONSOLE: "yes" })).toThrow(/ADMIN_CONSOLE/);
    expect(() => config({ ADMIN_CONSOLE: "ON" })).toThrow(/ADMIN_CONSOLE/);
  });

  it("reads ADMIN_HOST as a bare host name, as pasted", () => {
    expect(config({ ADMIN_HOST: ' "Admin.Linguva.app" ' }).ADMIN_HOST).toBe("admin.linguva.app");
    expect(config({ ADMIN_HOST: "localhost" }).ADMIN_HOST).toBe("localhost");
    expect(config({ ADMIN_HOST: "" }).ADMIN_HOST).toBeUndefined();
    for (const wrong of ["https://admin.linguva.app", "admin.linguva.app:443", "admin.linguva.app/admin", "-admin.linguva.app", "admin..linguva.app", "*.linguva.app"]) {
      expect(() => config({ ADMIN_HOST: wrong }), wrong).toThrow(/ADMIN_HOST: must be a host name/);
    }
  });

  it("in production, refuses the console without its own host, naming the variables only", () => {
    let message = "";
    try {
      getConfig({ ...production, ADMIN_CONSOLE: "on" } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("ADMIN_HOST: ADMIN_CONSOLE=on in production needs ADMIN_HOST");
    expect(getConfig({ ...production, ADMIN_CONSOLE: "on", ADMIN_HOST: "admin.linguva.app" } as NodeJS.ProcessEnv).ADMIN_CONSOLE).toBe("on");
    expect(getConfig({ ...production } as NodeJS.ProcessEnv).ADMIN_CONSOLE).toBe("off");
    // Elsewhere a host is optional (local development).
    expect(config({ ADMIN_CONSOLE: "on" }).ADMIN_HOST).toBeUndefined();
  });
});

describe("where the console answers", () => {
  it("nowhere while off: 404 before anything else", async () => {
    expect(adminConsoleAvailable(req("http://localhost:3000/admin"), config({}))).toBe(false);
    // The test environment leaves it off.
    await expect(requireAdminConsole(req("http://localhost:3000/admin"))).rejects.toMatchObject({ status: 404 });
  });

  it("only on ADMIN_HOST when set, whatever the case", () => {
    const on = config({ ADMIN_CONSOLE: "on", ADMIN_HOST: "admin.linguva.app" });
    expect(adminConsoleAvailable(req("https://admin.linguva.app/admin"), on)).toBe(true);
    expect(adminConsoleAvailable(req("https://ADMIN.linguva.app/admin"), on)).toBe(true);
    expect(adminConsoleAvailable(req("https://app.linguva.app/admin"), on)).toBe(false);
    expect(adminConsoleAvailable(req("https://admin.linguva.app.evil.example/admin"), on)).toBe(false);
    expect(adminConsoleAvailable(req("http://localhost:3000/admin"), config({ ADMIN_CONSOLE: "on" }))).toBe(true);
  });

  it("only over https on a hosted stage (Railway's proxy says so in X-Forwarded-Proto)", () => {
    const hosted = getConfig({ ...production, ADMIN_CONSOLE: "on", ADMIN_HOST: "admin.linguva.app" } as NodeJS.ProcessEnv);
    expect(adminConsoleAvailable(req("http://admin.linguva.app/admin", { "x-forwarded-proto": "https" }), hosted)).toBe(true);
    expect(adminConsoleAvailable(req("http://admin.linguva.app/admin"), hosted)).toBe(false);
    expect(adminConsoleAvailable(req("http://admin.linguva.app/admin", { "x-forwarded-proto": "https, http" }), hosted)).toBe(false);
  });
});

describe("roles", () => {
  it("grant view to all, refresh to owner, finance and support, prices to owner and finance", () => {
    const table = (["OWNER", "FINANCE", "SUPPORT", "READONLY"] as const).map((role) => [
      role,
      (["view", "refresh", "prices"] as const).filter((c) => roleCan(role, c)).join(","),
    ]);
    expect(table).toEqual([
      ["OWNER", "view,refresh,prices"],
      ["FINANCE", "view,refresh,prices"],
      ["SUPPORT", "view,refresh"],
      ["READONLY", "view"],
    ]);
  });
});

describe("after sign-in", () => {
  it("goes only to an /admin path of this site", () => {
    expect(safeNext("/admin/customers?q=shoe&plan=pro")).toBe("/admin/customers?q=shoe&plan=pro");
    expect(safeNext("/admin")).toBe("/admin");
    for (const wrong of [null, "", "/", "/app", "https://evil.example/admin", "//evil.example/admin", "/\\evil.example", "/admin\\..\\x", "/administrator", "/admin\n/x", "admin"]) {
      expect(safeNext(wrong), String(wrong)).toBe("/admin");
    }
  });
});

describe("cookies", () => {
  it("are __Host- prefixed and Secure over https, plain over local http", () => {
    expect(cookieName(req("https://admin.linguva.app/admin"))).toBe("__Host-lv_admin");
    expect(cookieName(req("http://admin.linguva.app/admin", { "x-forwarded-proto": "https" }))).toBe("__Host-lv_admin");
    expect(cookieName(req("http://localhost:3000/admin"))).toBe("lv_admin");
    // No request: the safe variant.
    expect(cookieName(null)).toBe("__Host-lv_admin");
    expect(clearCookie(req("https://admin.linguva.app/admin"))).toBe("__Host-lv_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
    expect(clearCookie(req("http://localhost:3000/admin"))).toBe("lv_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
  });

  it("are read under the scheme's own name only (no plain cookie planted over https), and only well-formed", () => {
    const https = (cookie: string) => sessionToken(req("https://admin.linguva.app/admin", { cookie }));
    expect(https(`other=1; __Host-lv_admin=${TOKEN}; lv_admin_lang=ar`)).toBe(TOKEN);
    expect(https(`lv_admin=${TOKEN}`)).toBeNull();
    expect(https(`__Host-lv_admin=${TOKEN.slice(1)}`)).toBeNull();
    expect(https(`__Host-lv_admin=${TOKEN}x`)).toBeNull();
    expect(https(`__Host-lv_admin=${"a".repeat(42)}+`)).toBeNull();
    expect(sessionToken(req("http://localhost:3000/admin", { cookie: `lv_admin=${TOKEN}` }))).toBe(TOKEN);
    expect(sessionToken(req("http://localhost:3000/admin", { cookie: `__Host-lv_admin=${TOKEN}` }))).toBeNull();
  });

  it("store only a hash, and derive the CSRF token from the secret", () => {
    expect(tokenHash(TOKEN)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(TOKEN)).not.toBe(TOKEN);
    expect(csrfTokenFor(TOKEN)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfTokenFor(TOKEN)).not.toBe(tokenHash(TOKEN));
    expect(csrfTokenFor("b".repeat(43))).not.toBe(csrfTokenFor(TOKEN));
  });
});

describe("request origin", () => {
  it("is the browser's: https behind Railway's proxy, with host and port", () => {
    expect(isHttps(req("http://admin.linguva.app/admin", { "x-forwarded-proto": "https" }))).toBe(true);
    expect(isHttps(req("http://admin.linguva.app/admin", { "x-forwarded-proto": "http" }))).toBe(false);
    expect(publicOrigin(req("http://admin.linguva.app/admin/x", { "x-forwarded-proto": "https" }))).toBe("https://admin.linguva.app");
    expect(publicOrigin(req("http://localhost:3000/admin"))).toBe("http://localhost:3000");
  });

  it("must match Origin when the browser sends one", () => {
    const post = (origin?: string) => req("http://localhost:3000/admin/login", origin ? { origin } : {}, "POST");
    expect(originAllowed(post())).toBe(true);
    expect(originAllowed(post("http://localhost:3000"))).toBe(true);
    for (const wrong of ["http://localhost:3001", "https://localhost:3000", "http://evil.example", "null"]) {
      expect(originAllowed(post(wrong)), wrong).toBe(false);
    }
  });
});

describe("the client of a sign-in attempt", () => {
  it("is the right-most X-Forwarded-For entry (the one Railway's proxy adds), else local", () => {
    expect(clientAddress(req("http://x/admin/login", { "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    // Entries on the left come from the client: a forged one doesn't give a new budget.
    expect(clientAddress(req("http://x/admin/login", { "x-forwarded-for": "198.51.100.1, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientAddress(req("http://x/admin/login"))).toBe("local");
    expect(clientAddress(req("http://x/admin/login", { "x-forwarded-for": " " }))).toBe("local");
  });
});

describe("logs", () => {
  it("redact an account row or a form logged by mistake", () => {
    const lines: string[] = [];
    const log = pino({ ...loggerOptions, level: "info" }, { write: (line: string) => void lines.push(line) });
    log.info({ user: { id: "u1", passwordHash: "scrypt$32768$8$3$salt$hash", totpSecret: "v1.k1.iv.tag.ct" }, form: { _csrf: "csrf-value", password: "pw-value" } }, "x");
    log.info({ ctx: { csrfToken: "csrf-token-value" } }, "y");
    const output = lines.join("");
    for (const value of ["scrypt$", "v1.k1", "csrf-value", "pw-value", "csrf-token-value"]) expect(output).not.toContain(value);
    expect(output).toContain('"id":"u1"');
  });
});
