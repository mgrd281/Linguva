/**
 * The admin console's language and formats (app/admin/locale.ts, format.ts,
 * meta.ts) and the Subscriptions page's figures (subscriptions.ts): the
 * choice from `?lang=`, the cookie or the browser; Western digits and UTC in
 * both languages; dollars that keep their sign in front in Arabic too.
 */
import { describe, expect, it } from "vitest";
import { formatCompact, formatDate, formatDateTime, formatLanguage, formatMonth, formatNumber, formatPercent, formatShortDateTime, formatUsd } from "../../app/admin/format";
import { planOfHandle, periodLabel } from "../../app/admin/labels";
import { adminDir, adminLangCookie, adminLocaleOf, isAdminUrlPath, languageHref, languageSwitch, localeFromAcceptLanguage } from "../../app/admin/locale";
import { adminTitle, metaLocale } from "../../app/admin/meta";
import { filterSubscriptions, parseSubscriptionFilters, subscribedRows, subscriptionMix } from "../../app/admin/subscriptions";
import type { ShopRow } from "../../app/.server/admin/directory";

const request = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { headers });

describe("the console's language", () => {
  it("follows ?lang=, then the cookie, then the browser (Arabic only when preferred)", () => {
    expect(adminLocaleOf(request("/admin?lang=ar"))).toBe("ar");
    expect(adminLocaleOf(request("/admin", { cookie: "lv_admin=x; lv_admin_lang=ar" }))).toBe("ar");
    expect(adminLocaleOf(request("/admin?lang=en", { cookie: "lv_admin_lang=ar" }))).toBe("en");
    expect(adminLocaleOf(request("/admin", { cookie: "lv_admin_lang=de", "accept-language": "ar-EG,ar;q=0.9,en;q=0.8" }))).toBe("ar");
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9,en;q=0.8,ar;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("de-DE,ar;q=0.9")).toBe("ar");
    expect(localeFromAcceptLanguage("ar;q=0,en")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
    expect(adminDir("ar")).toBe("rtl");
    expect(adminDir("en")).toBe("ltr");
  });

  it("stores ?lang= in a cookie for the console's paths and drops the parameter", () => {
    expect(languageSwitch(request("/admin/customers?q=nord&lang=ar&page=2"))).toEqual({
      location: "/admin/customers?q=nord&page=2",
      // Path=/: the pages' data requests (/admin.data) carry it too.
      cookie: "lv_admin_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax",
    });
    // An unknown language: the parameter goes, the choice stays.
    expect(languageSwitch(request("/admin?lang=xx"))).toEqual({ location: "/admin", cookie: null });
    expect(languageSwitch(request("/admin/prices"))).toBeNull();
    expect(adminLangCookie("en", request("/admin", { "x-forwarded-proto": "http, https" }))).toBe("lv_admin_lang=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(languageHref("/admin/customers", "?q=a&lang=en", "ar")).toBe("/admin/customers?q=a&lang=ar");
  });

  it("knows the console's paths", () => {
    expect(["/admin", "/admin/", "/admin/login", "/admin.data", "/ADMIN/prices"].map(isAdminUrlPath)).toEqual([true, true, true, true, true]);
    expect(["/administrator", "/app", "/", "/app/admin"].map(isAdminUrlPath)).toEqual([false, false, false, false]);
  });

  it("titles pages in the frame's language", () => {
    expect(
      adminTitle(
        [
          { id: "root", loaderData: {} },
          { id: "routes/admin", loaderData: { locale: "ar" } },
        ],
        "nav.customers",
      ),
    ).toEqual([{ title: "العملاء · Linguva Admin" }]);
    expect(adminTitle([], "nav.prices")).toEqual([{ title: "Prices · Linguva Admin" }]);
    expect(adminTitle([undefined])).toEqual([{ title: "Linguva Admin" }]);
    expect(metaLocale([{ id: "routes/admin_.login", loaderData: { locale: "ar" } }])).toBe("ar");
  });
});

describe("the console's formats", () => {
  const at = "2026-11-04T14:05:09.000Z";

  it("write dates in UTC, with the zone, and Western digits in Arabic", () => {
    expect(formatDate("en", at)).toBe("Nov 4, 2026");
    expect(formatDateTime("en", at)).toBe("Nov 4, 2026, 14:05 UTC");
    expect(formatDate("ar", at)).toBe("4 نوفمبر 2026");
    expect(formatDateTime("ar", at)).toMatch(/^4 نوفمبر 2026، 14:05 UTC$/);
    expect(formatShortDateTime("en", at)).toBe("Nov 4, 14:05");
    expect(formatMonth("en", "2026-11")).toBe("Nov 2026");
    expect(formatMonth("ar", "2026-01")).toBe("يناير 2026");
    // Just before midnight UTC is still that UTC day, wherever the server runs.
    expect(formatDate("en", "2026-11-04T23:59:00.000Z")).toBe("Nov 4, 2026");
  });

  it("write numbers with Western digits in both languages", () => {
    expect(formatNumber("en", 1_234_567)).toBe("1,234,567");
    expect(formatNumber("ar", 1_234_567)).toBe("1,234,567");
    expect(formatCompact("en", 7_612_000)).toBe("7.6M");
    expect(formatCompact("ar", 7_612_000)).toBe("7.6\u00a0مليون");
    expect(formatPercent("en", 0.415)).toBe("42%");
    expect(formatPercent("ar", 0.415)).not.toMatch(/[\u0660-\u0669]/);
  });

  it("write dollars as $29, cents only when there are some (or asked for), the sign first in Arabic too", () => {
    expect(formatUsd("en", 29)).toBe("$29");
    expect(formatUsd("en", 9.99)).toBe("$9.99");
    expect(formatUsd("en", 29, { cents: true })).toBe("$29.00");
    expect(formatUsd("en", 1234.5)).toBe("$1,234.50");
    // Isolated left to right: "$" stays in front of the figure in a right-to-left line.
    expect(formatUsd("ar", 802.67)).toBe("\u2066$802.67\u2069");
  });

  it("name languages, and fall back to the code", () => {
    expect(formatLanguage("en", "de")).toBe("German");
    expect(formatLanguage("ar", "de")).toBe("الألمانية");
    expect(formatLanguage("en", "pt-BR")).toBe("Brazilian Portuguese");
    expect(formatLanguage("en", "!!")).toBe("!!");
  });

  it("map Shopify's handles and periods", () => {
    expect(planOfHandle("own_key_test")).toBe("own-key");
    expect(planOfHandle("pro")).toBe("pro");
    expect(planOfHandle("platinum")).toBe("unknown");
    expect(planOfHandle(null)).toBeNull();
    expect(periodLabel("ANNUAL")).toBe("period.yearly");
    expect(periodLabel("EVERY_30_DAYS")).toBe("period.monthly");
    expect(periodLabel("EVERY_7_DAYS")).toBeNull();
  });
});

function row(domain: string, extra: Partial<ShopRow> & { sub?: Partial<NonNullable<ShopRow["subscription"]>> | null } = {}): ShopRow {
  const { sub, ...rest } = extra;
  return {
    id: domain,
    shopDomain: `${domain}.myshopify.com`,
    name: domain,
    status: "ACTIVE",
    installedAt: "2026-10-01T00:00:00.000Z",
    uninstalledAt: null,
    hasGid: true,
    subscription:
      sub === null
        ? null
        : {
            state: "ACTIVE",
            planHandle: "pro",
            billingPeriod: "EVERY_30_DAYS",
            trialEndsAt: null,
            cancelAtEndOfCycle: false,
            currentPeriodEnd: "2026-12-01T00:00:00.000Z",
            pendingPlanHandle: null,
            checkedAt: "2026-11-04T00:00:00.000Z",
            ...sub,
          },
    plan: "pro",
    inTrial: false,
    cancelling: false,
    complimentary: false,
    usage: { chars: 0, ownKeyChars: 0, costUsd: 0 },
    languages: 1,
    lastJobAt: null,
    monthlyRevenueUsd: 99,
    ...rest,
  };
}

describe("the Subscriptions page's figures", () => {
  const rows = [
    row("a"),
    row("b", { sub: { billingPeriod: "ANNUAL", currentPeriodEnd: "2027-05-01T00:00:00.000Z" } }),
    row("c", { plan: "starter", inTrial: true, sub: { planHandle: "starter", currentPeriodEnd: "2026-11-20T00:00:00.000Z" } }),
    row("d", { plan: "business", cancelling: true, sub: { planHandle: "business", cancelAtEndOfCycle: true } }),
    row("e", { plan: "free", sub: { state: "NONE", planHandle: null } }),
    row("f", { plan: "unknown", sub: null }),
    row("g", { status: "UNINSTALLED" }),
  ];

  it("count installed stores with an active subscription, per plan and period", () => {
    expect(subscribedRows(rows).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(subscriptionMix(rows)).toEqual({
      rows: [
        { plan: "starter", monthly: 1, yearly: 0, trial: 1, total: 1 },
        { plan: "pro", monthly: 1, yearly: 1, trial: 0, total: 2 },
        { plan: "business", monthly: 1, yearly: 0, trial: 0, total: 1 },
      ],
      total: { monthly: 3, yearly: 1, trial: 1, total: 4 },
    });
  });

  it("filter by plan, trial and cancelling, the soonest period end first", () => {
    expect(filterSubscriptions(rows, parseSubscriptionFilters(new URLSearchParams(""))).map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(filterSubscriptions(rows, parseSubscriptionFilters(new URLSearchParams("plan=pro"))).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterSubscriptions(rows, parseSubscriptionFilters(new URLSearchParams("trial=1"))).map((r) => r.id)).toEqual(["c"]);
    expect(filterSubscriptions(rows, parseSubscriptionFilters(new URLSearchParams("cancelling=1"))).map((r) => r.id)).toEqual(["d"]);
    expect(parseSubscriptionFilters(new URLSearchParams("plan=gold&trial=yes"))).toEqual({ plan: "all", trial: false, cancelling: false });
  });
});
