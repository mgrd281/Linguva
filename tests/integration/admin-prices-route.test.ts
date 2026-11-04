/**
 * The Prices page's save (app/routes/admin.prices.tsx) end to end against
 * the real database as the runtime role: signed-in admins post the form the
 * page renders (every plan's version included). A form read before another
 * admin's save is refused with 409 before the authenticator code is used,
 * nothing is written, and the page reads the current prices again; read
 * again, the same save goes through. A refused reason is the form's error.
 */
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminCipher, requireAdmin } from "../../app/.server/admin/auth";
import { signIn } from "../../app/.server/admin/login";
import { hashPassword } from "../../app/.server/admin/password";
import { invalidatePriceCache, type PricesPageData } from "../../app/.server/admin/prices";
import { base32Decode, generateTotpSecret, hotp, sealTotpSecret, totpStep } from "../../app/.server/admin/totp";
import { resetConfigCache } from "../../app/.server/lib/config";
import { MemoryCounters } from "../../app/.server/usage/request-limits";
import type { PricesActionData } from "../../app/components/admin/PricesView";
import { action, loader, shouldRevalidate } from "../../app/routes/admin.prices";
import { ownerDb, resetDatabase } from "../support/db";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct horse battery staple";

type Admin = { id: string; secret: string; cookie: string; csrf: string };

/** An account as `pnpm ops:admin add` creates it, signed in a while ago (its sign-in code is an older one). */
async function signedInAdmin(email: string): Promise<Admin> {
  const id = randomUUID();
  const secret = generateTotpSecret();
  await ownerDb.adminUser.create({ data: { id, email, role: "FINANCE", passwordHash: await hashPassword(PASSWORD), totpSecret: sealTotpSecret(adminCipher(), id, secret) } });
  const at = new Date(Date.now() - 120_000);
  const result = await signIn(new Request(`${ORIGIN}/admin/login`, { method: "POST", headers: { origin: ORIGIN } }), { email, password: PASSWORD, code: codeAt(secret, at) }, { counters: new MemoryCounters(), now: at });
  if (!result.ok) throw new Error(`sign-in failed: ${result.error}`);
  const cookie = result.cookie.split(";")[0]!;
  const { csrfToken } = await requireAdmin(new Request(`${ORIGIN}/admin`, { headers: { cookie } }));
  return { id, secret, cookie, csrf: csrfToken };
}

const codeAt = (secret: string, at: Date) => hotp(base32Decode(secret)!, totpStep(at.getTime()));

async function openPage(admin: Admin): Promise<PricesPageData> {
  const args = { request: new Request(`${ORIGIN}/admin/prices`, { headers: { cookie: admin.cookie } }), params: {}, context: {} } as unknown as LoaderFunctionArgs;
  return (await loader(args)).page;
}

/** What the page's form posts: every price as shown (Own key without a yearly field), every version, then the admin's changes. */
async function save(admin: Admin, page: PricesPageData, changes: Record<string, string>) {
  const form = new URLSearchParams({ _csrf: admin.csrf, reason: "Price review", code: codeAt(admin.secret, new Date()) });
  for (const plan of page.plans) {
    form.set(`${plan.handle}.version`, plan.version);
    if (plan.handle === "free") continue;
    form.set(`${plan.handle}.monthly`, String(plan.monthlyUsd));
    if (plan.offersYearly) form.set(`${plan.handle}.yearly`, plan.yearlyUsd === null ? "" : String(plan.yearlyUsd));
  }
  for (const [name, value] of Object.entries(changes)) form.set(name, value);
  const request = new Request(`${ORIGIN}/admin/prices`, { method: "POST", body: form, headers: { cookie: admin.cookie, origin: ORIGIN } });
  const result = (await action({ request, params: {}, context: {} } as unknown as ActionFunctionArgs)) as unknown as { data: PricesActionData; init: { status?: number } | null };
  return { status: result.init?.status ?? 200, body: result.data };
}

