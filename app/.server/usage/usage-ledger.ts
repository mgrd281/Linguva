import { Prisma, type PrismaClient } from "@prisma/client";
import { isEngineId, type EngineId } from "../../lib/engines";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import type { EngineCharge } from "./engine-charge";

/**
 * monthly: the shop's monthly allowance; daily: the shop's daily cap;
 * platform: the cap on AI characters across all shops per day (our cost);
 * smartDaily/smartMonthly: the merchant's Smart Auto-Translate budgets.
 */
export type QuotaScope = "monthly" | "daily" | "platform" | "smartDaily" | "smartMonthly";

/** The code a stop at each limit reports (job outcomes, editor messages). */
export const QUOTA_CODES: Record<QuotaScope, string> = {
  monthly: "QUOTA_EXCEEDED",
  daily: "DAILY_LIMIT",
  platform: "PLATFORM_LIMIT",
  smartDaily: "SMART_BUDGET_DAILY",
  smartMonthly: "SMART_BUDGET_MONTHLY",
};

/** Where usage came from: "smart" for Smart Auto-Translate (its budgets sum these). */
export type UsageOrigin = "smart";

/**
 * Who pays for the characters: "merchant" = the Own key plan's own engine keys (no Linguva
 * limit applies and PlatformUsageDay never counts them); absent (NULL in the ledger) = Linguva.
 */
export type UsagePayer = "merchant";

/** A merchant's own budget on top of the plan's limits, in their time zone's day and month. */
export interface UsageBudget {
  origin: UsageOrigin;
  daily?: { limit: number; since: Date };
  monthly?: { limit: number; since: Date };
}

export class QuotaExceededError extends Error {
  constructor(
    readonly used: number,
    readonly requested: number,
    readonly limit: number,
    readonly scope: QuotaScope = "monthly",
  ) {
    super(`${scope} character limit reached (${used} + ${requested} > ${limit})`);
    this.name = "QuotaExceededError";
  }
}

/** Usage periods are calendar months in UTC, e.g. "2026-10". */
export function periodKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** When the next usage period starts: the 1st of the next UTC month, 00:00 UTC (the allowance renews then). */
export function nextPeriodStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** UTC calendar day, e.g. "2026-10-27". */
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Linguva's characters since a time (the daily cap): rows paid by the merchant don't count. */
async function sumCharsSince(tx: TenantTx, shopId: string, since: Date): Promise<number> {
  const result = await tx.usageLedger.aggregate({
    where: { shopId, createdAt: { gte: since }, payer: null },
    _sum: { chars: true },
  });
  return result._sum.chars ?? 0;
}

/**
 * Adds `chars` to today's platform counter, or returns false when that would
 * exceed `cap`. The conditional UPDATE is atomic, so concurrent shops can't
 * overshoot together.
 */
async function addPlatformChars(tx: TenantTx, day: string, chars: number, cap: number | null): Promise<boolean> {
  await tx.$executeRaw`INSERT INTO "PlatformUsageDay" ("day", "chars") VALUES (${day}::date, 0) ON CONFLICT ("day") DO NOTHING`;
  const updated =
    cap === null
      ? await tx.$executeRaw`UPDATE "PlatformUsageDay" SET "chars" = GREATEST(0, "chars" + ${chars}), "updatedAt" = now() WHERE "day" = ${day}::date`
      : await tx.$executeRaw`UPDATE "PlatformUsageDay" SET "chars" = "chars" + ${chars}, "updatedAt" = now() WHERE "day" = ${day}::date AND "chars" + ${chars} <= ${cap}`;
  return updated === 1;
}

async function sumOriginSince(tx: TenantTx, shopId: string, origin: UsageOrigin, since: Date): Promise<number> {
  const result = await tx.usageLedger.aggregate({
    where: { shopId, origin, createdAt: { gte: since } },
    _sum: { chars: true },
  });
  return result._sum.chars ?? 0;
}

/** Characters Smart Auto-Translate used since a time (the start of a budget window). */
export async function getOriginUsageSince(shopId: string, origin: UsageOrigin, since: Date, client: PrismaClient = defaultClient): Promise<number> {
  return withTenant(shopId, (tx) => sumOriginSince(tx, shopId, origin, since), client);
}

