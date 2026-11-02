/**
 * The plan prices the app shows (docs/PRICING_DECISION.md §10.5). They must
 * equal the plans in the Partner Dashboard. This is the only file that
 * writes the values out, on purpose: changing a price or the trial means
 * changing this test too, the reminder to change the Partner Dashboard and
 * both listing languages on the same day (§9 step 8). Everywhere else,
 * including the browser tests, the values come from PLAN_PRICES.
 */
import { describe, expect, it } from "vitest";
import { translator, type AppLocale } from "../../app/i18n/i18n";
import { formatCostUsd, formatUsd, inTrial, monthsFree, priceLabel, showTrial, yearlyHandles } from "../../app/lib/plan-prices";
import { PLAN_PRICES, PLANS, TRIAL_AI_CHARS, TRIAL_DAYS, type PlanHandle } from "../../app/lib/plans";
import * as plans from "../../app/lib/plans";

// The worst case behind the 40 % margin floor (docs/PRICING_DECISION.md §3.1 and §6.1,
// docs/COST_MODEL.md §2): Shopify keeps 17.9 % (15 % revenue share after the first
// $1M plus the 2.9 % processing fee), DeepL bills $27.50 per million characters
// (API Growth, USD rate card), and every paying shop carries $0.50 of DeepL's
// fixed monthly fee. A plan uses its whole monthly allowance.
const KEPT_AFTER_SHOPIFY = 0.821;
const DEEPL_USD_PER_MILLION_CHARS = 27.5;
const FIXED_SHARE_USD = 0.5;
const MARGIN_FLOOR = 0.4;

const HANDLES = Object.keys(PLANS) as PlanHandle[];
const LOCALES: AppLocale[] = ["en", "de", "fr", "es"];

describe("plan prices", () => {
  it("has a price for every plan and for no other handle", () => {
    expect(Object.keys(PLAN_PRICES)).toEqual(Object.keys(PLANS));
  });

  it("keeps Free free, without a yearly price", () => {
    expect(PLAN_PRICES.free).toEqual({ monthlyUsd: 0, yearlyUsd: null });
  });

  it("rises strictly with the plans", () => {
    const monthly = HANDLES.map((handle) => PLAN_PRICES[handle].monthlyUsd);
    for (let i = 1; i < monthly.length; i++) expect(monthly[i]!, HANDLES[i]).toBeGreaterThan(monthly[i - 1]!);
  });

  it("charges ten months for a year wherever a yearly price exists", () => {
    for (const handle of HANDLES) {
      const { monthlyUsd, yearlyUsd } = PLAN_PRICES[handle];
      if (yearlyUsd !== null) expect(yearlyUsd, handle).toBe(10 * monthlyUsd);
    }
  });

  it("keeps at least 40 % margin on every paid price at full use, in the worst case", () => {
    for (const handle of HANDLES) {
      const { monthlyUsd, yearlyUsd } = PLAN_PRICES[handle];
      if (monthlyUsd === 0) continue;
      const cost = (PLANS[handle].monthlyChars * DEEPL_USD_PER_MILLION_CHARS) / 1_000_000 + FIXED_SHARE_USD;
      // The monthly price, and the yearly price per month.
      for (const price of yearlyUsd === null ? [monthlyUsd] : [monthlyUsd, yearlyUsd / 12]) {
        const margin = (price * KEPT_AFTER_SHOPIFY - cost) / price;
        expect(margin, `${handle} at $${price.toFixed(2)} a month`).toBeGreaterThanOrEqual(MARGIN_FLOOR);
      }
    }
  });

  it("pins the decided prices and trial (change the Partner Dashboard and the listing on the same day)", () => {
    expect(PLAN_PRICES).toEqual({
      free: { monthlyUsd: 0, yearlyUsd: null },
      starter: { monthlyUsd: 29, yearlyUsd: 290 },
      pro: { monthlyUsd: 99, yearlyUsd: 990 },
      business: { monthlyUsd: 299, yearlyUsd: null },
    });
    // 7 days with the trial allowance; 0 here and in the Partner Dashboard if the allowance is ever taken out.
    expect(TRIAL_DAYS).toBe(7);
    expect(TRIAL_AI_CHARS).toBe(100_000);
  });
});

