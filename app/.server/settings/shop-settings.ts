import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";

/**
 * Version of the AI data-processing notice the merchant accepted. Bump it
 * when the notice text or the list of subprocessors changes; merchants then
 * have to accept again.
 */
export const AI_CONSENT_VERSION = "2026-10-deepl-v1";

export async function getShopSettings(shopId: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    (tx) =>
      tx.shopSettings.upsert({
        where: { shopId },
        create: { shopId },
        update: {},
      }),
    client,
  );
}

export function hasCurrentAiConsent(settings: {
  aiDataProcessingConsentAt: Date | null;
  consentVersion: string | null;
}): boolean {
  return Boolean(settings.aiDataProcessingConsentAt) && settings.consentVersion === AI_CONSENT_VERSION;
}

export async function setAiConsent(
  input: { shopId: string; granted: boolean; actorId: string | null },
  client: PrismaClient = defaultClient,
) {
  await withTenant(
    input.shopId,
    (tx) =>
      tx.shopSettings.upsert({
        where: { shopId: input.shopId },
        create: {
          shopId: input.shopId,
          aiDataProcessingConsentAt: input.granted ? new Date() : null,
          consentVersion: input.granted ? AI_CONSENT_VERSION : null,
        },
        update: {
          aiDataProcessingConsentAt: input.granted ? new Date() : null,
          consentVersion: input.granted ? AI_CONSENT_VERSION : null,
        },
      }),
    client,
  );
  await client.auditLog.create({
    data: {
      shopId: input.shopId,
      actorType: "MERCHANT_USER",
      actorId: input.actorId,
      action: input.granted ? "ai_consent.granted" : "ai_consent.revoked",
      metadata: { version: AI_CONSENT_VERSION },
    },
  });
}