async function platformChars(tx: TenantTx, day: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ chars: bigint }>>`SELECT "chars" FROM "PlatformUsageDay" WHERE "day" = ${day}::date`;
  return Number(rows[0]?.chars ?? 0);
}

/** Linguva's characters in a period (the allowance): rows paid by the merchant don't count. */
async function sumChars(tx: TenantTx, shopId: string, period: string): Promise<number> {
  const result = await tx.usageLedger.aggregate({
    where: { shopId, periodKey: period, payer: null },
    _sum: { chars: true },
  });
  return result._sum.chars ?? 0;
}

async function insertOnce(
  tx: TenantTx,
  data: Prisma.UsageLedgerUncheckedCreateInput,
): Promise<boolean> {
  const existing = await tx.usageLedger.findUnique({
    where: { shopId_idempotencyKey: { shopId: data.shopId, idempotencyKey: data.idempotencyKey } },
  });
  if (existing) return false;
  await tx.usageLedger.create({ data });
  return true;
}

export async function getMonthlyUsage(
  shopId: string,
  period: string = periodKey(),
  client: PrismaClient = defaultClient,
): Promise<number> {
  return withTenant(shopId, (tx) => sumChars(tx, shopId, period), client);
}

/**
 * The shop's characters this month per engine (rows without one count as
 * DeepL's, the only engine before others existed). Charged characters only:
 * partials lost to failover aren't in a shop's ledger. Linguva's engines only
 * (the cost blend): rows paid by the merchant don't count. Inside the tenant.
 */
export async function getMonthlyUsageByProvider(
  shopId: string,
  period: string = periodKey(),
  client: PrismaClient = defaultClient,
): Promise<Record<string, number>> {
  const rows = await withTenant(
    shopId,
    (tx) => tx.usageLedger.groupBy({ by: ["provider"], where: { shopId, periodKey: period, payer: null }, _sum: { chars: true } }),
    client,
  );
  const usage: Record<string, number> = {};
  for (const row of rows) {
    const provider = row.provider ?? "deepl";
    usage[provider] = (usage[provider] ?? 0) + (row._sum.chars ?? 0);
  }
  return usage;
}

/**
 * Characters the shop translated through its own keys in a period, per engine (Own key plan):
 * the rows paid by the merchant. Rows of a provider outside ENGINE_IDS (none expected) count in
 * the total only. Inside the tenant.
 */
export async function getOwnKeyUsage(
  shopId: string,
  period: string = periodKey(),
  client: PrismaClient = defaultClient,
): Promise<{ total: number; byEngine: Partial<Record<EngineId, number>> }> {
  const rows = await withTenant(
    shopId,
    (tx) => tx.usageLedger.groupBy({ by: ["provider"], where: { shopId, periodKey: period, payer: "merchant" }, _sum: { chars: true } }),
    client,
  );
  let total = 0;
  const byEngine: Partial<Record<EngineId, number>> = {};
  for (const row of rows) {
    const chars = row._sum.chars ?? 0;
    total += chars;
    if (row.provider !== null && isEngineId(row.provider)) byEngine[row.provider] = (byEngine[row.provider] ?? 0) + chars;
  }
  return { total, byEngine };
}

export interface Reservation {
  shopId: string;
  key: string;
  period: string;
  /** UTC day of the reservation; settlement adjusts that day's platform counter. */
  day: string;
  /**
   * When it was reserved. Its settle and release rows carry this time, so every
   * window summed by time (the shop's day, the smart budgets' local day and
   * month) counts a reservation and its correction in the same window.
   */
  at: Date;
  chars: number;
  provider: string;
  /** Copied to the settle and release rows, so a budget sums the net usage. */
  origin?: UsageOrigin;
  /** Copied to the settle and release rows: "merchant" rows never touch PlatformUsageDay. */
  payer?: UsagePayer;
}

/** Shop daily usage of Linguva's characters (UTC day), for display. */
export async function getDailyUsage(shopId: string, client: PrismaClient = defaultClient): Promise<number> {
  const since = new Date(`${dayKey()}T00:00:00.000Z`);
  return withTenant(shopId, (tx) => sumCharsSince(tx, shopId, since), client);
}

