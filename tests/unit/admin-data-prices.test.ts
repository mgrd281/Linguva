/**
 * List prices that the admin console can change (app/.server/admin/prices.ts,
 * app/lib/plan-prices.ts): the form's rules (the reason counted as
 * PostgreSQL counts it, Own key monthly only, every plan's version), the
 * cached table, its fallback and its time bound (a slow or unreachable
 * database never keeps a page waiting), and every place that shows a price with a table other than the
 * defaults: the Plan page's cards, table and questions, and the website
 * (German formatting as before; with the defaults, byte for byte the text
 * written between the markers, which is the text before the markers existed).
 */
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPriceTable, invalidatePriceCache, parsePriceForm, partnerDashboardUrl } from "../../app/.server/admin/prices";
import { getConfig } from "../../app/.server/lib/config";
import { applyPrices, pageHtml, sitePage } from "../../app/.server/site/pages";
import { OwnKeyPlanCard } from "../../app/components/plan/OwnKeyPlanCard";
import { PlanCards } from "../../app/components/plan/PlanCards";
import { PlanFaq } from "../../app/components/plan/PlanFaq";
import { PlanFeatureTable } from "../../app/components/plan/PlanFeatureTable";
import { translator } from "../../app/i18n/i18n";
import { estimatedMargin, formatCostUsd, formatUsd, monthsFree, offersYearly, priceLabel, priceWarnings, sharedMonthsFree, yearlyHandles } from "../../app/lib/plan-prices";
import { planView } from "../../app/lib/plan-view";
import { DEFAULT_PRICES, OWN_KEY_PRICE, PLAN_PRICES, planPrice, PRICE_HANDLES, type PriceTable } from "../../app/lib/plans";

const table = (changes: Partial<PriceTable>): PriceTable => ({ ...DEFAULT_PRICES, ...changes });
const site = (file: string) => readFileSync(`site/${file}`, "utf8");
/** The page without the price markers: the text written between them. */
const unmarked = (html: string) => html.replace(/<!--price:[a-z:-]+-->([\s\S]*?)<!--\/price-->/g, "$1");
const tokens = (order: Array<"deepl" | "azure-eu" | "google-global">) => ({ tags: new Set([...order, ...order.map((t) => t.split("-")[0]!)]), order });

describe("the default table", () => {
  it("is PLAN_PRICES and OWN_KEY_PRICE, the same objects, frozen", () => {
    expect(Object.keys(DEFAULT_PRICES)).toEqual([...PRICE_HANDLES]);
    for (const handle of ["free", "starter", "pro", "business"] as const) expect(DEFAULT_PRICES[handle]).toBe(PLAN_PRICES[handle]);
    expect(DEFAULT_PRICES["own-key"]).toBe(OWN_KEY_PRICE);
    expect(Object.isFrozen(DEFAULT_PRICES)).toBe(true);
    // Another table: every Own key handle has Own key's price.
    const other = table({ "own-key": { monthlyUsd: 59, yearlyUsd: null } });
    expect(planPrice("ownkey", other)).toEqual({ monthlyUsd: 59, yearlyUsd: null });
    expect(planPrice("pro", other)).toBe(PLAN_PRICES.pro);
  });
});

