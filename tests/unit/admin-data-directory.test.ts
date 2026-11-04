/**
 * The admin console's rows and overview figures, worked out from one shop's
 * facts (app/.server/admin/directory.ts, overview.ts) without a database:
 * which plan a store is on, when it is in a trial or complimentary, what it
 * pays a month at the current list prices (cents, ANNUAL = yearly ÷ 12,
 * nothing for trials, complimentary, unknown or uninstalled stores), and
 * the search, filters and order of the customer list.
 */
import { describe, expect, it } from "vitest";
import { filterRows, revenueCents, shopRow, type RowContext, type ShopFacts, type ShopRow } from "../../app/.server/admin/directory";
import { summarize } from "../../app/.server/admin/overview";
import { DEFAULT_PRICES, type PriceTable } from "../../app/lib/plans";

const NOW = new Date("2026-11-04T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const GID = "gid://shopify/Shop/1";
const ctx = (extra: Partial<RowContext> = {}): RowContext => ({
  now: NOW,
  prices: DEFAULT_PRICES,
  billingConfigured: true,
  complimentaryGids: [GID],
  rates: { deepl: 25, azure: 10, google: 20 },
  ...extra,
});
let n = 0;
function facts(extra: { sub?: Partial<NonNullable<ShopFacts["subscription"]>> | null; shop?: Partial<ShopFacts["shop"]>; grant?: Partial<NonNullable<ShopFacts["grant"]>> | null } & Partial<Omit<ShopFacts, "shop" | "subscription" | "grant">> = {}): ShopFacts {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const shop = { id, shopDomain: `shop-${n}.myshopify.com`, name: `Shop ${n}`, status: "ACTIVE" as const, installedAt: new Date(NOW.getTime() - n * DAY), uninstalledAt: null, shopifyShopGid: null, ...extra.shop };
  return {
    shop,
    subscription:
      extra.sub === null
        ? null
        : {
            state: "ACTIVE",
            planHandle: "pro",
            billingPeriod: "EVERY_30_DAYS",
            trialEndsAt: null,
            cancelAtEndOfCycle: false,
            currentPeriodEnd: null,
            pendingPlanHandle: null,
            checkedAt: NOW,
            ...extra.sub,
          },
    grant:
      extra.grant == null
        ? null
        : {
            shopId: id,
            shopifyShopGid: GID,
            reason: "owner",
            grantedBy: "test",
            monthlyCharLimit: 2_000_000,
            grantedAt: NOW,
            expiresAt: null,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
            ...extra.grant,
          },
    byProvider: extra.byProvider ?? {},
    ownKeyChars: extra.ownKeyChars ?? 0,
    languages: extra.languages ?? 0,
    lastJobAt: extra.lastJobAt ?? null,
  };
}
const row = (f: ShopFacts, c: RowContext = ctx()) => shopRow(f, c);

describe("a store's plan", () => {
  it("follows the cached subscription, Own key's aliases, and unknown handles", () => {
    expect(row(facts({ sub: { planHandle: "starter" } })).plan).toBe("starter");
    for (const handle of ["own-key", "ownkey", "own_key", "own-key-test"]) expect(row(facts({ sub: { planHandle: handle } })).plan, handle).toBe("own-key");
    expect(row(facts({ sub: { planHandle: "enterprise" } })).plan).toBe("unknown");
    expect(row(facts({ sub: { planHandle: null } })).plan).toBe("unknown");
    expect(row(facts({ sub: { state: "NONE", planHandle: null } })).plan).toBe("free");
    expect(row(facts({ sub: { planHandle: "free" } })).plan).toBe("free");
    // Never checked: unknown with billing, Free without (every store has all features then).
    expect(row(facts({ sub: null })).plan).toBe("unknown");
    expect(row(facts({ sub: null }), ctx({ billingConfigured: false })).plan).toBe("free");
  });

  it("is complimentary only with an active grant for a listed GID", () => {
    const owner = (grant: Partial<NonNullable<ShopFacts["grant"]>>, gids: string[] = [GID]) => row(facts({ shop: { shopifyShopGid: GID }, grant }), ctx({ complimentaryGids: gids }));
    expect(owner({})).toMatchObject({ plan: "complimentary", complimentary: true, monthlyRevenueUsd: 0, hasGid: true });
    expect(owner({ revokedAt: NOW })).toMatchObject({ plan: "pro", complimentary: false, monthlyRevenueUsd: 99 });
    expect(owner({ expiresAt: new Date(NOW.getTime() - 1) })).toMatchObject({ plan: "pro", complimentary: false });
    expect(owner({ expiresAt: new Date(NOW.getTime() + DAY) })).toMatchObject({ plan: "complimentary" });
    expect(owner({}, [])).toMatchObject({ plan: "pro", complimentary: false });
    expect(owner({ shopifyShopGid: "gid://shopify/Shop/2" })).toMatchObject({ complimentary: false });
  });

  it("is in a trial while the trial's end is ahead, installed and not complimentary", () => {
    const ends = (ms: number, shop: Partial<ShopFacts["shop"]> = {}) => row(facts({ sub: { planHandle: "business", trialEndsAt: new Date(NOW.getTime() + ms) }, shop }));
    expect(ends(DAY)).toMatchObject({ inTrial: true, monthlyRevenueUsd: 0 });
    expect(ends(-1)).toMatchObject({ inTrial: false, monthlyRevenueUsd: 299 });
    expect(ends(DAY, { status: "UNINSTALLED" })).toMatchObject({ inTrial: false, monthlyRevenueUsd: 0 });
  });
});

describe("estimated revenue", () => {
  it("in cents: monthly price, yearly ÷ 12 for ANNUAL, nothing for the rest", () => {
    const cents = (sub: Partial<NonNullable<ShopFacts["subscription"]>>, prices: PriceTable = DEFAULT_PRICES, shop: Partial<ShopFacts["shop"]> = {}) => {
      const r = row(facts({ sub, shop }), ctx({ prices }));
      return revenueCents(r, prices);
    };
    expect(cents({ planHandle: "starter" })).toBe(2_900);
    expect(cents({ planHandle: "starter", billingPeriod: "ANNUAL" })).toBeCloseTo(29_000 / 12, 10);
    expect(cents({ planHandle: "pro", billingPeriod: "ANNUAL" })).toBe(8_250);
    expect(cents({ planHandle: "business", billingPeriod: "ANNUAL" })).toBe(29_900);
    expect(cents({ planHandle: "ownkey" })).toBe(4_900);
    expect(cents({ planHandle: "pro" }, { ...DEFAULT_PRICES, pro: { monthlyUsd: 9.99, yearlyUsd: 99.9 } })).toBe(999);
    expect(cents({ planHandle: "pro", billingPeriod: "ANNUAL" }, { ...DEFAULT_PRICES, pro: { monthlyUsd: 9.99, yearlyUsd: 99.9 } })).toBeCloseTo(832.5, 10);
    for (const sub of [{ planHandle: "free" }, { state: "NONE" as const, planHandle: null }, { planHandle: "enterprise" }]) expect(cents(sub), JSON.stringify(sub)).toBe(0);
    expect(cents({ planHandle: "pro" }, DEFAULT_PRICES, { status: "UNINSTALLED" })).toBe(0);
    // A cancelling store or one with a change pending pays its current plan until the cycle ends.
    expect(cents({ planHandle: "pro", cancelAtEndOfCycle: true, pendingPlanHandle: "starter" })).toBe(9_900);
    // The row shows whole cents: $290 / 12 = $24.17.
    expect(row(facts({ sub: { planHandle: "starter", billingPeriod: "ANNUAL" } })).monthlyRevenueUsd).toBe(24.17);
  });

  it("sums exactly and rounds once", () => {
    const rows = [1, 2, 3].map(() => row(facts({ sub: { planHandle: "starter", billingPeriod: "ANNUAL" } })));
    const s = summarize({ rows, builtAt: NOW.toISOString(), billingConfigured: true, prices: DEFAULT_PRICES }, NOW);
    // 3 × 2416.67 rounded per row would be $72.51; exact: 3 × 29000 / 12 = 7250 cents.
    expect(s.revenue).toEqual({ mrrUsd: 72.5, arrUsd: 870, payingStores: 3, arpuUsd: 24.17 });
    const none = summarize({ rows: [], builtAt: NOW.toISOString(), billingConfigured: false, prices: DEFAULT_PRICES }, NOW);
    expect(none.revenue).toEqual({ mrrUsd: 0, arrUsd: 0, payingStores: 0, arpuUsd: 0 });
    expect(none.plans).toEqual({ free: 0, starter: 0, pro: 0, business: 0, "own-key": 0, complimentary: 0, unknown: 0 });
  });
});

describe("usage on a row", () => {
  it("sums the engines at their own rates (no engine and mock at DeepL's), the merchant's keys apart", () => {
    const r = row(facts({ byProvider: { deepl: 600_000, azure: 1_000_000, mock: 400_000 }, ownKeyChars: 5_000 }));
    expect(r.usage).toEqual({ chars: 2_000_000, ownKeyChars: 5_000, costUsd: 35 });
  });
});

describe("the overview", () => {
  it("lists trials ending within 7 days, soonest first, at most 10, and the newest installs", () => {
    const trials = Array.from({ length: 13 }, (_, i) => row(facts({ sub: { planHandle: "starter", trialEndsAt: new Date(NOW.getTime() + (i + 1) * 12 * 60 * 60 * 1000) } })));
    const later = row(facts({ sub: { planHandle: "starter", trialEndsAt: new Date(NOW.getTime() + 8 * DAY) } }));
    const rows: ShopRow[] = [later, ...trials.reverse()];
    const s = summarize({ rows, builtAt: NOW.toISOString(), billingConfigured: true, prices: DEFAULT_PRICES }, NOW);
    expect(s.trials.count).toBe(14);
    expect(s.trials.endingSoon).toHaveLength(10);
    const ends = s.trials.endingSoon.map((r) => Date.parse(r.subscription!.trialEndsAt!));
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(s.trials.endingSoon).not.toContain(later);
    expect(s.recent.map((r) => r.installedAt)).toEqual([...rows].map((r) => r.installedAt).sort().reverse().slice(0, 5));
    expect(s.revenue.payingStores).toBe(0);
  });

  it("counts new and lost stores in the last 30 days", () => {
    const rows = [
      row(facts({ shop: { installedAt: new Date(NOW.getTime() - 2 * DAY) } })),
      row(facts({ shop: { installedAt: new Date(NOW.getTime() - 40 * DAY), status: "UNINSTALLED", uninstalledAt: new Date(NOW.getTime() - 3 * DAY) } })),
      row(facts({ shop: { installedAt: new Date(NOW.getTime() - 90 * DAY), status: "UNINSTALLED", uninstalledAt: new Date(NOW.getTime() - 60 * DAY) } })),
    ];
    expect(summarize({ rows, builtAt: "", billingConfigured: true, prices: DEFAULT_PRICES }, NOW).stores).toEqual({ active: 1, uninstalled: 2, new30: 1, lost30: 1 });
  });
});

describe("the customer list", () => {
  const rows = [
    row(facts({ shop: { name: "Zebra Goods", shopDomain: "zebra.myshopify.com" }, sub: { planHandle: "business" }, byProvider: { deepl: 10 } })),
    row(facts({ shop: { name: null, shopDomain: "alpha-store.myshopify.com" }, sub: { planHandle: "starter" }, byProvider: { deepl: 900 } })),
    row(facts({ shop: { name: "beta", shopDomain: "beta.myshopify.com", status: "UNINSTALLED" }, sub: { state: "NONE", planHandle: null }, ownKeyChars: 5_000 })),
  ];

  it("searches name and domain in any case, filters status and plan", () => {
    expect(filterRows(rows, { q: "  ZEB " }).map((r) => r.shopDomain)).toEqual(["zebra.myshopify.com"]);
    expect(filterRows(rows, { q: "alpha-STORE" }).map((r) => r.shopDomain)).toEqual(["alpha-store.myshopify.com"]);
    expect(filterRows(rows, { status: "ACTIVE" })).toHaveLength(2);
    expect(filterRows(rows, { status: "UNINSTALLED", plan: "free" }).map((r) => r.shopDomain)).toEqual(["beta.myshopify.com"]);
    expect(filterRows(rows, { plan: "pro" })).toEqual([]);
    expect(filterRows(rows, { q: "nothing" })).toEqual([]);
  });

  it("orders by install, usage, revenue or name (no name: the domain)", () => {
    const order = (sort: "newest" | "oldest" | "usage" | "revenue" | "name") => filterRows(rows, { sort }).map((r) => r.shopDomain.split(".")[0]);
    expect(order("newest")).toEqual(["zebra", "alpha-store", "beta"]);
    expect(order("oldest")).toEqual(["beta", "alpha-store", "zebra"]);
    expect(order("usage")).toEqual(["beta", "alpha-store", "zebra"]);
    expect(order("revenue")).toEqual(["zebra", "alpha-store", "beta"]);
    expect(order("name")).toEqual(["alpha-store", "beta", "zebra"]);
    // The input stays as it was.
    expect(rows.map((r) => r.shopDomain.split(".")[0])).toEqual(["zebra", "alpha-store", "beta"]);
  });
});