/**
 * Reserves characters before a provider call. A per-shop transaction-level
 * advisory lock serialises concurrent reservations, so parallel requests
 * can't overshoot the limit. Re-using an idempotency key returns the
 * existing reservation without counting twice.
 *
 * `payer: "merchant"` (Own key plan): the characters go through the shop's own
 * keys, so no Linguva limit applies (monthly allowance, daily cap, smart
 * budgets, platform cap) and the platform counter isn't touched; the row is
 * still written (idempotency, the shop's own-key usage figures).
 */
export async function reserveUsage(
  input: {
    shopId: string;
    key: string;
    chars: number;
    /** Monthly allowance of the shop. */
    limit: number;
    provider: string;
    /** Optional daily cap of the shop (UTC day). */
    dailyLimit?: number;
    /** Optional cap across all shops per UTC day. */
    platformDailyLimit?: number;
    /** Smart Auto-Translate: its origin and the merchant's budgets. */
    budget?: UsageBudget;
    /** "merchant": the shop's own engine keys pay (Own key plan); no Linguva limit applies. */
    payer?: UsagePayer;
  },
  client: PrismaClient = defaultClient,
): Promise<Reservation> {
  const now = new Date();
  const period = periodKey(now);
  const day = dayKey(now);
  const existing = await withTenant(
    input.shopId,
    async (tx): Promise<Reservation | null> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.shopId}, 0))`;
      const already = await tx.usageLedger.findUnique({
        where: { shopId_idempotencyKey: { shopId: input.shopId, idempotencyKey: input.key } },
      });
      if (already) {
        // A repeated request returns the original reservation unchanged.
        return {
          shopId: input.shopId,
          key: input.key,
          period: already.periodKey,
          day: dayKey(already.createdAt),
          at: already.createdAt,
          chars: already.chars,
          provider: already.provider ?? input.provider,
          ...(already.origin ? { origin: already.origin as UsageOrigin } : {}),
          ...(already.payer ? { payer: "merchant" as const } : {}),
        };
      }
      if (input.payer === "merchant") {
        // The merchant's own keys: none of Linguva's limits, and not Linguva's cost. Never a smart
        // row (Own key has no Smart Auto-Translate; UsageLedger_payer_check), so a budget is ignored.
        await tx.usageLedger.create({
          data: {
            shopId: input.shopId,
            periodKey: period,
            kind: "RESERVE",
            chars: input.chars,
            provider: input.provider,
            idempotencyKey: input.key,
            origin: null,
            payer: "merchant",
            createdAt: now,
          },
        });
        return null;
      }
      const used = await sumChars(tx, input.shopId, period);
      if (used + input.chars > input.limit) {
        throw new QuotaExceededError(used, input.chars, input.limit);
      }
      if (input.dailyLimit !== undefined) {
        const today = await sumCharsSince(tx, input.shopId, new Date(`${day}T00:00:00.000Z`));
        if (today + input.chars > input.dailyLimit) {
          throw new QuotaExceededError(today, input.chars, input.dailyLimit, "daily");
        }
      }
      // The merchant's own Smart Auto-Translate budgets (local day and month), on top of the plan's limits.
      const budget = input.budget;
      if (budget?.daily) {
        const used = await sumOriginSince(tx, input.shopId, budget.origin, budget.daily.since);
        if (used + input.chars > budget.daily.limit) throw new QuotaExceededError(used, input.chars, budget.daily.limit, "smartDaily");
      }
      if (budget?.monthly) {
        const used = await sumOriginSince(tx, input.shopId, budget.origin, budget.monthly.since);
        if (used + input.chars > budget.monthly.limit) throw new QuotaExceededError(used, input.chars, budget.monthly.limit, "smartMonthly");
      }
      // Same transaction: a refused shop reservation never counts globally.
      if (!(await addPlatformChars(tx, day, input.chars, input.platformDailyLimit ?? null))) {
        throw new QuotaExceededError(await platformChars(tx, day), input.chars, input.platformDailyLimit!, "platform");
      }
      await tx.usageLedger.create({
        data: {
          shopId: input.shopId,
          periodKey: period,
          kind: "RESERVE",
          chars: input.chars,
          provider: input.provider,
          idempotencyKey: input.key,
          origin: input.budget?.origin ?? null,
          createdAt: now,
        },
      });
      return null;
    },
    client,
  );
  return (
    existing ?? {
      shopId: input.shopId,
      key: input.key,
      period,
      day,
      at: now,
      chars: input.chars,
      provider: input.provider,
      ...(input.budget && input.payer !== "merchant" ? { origin: input.budget.origin } : {}),
      ...(input.payer === "merchant" ? { payer: "merchant" as const } : {}),
    }
  );
}

/**
 * Records actual usage: the difference to the reservation is adjusted. The
 * settle row is written even without a difference, so a later release of the
 * same reservation (an error after the provider call) can't undo billed usage.
 *
 * `charge` (engine-charge.ts) says which engines answered: when another engine
 * than the planned one was charged, or failover lost partials, the planned
 * engine's `:settle` row is followed by one `:settle:<engine>` row per other
 * engine, and lost partials go to the platform counter only. Without it, or
 * naming only the planned engine, today's single row.
 */
export async function settleUsage(
  reservation: Reservation,
  actualChars: number,
  client: PrismaClient = defaultClient,
  charge?: EngineCharge,
): Promise<void> {
  const others = charge ? Object.entries(charge.byEngine).filter(([engine]) => engine !== reservation.provider) : [];
  const lost = charge ? Object.values(charge.lost).reduce((sum, chars) => sum + chars, 0) : 0;
  if (charge && (others.length > 0 || lost > 0)) return settleByEngine(reservation, charge, others, lost, client);
  const delta = actualChars - reservation.chars;
  await withTenant(
    reservation.shopId,
    async (tx) => {
      const inserted = await insertOnce(tx, {
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "ADJUST",
        chars: delta,
        provider: reservation.provider,
        idempotencyKey: `${reservation.key}:settle`,
        origin: reservation.origin ?? null,
        payer: reservation.payer ?? null,
        createdAt: reservation.at,
      });
      if (inserted && delta !== 0 && reservation.payer !== "merchant") await addPlatformChars(tx, reservation.day, delta, null);
    },
    client,
  );
}

async function settleByEngine(
  reservation: Reservation,
  charge: EngineCharge,
  others: Array<[string, number]>,
  lost: number,
  client: PrismaClient,
): Promise<void> {
  const planned = charge.byEngine[reservation.provider] ?? 0;
  const charged = Object.values(charge.byEngine).reduce((sum, chars) => sum + chars, 0);
  await withTenant(
    reservation.shopId,
    async (tx) => {
      const row = (chars: number, provider: string, idempotencyKey: string) => ({
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "ADJUST" as const,
        chars,
        provider,
        idempotencyKey,
        origin: reservation.origin ?? null,
        payer: reservation.payer ?? null,
        createdAt: reservation.at,
      });
      // `:settle` first: releaseUsage looks for it, so the reservation can't be released afterwards.
      const inserted = await insertOnce(tx, row(planned - reservation.chars, reservation.provider, `${reservation.key}:settle`));
      if (!inserted) return;
      for (const [engine, chars] of others) await insertOnce(tx, row(chars, engine, `${reservation.key}:settle:${engine}`));
      // The platform counts what every engine billed, the lost partials too (they cost the platform).
      // Own keys: the merchant's engines billed them, never Linguva's.
      const delta = charged - reservation.chars + lost;
      if (delta !== 0 && reservation.payer !== "merchant") await addPlatformChars(tx, reservation.day, delta, null);
    },
    client,
  );
}

/** Returns reserved characters when the provider call failed. Does nothing once the reservation is settled. */
export async function releaseUsage(
  reservation: Reservation,
  client: PrismaClient = defaultClient,
): Promise<void> {
  await withTenant(
    reservation.shopId,
    async (tx) => {
      const settled = await tx.usageLedger.findUnique({
        where: { shopId_idempotencyKey: { shopId: reservation.shopId, idempotencyKey: `${reservation.key}:settle` } },
        select: { id: true },
      });
      if (settled) return;
      const inserted = await insertOnce(tx, {
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "RELEASE",
        chars: -reservation.chars,
        provider: reservation.provider,
        idempotencyKey: `${reservation.key}:release`,
        origin: reservation.origin ?? null,
        payer: reservation.payer ?? null,
        createdAt: reservation.at,
      });
      if (inserted && reservation.payer !== "merchant") await addPlatformChars(tx, reservation.day, -reservation.chars, null);
    },
    client,
  );
}