describe("prices on the page", () => {
  it("formats whole US dollars for each language, with a no-break space where the language puts one", () => {
    expect(formatUsd("en", 29)).toBe("$29");
    expect(formatUsd("de", 29)).toBe("29 $");
    expect(formatUsd("fr", 29)).toBe("29 $US");
    expect(formatUsd("es", 29)).toBe("29 US$");
    expect(formatUsd("de", 990)).toBe("990 $");
    expect(formatUsd("en", 299)).toBe("$299");
  });

  it("shows Free as a word in every language, never as a zero price", () => {
    const words = { en: "Free", de: "Kosten­los", fr: "Gratuit", es: "Gratis" };
    for (const locale of LOCALES) {
      const label = priceLabel(translator(locale), "free");
      expect(label, locale).toBe(words[locale]);
      expect(label, locale).not.toMatch(/\d/);
    }
    expect(priceLabel(translator("de"), "pro")).toBe("99 $");
  });

  it("states two months free for the yearly prices, and nothing for Free and Business", () => {
    expect(HANDLES.map((handle) => monthsFree(handle))).toEqual([null, 2, 2, null]);
    expect(yearlyHandles()).toEqual(["starter", "pro"]);
  });

  it("shows the trial line only to a store without a paid plan that can choose one, and only with trial days", () => {
    const none = { state: "NONE" as const, stale: false, choosePlanUrl: "https://admin.shopify.com/store/x/charges/linguva/pricing_plans" };
    expect(showTrial(none)).toBe(true);
    expect(showTrial(none, 0)).toBe(false);
    expect(showTrial({ ...none, stale: true })).toBe(false);
    expect(showTrial({ ...none, choosePlanUrl: null })).toBe(false);
    for (const state of ["ACTIVE", "UNKNOWN", "COMPLIMENTARY"] as const) expect(showTrial({ ...none, state }), state).toBe(false);
  });

  it("knows a trial runs only for a current, active subscription whose trial ends later", () => {
    const now = "2026-10-30T09:00:00.000Z";
    const trial = { state: "ACTIVE" as const, stale: false, subscription: { trialEndsAt: "2026-11-05T00:00:00.000Z" }, now };
    expect(inTrial(trial)).toBe(true);
    expect(inTrial({ ...trial, subscription: { trialEndsAt: "2026-10-29T00:00:00.000Z" } })).toBe(false);
    expect(inTrial({ ...trial, subscription: { trialEndsAt: null } })).toBe(false);
    expect(inTrial({ ...trial, stale: true })).toBe(false);
    expect(inTrial({ ...trial, state: "NONE" })).toBe(false);
  });

  it("formats the owner's internal cost with two decimals only when needed", () => {
    expect(formatCostUsd("de", 2.2)).toBe("2,20 $");
    expect(formatCostUsd("de", 27.5)).toBe("27,50 $");
    expect(formatCostUsd("de", 25)).toBe("25 $");
    expect(formatCostUsd("en", 0)).toBe("$0");
  });
});

describe("the Own key plan's price (outside PLAN_PRICES, the ladder of four)", () => {
  const { OWN_KEY_HANDLES, OWN_KEY_PLAN, OWN_KEY_PRICE } = plans;

  it("pins $49 a month, monthly only (change the Partner Dashboard and the listing on the same day)", () => {
    expect(OWN_KEY_PRICE).toEqual({ monthlyUsd: 49, yearlyUsd: null });
    for (const handle of OWN_KEY_HANDLES) {
      expect(plans.planPrice(handle), handle).toBe(OWN_KEY_PRICE);
      expect(Object.hasOwn(PLAN_PRICES, handle), handle).toBe(false);
    }
    // The four plans' prices come from PLAN_PRICES, unchanged.
    for (const handle of HANDLES) expect(plans.planPrice(handle), handle).toBe(PLAN_PRICES[handle]);
  });

  it("keeps at least 40 % margin with the same worst-case formula (0 included characters: only the fixed share)", () => {
    const cost = (OWN_KEY_PLAN.monthlyChars * DEEPL_USD_PER_MILLION_CHARS) / 1_000_000 + FIXED_SHARE_USD;
    const margin = (OWN_KEY_PRICE.monthlyUsd * KEPT_AFTER_SHOPIFY - cost) / OWN_KEY_PRICE.monthlyUsd;
    expect(margin).toBeGreaterThanOrEqual(MARGIN_FLOOR);
  });

  it("has no trial and no months-free claim; the four plans keep theirs", () => {
    expect(plans.trialDaysFor("own-key")).toBe(0);
    for (const handle of OWN_KEY_HANDLES) {
      expect(plans.trialDaysFor(handle), handle).toBe(0);
      expect(monthsFree(handle), handle).toBeNull();
    }
    for (const handle of HANDLES) expect(plans.trialDaysFor(handle), handle).toBe(TRIAL_DAYS);
    expect(yearlyHandles()).toEqual(["starter", "pro"]);
  });
});