describe("prices with cents", () => {
  it("show two fraction digits only when the amount isn't whole", () => {
    expect(formatUsd("de", 9.99)).toBe("9,99\u00A0$");
    expect(formatUsd("en", 9.99)).toBe("$9.99");
    expect(formatUsd("de", 9.9)).toBe("9,90\u00A0$");
    expect(formatUsd("de", 29)).toBe("29\u00A0$");
    expect(formatUsd("de", 1290)).toBe("1.290\u00A0$");
    expect(formatUsd("en", 1290)).toBe("$1,290");
    expect(formatCostUsd("de", 27.5)).toBe("27,50\u00A0$");
    expect(priceLabel(translator("de"), "starter", table({ starter: { monthlyUsd: 19.99, yearlyUsd: null } }))).toBe("19,99\u00A0$");
  });

  it("count months free in cents (no float drift), only whole months", () => {
    const at = (monthlyUsd: number, yearlyUsd: number | null) => monthsFree("starter", table({ starter: { monthlyUsd, yearlyUsd } }));
    expect(at(9.99, 99.9)).toBe(2);
    expect(at(0.1 + 0.2, 3)).toBe(2);
    expect(at(9.99, 109.89)).toBe(1);
    expect(at(9.99, 100)).toBeNull();
    expect(at(29, 348)).toBeNull();
    expect(at(29, 400)).toBeNull();
    expect(at(29, null)).toBeNull();
    expect(monthsFree("own-key", table({ "own-key": { monthlyUsd: 49, yearlyUsd: 490 } }))).toBe(2);
  });

  it("list the yearly plans and the months they share", () => {
    expect(yearlyHandles(table({ business: { monthlyUsd: 299, yearlyUsd: 2990 } }))).toEqual(["starter", "pro", "business"]);
    expect(sharedMonthsFree()).toBe(2);
    expect(sharedMonthsFree(table({ pro: { monthlyUsd: 99, yearlyUsd: 1089 } }))).toBeNull();
    expect(sharedMonthsFree(table({ starter: { monthlyUsd: 29, yearlyUsd: null }, pro: { monthlyUsd: 99, yearlyUsd: null } }))).toBeNull();
  });
});

describe("warnings before saving", () => {
  it("none for the defaults; a ladder that doesn't rise; a margin under 40 %", () => {
    expect(priceWarnings(DEFAULT_PRICES)).toEqual([]);
    expect(priceWarnings(table({ starter: { monthlyUsd: 120, yearlyUsd: null } }))).toEqual([{ code: "LADDER_NOT_RISING", handle: "pro", below: "starter" }]);
    expect(priceWarnings(table({ business: { monthlyUsd: 99, yearlyUsd: null } }))).toContainEqual({ code: "LADDER_NOT_RISING", handle: "business", below: "pro" });
    const low = priceWarnings(table({ business: { monthlyUsd: 199, yearlyUsd: 1990 } }));
    expect(low).toEqual([
      { code: "LOW_MARGIN", handle: "business", period: "monthly", margin: estimatedMargin(199, 4_000_000) },
      { code: "LOW_MARGIN", handle: "business", period: "yearly", margin: estimatedMargin(1990 / 12, 4_000_000) },
    ]);
    expect(low.every((w) => w.code === "LOW_MARGIN" && w.margin < 0.4)).toBe(true);
  });
});

