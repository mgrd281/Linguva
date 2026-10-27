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
  // createMany: no RETURNING, so the runtime role needs no SELECT on AuditLog.
  await client.auditLog.createMany({
    data: [{
      shopId: input.shopId,
      actorType: "MERCHANT_USER",
      actorId: input.actorId,
      action: input.granted ? "ai_consent.granted" : "ai_consent.revoked",
      metadata: { version: AI_CONSENT_VERSION },
    }],
  });
}

export class ConfirmationRequiredError extends Error {
  constructor() {
    super("Explicit confirmation is required");
    this.name = "ConfirmationRequiredError";
  }
}

/**
 * Switches bulk jobs between review (DRAFT) and automatic publishing.
 * Turning automatic publishing on requires an explicit confirmation and is
 * recorded with who and when.
 */
export async function setBulkPublishMode(
  input: { shopId: string; mode: "DRAFT" | "AUTO_PUBLISH"; confirmed: boolean; actorId: string | null },
  client: PrismaClient = defaultClient,
) {
  if (input.mode === "AUTO_PUBLISH" && !input.confirmed) throw new ConfirmationRequiredError();
  const auto = input.mode === "AUTO_PUBLISH";
  await withTenant(
    input.shopId,
    (tx) =>
      tx.shopSettings.upsert({
        where: { shopId: input.shopId },
        create: {
          shopId: input.shopId,
          bulkPublishMode: input.mode,
          autoPublishEnabledAt: auto ? new Date() : null,
          autoPublishEnabledBy: auto ? input.actorId : null,
        },
        update: {
          bulkPublishMode: input.mode,
          autoPublishEnabledAt: auto ? new Date() : null,
          autoPublishEnabledBy: auto ? input.actorId : null,
        },
      }),
    client,
  );
  // createMany: no RETURNING, so the runtime role needs no SELECT on AuditLog.
  await client.auditLog.createMany({
    data: [{
      shopId: input.shopId,
      actorType: "MERCHANT_USER",
      actorId: input.actorId,
      action: auto ? "bulk_publish.auto_enabled" : "bulk_publish.review_enabled",
    }],
  });
}

export async function setReuseMachineMemory(
  input: { shopId: string; enabled: boolean },
  client: PrismaClient = defaultClient,
) {
  await withTenant(
    input.shopId,
    (tx) =>
      tx.shopSettings.upsert({
        where: { shopId: input.shopId },
        create: { shopId: input.shopId, reuseMachineMemory: input.enabled },
        update: { reuseMachineMemory: input.enabled },
      }),
    client,
  );
}
