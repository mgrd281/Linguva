/**
 * The console's sign-in, sign-out and frame routes as React Router serves
 * them (its own request handler with the real route modules, against the
 * real database as the runtime role): every answer carries the console's
 * headers, including the ones React Router returns as they are, past
 * entry.server (a redirect thrown on a page request, a resource route's
 * Response); GET /admin/logout answers like any console URL; a `next` that
 * can't be a Location header ends on /admin instead of an error after the
 * sign-in (docs/SECURITY_MODEL.md §5s).
 */
import { randomUUID } from "node:crypto";
import { createRequestHandler, type ServerBuild } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminCipher, requireAdmin } from "../../app/.server/admin/auth";
import { signIn } from "../../app/.server/admin/login";
import { hashPassword } from "../../app/.server/admin/password";
import { readSession } from "../../app/.server/admin/session";
import { base32Decode, generateTotpSecret, hotp, sealTotpSecret, totpStep } from "../../app/.server/admin/totp";
import { resetConfigCache } from "../../app/.server/lib/config";
import { addSecurityHeaders } from "../../app/.server/lib/security-headers";
import { MemoryCounters } from "../../app/.server/usage/request-limits";
import * as frame from "../../app/routes/admin";
import * as login from "../../app/routes/admin_.login";
import * as logout from "../../app/routes/admin_.logout";
import { ownerDb, resetDatabase } from "../support/db";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

/** What entry.server does with the responses React Router hands it: pages (handleRequest) and data requests. */
const errors: unknown[] = [];
const entry = {
  default: (request: Request, status: number, headers: Headers) => {
    addSecurityHeaders(request, headers, { document: true, scriptNonce: "bm9uY2U=" });
    return new Response("<!doctype html><title>page</title>", { status, headers });
  },
  handleDataRequest: (response: Response, { request }: { request: Request }) => {
    addSecurityHeaders(request, response.headers, { document: false });
    return response;
  },
  // As entry.server: Responses thrown on purpose are no errors.
  handleError: (error: unknown, { request }: { request: Request }) => {
    if (!request.signal.aborted && !(error instanceof Response)) errors.push(error);
  },
};

const routes = {
  root: { id: "root", path: "", module: { default: () => null } },
  "routes/admin": { id: "routes/admin", parentId: "root", path: "admin", module: frame },
  "routes/admin_.login": { id: "routes/admin_.login", parentId: "root", path: "admin/login", module: login },
  "routes/admin_.logout": { id: "routes/admin_.logout", parentId: "root", path: "admin/logout", module: logout },
};
const build = {
  entry: { module: entry },
  routes,
  assets: {
    url: "/manifest.js",
    version: "test",
    entry: { module: "/entry.client.js", imports: [] },
    routes: Object.fromEntries(
      Object.values(routes).map((r) => [
        r.id,
        { id: r.id, parentId: "parentId" in r ? r.parentId : undefined, path: r.path, module: `/${r.id}.js`, hasLoader: "loader" in r.module, hasAction: "action" in r.module, hasClientLoader: false, hasClientAction: false, hasErrorBoundary: "ErrorBoundary" in r.module },
      ]),
    ),
  },
  future: {},
  basename: "/",
  publicPath: "/",
  assetsBuildDirectory: "/tmp",
  isSpaMode: false,
  ssr: true,
  prerender: [],
  routeDiscovery: { mode: "lazy", manifestPath: "/__manifest" },
} as unknown as ServerBuild;
const handle = createRequestHandler(build, "production");