const env = { ADMIN_CONSOLE: process.env.ADMIN_CONSOLE, ADMIN_HOST: process.env.ADMIN_HOST };
beforeAll(() => {
  process.env.ADMIN_CONSOLE = "on";
  delete process.env.ADMIN_HOST;
  resetConfigCache();
});
beforeEach(async () => {
  await resetDatabase();
  invalidatePriceCache();
});
afterAll(async () => {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetConfigCache();
  await ownerDb.$disconnect();
});

describe("saving the Prices form", () => {
  it("refuses a page read before another admin's save (409, code unused, nothing written), and saves once read again", async () => {
    const a = await signedInAdmin("a@linguva.test");
    const b = await signedInAdmin("b@linguva.test");
    const pageA = await openPage(a);
    const pageB = await openPage(b);

    expect(await save(a, pageA, { "starter.monthly": "39", "starter.yearly": "390", reason: "Starter up" })).toEqual({
      status: 200,
      body: { ok: true, changed: ["starter"], savedAt: expect.any(String) },
    });
    // B's page still shows Starter at 29/290 and B raises Pro: refused, and Starter keeps A's price.
    const before = await ownerDb.adminUser.findUniqueOrThrow({ where: { id: b.id }, select: { lastTotpStep: true } });
    const refused = await save(b, pageB, { "pro.monthly": "109", "pro.yearly": "1090", reason: "  Pro   up " });
    expect(refused).toEqual({ status: 409, body: { ok: false, conflict: ["starter"], errors: {}, values: { reason: "  Pro   up " } } });
    expect(await ownerDb.planPrice.findMany({ select: { handle: true, monthlyCents: true, yearlyCents: true } })).toEqual([{ handle: "starter", monthlyCents: 3_900, yearlyCents: 39_000 }]);
    expect((await ownerDb.planPriceChange.findMany()).map((c) => [c.handle, c.newMonthlyCents, c.reason])).toEqual([["starter", 3_900, "Starter up"]]);
    // B's code wasn't used up.
    expect(await ownerDb.adminUser.findUniqueOrThrow({ where: { id: b.id }, select: { lastTotpStep: true } })).toEqual(before);
    // The page reads the prices again after a conflict (React Router skips that after other refusals).
    const args = (actionStatus: number) => ({ actionStatus, defaultShouldRevalidate: actionStatus < 400 }) as ShouldRevalidateFunctionArgs;
    expect([shouldRevalidate(args(409)), shouldRevalidate(args(400)), shouldRevalidate(args(200))]).toEqual([true, false, true]);

    const reread = await openPage(b);
    expect(reread.plans.find((p) => p.handle === "starter")).toMatchObject({ monthlyUsd: 39, yearlyUsd: 390 });
    expect(await save(b, reread, { "pro.monthly": "109", "pro.yearly": "1090", reason: "Pro up" })).toMatchObject({ status: 200, body: { ok: true, changed: ["pro"] } });
    expect(await ownerDb.planPrice.findMany({ orderBy: { handle: "asc" }, select: { handle: true, monthlyCents: true } })).toEqual([
      { handle: "pro", monthlyCents: 10_900 },
      { handle: "starter", monthlyCents: 3_900 },
    ]);
  });

  it("answers a refused reason or an Own key yearly price with the form's error, never an error page", async () => {
    const a = await signedInAdmin("a@linguva.test");
    const page = await openPage(a);
    expect(await save(a, page, { "pro.monthly": "109", reason: "📈a" })).toMatchObject({ status: 400, body: { ok: false, errors: { reason: "REASON_REQUIRED" } } });
    expect(await save(a, page, { "pro.monthly": "109", reason: "abc\u0000def" })).toMatchObject({ status: 400, body: { ok: false, errors: { reason: "REASON_INVALID" } } });
    expect(await save(a, page, { "own-key.yearly": "490" })).toMatchObject({ status: 400, body: { ok: false, errors: { "own-key.yearly": "MONTHLY_ONLY" } } });
    expect(await ownerDb.planPriceChange.count()).toBe(0);
  });
});
