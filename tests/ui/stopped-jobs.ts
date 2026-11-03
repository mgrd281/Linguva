/**
 * A job stopped (FAILED) with a stop cause, written into a test shop the way
 * the worker leaves it, for the pages that lead back to it once its cause is
 * fixed (`?job=<id>`). Removed again by `remove()`, so the shared stores'
 * Jobs pages stay as other specs expect them.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { findShopByDomain } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { testEnv } from "../support/env";
import { UI_SHOPS, type UiShopKey } from "./fixtures/shops";

export async function stoppedJob(shop: UiShopKey, errorCode: string, data: { resourceType?: string; targetLocale?: string; requestedBy?: string } = {}) {
  const db = new PrismaClient({ datasources: { db: { url: testEnv.DATABASE_URL } } });
  const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
  const shopId = (await findShopByDomain(UI_SHOPS[shop].domain, db))!.id;
  const id = randomUUID();
  await withTenant(
    shopId,
    (tx) =>
      tx.translationJob.create({
        data: {
          id,
          shopId,
          resourceType: data.resourceType ?? "PRODUCT",
          targetLocale: data.targetLocale ?? "de",
          requestedBy: data.requestedBy ?? null,
          status: "FAILED",
          errorCode,
          discoveryDone: true,
          idempotencyKey: `ui-stopped-${id}`,
          finishedAt: new Date(),
        },
      }),
    db,
  );
  return {
    id,
    async remove() {
      try {
        await owner.$transaction([owner.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`, owner.$executeRaw`DELETE FROM "TranslationJob" WHERE "id" = ${id}::uuid`]);
      } finally {
        await Promise.all([db.$disconnect(), owner.$disconnect()]);
      }
    },
  };
}
