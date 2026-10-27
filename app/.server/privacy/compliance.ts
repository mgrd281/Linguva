import type { PrismaClient, PrivacyTopic } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";

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
 */
export async function handleShopRedact(
  input: { webhookId: string; shopDomain: string },
  client: PrismaClient = defaultClient,
) {
  const now = new Date();
  await client.$transaction([
    client.session.deleteMany({ where: { shop: input.shopDomain } }),
    client.shop.deleteMany({ where: { shopDomain: input.shopDomain } }),
    client.webhookEvent.deleteMany({
      where: {
        shopDomain: input.shopDomain,
        webhookId: { not: input.webhookId },
      },
    }),
    client.privacyRequest.upsert({
      where: { webhookId: input.webhookId },
      create: {
        webhookId: input.webhookId,
        topic: "SHOP_REDACT",
        shopDomain: input.shopDomain,
        dueAt: dueDate(now),
        status: "COMPLETED",
        completedAt: now,
        resolution: "SHOP_DATA_DELETED",
      },
      update: {},
    }),
  ]);
}
