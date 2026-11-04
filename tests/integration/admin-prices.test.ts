/**
 * The list prices set in the admin console (app/.server/admin/prices.ts)
 * against the real database as the runtime role: a save writes the changed
 * plans' PlanPrice rows, their history and the audit log in one
 * transaction, one writer at a time; a save from a form read before
 * another save is refused (nothing written); a value the database refuses
 * is the form's error; the website and the app's Plan page then show them
 * (German formatting as before), and the defaults stay exactly as they were
 * while no price is set.
 */
import { PrismaClient } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPriceTable, InvalidPriceTableError, invalidatePriceCache, loadPricesPage, parsePriceForm, pricesChangedSince, savePrices, type PriceVersions } from "../../app/.server/admin/prices";
import { loadPlanPage } from "../../app/.server/billing/plan-page";
import type { BillingStatus } from "../../app/.server/billing/subscription";
import { getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { sitePage } from "../../app/.server/site/pages";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { DEFAULT_PRICES, PLANS, type PriceTable } from "../../app/lib/plans";
import { loader as homeLoader } from "../../app/routes/_index/route";
import { loader as pricingLoader } from "../../app/routes/preise";
import { ownerDb, resetDatabase } from "../support/db";
import { FakeShopifyStore } from "../support/fake-store";

const app = new PrismaClient();
const HASH = `scrypt$32768$8$3$${"A".repeat(22)}$${"B".repeat(43)}`;
const args = (path: string) => ({ request: new Request(`https://linguva.example${path}`), params: {}, context: {} }) as unknown as LoaderFunctionArgs;
const admin = (email: string) => ownerDb.adminUser.create({ data: { email, passwordHash: HASH, totpSecret: "v1.k1.aaaa.bbbb.cccc", role: "FINANCE" } });
const table = (changes: Partial<PriceTable>): PriceTable => ({ ...DEFAULT_PRICES, ...changes });
/** The versions the Prices page shows now (what its form sends back). */
const versions = async (): Promise<PriceVersions> =>
  Object.fromEntries((await loadPricesPage({ client: app, config: getConfig() })).plans.map((plan) => [plan.handle, plan.version])) as unknown as PriceVersions;

beforeEach(async () => {
  await resetDatabase();
  invalidatePriceCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("saving prices", () => {
  it("writes only the changed plans, their history and the audit log; an unchanged table writes nothing", async () => {
    const finance = await admin("finance@linguva.test");
    expect(await getPriceTable(app)).toEqual(DEFAULT_PRICES);

    const first = table({ starter: { monthlyUsd: 34.99, yearlyUsd: 349.9 }, business: { monthlyUsd: 299, yearlyUsd: 2990 } });
    expect(await savePrices(first, "Launch prices", { userId: finance.id }, { client: app, expected: await versions() })).toEqual({ ok: true, changed: ["starter", "business"] });
    expect(await ownerDb.planPrice.findMany({ orderBy: { handle: "asc" }, select: { handle: true, monthlyCents: true, yearlyCents: true } })).toEqual([
      { handle: "business", monthlyCents: 29_900, yearlyCents: 299_000 },
      { handle: "starter", monthlyCents: 3_499, yearlyCents: 34_990 },
    ]);
    const history = await ownerDb.planPriceChange.findMany({ orderBy: { handle: "asc" } });
    expect(history.map((h) => [h.handle, h.oldMonthlyCents, h.oldYearlyCents, h.newMonthlyCents, h.newYearlyCents, h.reason, h.adminUserId])).toEqual([
      ["business", 29_900, null, 29_900, 299_000, "Launch prices", finance.id],
      ["starter", 2_900, 29_000, 3_499, 34_990, "Launch prices", finance.id],
    ]);
    const audit = await ownerDb.auditLog.findMany({ where: { action: "admin.prices.changed" }, orderBy: { targetId: "asc" } });
    expect(audit.map((a) => [a.actorType, a.actorId, a.targetType, a.targetId, a.shopId, a.metadata])).toEqual([
      ["ADMIN", finance.id, "PlanPrice", "business", null, { handle: "business", oldMonthlyCents: 29_900, oldYearlyCents: null, newMonthlyCents: 29_900, newYearlyCents: 299_000, reason: "Launch prices" }],
      ["ADMIN", finance.id, "PlanPrice", "starter", null, { handle: "starter", oldMonthlyCents: 2_900, oldYearlyCents: 29_000, newMonthlyCents: 3_499, newYearlyCents: 34_990, reason: "Launch prices" }],
    ]);
    // The cache was cleared: the next read shows the saved prices.
    expect(await getPriceTable(app)).toEqual(first);

    // The same table again: nothing changes, nothing is written.
    expect(await savePrices(first, "Again", { userId: finance.id }, { client: app })).toEqual({ ok: true, changed: [] });
    expect(await ownerDb.planPriceChange.count()).toBe(2);
    expect(await ownerDb.auditLog.count()).toBe(2);

    // Back to the default and yearly price removed: a row (never deleted) holding the default, history from the saved price.
    expect(await savePrices(DEFAULT_PRICES, "Back to the defaults", { userId: finance.id }, { client: app })).toEqual({ ok: true, changed: ["starter", "business"] });
    expect(await ownerDb.planPrice.findUniqueOrThrow({ where: { handle: "business" } })).toMatchObject({ monthlyCents: 29_900, yearlyCents: null });
    expect(await getPriceTable(app)).toEqual(DEFAULT_PRICES);
    const page = await loadPricesPage({ client: app, config: getConfig() });
    expect(page.plans.find((p) => p.handle === "starter")).toMatchObject({ isDefault: true, updatedAt: expect.any(String), lastChange: { reason: "Back to the defaults", by: "finance@linguva.test" } });
    expect(page.history.map((h) => [h.handle, h.newMonthlyUsd, h.newYearlyUsd])).toEqual(
      expect.arrayContaining([
        ["starter", 29, 290],
        ["business", 299, null],
        ["starter", 34.99, 349.9],
        ["business", 299, 2990],
      ]),
    );
    expect(page.history[0]!.reason).toBe("Back to the defaults");
  });

  it("lets one save at a time decide what 'before' is", async () => {
    const a = await admin("a@linguva.test");
    const b = await admin("b@linguva.test");
    await Promise.all([
      savePrices(table({ pro: { monthlyUsd: 109, yearlyUsd: 1090 } }), "First", { userId: a.id }, { client: app }),
      savePrices(table({ pro: { monthlyUsd: 119, yearlyUsd: 1190 } }), "Second", { userId: b.id }, { client: app }),
    ]);
    const changes = await ownerDb.planPriceChange.findMany();
    expect(changes).toHaveLength(2);
    // Whichever ran first changed the default; the second saw the first's price as its "before".
    const first = changes.find((c) => c.oldMonthlyCents === 9_900)!;
    const second = changes.find((c) => c !== first)!;
    expect(second.oldMonthlyCents).toBe(first.newMonthlyCents);
    expect(second.createdAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());
    expect((await getPriceTable(app)).pro.monthlyUsd).toBe(second.newMonthlyCents / 100);
  });

  it("refuses a form read before another save: two admins, one stale page, nothing reverted", async () => {
    const a = await admin("a@linguva.test");
    const b = await admin("b@linguva.test");
    // Both open the page while every price is the default.
    const seenByA = await versions();
    const seenByB = await versions();
    expect(seenByA).toEqual({ free: "default", starter: "default", pro: "default", business: "default", "own-key": "default" });
    expect(await savePrices(table({ starter: { monthlyUsd: 39, yearlyUsd: 390 } }), "Starter up", { userId: a.id }, { client: app, expected: seenByA })).toEqual({ ok: true, changed: ["starter"] });
    // B's form still holds Starter at 29/290 and raises Pro: refused, nothing written.
    expect(await pricesChangedSince(seenByB, app)).toEqual(["starter"]);
    const stale = table({ pro: { monthlyUsd: 109, yearlyUsd: 1090 } });
    expect(await savePrices(stale, "Pro up", { userId: b.id }, { client: app, expected: seenByB })).toEqual({ ok: false, conflict: ["starter"] });
    expect(await ownerDb.planPrice.findMany({ select: { handle: true, monthlyCents: true, yearlyCents: true } })).toEqual([{ handle: "starter", monthlyCents: 3_900, yearlyCents: 39_000 }]);
    expect((await ownerDb.planPriceChange.findMany()).map((c) => [c.handle, c.reason])).toEqual([["starter", "Starter up"]]);
    expect(await ownerDb.auditLog.count()).toBe(1);
    expect((await getPriceTable(app)).starter).toEqual({ monthlyUsd: 39, yearlyUsd: 390 });
    // After reading the page again (Starter at 39/390), B's save goes through and changes Pro only.
    const reread = await versions();
    expect(reread.starter).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\/3900\/39000$/);
    expect(await pricesChangedSince(reread, app)).toEqual([]);
    const current = table({ starter: { monthlyUsd: 39, yearlyUsd: 390 }, pro: { monthlyUsd: 109, yearlyUsd: 1090 } });
    expect(await savePrices(current, "Pro up", { userId: b.id }, { client: app, expected: reread })).toEqual({ ok: true, changed: ["pro"] });
    // A version that is missing never matches.
    expect(await savePrices(current, "No versions", { userId: b.id }, { client: app, expected: { ...reread, pro: "" } })).toEqual({ ok: false, conflict: ["pro"] });
  });

  it("refuses the second of two saves from the same page at the same moment (checked under the locks)", async () => {
    const a = await admin("a@linguva.test");
    const b = await admin("b@linguva.test");
    const seen = await versions();
    const results = await Promise.all([
      savePrices(table({ pro: { monthlyUsd: 109, yearlyUsd: 1090 } }), "First", { userId: a.id }, { client: app, expected: seen }),
      savePrices(table({ business: { monthlyUsd: 349, yearlyUsd: null } }), "Second", { userId: b.id }, { client: app, expected: seen }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok)!;
    const saved = results.find((r) => r.ok)!;
    // The refused one names the plan the other one saved; only that one is written.
    expect(refused).toEqual({ ok: false, conflict: saved.ok ? saved.changed : [] });
    expect(await ownerDb.planPriceChange.count()).toBe(1);
    expect(await ownerDb.planPrice.count()).toBe(1);
  });

  it("refuses a table the form wouldn't accept, and writes nothing", async () => {
    const a = await admin("a@linguva.test");
    const bad: PriceTable[] = [
      table({ free: { monthlyUsd: 1, yearlyUsd: null } }),
      table({ starter: { monthlyUsd: 0.5, yearlyUsd: null } }),
      table({ pro: { monthlyUsd: 99, yearlyUsd: 50 } }),
      table({ business: { monthlyUsd: 100_000.01, yearlyUsd: null } }),
      table({ "own-key": { monthlyUsd: Number.NaN, yearlyUsd: null } }),
      // Own key is monthly only (its plan in the Partner Dashboard).
      table({ "own-key": { monthlyUsd: 49, yearlyUsd: 490 } }),
    ];
    for (const t of bad) await expect(savePrices(t, "A reason", { userId: a.id }, { client: app })).rejects.toMatchObject({ field: "prices", code: "SAVE_REFUSED" });
    const pro = table({ pro: { monthlyUsd: 89, yearlyUsd: 890 } });
    await expect(savePrices(pro, " x ", { userId: a.id }, { client: app })).rejects.toBeInstanceOf(InvalidPriceTableError);
    // Counted as PostgreSQL counts (2 code points), and no NUL: refused before the database is asked.
    await expect(savePrices(pro, "📈a", { userId: a.id }, { client: app })).rejects.toMatchObject({ field: "reason", code: "REASON_REQUIRED" });
    await expect(savePrices(pro, "abc\u0000def", { userId: a.id }, { client: app })).rejects.toMatchObject({ field: "reason", code: "REASON_INVALID" });
    expect(await ownerDb.planPrice.count()).toBe(0);
    expect(await ownerDb.planPriceChange.count()).toBe(0);
  });

  it("turns a value the database refuses into the form's error, and writes nothing", async () => {
    const a = await admin("a@linguva.test");
    // A client that writes something else than it was given, past every check in the code: the database's CHECKs and encoding are the last line.
    const tampered = (change: { reason?: string; monthlyCents?: number }) =>
      new Proxy(app, {
        get(target, key, receiver) {
          if (key !== "$transaction") return Reflect.get(target, key, receiver);
          return (fn: (tx: unknown) => Promise<unknown>) =>
            app.$transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(inner, name, r) {
                    if (name === "planPriceChange" && change.reason !== undefined) {
                      return { createMany: (args: { data: object[] }) => inner.planPriceChange.createMany({ data: args.data.map((d) => ({ ...d, reason: change.reason })) as never }) };
                    }
                    if (name === "planPrice" && change.monthlyCents !== undefined) {
                      return { upsert: (args: { where: { handle: string } }) => inner.planPrice.upsert({ where: args.where, create: { handle: args.where.handle, monthlyCents: change.monthlyCents! }, update: { monthlyCents: change.monthlyCents! } }) };
                    }
                    return Reflect.get(inner, name, r);
                  },
                }),
              ),
            );
        },
      }) as PrismaClient;
    const pro = table({ pro: { monthlyUsd: 89, yearlyUsd: 890 } });
    await expect(savePrices(pro, "A reason", { userId: a.id }, { client: tampered({ reason: "📈a" }) })).rejects.toMatchObject({ field: "reason", code: "REASON_REQUIRED" });
    await expect(savePrices(pro, "A reason", { userId: a.id }, { client: tampered({ reason: "abc\u0000def" }) })).rejects.toMatchObject({ field: "reason", code: "REASON_INVALID" });
    await expect(savePrices(pro, "A reason", { userId: a.id }, { client: tampered({ monthlyCents: 50 }) })).rejects.toMatchObject({ field: "prices", code: "SAVE_REFUSED" });
    expect(await ownerDb.planPrice.count()).toBe(0);
    expect(await ownerDb.planPriceChange.count()).toBe(0);
    expect(await ownerDb.auditLog.count()).toBe(0);
  });

  it("saves what the form parsed (cents exact)", async () => {
    const a = await admin("a@linguva.test");
    const form = new FormData();
    for (const [handle, price] of Object.entries(DEFAULT_PRICES)) {
      form.set(`${handle}.monthly`, String(price.monthlyUsd));
      form.set(`${handle}.yearly`, price.yearlyUsd === null ? "" : String(price.yearlyUsd));
    }
    form.set("starter.monthly", "19,99");
    form.set("starter.yearly", "199.9");
    form.set("reason", "Cheaper start");
    form.set("code", "123 456");
    const parsed = parsePriceForm(form);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.code).toBe("123456");
    expect(await savePrices(parsed.table, parsed.reason, { userId: a.id }, { client: app, expected: parsed.versions })).toEqual({ ok: false, conflict: ["free", "starter", "pro", "business", "own-key"] });
    for (const [handle, version] of Object.entries(await versions())) form.set(`${handle}.version`, version);
    const fresh = parsePriceForm(form);
    if (!fresh.ok) throw new Error(JSON.stringify(fresh.errors));
    expect(await savePrices(fresh.table, fresh.reason, { userId: a.id }, { client: app, expected: fresh.versions })).toEqual({ ok: true, changed: ["starter"] });
    expect(await ownerDb.planPrice.findUniqueOrThrow({ where: { handle: "starter" } })).toMatchObject({ monthlyCents: 1_999, yearlyCents: 19_990 });
  });
});

