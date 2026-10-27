import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";

export class QuotaExceededError extends Error {
  constructor(
    readonly used: number,
    readonly requested: number,
    readonly limit: number,
  ) {
    super(`Monthly character limit reached (${used} + ${requested} > ${limit})`);
    this.name = "QuotaExceededError";
  }
}

/** Usage periods are calendar months in UTC, e.g. "2026-10". */
export function periodKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
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
  chars: number;
  provider: string;
}

/**
 * Reserves characters before a provider call. A per-shop transaction-level
 * advisory lock serialises concurrent reservations, so parallel requests
 * can't overshoot the limit. Re-using an idempotency key returns the
 * existing reservation without counting twice.
 */
export async function reserveUsage(
  input: { shopId: string; key: string; chars: number; limit: number; provider: string },
  client: PrismaClient = defaultClient,
): Promise<Reservation> {
  const period = periodKey();
  await withTenant(
    input.shopId,
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.shopId}, 0))`;
      const already = await tx.usageLedger.findUnique({
        where: { shopId_idempotencyKey: { shopId: input.shopId, idempotencyKey: input.key } },
      });
      if (already) return;
      const used = await sumChars(tx, input.shopId, period);
      if (used + input.chars > input.limit) {
        throw new QuotaExceededError(used, input.chars, input.limit);
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
    },
    client,
  );
  return { shopId: input.shopId, key: input.key, period, chars: input.chars, provider: input.provider };
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
    (tx) =>
      insertOnce(tx, {
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "ADJUST",
        chars: delta,
        provider: reservation.provider,
        idempotencyKey: `${reservation.key}:settle`,
      }),
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
    (tx) =>
      insertOnce(tx, {
        shopId: reservation.shopId,
        periodKey: reservation.period,
        kind: "RELEASE",
        chars: -reservation.chars,
        provider: reservation.provider,
        idempotencyKey: `${reservation.key}:release`,
      }),
    client,
  );
}
