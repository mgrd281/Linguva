/**
 * Prices as the Plan page and the website show them (client-safe). Every
 * price, yearly price and trial figure comes from the price table
 * (PriceTable: DEFAULT_PRICES, or the prices set in the admin console),
 * TRIAL_DAYS and TRIAL_AI_CHARS (app/lib/plans.ts), never from typed copy
 * (docs/PRICING_DECISION.md §10.3). The prices are display only: the plan
 * button leads to Shopify's plan page, which shows the binding price.
 */
import { INTL_LOCALE, type AppLocale, type I18n } from "../i18n/i18n";
import { DEFAULT_PRICES, OWN_KEY, OWN_KEY_PLAN, PLANS, planPrice, TRIAL_DAYS, type KnownPlanHandle, type KnownPriceHandle, type PlanHandle, type PriceTable } from "./plans";

/**
 * "$29", "29 $", "29 $US", "29 US$" (U+00A0 before the symbol where the
 * language puts one); a price with cents shows both digits ("9,99 $", never
 * "9,9 $"). Both fraction digits are set: older engines throw a RangeError
 * when only the maximum is 0 for USD. No `narrowSymbol`: French and Spanish
 * then say which dollar; the German footnote says US dollars.
 */
export function formatUsd(locale: AppLocale, amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

/** Whole cents of a dollar amount (prices are kept in cents: 9.99 → 999, no float drift in sums). */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}
export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** The monthly price as a card shows it: Free shows the word, never "$0". */
export function priceLabel(i18n: Pick<I18n, "locale" | "t">, handle: PlanHandle, prices: PriceTable = DEFAULT_PRICES): string {
  const { monthlyUsd } = prices[handle];
  return monthlyUsd === 0 ? i18n.t("plan.price.free") : formatUsd(i18n.locale, monthlyUsd);
}

/**
 * Months free with the yearly price ("2 months free"): the only savings
 * claim on the page, and exact (yearly = 10 × monthly: 2), computed in cents.
 * Null without a yearly price (Own key is monthly only) or when it isn't a
 * whole number of months.
 */
export function monthsFree(handle: KnownPlanHandle, prices: PriceTable = DEFAULT_PRICES): number | null {
  const { monthlyUsd, yearlyUsd } = planPrice(handle, prices);
  if (yearlyUsd === null || monthlyUsd <= 0) return null;
  const monthly = usdToCents(monthlyUsd);
  const free = 12 * monthly - usdToCents(yearlyUsd);
  return free > 0 && free % monthly === 0 ? free / monthly : null;
}

/** The plans with a yearly price, in plan order (Starter, Pro). */
export function yearlyHandles(prices: PriceTable = DEFAULT_PRICES): PlanHandle[] {
  return (Object.keys(PLANS) as PlanHandle[]).filter((handle) => prices[handle].yearlyUsd !== null);
}

/** The months free every plan with a yearly price shares (the table's "Starter and Pro also yearly: 2 months free"), else null. */
export function sharedMonthsFree(prices: PriceTable = DEFAULT_PRICES): number | null {
  const months = yearlyHandles(prices).map((handle) => monthsFree(handle, prices));
  return months.length > 0 && months.every((m) => m !== null && m === months[0]) ? months[0]! : null;
}

/**
 * The margin floor's worst case (docs/PRICING_DECISION.md §3.1, §6.1 and
 * §10.5): Shopify keeps 17.9 % (15 % revenue share plus the 2.9 % processing
 * fee), DeepL bills $27.50 per million characters (API Growth, USD rate
 * card), every paying shop carries $0.50 of DeepL's fixed monthly fee, and a
 * plan uses its whole monthly allowance. Prices at or above 40 % only.
 */
export const MARGIN_MODEL = { keptAfterShopify: 0.821, usdPerMillionChars: 27.5, fixedShareUsd: 0.5, floor: 0.4 } as const;

/**
 * A plan the admin console may give a yearly price: the paid ladder only.
 * Own key is monthly only, like its plan in the Partner Dashboard, so the
 * Plan page's texts about it ("monthly only", the yearly plans in the
 * questions) stay true; Free has no price at all.
 */
