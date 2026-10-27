import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantTx = Prisma.TransactionClient;

/**
 * Runs `fn` in a transaction where PostgreSQL row-level security is scoped to
 * `shopId`. The setting is transaction-local, so it can't leak to other
 * requests through a pooled connection.
 *
 * `shopId` must come from a verified Shopify session or webhook, never from
 * client input.
 */
export async function withTenant<T>(
  shopId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = defaultClient,
): Promise<T> {
  if (!UUID.test(shopId)) {
    throw new Error("withTenant requires a shop UUID");
  }
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`;
    return fn(tx);
  });
}