describe("the Prices form", () => {
  const form = (values: Record<string, string>, omit: string[] = []) => {
    const data = new FormData();
    const base: Record<string, string> = {
      "free.monthly": "0",
      "free.yearly": "",
      "starter.monthly": "29",
      "starter.yearly": "290",
      "pro.monthly": "99",
      "pro.yearly": "990",
      "business.monthly": "299",
      "business.yearly": "",
      "own-key.monthly": "49",
      "own-key.yearly": "",
      ...VERSIONS,
      reason: "Price review",
      code: "123456",
    };
    for (const [name, value] of Object.entries({ ...base, ...values })) if (!omit.includes(name)) data.set(name, value);
    return data;
  };
  const VERSIONS = Object.fromEntries(PRICE_HANDLES.map((handle) => [`${handle}.version`, handle === "pro" ? "2026-11-04T10:50:00.000Z/9900/99000" : "default"]));
  const versions = { free: "default", starter: "default", pro: "2026-11-04T10:50:00.000Z/9900/99000", business: "default", "own-key": "default" };
  const errors = (values: Record<string, string>, omit: string[] = []) => {
    const result = parsePriceForm(form(values, omit));
    return result.ok ? {} : result.errors;
  };

  it("accepts the defaults, decimal comma or point, Free's fields left out, a spaced code", () => {
    const result = parsePriceForm(form({ "starter.monthly": " 19,9 ", "starter.yearly": "199.00", code: " 123 456 ", reason: "  Lower   start\nprice " }, ["free.monthly", "free.yearly"]));
    expect(result).toEqual({ ok: true, table: table({ starter: { monthlyUsd: 19.9, yearlyUsd: 199 } }), versions, reason: "Lower start price", code: "123456" });
    expect(parsePriceForm(form({}))).toMatchObject({ ok: true, table: DEFAULT_PRICES });
  });

  it("returns every plan's version as sent, a missing one empty (it never matches: savePrices refuses)", () => {
    const missing = parsePriceForm(form({}, ["pro.version", "free.version"]));
    expect(missing).toMatchObject({ ok: true, versions: { ...versions, pro: "", free: "" } });
  });

  it("keeps Own key monthly only, like its plan in the Partner Dashboard", () => {
    expect(PRICE_HANDLES.filter(offersYearly)).toEqual(["starter", "pro", "business"]);
    expect(errors({ "own-key.yearly": "490" })).toEqual({ "own-key.yearly": "MONTHLY_ONLY" });
    expect(errors({ "own-key.yearly": "abc" })).toEqual({ "own-key.yearly": "MONTHLY_ONLY" });
    expect(errors({ "own-key.monthly": "59", "own-key.yearly": "" })).toEqual({});
  });

  it("counts the reason as PostgreSQL does (code points) and refuses control characters", () => {
    // "📈a" is 3 UTF-16 units but 2 code points: PostgreSQL's length() says 2, under the CHECK's 3.
    expect("📈a".length).toBe(3);
    expect(errors({ reason: "📈a" })).toEqual({ reason: "REASON_REQUIRED" });
    expect(errors({ reason: "🇺🇸" })).toEqual({ reason: "REASON_REQUIRED" });
    expect(errors({ reason: "📈ab" })).toEqual({});
    expect(errors({ reason: "📈".repeat(500) })).toEqual({});
    expect(errors({ reason: "📈".repeat(501) })).toEqual({ reason: "REASON_REQUIRED" });
    // NUL (PostgreSQL refuses it in text and JSON) and every other control character; tabs and line breaks are spaces.
    for (const bad of ["abc\u0000def", "abc\u0007def", "abc\u001bdef", "abc\u007fdef", "abc\u0085def"]) expect(errors({ reason: bad }), JSON.stringify(bad)).toEqual({ reason: "REASON_INVALID" });
    const spaced = parsePriceForm(form({ reason: "Line one\r\n\tline two" }));
    expect(spaced).toMatchObject({ ok: true, reason: "Line one line two" });
  });

  it("names each field's problem", () => {
    expect(errors({ "starter.monthly": "" })).toEqual({ "starter.monthly": "REQUIRED" });
    for (const raw of ["abc", "1,000", "1.000", "9.999", "-5", "$29", "29 $", "1e3"]) expect(errors({ "pro.monthly": raw }), raw).toEqual({ "pro.monthly": "NOT_A_PRICE" });
    expect(errors({ "pro.monthly": "0.99" })).toEqual({ "pro.monthly": "TOO_LOW" });
    expect(errors({ "pro.monthly": "100000.01" })).toEqual({ "pro.monthly": "TOO_HIGH" });
    expect(errors({ "pro.monthly": "99999999999" })).toEqual({ "pro.monthly": "TOO_HIGH" });
    expect(errors({ "pro.monthly": "100000", "pro.yearly": "" })).toEqual({});
    expect(errors({ "pro.yearly": "1200000.01" })).toEqual({ "pro.yearly": "TOO_HIGH" });
    expect(errors({ "pro.yearly": "0,5" })).toEqual({ "pro.yearly": "TOO_LOW" });
    expect(errors({ "pro.yearly": "98.99" })).toEqual({ "pro.yearly": "YEARLY_TOO_LOW" });
    expect(errors({ "pro.yearly": "99" })).toEqual({});
    expect(errors({ "free.monthly": "5" })).toEqual({ "free.monthly": "FREE_IS_FREE" });
    expect(errors({ "free.yearly": "0" })).toEqual({ "free.yearly": "FREE_IS_FREE" });
    expect(errors({ "free.monthly": "0,00" })).toEqual({});
    expect(errors({ reason: "ok" })).toEqual({ reason: "REASON_REQUIRED" });
    expect(errors({ reason: "x".repeat(501) })).toEqual({ reason: "REASON_REQUIRED" });
    expect(errors({ reason: "x".repeat(500) })).toEqual({});
    expect(errors({}, ["reason", "code"])).toEqual({ reason: "REASON_REQUIRED", code: "CODE_REQUIRED" });
    expect(errors({ code: "12345" })).toEqual({ code: "CODE_REQUIRED" });
    expect(errors({ code: "12345a" })).toEqual({ code: "CODE_REQUIRED" });
  });

  it("links to the organization's apps in the Partner Dashboard when its id is known", () => {
    const env = { ...process.env };
    expect(partnerDashboardUrl(getConfig({ ...env, SHOPIFY_PARTNER_ORG_ID: "1234567" }))).toBe("https://partners.shopify.com/1234567/apps");
    expect(partnerDashboardUrl(getConfig({ ...env, SHOPIFY_PARTNER_ORG_ID: undefined }))).toBe("https://partners.shopify.com/");
  });
});

