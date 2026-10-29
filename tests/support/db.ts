import { PrismaClient } from "@prisma/client";

/** Owner connection, used only for test setup/teardown and assertions. */
export const ownerDb = new PrismaClient({
  datasources: { db: { url: process.env.MIGRATION_DATABASE_URL! } },
});

/**
 * Removes all rows between tests (TRUNCATE isn't subject to RLS). Every
 * table except Prisma's migration log is cleared, so new tables can't be
 * forgotten here.
 */
export async function resetDatabase() {
  const tables = await ownerDb.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await ownerDb.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`,
  );
}

/**
 * Counts a tenant's rows over the owner connection. FORCE RLS applies to the
 * owner as well, so the tenant is set for this transaction.
 */
export async function countAsOwner(table: string, shopId: string) {
  const [, rows] = await ownerDb.$transaction([
    ownerDb.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`,
    ownerDb.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${table}" WHERE "shopId" = $1::uuid`,
      shopId,
    ),
  ]);
  return Number(rows[0]!.count);
}
