/**
 * The Subscriptions page's figures (client-safe, from the directory's rows):
 * installed stores with an active Shopify subscription, their mix per plan
 * and billing period, and the page's filters.
 */
import type { ShopRow } from "../.server/admin/directory";
import { CONSOLE_PLANS, type ConsolePlan } from "./labels";

export interface SubscriptionFilters {
  plan: ConsolePlan | "all";
  trial: boolean;
  cancelling: boolean;
}

export interface MixRow {
  plan: ConsolePlan;
  monthly: number;
  yearly: number;
  trial: number;
  total: number;
}

/** Installed stores whose cached subscription is active (what Shopify charges or will charge after a trial). */
export function subscribedRows(rows: readonly ShopRow[]): ShopRow[] {
  return rows.filter((row) => row.status === "ACTIVE" && row.subscription?.state === "ACTIVE");
}

export function isCancelling(row: ShopRow): boolean {
  return row.cancelling;
}

/** Per plan (in plan order, only plans with a subscription): monthly, yearly, in trial and all. */
export function subscriptionMix(rows: readonly ShopRow[]): { rows: MixRow[]; total: Omit<MixRow, "plan"> } {
  const byPlan = new Map<ConsolePlan, MixRow>();
  for (const row of subscribedRows(rows)) {
    const mix = byPlan.get(row.plan) ?? { plan: row.plan, monthly: 0, yearly: 0, trial: 0, total: 0 };
    if (row.subscription?.billingPeriod === "ANNUAL") mix.yearly++;
    else if (row.subscription?.billingPeriod === "EVERY_30_DAYS") mix.monthly++;
    if (row.inTrial) mix.trial++;
    mix.total++;
    byPlan.set(row.plan, mix);
  }
  const ordered = CONSOLE_PLANS.flatMap((plan) => (byPlan.has(plan) ? [byPlan.get(plan)!] : []));
  const total = ordered.reduce((sum, m) => ({ monthly: sum.monthly + m.monthly, yearly: sum.yearly + m.yearly, trial: sum.trial + m.trial, total: sum.total + m.total }), {
    monthly: 0,
    yearly: 0,
    trial: 0,
    total: 0,
  });
  return { rows: ordered, total };
}

export function parseSubscriptionFilters(params: URLSearchParams): SubscriptionFilters {
  const plan = params.get("plan");
  return {
    plan: plan && (CONSOLE_PLANS as readonly string[]).includes(plan) ? (plan as ConsolePlan) : "all",
    trial: params.get("trial") === "1",
    cancelling: params.get("cancelling") === "1",
  };
}

/** The subscribed stores the filters keep, the soonest renewal first. */
export function filterSubscriptions(rows: readonly ShopRow[], filters: SubscriptionFilters): ShopRow[] {
  const ends = (row: ShopRow) => Date.parse(row.subscription?.currentPeriodEnd ?? "") || Number.MAX_SAFE_INTEGER;
  return subscribedRows(rows)
    .filter((row) => (filters.plan === "all" || row.plan === filters.plan) && (!filters.trial || row.inTrial) && (!filters.cancelling || isCancelling(row)))
    .sort((a, b) => ends(a) - ends(b) || (a.shopDomain < b.shopDomain ? -1 : a.shopDomain > b.shopDomain ? 1 : 0));
}