type Row = { handle: string; monthlyCents: number; yearlyCents: number | null };

describe("the cached table", () => {
  const client = (rows: () => Promise<Row[]>) => {
    const calls = { count: 0 };
    return { calls, client: { planPrice: { findMany: () => (calls.count++, rows()) } } as unknown as PrismaClient };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    invalidatePriceCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    invalidatePriceCache();
  });

  it("reads the database at most every 30 s, rows over the defaults, again after invalidation", async () => {
    const db = client(async () => [{ handle: "pro", monthlyCents: 10_999, yearlyCents: null }]);
    const [a, b] = await Promise.all([getPriceTable(db.client), getPriceTable(db.client)]);
    expect(db.calls.count).toBe(1);
    expect(a).toBe(b);
    expect(a).toEqual(table({ pro: { monthlyUsd: 109.99, yearlyUsd: null } }));
    vi.advanceTimersByTime(29_000);
    await getPriceTable(db.client);
    expect(db.calls.count).toBe(1);
    vi.advanceTimersByTime(2_000);
    await getPriceTable(db.client);
    expect(db.calls.count).toBe(2);
    invalidatePriceCache();
    await getPriceTable(db.client);
    expect(db.calls.count).toBe(3);
  });

  it("shows the last table read when the database fails, else the defaults, and says so once", async () => {
    // A fresh module: no table read yet in this process.
    vi.resetModules();
    const { getPriceTable, invalidatePriceCache } = await import("../../app/.server/admin/prices");
    const { logger } = await import("../../app/.server/lib/logger");
    const { DEFAULT_PRICES } = await import("../../app/lib/plans");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const failing = client(async () => {
      throw Object.assign(new Error("connection refused at postgresql://user:secret@db"), { name: "PrismaClientInitializationError" });
    });
    expect(await getPriceTable(failing.client)).toBe(DEFAULT_PRICES);
    const good = client(async () => [{ handle: "starter", monthlyCents: 3_900, yearlyCents: 39_000 }]);
    invalidatePriceCache();
    const read = await getPriceTable(good.client);
    invalidatePriceCache();
    expect(await getPriceTable(failing.client)).toBe(read);
    invalidatePriceCache();
    expect(await getPriceTable(failing.client)).toBe(read);
    // Logged for the first outage, then again only after a good read; the error's class, never its message.
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [fields] of warn.mock.calls) expect(fields).toEqual({ error: "PrismaClientInitializationError" });
    // A failed read is kept for 5 s too: no read per page during an outage.
    const before = failing.calls.count;
    await getPriceTable(failing.client);
    expect(failing.calls.count).toBe(before);
    // Then one try in the background; the page gets the fallback at once.
    vi.advanceTimersByTime(5_000);
    expect(await getPriceTable(failing.client)).toBe(read);
    expect(failing.calls.count).toBe(before + 1);
  });

  /** A database that answers only when told to (a dropped connection, a full pool). */
  const hangingClient = () => {
    const answers: Array<(rows: Row[]) => void> = [];
    const db = client(() => new Promise<Row[]>((resolve) => answers.push(resolve)));
    return { ...db, answer: (rows: Row[]) => answers.shift()!(rows) };
  };

  it("never keeps a page waiting on a hanging database: the first pages at most 1.5 s, one read for all, then no wait at all", async () => {
    vi.resetModules();
    const { getPriceTable } = await import("../../app/.server/admin/prices");
    const { logger } = await import("../../app/.server/lib/logger");
    const { DEFAULT_PRICES } = await import("../../app/lib/plans");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const db = hangingClient();
    let served = 0;
    const pages = [0, 1, 2].map(() => getPriceTable(db.client).then((t) => (served++, t)));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(served).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    // No table read yet in this process: the defaults, for every page, after 1.5 s at most.
    expect(await Promise.all(pages)).toEqual([DEFAULT_PRICES, DEFAULT_PRICES, DEFAULT_PRICES]);
    expect(db.calls.count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ error: "PriceReadTimeout" });
    // The read is still under way: later pages get the fallback at once, and no second read starts.
    expect(await getPriceTable(db.client)).toBe(DEFAULT_PRICES);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await getPriceTable(db.client)).toBe(DEFAULT_PRICES);
    expect(db.calls.count).toBe(1);
    // It answers at last: its table from then on.
    db.answer([{ handle: "pro", monthlyCents: 10_900, yearlyCents: 109_000 }]);
    await vi.advanceTimersByTimeAsync(0);
    const read = await getPriceTable(db.client);
    expect(read).toEqual(table({ pro: { monthlyUsd: 109, yearlyUsd: 1090 } }));

    // 30 s later the database hangs again: the table read before, at once (no timer runs), while it is read again.
    vi.advanceTimersByTime(30_000);
    let fresh: unknown = null;
    void getPriceTable(db.client).then((t) => (fresh = t));
    await Promise.resolve();
    await Promise.resolve();
    expect(fresh).toBe(read);
    expect(db.calls.count).toBe(2);
    db.answer([{ handle: "pro", monthlyCents: 11_900, yearlyCents: null }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await getPriceTable(db.client)).pro).toEqual({ monthlyUsd: 119, yearlyUsd: null });
    expect(db.calls.count).toBe(2);
  });

  it("waits for a slow first read that answers in time, and shows the last table read when the next one doesn't", async () => {
    vi.resetModules();
    const { getPriceTable, invalidatePriceCache } = await import("../../app/.server/admin/prices");
    const { logger } = await import("../../app/.server/lib/logger");
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const db = hangingClient();
    const page = getPriceTable(db.client);
    await vi.advanceTimersByTimeAsync(400);
    db.answer([{ handle: "starter", monthlyCents: 3_900, yearlyCents: 39_000 }]);
    const read = await page;
    expect(read.starter).toEqual({ monthlyUsd: 39, yearlyUsd: 390 });
    // After a save in this process the cache is gone; the database hangs now: the table read before, not the defaults.
    invalidatePriceCache();
    const next = getPriceTable(db.client);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await next).toBe(read);
  });
});