describe("where the prices show", () => {
  it("the website: the defaults byte for byte while none is set, the saved prices after a save", async () => {
    const config = getConfig();
    for (const [loader, path, page] of [
      [pricingLoader, "/preise", "pricing"],
      [homeLoader, "/", "home"],
    ] as const) {
      const response = (await loader(args(path))) as Response;
      expect(await response.text(), path).toBe(await sitePage(new Request(`https://linguva.example${path}`), page, config).text());
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    }

    const a = await admin("a@linguva.test");
    await savePrices(table({ starter: { monthlyUsd: 19.99, yearlyUsd: null }, pro: { monthlyUsd: 1290, yearlyUsd: 12_900 } }), "Test", { userId: a.id }, { client: app });
    const pricing = await ((await pricingLoader(args("/preise"))) as Response).text();
    expect(pricing).toContain('<span class="amt">19,99&nbsp;$</span>');
    expect(pricing).toContain('<p class="plan-year">Nur monatlich</p>\n<hr>');
    expect(pricing).toContain('<span class="amt">1.290&nbsp;$</span>');
    expect(pricing).toContain('<p class="plan-year">oder 12.900&nbsp;$ / Jahr <span class="tag">2 Monate gratis</span></p>');
    expect(pricing).toContain('<span class="rd">Pro auch jährlich: 2 Monate gratis</span>');
    expect(pricing).toContain('<td role="cell">19,99&nbsp;$</td><td role="cell">1.290&nbsp;$</td><td role="cell">299&nbsp;$</td>');
    expect(pricing).not.toMatch(/<!--\/?price/);
    const home = await ((await homeLoader(args("/"))) as Response).text();
    expect(home).toContain("Kostenlos oder ab 19,99&nbsp;$ im Monat.");
    expect(home).toContain('<p class="pp">19,99&nbsp;$ <span class="per">/ Monat</span></p>');
    // Shopify's link to the app still goes to the app, before any price is read.
    await expect(homeLoader(args("/?shop=x.myshopify.com"))).rejects.toMatchObject({ status: 302 });
  });

  it("the app's Plan page: the table, and Own key's price from it", async () => {
    vi.stubEnv("TRANSLATION_PROVIDER", "mock");
    resetConfigCache();
    const a = await admin("a@linguva.test");
    // Own key is monthly only (the console takes no yearly price for it).
    const own = { monthlyUsd: 59, yearlyUsd: null };
    const prices = table({ pro: { monthlyUsd: 89, yearlyUsd: 890 }, "own-key": own });
    await savePrices(prices, "Test", { userId: a.id }, { client: app });
    const { shop } = await upsertInstalledShop({ shopDomain: "plan-prices.myshopify.com" }, app);
    const billing: BillingStatus = { configured: false, state: "ACTIVE", entitlements: { ...PLANS.business, plan: "unmetered" }, subscription: null, stale: false, mustChoosePlan: false };
    const page = await loadPlanPage({ admin: new FakeShopifyStore(2).asAdmin(), shop, billing: Promise.resolve(billing), welcome: false }, app);
    expect(page.prices).toEqual(prices);
    expect(page.ownKeyPlan.price).toEqual(own);
    vi.unstubAllEnvs();
    resetConfigCache();
  });
});
