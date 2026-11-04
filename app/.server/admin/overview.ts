/**
 * The admin console's overview: store counts, the plan mix, trials,
 * cancellations, the estimated monthly revenue and this month's AI usage,
 * all from the directory (no database read of its own). Revenue is in
 * cents until the end and rounded once: a yearly price ÷ 12 is rarely whole.
 */
import { ADMIN_PLAN_KEYS, revenueCents, type AdminPlanKey, type Directory, type ShopRow } from "./directory";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "New" and "lost" stores: the last 30 days. */
const RECENT_MS = 30 * DAY_MS;
/** Trials ending this soon are listed. */
const ENDING_SOON_MS = 7 * DAY_MS;

export interface OverviewSummary {
  stores: { active: number; uninstalled: number; new30: number; lost30: number };
  /** Installed stores per plan (every key, 0 included). */
  plans: Record<AdminPlanKey, number>;
  /** Installed stores in a Shopify trial; the ones ending in the next 7 days, soonest first (at most 10). */
  trials: { count: number; endingSoon: ShopRow[] };
  /** Installed stores whose subscription ends with the billing cycle. */
  cancelling: number;
  /** Installed stores with a plan change waiting for the end of the cycle. */
  pendingChanges: number;
  /** Estimated from the current list prices: MRR, ARR = MRR × 12, stores that pay, MRR ÷ paying stores. */
  revenue: { mrrUsd: number; arrUsd: number; payingStores: number; arpuUsd: number };
  /** This UTC month, every store (an uninstalled store's characters still cost). */
  usage: { chars: number; costUsd: number; ownKeyChars: number };
  /** The 5 newest installs (any status). */
  recent: ShopRow[];
  billingConfigured: boolean;
}

export function summarize(dir: Directory, now: Date = new Date()): OverviewSummary {
  const at = now.getTime();
  const active = dir.rows.filter((row) => row.status === "ACTIVE");
  const plans = Object.fromEntries(ADMIN_PLAN_KEYS.map((key) => [key, 0])) as Record<AdminPlanKey, number>;
  for (const row of active) plans[row.plan]++;
  const trialing = active.filter((row) => row.inTrial);
  const endsAt = (row: ShopRow) => Date.parse(row.subscription?.trialEndsAt ?? "");
  const endingSoon = trialing
    .filter((row) => endsAt(row) > at && endsAt(row) - at <= ENDING_SOON_MS)
    .sort((a, b) => endsAt(a) - endsAt(b))
    .slice(0, 10);
  // No upper bound: the database's clock may run a little ahead of this process's.
  const within = (iso: string | null) => iso !== null && at - Date.parse(iso) <= RECENT_MS;
  const cents = dir.rows.map((row) => revenueCents(row, dir.prices));
  const mrrCents = cents.reduce((sum, c) => sum + c, 0);
  const payingStores = cents.filter((c) => c > 0).length;
  return {
    stores: {
      active: active.length,
      uninstalled: dir.rows.length - active.length,
      new30: dir.rows.filter((row) => within(row.installedAt)).length,
      lost30: dir.rows.filter((row) => row.status === "UNINSTALLED" && within(row.uninstalledAt)).length,
    },
    plans,
    trials: { count: trialing.length, endingSoon },
    cancelling: active.filter((row) => row.subscription?.state === "ACTIVE" && row.subscription.cancelAtEndOfCycle).length,
    pendingChanges: active.filter((row) => row.subscription?.state === "ACTIVE" && row.subscription.pendingPlanHandle !== null).length,
    revenue: {
      mrrUsd: Math.round(mrrCents) / 100,
      arrUsd: Math.round(mrrCents * 12) / 100,
      payingStores,
      arpuUsd: payingStores ? Math.round(mrrCents / payingStores) / 100 : 0,
    },
    usage: {
      chars: dir.rows.reduce((sum, row) => sum + row.usage.chars, 0),
      // Each row's cost is already in whole cents: summed in cents, no float drift.
      costUsd: dir.rows.reduce((sum, row) => sum + Math.round(row.usage.costUsd * 100), 0) / 100,
      ownKeyChars: dir.rows.reduce((sum, row) => sum + row.usage.ownKeyChars, 0),
    },
    recent: [...dir.rows].sort((a, b) => Date.parse(b.installedAt) - Date.parse(a.installedAt) || (a.shopDomain < b.shopDomain ? -1 : 1)).slice(0, 5),
    billingConfigured: dir.billingConfigured,
  };
}
