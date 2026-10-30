/**
 * Prices as the Plan page shows them (client-safe). Every price, yearly
 * price and trial figure comes from PLAN_PRICES, TRIAL_DAYS and
 * TRIAL_AI_CHARS (app/lib/plans.ts), never from typed copy
 * (docs/PRICING_DECISION.md §10.3). The prices are display only: the plan
 * button leads to Shopify's plan page, which shows the binding price.
 */
import { INTL_LOCALE, type AppLocale, type I18n } from "../i18n/i18n";
import { PLAN_PRICES, PLANS, TRIAL_DAYS, type PlanHandle } from "./plans";

/**
 * "$29", "29 $", "29 $US", "29 US$" (U+00A0 before the symbol where the
 * language puts one). Both fraction digits are set: older engines throw a
 * RangeError when only the maximum is 0 for USD. No `narrowSymbol`: French
 * and Spanish then say which dollar; the German footnote says US dollars.
 */
export function formatUsd(locale: AppLocale, amount: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

/** The monthly price as a card shows it: Free shows the word, never "$0". */
export function priceLabel(i18n: Pick<I18n, "locale" | "t">, handle: PlanHandle): string {
  const { monthlyUsd } = PLAN_PRICES[handle];
  return monthlyUsd === 0 ? i18n.t("plan.price.free") : formatUsd(i18n.locale, monthlyUsd);
}

/**
 * Months free with the yearly price ("2 months free"): the only savings
 * claim on the page, and exact (yearly = 10 × monthly). Null without a
 * yearly price or when it isn't a whole number of months.
 */
export function monthsFree(handle: PlanHandle): number | null {
  const { monthlyUsd, yearlyUsd } = PLAN_PRICES[handle];
  if (yearlyUsd === null || monthlyUsd <= 0) return null;
  const months = (12 * monthlyUsd - yearlyUsd) / monthlyUsd;
  return Number.isInteger(months) && months >= 1 ? months : null;
}

/** The plans with a yearly price, in plan order (Starter, Pro). */
export function yearlyHandles(): PlanHandle[] {
  return (Object.keys(PLANS) as PlanHandle[]).filter((handle) => PLAN_PRICES[handle].yearlyUsd !== null);
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
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}
