/**
 * The admin console's data across shops (app/.server/admin/directory.ts,
 * overview.ts, customer.ts, activity.ts) against the real database as the
 * runtime role: every tenant table is read inside its own shop's tenant, so
 * two shops' rows never mix, and nothing is readable without one. Plans,
 * trials, complimentary access and the revenue estimate follow the cached
 * subscriptions and the list prices; "ask Shopify again" refreshes one
 * store's cache through a fake Partner API and is audited.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadActivity } from "../../app/.server/admin/activity";
import { loadCustomer, recentPeriods, refreshCustomerSubscription, shopifyAdminUrl } from "../../app/.server/admin/customer";
import { filterRows, invalidateDirectoryCache, loadDirectory, type ShopRow } from "../../app/.server/admin/directory";
import { summarize } from "../../app/.server/admin/overview";
import { invalidatePriceCache, savePrices } from "../../app/.server/admin/prices";
import { grantComplimentaryAccess } from "../../app/.server/billing/complimentary";
import { getConfig } from "../../app/.server/lib/config";
import { markShopUninstalled, upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { periodKey } from "../../app/.server/usage/usage-ledger";
import { DEFAULT_PRICES } from "../../app/lib/plans";
import { ownerDb, resetDatabase } from "../support/db";
import { fakePartnerApi, PARTNER_SETTINGS } from "../support/fake-partner-api";

const app = new PrismaClient();
const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const GID = (n: number) => `gid://shopify/Shop/${9_000 + n}`;
const BILLING = {
  SHOPIFY_PARTNER_ORG_ID: PARTNER_SETTINGS.orgId,
  SHOPIFY_PARTNER_API_TOKEN: PARTNER_SETTINGS.token,
  SHOPIFY_APP_GID: PARTNER_SETTINGS.appGid,
  SHOPIFY_APP_HANDLE: "linguva",
};
const billingOn = getConfig({ ...process.env, ...BILLING, COMPLIMENTARY_SHOP_GIDS: GID(4) });
const billingOff = getConfig({ ...process.env });

let seq = 0;
async function shop(name: string, gid: number | null = null) {
  const { shop } = await upsertInstalledShop({ shopDomain: `${name}.myshopify.com`, name: `Store ${name}`, shopifyShopGid: gid === null ? null : GID(gid) }, app);
  return shop;
}
type Sub = {
  state?: "ACTIVE" | "NONE";
  planHandle?: string | null;
  billingPeriod?: string | null;
  trialEndsAt?: Date | null;
  cancelAtEndOfCycle?: boolean;
  pendingPlanHandle?: string | null;
  currentPeriodEnd?: Date;
  checkedAt?: Date;
};
async function subscribe(shopId: string, sub: Sub) {
  await withTenant(
    shopId,
    (tx) =>
      tx.shopSubscription.create({
        data: {
          shopId,
          state: sub.state ?? "ACTIVE",
          planHandle: sub.planHandle ?? null,
          billingPeriod: sub.billingPeriod ?? "EVERY_30_DAYS",
          trialEndsAt: sub.trialEndsAt ?? null,
          cancelAtEndOfCycle: sub.cancelAtEndOfCycle ?? false,
          pendingPlanHandle: sub.pendingPlanHandle ?? null,
          currentPeriodEnd: sub.currentPeriodEnd ?? new Date(NOW.getTime() + 20 * DAY),
          checkedAt: sub.checkedAt ?? NOW,
        },
      }),
    app,
  );
}
async function use(shopId: string, chars: number, extra: { provider?: string | null; payer?: string | null; period?: string } = {}) {
  await withTenant(
    shopId,
    (tx) =>
      tx.usageLedger.create({
        data: {
          shopId,
          periodKey: extra.period ?? periodKey(NOW),
          kind: "RESERVE",
          chars,
          provider: extra.provider === undefined ? "deepl" : extra.provider,
          payer: extra.payer ?? null,
          idempotencyKey: `admin-data-${++seq}`,
        },
      }),
    app,
  );
}
async function locales(shopId: string, codes: string[]) {
  await withTenant(
    shopId,
    (tx) => tx.shopLocale.createMany({ data: codes.map((locale, i) => ({ shopId, locale, name: locale, primary: i === 0, published: true, syncedAt: NOW })) }),
    app,
  );
}
async function job(shopId: string, status: "COMPLETED" | "FAILED", createdAt: Date) {
  await withTenant(
    shopId,
    (tx) => tx.translationJob.create({ data: { shopId, resourceType: "PRODUCT", targetLocale: "fr", status, idempotencyKey: `job-${++seq}`, createdAt } }),
    app,
  );
}
const byDomain = (rows: ShopRow[], name: string) => rows.find((r) => r.shopDomain === `${name}.myshopify.com`)!;

beforeEach(async () => {
  await resetDatabase();
  invalidateDirectoryCache();
  invalidatePriceCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

describe("two shops' rows never mix", () => {
  it("reads each shop's usage, languages and jobs inside its own tenant; nothing without one", async () => {
    const a = await shop("alpha", 1);
    const b = await shop("beta", 2);
    await subscribe(a.id, { planHandle: "pro" });
    await subscribe(b.id, { planHandle: "starter" });
    await use(a.id, 1_000);
    await use(a.id, 500, { provider: "azure" });
    await use(a.id, 200, { payer: "merchant" });
    await use(a.id, 99_999, { period: "2020-01" });
    await use(b.id, 70, { provider: null });
    await locales(a.id, ["de", "en", "fr"]);
    await locales(b.id, ["en"]);
    await job(a.id, "COMPLETED", new Date(NOW.getTime() - DAY));

    // The runtime role sees no tenant row outside a tenant, and only the tenant's own inside it.
    expect(await app.usageLedger.findMany()).toEqual([]);
    expect(await app.shopSubscription.findMany()).toEqual([]);
    expect(await app.shopLocale.findMany()).toEqual([]);
    const seenByA = await withTenant(a.id, (tx) => tx.usageLedger.findMany({ select: { shopId: true } }), app);
    expect(new Set(seenByA.map((r) => r.shopId))).toEqual(new Set([a.id]));
    const seenByB = await withTenant(b.id, (tx) => tx.shopLocale.findMany({ select: { shopId: true } }), app);
    expect(seenByB.map((r) => r.shopId)).toEqual([b.id]);
    // A shop's tenant can't read another shop's rows, even when asked for them by id.
    expect(await withTenant(b.id, (tx) => tx.usageLedger.findMany({ where: { shopId: a.id } }), app)).toEqual([]);

    const dir = await loadDirectory({ client: app, now: NOW, config: billingOff, force: true });
    const rowA = byDomain(dir.rows, "alpha");
    const rowB = byDomain(dir.rows, "beta");
    // DeepL 25 and Azure 10 per million (the test configuration's defaults): 1000 × 25/1M + 500 × 10/1M = $0.03.
    expect(rowA.usage).toEqual({ chars: 1_500, ownKeyChars: 200, costUsd: 0.03 });
    expect(rowA.languages).toBe(2);
    expect(rowA.lastJobAt).not.toBeNull();
    expect(rowB.usage).toEqual({ chars: 70, ownKeyChars: 0, costUsd: 0 });
    expect(rowB.languages).toBe(0);
    expect(rowB.lastJobAt).toBeNull();
    expect(rowA.subscription?.planHandle).toBe("pro");
    expect(rowB.subscription?.planHandle).toBe("starter");
  });
});

describe("plans, trials and revenue", () => {
  it("maps every kind of store and estimates the revenue from the list prices in cents", async () => {
    const pro = await shop("pro-monthly", 1);
    const annual = await shop("starter-annual", 2);
    const trial = await shop("business-trial", 3);
    const comp = await shop("owner-store", 4);
    const gone = await shop("uninstalled", 5);
    const own = await shop("own-key-store", 6);
    await shop("never-checked", 7);
    const none = await shop("no-plan", 8);
    const odd = await shop("odd-plan", 9);
    await subscribe(pro.id, { planHandle: "pro", cancelAtEndOfCycle: true });
    await subscribe(annual.id, { planHandle: "starter", billingPeriod: "ANNUAL", pendingPlanHandle: "pro" });
    await subscribe(trial.id, { planHandle: "business", trialEndsAt: new Date(NOW.getTime() + 3 * DAY) });
    await subscribe(comp.id, { planHandle: "pro" });
    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: GID(4), reason: "The owner's own store", operator: "test" });
    await subscribe(gone.id, { planHandle: "pro" });
    await markShopUninstalled(gone.shopDomain, app);
    await subscribe(own.id, { planHandle: "ownkey" });
    await subscribe(none.id, { state: "NONE" });
    await subscribe(odd.id, { planHandle: "enterprise" });

    const dir = await loadDirectory({ client: app, now: NOW, config: billingOn, force: true });
    expect(dir.billingConfigured).toBe(true);
    expect(dir.prices).toEqual(DEFAULT_PRICES);
    const row = (name: string) => byDomain(dir.rows, name);
    expect(dir.rows.map((r) => [r.shopDomain.split(".")[0], r.plan, r.inTrial, r.complimentary, r.monthlyRevenueUsd, r.status])).toEqual(
      expect.arrayContaining([
        ["pro-monthly", "pro", false, false, 99, "ACTIVE"],
        // $290 a year ÷ 12 = $24.1666…: $24.17 on the row.
        ["starter-annual", "starter", false, false, 24.17, "ACTIVE"],
        ["business-trial", "business", true, false, 0, "ACTIVE"],
        ["owner-store", "complimentary", false, true, 0, "ACTIVE"],
        // Uninstalled: the cache was reset (not checked since), unknown while billing is configured.
        ["uninstalled", "unknown", false, false, 0, "UNINSTALLED"],
        ["own-key-store", "own-key", false, false, 49, "ACTIVE"],
        ["never-checked", "unknown", false, false, 0, "ACTIVE"],
        ["no-plan", "free", false, false, 0, "ACTIVE"],
        ["odd-plan", "unknown", false, false, 0, "ACTIVE"],
      ]),
    );
    expect(dir.rows).toHaveLength(9);
    expect(row("never-checked").subscription).toBeNull();
    // The reset's epoch is no check date: "not checked since".
    expect(row("uninstalled").subscription).toMatchObject({ state: "NONE", planHandle: null, checkedAt: null });
    expect(row("no-plan").subscription?.checkedAt).toBe(NOW.toISOString());
    expect(row("owner-store").hasGid).toBe(true);

    const summary = summarize(dir, NOW);
    expect(summary.stores).toEqual({ active: 8, uninstalled: 1, new30: 9, lost30: 1 });
    expect(summary.plans).toEqual({ free: 1, starter: 1, pro: 1, business: 1, "own-key": 1, complimentary: 1, unknown: 2 });
    expect(summary.trials.count).toBe(1);
    expect(summary.trials.endingSoon.map((r) => r.shopDomain)).toEqual(["business-trial.myshopify.com"]);
    expect(summary.cancelling).toBe(1);
    expect(summary.pendingChanges).toBe(1);
    // Exact cents: 9900 + 29000/12 + 4900 = 17216.67 → $172.17 a month; ARR 9900×12 + 29000 + 4900×12 = $2,066.
    expect(summary.revenue).toEqual({ mrrUsd: 172.17, arrUsd: 2066, payingStores: 3, arpuUsd: 57.39 });
    expect(summary.recent).toHaveLength(5);
    expect(summary.billingConfigured).toBe(true);

    // Without billing, a store never checked is on Free (every store has all features).
    const off = await loadDirectory({ client: app, now: NOW, config: billingOff });
    expect(byDomain(off.rows, "never-checked").plan).toBe("free");
    // Without COMPLIMENTARY_SHOP_GIDS the grant doesn't apply: the owner's store shows its plan.
    expect(byDomain(off.rows, "owner-store")).toMatchObject({ plan: "pro", complimentary: false, monthlyRevenueUsd: 99 });

    expect(filterRows(dir.rows, { q: "STORE PRO", status: "all", plan: "all" }).map((r) => r.shopDomain)).toEqual(["pro-monthly.myshopify.com"]);
    expect(filterRows(dir.rows, { plan: "unknown", sort: "name" }).map((r) => r.shopDomain)).toEqual(["never-checked.myshopify.com", "odd-plan.myshopify.com", "uninstalled.myshopify.com"]);
    // Without billing, the uninstalled store's reset row is Free, as a store never checked.
    expect(byDomain(off.rows, "uninstalled").plan).toBe("free");
    expect(filterRows(dir.rows, { status: "UNINSTALLED" }).map((r) => r.shopDomain)).toEqual(["uninstalled.myshopify.com"]);
    expect(filterRows(dir.rows, { sort: "revenue" }).slice(0, 3).map((r) => r.monthlyRevenueUsd)).toEqual([99, 49, 24.17]);
  });

  it("reads a cached cycle that is over as what followed it, and a reinstalled store as not checked since", async () => {
    const cancelled = await shop("cancelled", 1);
    const downgraded = await shop("downgraded", 2);
    const renewing = await shop("renewing", 3);
    const reinstalled = await shop("reinstalled", 4);
    // Checked during a cycle that ended 35 days ago; no answer since.
    const checkedAt = new Date(NOW.getTime() - 40 * DAY);
    const over = new Date(NOW.getTime() - 35 * DAY);
    await subscribe(cancelled.id, { planHandle: "pro", cancelAtEndOfCycle: true, currentPeriodEnd: over, checkedAt });
    await subscribe(downgraded.id, { planHandle: "pro", pendingPlanHandle: "starter", currentPeriodEnd: over, checkedAt });
    await subscribe(renewing.id, { planHandle: "pro", currentPeriodEnd: over, checkedAt });
    await subscribe(reinstalled.id, { planHandle: "business" });
    await markShopUninstalled(reinstalled.shopDomain, app);
    await upsertInstalledShop({ shopDomain: reinstalled.shopDomain }, app);

    const dir = await loadDirectory({ client: app, now: NOW, config: billingOn, force: true });
    expect(dir.rows.map((r) => [r.shopDomain.split(".")[0], r.status, r.plan, r.monthlyRevenueUsd, r.subscription ? r.subscription.checkedAt : "none"])).toEqual(
      expect.arrayContaining([
        ["cancelled", "ACTIVE", "free", 0, checkedAt.toISOString()],
        ["downgraded", "ACTIVE", "starter", 29, checkedAt.toISOString()],
        ["renewing", "ACTIVE", "pro", 99, checkedAt.toISOString()],
        ["reinstalled", "ACTIVE", "unknown", 0, null],
      ]),
    );
    const summary = summarize(dir, NOW);
    expect(summary).toMatchObject({ cancelling: 0, pendingChanges: 0, revenue: { mrrUsd: 128, payingStores: 2 } });
    expect(summary.plans).toMatchObject({ free: 1, starter: 1, pro: 1, unknown: 1 });
    // The store's own page says the same.
    expect((await loadCustomer(reinstalled.id, { client: app, now: NOW, config: billingOn }))!.shop).toMatchObject({ plan: "unknown", subscription: { checkedAt: null } });
  });

  it("follows the list prices at once, and keeps the database part for 60 s unless forced", async () => {
    const admin = await ownerDb.adminUser.create({
      data: { email: "finance@linguva.test", passwordHash: `scrypt$32768$8$3$${"A".repeat(22)}$${"B".repeat(43)}`, totpSecret: "v1.k1.aaaa.bbbb.cccc", role: "FINANCE" },
    });
    const a = await shop("alpha", 1);
    await subscribe(a.id, { planHandle: "pro", billingPeriod: "ANNUAL" });
    const first = await loadDirectory({ client: app, config: billingOn });
    expect(byDomain(first.rows, "alpha").monthlyRevenueUsd).toBe(82.5);
    await savePrices({ ...DEFAULT_PRICES, pro: { monthlyUsd: 109.99, yearlyUsd: 1099.99 } }, "Price rise", { userId: admin.id }, { client: app });
    // New prices: worked out from the same cached snapshot (1099.99 / 12 = 91.67).
    const second = await loadDirectory({ client: app, config: billingOn });
    expect(second.builtAt).toBe(first.builtAt);
    expect(byDomain(second.rows, "alpha").monthlyRevenueUsd).toBe(91.67);
    // A new store shows after a forced rebuild (or after 60 s).
    await shop("beta", 2);
    expect((await loadDirectory({ client: app, config: billingOn })).rows).toHaveLength(1);
    const forced = await loadDirectory({ client: app, config: billingOn, force: true });
    expect(forced.rows).toHaveLength(2);
    expect(Date.parse(forced.builtAt)).toBeGreaterThanOrEqual(Date.parse(first.builtAt));
    const later = await loadDirectory({ client: app, config: billingOn, now: new Date(Date.now() + 61_000) });
    expect(later.builtAt).not.toBe(forced.builtAt);
  });
});

describe("one store", () => {
  it("shows its row, six months of usage, languages, installations, jobs and flags; null for an unknown id", async () => {
    const a = await shop("alpha", 4);
    const b = await shop("beta", 2);
    await subscribe(a.id, { planHandle: "business" });
    await grantComplimentaryAccess(ownerDb, { shopifyShopGid: GID(4), reason: "Owner", operator: "test", monthlyCharLimit: 3_000_000 });
    const [current, previous, , , , oldest] = recentPeriods(NOW);
    await use(a.id, 1_000, { period: current });
    await use(a.id, 300, { payer: "merchant", period: current });
    await use(a.id, 40_000, { provider: "google", period: previous });
    await use(a.id, 7, { period: oldest });
    await use(a.id, 123_456, { period: "2019-01" });
    await use(b.id, 5_000, { period: current });
    await locales(a.id, ["de", "en", "fr"]);
    await job(a.id, "COMPLETED", new Date(NOW.getTime() - DAY));
    await job(a.id, "FAILED", new Date(NOW.getTime() - 2 * DAY));
    await job(a.id, "COMPLETED", new Date(NOW.getTime() - 40 * DAY));
    await job(b.id, "FAILED", new Date(NOW.getTime() - DAY));
    await withTenant(a.id, (tx) => tx.shopSettings.update({ where: { shopId: a.id }, data: { autoTranslateNew: true } }), app);

    const detail = (await loadCustomer(a.id, { client: app, now: NOW, config: billingOn }))!;
    expect(detail.shop).toMatchObject({ id: a.id, plan: "complimentary", complimentary: true, languages: 2 });
    expect(detail.shopifyShopGid).toBe(GID(4));
    expect(detail.adminUrl).toBe("https://admin.shopify.com/store/alpha");
    expect(detail.complimentary).toMatchObject({ active: true, monthlyCharLimit: 3_000_000, revokedAt: null, expiresAt: null });
    expect(detail.usageByMonth.map((m) => m.period)).toEqual(recentPeriods(NOW));
    expect(detail.usageByMonth[0]).toEqual({ period: current, chars: 1_000, ownKeyChars: 300, costUsd: 0.03 });
    // Google: 20 per million by default.
    expect(detail.usageByMonth[1]).toEqual({ period: previous, chars: 40_000, ownKeyChars: 0, costUsd: 0.8 });
    expect(detail.usageByMonth[5]).toMatchObject({ period: oldest, chars: 7 });
    expect(detail.usageByMonth.reduce((sum, m) => sum + m.chars, 0)).toBe(41_007);
    expect(detail.locales).toEqual([
      { locale: "de", primary: true, published: true },
      { locale: "en", primary: false, published: true },
      { locale: "fr", primary: false, published: true },
    ]);
    expect(detail.installations).toEqual([{ event: "INSTALLED", occurredAt: expect.any(String) }]);
    expect(detail.jobs.last30).toEqual({ PENDING: 0, DISCOVERING: 0, RUNNING: 0, COMPLETED: 1, CANCELLED: 0, FAILED: 1 });
    expect(detail.jobs.lastAt).not.toBeNull();
    expect(detail.settings).toEqual({ autoTranslateNew: true, smartAuto: false });

    expect(await loadCustomer("not-a-uuid", { client: app })).toBeNull();
    expect(await loadCustomer("00000000-0000-4000-8000-000000000000", { client: app })).toBeNull();
    expect(shopifyAdminUrl("custom.example.com")).toBeNull();
  });

  it("asks Shopify again: refreshes the cache, audits it, rebuilds the directory; says why when it can't", async () => {
    const admin = await ownerDb.adminUser.create({
      data: { email: "support@linguva.test", passwordHash: `scrypt$32768$8$3$${"A".repeat(22)}$${"B".repeat(43)}`, totpSecret: "v1.k1.aaaa.bbbb.cccc", role: "SUPPORT" },
    });
    const a = await shop("alpha", 1);
    const noGid = await shop("beta");
    const partner = fakePartnerApi({ handle: "pro", pendingHandle: "business" });
    const before = await loadDirectory({ client: app, config: billingOn });
    expect(byDomain(before.rows, "alpha").plan).toBe("unknown");

    const actor = { userId: admin.id };
    expect(await refreshCustomerSubscription(a.id, actor, { client: app, config: billingOn, fetchImpl: partner.fetchImpl })).toEqual({ ok: true });
    expect(partner.calls).toHaveLength(1);
    const after = await loadDirectory({ client: app, config: billingOn });
    expect(byDomain(after.rows, "alpha")).toMatchObject({ plan: "pro", subscription: { state: "ACTIVE", planHandle: "pro", pendingPlanHandle: "business" } });
    const audit = await ownerDb.auditLog.findMany({ where: { action: "admin.subscription.refreshed" } });
    expect(audit).toEqual([
      expect.objectContaining({ shopId: a.id, actorType: "ADMIN", actorId: admin.id, targetType: "Shop", targetId: a.id, metadata: { state: "ACTIVE", planHandle: "pro" } }),
    ]);

    partner.set({ status: 503 });
    expect(await refreshCustomerSubscription(a.id, actor, { client: app, config: billingOn, fetchImpl: partner.fetchImpl })).toEqual({ ok: false, reason: "SHOPIFY_UNAVAILABLE" });
    expect(await refreshCustomerSubscription(noGid.id, actor, { client: app, config: billingOn, fetchImpl: partner.fetchImpl })).toEqual({ ok: false, reason: "NO_GID" });
    expect(await refreshCustomerSubscription(a.id, actor, { client: app, config: billingOff, fetchImpl: partner.fetchImpl })).toEqual({ ok: false, reason: "NOT_CONFIGURED" });
    expect(await refreshCustomerSubscription("nope", actor, { client: app, config: billingOn })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await refreshCustomerSubscription("00000000-0000-4000-8000-000000000000", actor, { client: app, config: billingOn })).toEqual({ ok: false, reason: "NOT_FOUND" });
    // Only the successful check reached Shopify's answer into the audit log; failures write nothing.
    expect(await ownerDb.auditLog.count({ where: { action: "admin.subscription.refreshed" } })).toBe(1);
    expect(partner.calls).toHaveLength(2);
  });
});

describe("activity", () => {
  it("lists the price changes with who made them, and the sessions with their state", async () => {
    const hash = `scrypt$32768$8$3$${"A".repeat(22)}$${"B".repeat(43)}`;
    const owner = await ownerDb.adminUser.create({ data: { email: "owner@linguva.test", passwordHash: hash, totpSecret: "v1.k1.aaaa.bbbb.cccc", role: "OWNER" } });
    const gone = await ownerDb.adminUser.create({ data: { email: "gone@linguva.test", passwordHash: hash, totpSecret: "v1.k1.aaaa.bbbb.cccc", role: "READONLY", disabledAt: NOW } });
    await savePrices({ ...DEFAULT_PRICES, starter: { monthlyUsd: 39, yearlyUsd: 390 } }, "  New   starter price  ", { userId: owner.id }, { client: app });
    const session = (n: number, data: { createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt?: Date }, user = owner.id) =>
      ownerDb.adminSession.create({ data: { adminUserId: user, tokenHash: String(n).padStart(43, "x"), ...data } });
    const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    await session(1, { createdAt: ago(10), lastSeenAt: ago(1), expiresAt: ago(-470) });
    await session(2, { createdAt: ago(20), lastSeenAt: ago(31), expiresAt: ago(-460) });
    await session(3, { createdAt: ago(30), lastSeenAt: ago(1), expiresAt: ago(-450), revokedAt: ago(1) });
    await session(4, { createdAt: ago(600), lastSeenAt: ago(500), expiresAt: ago(120) });
    await session(5, { createdAt: ago(5), lastSeenAt: ago(1), expiresAt: ago(-475) }, gone.id);

    const activity = await loadActivity({ client: app, now: NOW });
    expect(activity.priceChanges).toEqual([
      {
        id: expect.any(String),
        handle: "starter",
        oldMonthlyUsd: 29,
        oldYearlyUsd: 290,
        newMonthlyUsd: 39,
        newYearlyUsd: 390,
        reason: "New starter price",
        by: "owner@linguva.test",
        at: expect.any(String),
      },
    ]);
    expect(activity.signIns.map((s) => [s.email, s.role, s.state])).toEqual([
      ["gone@linguva.test", "READONLY", "ended"],
      ["owner@linguva.test", "OWNER", "active"],
      ["owner@linguva.test", "OWNER", "ended"],
      ["owner@linguva.test", "OWNER", "ended"],
      ["owner@linguva.test", "OWNER", "ended"],
    ]);
    expect(JSON.stringify(activity)).not.toMatch(/scrypt|v1\.k1|xxxx/);
  });
});