/** A request as Railway's proxy forwards it: its own client address, so the per-client limit (in Redis) is this test's. */
const client = `198.18.1.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 8)}`;
function request(path: string, { method = "GET", cookie, form }: { method?: string; cookie?: string; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": client };
  if (cookie) headers.cookie = cookie;
  if (method !== "GET" && method !== "HEAD") headers.origin = ORIGIN;
  if (form) headers["content-type"] = "application/x-www-form-urlencoded";
  return new Request(`${ORIGIN}${path}`, { method, headers, body: form ? new URLSearchParams(form) : undefined });
}

/** The console's headers, on every answer (the policy is the development one: NODE_ENV=test). */
function expectConsoleHeaders(response: Response, what: string) {
  expect(response.headers.get("Cache-Control"), what).toBe("no-store");
  expect(response.headers.get("X-Frame-Options"), what).toBe("DENY");
  expect(response.headers.get("X-Robots-Tag"), what).toBe("noindex, nofollow");
  expect(response.headers.get("Referrer-Policy"), what).toBe("same-origin");
  expect(response.headers.get("X-Content-Type-Options"), what).toBe("nosniff");
  expect(response.headers.get("Content-Security-Policy"), what).toMatch(/^default-src 'none'; .*frame-ancestors 'none'/);
}

async function seedAdmin(email = "owner@example.com") {
  const id = randomUUID();
  const secret = generateTotpSecret();
  await ownerDb.adminUser.create({
    data: { id, email, role: "OWNER", passwordHash: await hashPassword(PASSWORD), totpSecret: sealTotpSecret(adminCipher(), id, secret) },
  });
  return { id, email, secret };
}
const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret)!, totpStep(at.getTime()));

async function sessionCookie(user: { email: string; secret: string }) {
  const now = new Date();
  const result = await signIn(new Request(`${ORIGIN}/admin/login`, { method: "POST", headers: { origin: ORIGIN } }), { email: user.email, password: PASSWORD, code: codeAt(user.secret, now) }, { counters: new MemoryCounters(), now });
  if (!result.ok) throw new Error(`sign-in failed: ${result.error}`);
  return result.cookie.split(";")[0]!;
}

const setConsole = (value: "on" | "off") => {
  process.env.ADMIN_CONSOLE = value;
  resetConfigCache();
};
const env = { ADMIN_CONSOLE: process.env.ADMIN_CONSOLE, ADMIN_HOST: process.env.ADMIN_HOST };
beforeAll(() => {
  delete process.env.ADMIN_HOST;
  setConsole("on");
});
beforeEach(async () => {
  await resetDatabase();
  errors.length = 0;
  setConsole("on");
});
afterAll(async () => {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetConfigCache();
  await ownerDb.$disconnect();
});

describe("while the console is off", () => {
  it("every console URL answers 404 with the console's headers, /admin/logout too, and nothing is logged as an error", async () => {
    setConsole("off");
    for (const [method, path] of [
      ["GET", "/admin/logout"],
      ["HEAD", "/admin/logout"],
      ["POST", "/admin/logout"],
      ["GET", "/admin/logout.data"],
      ["GET", "/admin"],
      ["GET", "/admin/login"],
      ["POST", "/admin/login"],
      ["GET", "/admin/login.data"],
    ] as const) {
      const response = await handle(request(path, { method, form: method === "POST" ? { email: "x@example.com" } : undefined }));
      expect(response.status, `${method} ${path}`).toBe(404);
      expectConsoleHeaders(response, `${method} ${path}`);
    }
    expect(errors).toEqual([]);
    expect(await ownerDb.auditLog.count()).toBe(0);
  });
});

describe("signing out", () => {
  it("GET and HEAD /admin/logout sign nobody out: to the sign-in page without a session, else to the console", async () => {
    for (const [method, next] of [["GET", "?next=%2Fadmin%2Flogout"], ["HEAD", ""]]) {
      const anonymous = await handle(request("/admin/logout", { method }));
      expect([anonymous.status, anonymous.headers.get("Location")], method).toEqual([302, `/admin/login${next}`]);
      expectConsoleHeaders(anonymous, `${method} without a session`);
    }
    const cookie = await sessionCookie(await seedAdmin());
    const signedIn = await handle(request("/admin/logout", { cookie }));
    expect([signedIn.status, signedIn.headers.get("Location"), signedIn.headers.get("Set-Cookie")]).toEqual([302, "/admin", null]);
    expectConsoleHeaders(signedIn, "GET signed in");
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("the frame's form (POST without JavaScript) ends the session; without the CSRF token: 403, with the headers too", async () => {
    const user = await seedAdmin();
    const cookie = await sessionCookie(user);
    const refused = await handle(request("/admin/logout", { method: "POST", cookie, form: { _csrf: "wrong" } }));
    expect(refused.status).toBe(403);
    expectConsoleHeaders(refused, "POST without the token");
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).not.toBeNull();

    const { csrfToken } = await requireAdmin(new Request(`${ORIGIN}/admin`, { headers: { cookie } }));
    const out = await handle(request("/admin/logout", { method: "POST", cookie, form: { _csrf: csrfToken } }));
    expect([out.status, out.headers.get("Location"), out.headers.get("Set-Cookie")]).toEqual([303, "/admin/login", "lv_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"]);
    expectConsoleHeaders(out, "POST signed out");
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).toBeNull();
  });
});

