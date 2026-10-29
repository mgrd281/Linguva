import type { Prisma, PrismaClient, PrivacyRequestStatus, PrivacyTopic, ShopStatus } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";

// Shopify requires compliance requests to be completed within 30 days.
const COMPLIANCE_DEADLINE_DAYS = 30;

function dueDate(from: Date): Date {
  return new Date(from.getTime() + COMPLIANCE_DEADLINE_DAYS * 86_400_000);
}

/**
 * customers/data_request and customers/redact.
 *
 * Linguva requests no customer or order scopes and stores no customer
 * personal data, so there is nothing to export or erase. The request is
 * recorded as evidence and completed immediately. Customer identifiers from
 * the payload are deliberately not stored.
 */
export async function handleCustomerPrivacyRequest(
  input: { webhookId: string; shopDomain: string; topic: PrivacyTopic },
  client: PrismaClient = defaultClient,
) {
  const now = new Date();
  await client.privacyRequest.upsert({
    where: { webhookId: input.webhookId },
    create: {
      webhookId: input.webhookId,
      topic: input.topic,
      shopDomain: input.shopDomain,
      dueAt: dueDate(now),
      status: "COMPLETED",
      completedAt: now,
      resolution: "NO_CUSTOMER_DATA_STORED",
    },
    update: {},
  });
}

/**
 * shop/redact: erase all data held for the shop. Tenant tables cascade from
 * Shop; sessions and webhook delivery logs are keyed by domain and removed
 * explicitly. Audit entries are kept but detached from the shop (SetNull).
 *
 * Shopify sends it 48 hours after an uninstall. Its HMAC covers only the
 * body, so a captured delivery passes again with a new webhook id: a shop
 * that is installed (again) is never erased. That request is recorded as
 * open (SHOP_ACTIVE_NOT_DELETED) and a warning logged, for the operator to
 * check: a replay, or an uninstall that never reached the app.
 */
export async function handleShopRedact(
  input: { webhookId: string; shopDomain: string },
  client: PrismaClient = defaultClient,
) {
  const now = new Date();
  const record = (status: PrivacyRequestStatus, resolution: string): Prisma.PrivacyRequestUpsertArgs => ({
    where: { webhookId: input.webhookId },
    create: {
      webhookId: input.webhookId,
      topic: "SHOP_REDACT",
      shopDomain: input.shopDomain,
      dueAt: dueDate(now),
      status,
      completedAt: status === "COMPLETED" ? now : null,
      resolution,
    },
    update: {},
  });
  const installed = await client.$transaction(
    async (tx) => {
      // Locks the row: a reinstall waits for this decision instead of racing it.
      const [shop] = await tx.$queryRaw<Array<{ id: string; status: ShopStatus }>>`
        SELECT "id", "status" FROM "Shop" WHERE "shopDomain" = ${input.shopDomain} FOR UPDATE`;
      if (shop?.status === "ACTIVE") {
        await tx.privacyRequest.upsert(record("RECEIVED", "SHOP_ACTIVE_NOT_DELETED"));
        return shop;
      }
      await tx.session.deleteMany({ where: { shop: input.shopDomain } });
      await tx.shop.deleteMany({ where: { shopDomain: input.shopDomain } });
      await tx.webhookEvent.deleteMany({ where: { shopDomain: input.shopDomain, webhookId: { not: input.webhookId } } });
      await tx.privacyRequest.upsert(record("COMPLETED", "SHOP_DATA_DELETED"));
      return null;
    },
    // A large shop's rows all go in this one transaction.
    { timeout: 120_000 },
  );
  if (installed) logger.warn({ webhookId: input.webhookId, shopId: installed.id }, "shop/redact for an installed shop: nothing deleted");
}
