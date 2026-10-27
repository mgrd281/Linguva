import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";

/**
 * Version of the AI data-processing notice the merchant accepted. Bump it
 * when the notice text or the list of subprocessors changes; merchants then
 * have to accept again.
 */
export const AI_CONSENT_VERSION = "2026-10-deepl-v1";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Creates the settings row if it is missing. INSERT … ON CONFLICT DO NOTHING:
 * safe when several requests do it at once (a Prisma upsert reads first and
 * can fail with a unique violation when two requests insert together, which
 * happened on a merchant's first open, when several pages load in parallel).
 */
async function ensureSettingsRow(tx: Tx, shopId: string) {
  await tx.shopSettings.createMany({ data: [{ shopId }], skipDuplicates: true });
}

/** Updates settings, creating the row first if needed. */
async function updateSettings(shopId: string, data: Prisma.ShopSettingsUpdateInput, client: PrismaClient) {
  return withTenant(
    shopId,
    async (tx) => {
      await ensureSettingsRow(tx, shopId);
      return tx.shopSettings.update({ where: { shopId }, data });
    },
    client,
  );
}

export async function getShopSettings(shopId: string, client: PrismaClient = defaultClient) {
  return withTenant(
    shopId,
    async (tx) => {
      const existing = await tx.shopSettings.findUnique({ where: { shopId } });
      if (existing) return existing;
      await ensureSettingsRow(tx, shopId);
      return tx.shopSettings.findUniqueOrThrow({ where: { shopId } });
    },
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
  await updateSettings(
    input.shopId,
    {
      aiDataProcessingConsentAt: input.granted ? new Date() : null,
      consentVersion: input.granted ? AI_CONSENT_VERSION : null,
    },
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
  await updateSettings(
    input.shopId,
    {
      bulkPublishMode: input.mode,
      autoPublishEnabledAt: auto ? new Date() : null,
      autoPublishEnabledBy: auto ? input.actorId : null,
    },
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
  await updateSettings(input.shopId, { reuseMachineMemory: input.enabled }, client);
}

export type Formality = "more" | "less";
export const AI_STORE_CONTEXT_MAX = 300;

/** The form of address configured for a language, if any. */
export function formalityFor(settings: { formalityByLocale: unknown }, locale: string): Formality | undefined {
  const map = settings.formalityByLocale;
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  const value = (map as Record<string, unknown>)[locale];
  return value === "more" || value === "less" ? value : undefined;
}

/**
 * Translation style: form of address per language and a short description
 * of the store for the AI. Unknown languages and values are dropped; the
 * description is trimmed to one paragraph of at most 300 characters.
 */
export async function setTranslationStyle(
  input: { shopId: string; formality: Record<string, string>; storeContext: string; allowedLocales: readonly string[] },
  client: PrismaClient = defaultClient,
) {
  const formalityByLocale: Record<string, Formality> = {};
  for (const [locale, value] of Object.entries(input.formality)) {
    if (input.allowedLocales.includes(locale) && (value === "more" || value === "less")) formalityByLocale[locale] = value;
  }
  const storeContext = input.storeContext.replace(/\s+/g, " ").trim().slice(0, AI_STORE_CONTEXT_MAX) || null;
  await updateSettings(input.shopId, { formalityByLocale, aiStoreContext: storeContext }, client);
  return { formalityByLocale, storeContext };
}

/** Context for the provider: what the store is, then what the text belongs to. Not translated. */
export function translationContext(storeContext: string | null | undefined, itemContext: string | undefined): string | undefined {
  const parts = [storeContext ? `Store: ${storeContext}` : null, itemContext ?? null].filter(Boolean);
  return parts.length ? parts.join(". ").slice(0, 1000) : undefined;
}