describe("the console's redirects on page requests (returned past entry.server)", () => {
  it("to the sign-in page, the language switch and on to the console when signed in", async () => {
    const toSignIn = await handle(request("/admin?q=shoe"));
    expect([toSignIn.status, toSignIn.headers.get("Location")]).toEqual([302, "/admin/login?next=%2Fadmin%3Fq%3Dshoe"]);
    expectConsoleHeaders(toSignIn, "GET /admin without a session");

    const language = await handle(request("/admin/login?lang=ar&next=%2Fadmin%2Fprices"));
    expect([language.status, language.headers.get("Location"), language.headers.get("Set-Cookie")]).toEqual([
      302,
      "/admin/login?next=%2Fadmin%2Fprices",
      "lv_admin_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax",
    ]);
    expectConsoleHeaders(language, "GET /admin/login?lang=ar");

    const cookie = await sessionCookie(await seedAdmin());
    const onwards = await handle(request("/admin/login?next=%2Fadmin%2Fprices", { cookie }));
    expect([onwards.status, onwards.headers.get("Location")]).toEqual([302, "/admin/prices"]);
    expectConsoleHeaders(onwards, "GET /admin/login signed in");
    // The sign-in page itself, and its data request.
    const page = await handle(request("/admin/login"));
    expect(page.status).toBe(200);
    expectConsoleHeaders(page, "GET /admin/login");
    expectConsoleHeaders(await handle(request("/admin/login.data")), "GET /admin/login.data");
    expect(errors).toEqual([]);
  });

  it("signing in without JavaScript: the session cookie's redirect carries them, a refusal's page too", async () => {
    const user = await seedAdmin();
    const wrong = await handle(request("/admin/login", { method: "POST", form: { email: user.email, password: "wrong password here", code: "000000", next: "/admin/prices" } }));
    expect(wrong.status).toBe(401);
    expectConsoleHeaders(wrong, "POST /admin/login wrong");

    const now = new Date();
    const right = await handle(request("/admin/login", { method: "POST", form: { email: user.email, password: PASSWORD, code: codeAt(user.secret, now), next: "/admin/prices" } }));
    expect([right.status, right.headers.get("Location")]).toEqual([303, "/admin/prices"]);
    expect(right.headers.get("Set-Cookie")).toMatch(/^lv_admin=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Strict$/);
    expectConsoleHeaders(right, "POST /admin/login right");
    expect(errors).toEqual([]);
  });
});

describe("a next that can't be a Location header", () => {
  const LINE_SEPARATOR = "/admin/%E2%80%A8";

  it("ends a successful sign-in on /admin, with its session, instead of an error page", async () => {
    const user = await seedAdmin();
    const now = new Date();
    const response = await handle(
      request(`/admin/login?next=${encodeURIComponent(decodeURIComponent(LINE_SEPARATOR))}`, {
        method: "POST",
        form: { email: user.email, password: PASSWORD, code: codeAt(user.secret, now), next: decodeURIComponent(LINE_SEPARATOR) },
      }),
    );
    expect([response.status, response.headers.get("Location")]).toEqual([303, "/admin"]);
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
    expect(await readSession(new Request(`${ORIGIN}/admin`, { headers: { cookie } }))).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("sends a signed-in visitor of the sign-in page on to /admin; the encoded path stays a path of the console's", async () => {
    const cookie = await sessionCookie(await seedAdmin());
    const decoded = await handle(request(`/admin/login?next=${LINE_SEPARATOR}`, { cookie }));
    expect([decoded.status, decoded.headers.get("Location")]).toEqual([302, "/admin"]);
    const encoded = await handle(request(`/admin/login?next=${encodeURIComponent(LINE_SEPARATOR)}`, { cookie }));
    expect([encoded.status, encoded.headers.get("Location")]).toEqual([302, LINE_SEPARATOR]);
    expect(errors).toEqual([]);
  });
});