export function offersYearly(handle: KnownPriceHandle): boolean {
  return handle !== "free" && handle !== OWN_KEY;
}

/** Characters a plan includes per month (Own key: none, the merchant's keys pay). */
export function includedChars(handle: KnownPriceHandle): number {
  return handle === OWN_KEY ? OWN_KEY_PLAN.monthlyChars : PLANS[handle].monthlyChars;
}

/**
 * (price × 0.821 − monthlyChars × 27.50 / 1M − 0.50) ÷ price, for a price per
 * month (a yearly price: yearly ÷ 12). Null for a free price.
 */
export function estimatedMargin(priceUsdPerMonth: number, monthlyChars: number): number | null {
  if (priceUsdPerMonth <= 0) return null;
  const cost = (monthlyChars * MARGIN_MODEL.usdPerMillionChars) / 1_000_000 + MARGIN_MODEL.fixedShareUsd;
  return (priceUsdPerMonth * MARGIN_MODEL.keptAfterShopify - cost) / priceUsdPerMonth;
}

export type PriceWarning =
  /** A plan doesn't cost more a month than the plan below it (Starter < Pro < Business). */
  | { code: "LADDER_NOT_RISING"; handle: "pro" | "business"; below: "starter" | "pro" }
  /** Under the 40 % floor at full use: the monthly price, or the yearly price per month. */
  | { code: "LOW_MARGIN"; handle: Exclude<KnownPriceHandle, "free">; period: "monthly" | "yearly"; margin: number };

/** What to look at before saving a price table (shown, never blocking). */
export function priceWarnings(prices: PriceTable): PriceWarning[] {
  const warnings: PriceWarning[] = [];
  const ladder = ["starter", "pro", "business"] as const;
  for (let i = 1; i < ladder.length; i++) {
    const handle = ladder[i] as "pro" | "business";
    const below = ladder[i - 1] as "starter" | "pro";
    if (usdToCents(prices[handle].monthlyUsd) <= usdToCents(prices[below].monthlyUsd)) warnings.push({ code: "LADDER_NOT_RISING", handle, below });
  }
  for (const handle of [...ladder, OWN_KEY] as const) {
    const { monthlyUsd, yearlyUsd } = prices[handle];
    const periods = yearlyUsd === null ? ([["monthly", monthlyUsd]] as const) : ([["monthly", monthlyUsd], ["yearly", yearlyUsd / 12]] as const);
    for (const [period, price] of periods) {
      const margin = estimatedMargin(price, includedChars(handle));
      if (margin !== null && margin < MARGIN_MODEL.floor) warnings.push({ code: "LOW_MARGIN", handle, period, margin });
    }
  }
  return warnings;
}

export interface TrialView {
  state: "ACTIVE" | "NONE" | "UNKNOWN" | "COMPLIMENTARY";
  stale: boolean;
  choosePlanUrl: string | null;
}

/**
 * The paid cards' trial line ("Up to 7 days free …"): only for a store
 * without a paid plan (a verified NONE, not stale) that can choose one, and
 * only while the paid plans have a trial. "Up to": Shopify subtracts trial
 * days the store used in the last 180 days.
 */
export function showTrial(view: TrialView, trialDays: number = TRIAL_DAYS): boolean {
  return trialDays > 0 && view.state === "NONE" && !view.stale && view.choosePlanUrl !== null;
}

export interface RunningTrialView {
  state: TrialView["state"];
  stale: boolean;
  subscription: { trialEndsAt: string | null } | null;
  /** The loader's time (ISO), the same on the server and in the browser. */
  now: string;
}

/** A Shopify trial runs now (the hero shows its end and the trial allowance). Stale data says nothing about it. */
export function inTrial(view: RunningTrialView): boolean {
  const ends = view.subscription?.trialEndsAt;
  return view.state === "ACTIVE" && !view.stale && ends != null && Date.parse(ends) > Date.parse(view.now);
}

/**
 * The owner's internal cost figures: "2,20 $", "27,50 $", "25 $". Whole
 * amounts without decimals, others with two (never "27,5 $").
 */
export function formatCostUsd(locale: AppLocale, amount: number): string {
  return formatUsd(locale, amount);
}