describe("the Plan page with other prices", () => {
  const NOW = "2026-11-04T09:00:00.000Z";
  const URL = "https://admin.shopify.com/store/shop/charges/linguva/pricing_plans";
  const hero = planView({ configured: true, state: "NONE", stale: false, subscription: null, choosePlanUrl: URL, now: NOW });
  const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/[\u00A0\s]+/g, " ");
  const prices = table({
    starter: { monthlyUsd: 19.99, yearlyUsd: null },
    pro: { monthlyUsd: 109, yearlyUsd: 1199 },
    business: { monthlyUsd: 349, yearlyUsd: 3490 },
    "own-key": { monthlyUsd: 59, yearlyUsd: 590 },
  });

  it("the cards show the table's prices and yearly lines", () => {
    const i18n = translator("de");
    const html = renderToStaticMarkup(createElement(PlanCards, { i18n, hero, now: NOW, intro: "plan.compare.intro", choosePlanUrl: URL, trial: true, recommendation: null, use: null, prices }));
    const text = flat(html);
    for (const price of ["19,99 $", "109 $", "349 $"]) expect(text).toContain(price);
    expect([...html.matchAll(/oder ([\d.]+)\u00A0\$ \/ Jahr/g)].map((m) => m[1])).toEqual(["1.199", "3.490"]);
    // 1199 = 11 × 109: one month free; 3490 = 10 × 349: two.
    expect(html.match(/1 Monat gratis/g)).toHaveLength(1);
    expect(html.match(/2 Monate gratis/g)).toHaveLength(1);
    expect(html.match(/Nur monatlich/g)).toHaveLength(1);
    expect(text).not.toContain("29 $");
  });

  it("the Own key card shows a yearly price when the table has one", () => {
    const i18n = translator("de");
    const plan = { visible: true, current: false, pending: false, choosePlanUrl: URL, price: prices["own-key"] };
    const html = renderToStaticMarkup(createElement(OwnKeyPlanCard, { i18n, plan, hero, now: NOW }));
    expect(html).toContain("59\u00A0$");
    expect(html).toContain("oder 590\u00A0$ / Jahr");
    expect(html).toContain("2 Monate gratis");
    expect(html).not.toContain("Nur monatlich");
    const monthly = renderToStaticMarkup(createElement(OwnKeyPlanCard, { i18n, plan: { ...plan, price: OWN_KEY_PRICE }, hero, now: NOW }));
    expect(monthly).toContain("Nur monatlich");
    expect(monthly).not.toContain("Jahr");
  });

  it("the table's price row and the questions follow the table", () => {
    const i18n = translator("en");
    const html = renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: null, prices }));
    const row = html.slice(html.indexOf("lv-plan-table__label--price"), html.indexOf("</tr>", html.indexOf("lv-plan-table__label--price")));
    expect(flat(row)).toContain("$19.99");
    expect(flat(row)).toContain("$109");
    // Pro saves one month, Business two: no shared claim.
    expect(row).not.toMatch(/also yearly/);
    const same = renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: null, prices: { ...prices, pro: { monthlyUsd: 109, yearlyUsd: 1090 } } }));
    expect(same).toContain("Pro and Business also yearly: 2 months free");
    const faq = flat(renderToStaticMarkup(createElement(PlanFaq, { i18n, canChange: true, prices })));
    expect(faq).toContain("Pro and Business");
    expect(faq).not.toContain("Starter and Pro");
  });

  it("render exactly as before without a table", () => {
    const i18n = translator("de");
    const props = { i18n, hero, now: NOW, intro: "plan.compare.intro" as const, choosePlanUrl: URL, trial: true, recommendation: null, use: null };
    expect(renderToStaticMarkup(createElement(PlanCards, { ...props, prices: DEFAULT_PRICES }))).toBe(renderToStaticMarkup(createElement(PlanCards, props)));
    expect(renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: "pro", prices: DEFAULT_PRICES }))).toBe(renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: "pro" })));
  });
});

