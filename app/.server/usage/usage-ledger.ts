import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";

/**
 * monthly: the shop's monthly allowance; daily: the shop's daily cap;
 * platform: the cap on AI characters across all shops per day (our cost).
 */
export type QuotaScope = "monthly" | "daily" | "platform";

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

/** UTC calendar day, e.g. "2026-10-27". */
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function sumCharsSince(tx: TenantTx, shopId: string, since: Date): Promise<number> {
  const result = await tx.usageLedger.aggregate({
    where: { shopId, createdAt: { gte: since } },
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

async function platformChars(tx: TenantTx, day: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ chars: bigint }>>`SELECT "chars" FROM "PlatformUsageDay" WHERE "day" = ${day}::date`;
  return Number(rows[0]?.chars ?? 0);
}

async function sumChars(tx: TenantTx, shopId: string, period: string): Promise<number> {
  const result = await tx.usageLedger.aggregate({
    where: { shopId, periodKey: period },
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

export interface Reservation {
  shopId: string;
  key: string;
  period: string;
  /** UTC day of the reservation; settlement adjusts that day's platform counter. */
  day: string;
  chars: number;
  provider: string;
}

/** Shop daily usage (UTC day), for display. */
export async function getDailyUsage(shopId: string, client: PrismaClient = defaultClient): Promise<number> {
  const since = new Date(`${dayKey()}T00:00:00.000Z`);
  return withTenant(shopId, (tx) => sumCharsSince(tx, shopId, since), client);
}

/**
 * Reserves characters before a provider call. A per-shop transaction-level
 * advisory lock serialises concurrent reservations, so parallel requests
 * can't overshoot the limit. Re-using an idempotency key returns the
 * existing reservation without counting twice.
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
          chars: already.chars,
          provider: already.provider ?? input.provider,
        };
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
        },
      });
      return null;
    },
    client,
  );
  return existing ?? { shopId: input.shopId, key: input.key, period, day, chars: input.chars, provider: input.provider };
}

/** Records actual usage: the difference to the reservation is adjusted. */
export async function settleUsage(
  reservation: Reservation,
  actualChars: number,
  client: PrismaClient = defaultClient,
): Promise<void> {
  const delta = actualChars - reservation.chars;
  if (delta === 0) return;
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
      });
      if (inserted) await addPlatformChars(tx, reservation.day, delta, null);
    },
    client,
  );
}

/** Returns reserved characters when the provider call failed. */
export async function releaseUsage(
  reservation: Reservation,
  client: PrismaClient = defaultClient,
): Promise<void> {
  await withTenant(
    reservation.shopId,
    async (tx) => {
      const inserted = await insertOnce(tx, {
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "RELEASE",
        chars: -reservation.chars,
        provider: reservation.provider,
        idempotencyKey: `${reservation.key}:release`,
      });
      if (inserted) await addPlatformChars(tx, reservation.day, -reservation.chars, null);
    },
    client,
  );
}