describe("the website's prices", () => {
  const PAGES = ["index.html", "preise.html"];
  const variants = [
    { publicPages: false, reviewed: false },
    { publicPages: true, reviewed: true, ownKeyPlan: true },
    { publicPages: true, reviewed: false, ownKeyPlan: false, engines: tokens(["deepl", "azure-eu", "google-global"]) },
  ];

  it("with the defaults, are byte for byte the text between the markers, in every variant", () => {
    for (const file of PAGES) {
      const html = site(file);
      expect(html, file).toMatch(/<!--price:/);
      for (const options of variants) {
        expect(pageHtml(html, { ...options, prices: DEFAULT_PRICES }), file).toBe(pageHtml(unmarked(html), options));
        expect(pageHtml(html, options), file).not.toMatch(/<!--\/?price/);
      }
      expect(applyPrices(html), file).toBe(unmarked(html));
    }
    // So the other pages, with no price, are untouched.
    for (const file of ["impressum.html", "datenschutz.html", "privacy.html", "support.html"]) expect(site(file), file).not.toMatch(/<!--\/?price/);
  });

  it("leave no price outside a marker", () => {
    for (const file of PAGES) {
      const outside = site(file).replace(/<!--price:[a-z:-]+-->[\s\S]*?<!--\/price-->/g, "");
      expect(outside, file).not.toMatch(/\d(?:&nbsp;|\s|\u00A0)?\$|Monate? gratis|Nur monatlich|nur monatlich|\/ Jahr/);
      // Markers are paired and never nested.
      expect(site(file).split("<!--price:").length, file).toBe(site(file).split("<!--/price-->").length);
      for (const [, inner] of site(file).matchAll(/<!--price:[a-z:-]+-->([\s\S]*?)<!--\/price-->/g)) expect(inner, file).not.toMatch(/<!--/);
    }
  });

  it("write a changed table in German, the yearly line and the table's note included", () => {
    const prices = table({
      starter: { monthlyUsd: 9.99, yearlyUsd: null },
      pro: { monthlyUsd: 99, yearlyUsd: 1089 },
      business: { monthlyUsd: 1299, yearlyUsd: 12990 },
      "own-key": { monthlyUsd: 5, yearlyUsd: 50 },
    });
    const pricing = pageHtml(site("preise.html"), { publicPages: false, reviewed: false, ownKeyPlan: true, prices });
    expect(pricing).toContain('<span class="amt">9,99&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">Nur monatlich</p>');
    expect(pricing).toContain('<span class="amt">99&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">oder 1.089&nbsp;$ / Jahr <span class="tag">1 Monat gratis</span></p>');
    expect(pricing).toContain('<span class="amt">1.299&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">oder 12.990&nbsp;$ / Jahr <span class="tag">2 Monate gratis</span></p>');
    expect(pricing).toContain('<span class="amt">5&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">oder 50&nbsp;$ / Jahr <span class="tag">2 Monate gratis</span></p>');
    // Pro saves one month, Business two: the table names the yearly plans without a claim.
    expect(pricing).toContain('<span class="rl">Preis pro Monat</span><span class="rd">Pro und Business auch jährlich</span></th>');
    expect(pricing).toContain('<td role="cell">Kosten&shy;los</td><td role="cell">9,99&nbsp;$</td><td role="cell">99&nbsp;$</td><td role="cell">1.299&nbsp;$</td>');
    expect(pricing).toContain("statt KI&#8209;Zeichen, 5&nbsp;$ im Monat oder 50&nbsp;$ im Jahr.</p>");

    // No yearly price at all: the table's note goes; one shared claim: said once.
    const monthly = pageHtml(site("preise.html"), { publicPages: false, reviewed: false, prices: table({ starter: { monthlyUsd: 29, yearlyUsd: null }, pro: { monthlyUsd: 99, yearlyUsd: null } }) });
    expect(monthly).toContain('<span class="rl">Preis pro Monat</span></th>');
    expect(monthly.match(/Nur monatlich/g)).toHaveLength(3);
    expect(monthly).not.toContain("gratis");
    const all = pageHtml(site("preise.html"), { publicPages: false, reviewed: false, prices: table({ business: { monthlyUsd: 299, yearlyUsd: 2990 } }) });
    expect(all).toContain('<span class="rd">Starter, Pro und Business auch jährlich: 2 Monate gratis</span>');

    const home = pageHtml(site("index.html"), { publicPages: false, reviewed: false, prices });
    expect(home).toContain("Kostenlos oder ab 9,99&nbsp;$ im Monat.");
    expect(home).toContain('<p class="pp">1.299&nbsp;$ <span class="per">/ Monat</span></p>');
    // "ab" counts Own key only while its card is on the page.
    const cheapOwnKey = table({ "own-key": { monthlyUsd: 19, yearlyUsd: null } });
    expect(pageHtml(site("index.html"), { publicPages: false, reviewed: false, prices: cheapOwnKey })).toContain("ab 29&nbsp;$ im Monat");
    expect(pageHtml(site("index.html"), { publicPages: false, reviewed: false, ownKeyPlan: true, prices: cheapOwnKey })).toContain("ab 19&nbsp;$ im Monat");
  });

  it("come through sitePage, which keeps its headers and sets no cookie", async () => {
    const response = sitePage(new Request("https://linguva.example/preise"), "pricing", { PUBLIC_PAGES: "off", LEGAL_TEXTS_REVIEWED: undefined }, table({ pro: { monthlyUsd: 89, yearlyUsd: 890 } }));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await response.text();
    expect(html).toContain('<span class="amt">89&nbsp;$</span>');
    expect(html).toContain("oder 890&nbsp;$ / Jahr");
    // Without a table: the defaults, in today's words.
    const config = { PUBLIC_PAGES: "off" as const, LEGAL_TEXTS_REVIEWED: undefined };
    const served = await sitePage(new Request("https://linguva.example/preise"), "pricing", config).text();
    expect(served).toBe(await sitePage(new Request("https://linguva.example/preise"), "pricing", config, DEFAULT_PRICES).text());
    for (const line of [
      '<p class="plan-price"><span class="amt">29&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">oder 290&nbsp;$ / Jahr <span class="tag">2 Monate gratis</span></p>',
      '<p class="plan-price"><span class="amt">99&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">oder 990&nbsp;$ / Jahr <span class="tag">2 Monate gratis</span></p>',
      '<p class="plan-price"><span class="amt">299&nbsp;$</span> <span class="per">/ Monat</span></p>\n<p class="plan-year">Nur monatlich</p>',
      '<span class="rl">Preis pro Monat</span><span class="rd">Starter und Pro auch jährlich: 2 Monate gratis</span></th><td role="cell">Kosten&shy;los</td><td role="cell">29&nbsp;$</td><td role="cell">99&nbsp;$</td><td role="cell">299&nbsp;$</td>',
    ]) expect(served).toContain(line);
    const home = await sitePage(new Request("https://linguva.example/"), "home", config).text();
    expect(home).toContain('<p class="intro">Kostenlos oder ab 29&nbsp;$ im Monat. Abgerechnet über Shopify.</p>');
    expect(home).toContain('<li><p class="pn">Pro</p><p class="pp">99&nbsp;$ <span class="per">/ Monat</span></p>');
  });

  it("refuse a marker they don't know", () => {
    expect(() => applyPrices("<!--price:month:enterprise-->1&nbsp;$<!--/price-->")).toThrow(/site price marker unknown/);
    expect(() => applyPrices("<!--price:week:pro-->1&nbsp;$<!--/price-->")).toThrow(/site price marker unknown/);
  });
});
