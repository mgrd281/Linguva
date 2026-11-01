import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { withTenant } from "../tenancy/with-tenant";
import { AUTO_REQUESTED_BY } from "../jobs/bulk-jobs";
import { engineConsentTokens, getConfig } from "../lib/config";
import { engineOfToken, type ConsentToken, type EngineId } from "../../lib/engines";
import { consentTokens, consentVersionFor, LEGACY_DEEPL_CONSENT } from "./ai-consent";

/**
 * Version of the AI data-processing notice for DeepL alone (what every shop
 * accepted before engines could be combined). Other engine sets get their
 * own version (ai-consent.ts): a shop's consent records which engines it
 * covers, and adding one never takes the others away.
 */
export const AI_CONSENT_VERSION = LEGACY_DEEPL_CONSENT;

type ConsentState = { aiDataProcessingConsentAt: Date | null; consentVersion: string | null };

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

/** The consent tokens a stored consent covers among the configured ones, in routing order (none without consent). Pure. */
function coveredTokens(settings: ConsentState, configured: readonly ConsentToken[]): ConsentToken[] {
  if (!settings.aiDataProcessingConsentAt) return [];
  const covered = consentTokens(settings.consentVersion) ?? [];
  return configured.filter((t) => covered.includes(t));
}

/** Consent given and covering at least one configured engine. Pure; with DeepL only or mock, today's rule. */
export function hasAiConsentFor(settings: ConsentState, configured: readonly ConsentToken[]): boolean {
  return coveredTokens(settings, configured).length > 0;
}

/**
 * Whether AI translation may run for the shop: its consent covers at least
 * one engine in use. `configured` is read from the environment (validated at
 * start and cached); pure tests use hasAiConsentFor.
 */
export function hasCurrentAiConsent(settings: ConsentState, configured: readonly ConsentToken[] = engineConsentTokens(getConfig())): boolean {
  return hasAiConsentFor(settings, configured);
}

/** The engines a request may use: consented ∩ configured, in routing order. */
export function consentedEngines(settings: ConsentState, configured: readonly ConsentToken[] = engineConsentTokens(getConfig())): EngineId[] {
  return coveredTokens(settings, configured).map(engineOfToken);
}

/**
 * The consent tokens a page's texts and coverage are about: what a current
 * consent covers among the engines in use, else every engine in use (before
 * any consent the merchant reads about all of them). Routing order.
 */
export function textConsentTokens(settings: ConsentState, configured: readonly ConsentToken[] = engineConsentTokens(getConfig())): ConsentToken[] {
  const covered = coveredTokens(settings, configured);
  return covered.length ? covered : [...configured];
}

/** Configured engines (with their data location) the shop's consent doesn't cover yet. */
export function missingConsent(settings: ConsentState, configured: readonly ConsentToken[] = engineConsentTokens(getConfig())): ConsentToken[] {
  const covered = coveredTokens(settings, configured);
  return configured.filter((t) => !covered.includes(t));
}

/**
 * Records the merchant's decision. Granting stores consent for the engines
 * the merchant was shown (`shown`, posted by the form), and only when they
 * cover every engine in use: a page rendered before an engine was added
 * returns "changed" and stores nothing (the page shows the new list). A post
 * without the list is accepted only while DeepL is the only engine (forms
 * rendered before this version).
 */
export async function setAiConsent(
  input: { shopId: string; granted: boolean; actorId: string | null; shown?: readonly string[] | null },
  client: PrismaClient = defaultClient,
): Promise<"saved" | "changed"> {
  const configured = engineConsentTokens(getConfig());
  if (input.granted) {
    const covered = input.shown ? configured.every((t) => input.shown!.includes(t)) : configured.length === 1 && configured[0] === "deepl";
    if (!covered) return "changed";
  }
  const version = consentVersionFor(configured);
  await updateSettings(
    input.shopId,
    {
      aiDataProcessingConsentAt: input.granted ? new Date() : null,
      consentVersion: input.granted ? version : null,
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
      metadata: { version },
    }],
  });
  return "saved";
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

/**
 * Automatic translation of new and changed products, collections, pages,
 * blog posts and blogs. Only the shop's additional languages are kept;
 * turning it on without a language turns it off. Turning it on starts the
 * periodic check from now: content changed before isn't picked up.
 * Recorded in the audit log (it spends AI allowance without someone
 * starting each run).
 */
export async function setAutoTranslate(
  input: { shopId: string; enabled: boolean; locales: readonly string[]; allowedLocales: readonly string[]; actorId: string | null },
  client: PrismaClient = defaultClient,
) {
  const locales = [...new Set(input.locales)].filter((l) => input.allowedLocales.includes(l)).slice(0, 20);
  const enabled = input.enabled && locales.length > 0;
  const wasOn = (await getShopSettings(input.shopId, client)).autoTranslateNew;
  await withTenant(
    input.shopId,
    async (tx) => {
      await ensureSettingsRow(tx, input.shopId);
      await tx.shopSettings.update({
        where: { shopId: input.shopId },
        data: {
          autoTranslateNew: enabled,
          autoTranslateLocales: enabled ? locales : [],
          // Changing the languages keeps the position; off clears it. A new choice lifts a pause.
          ...(enabled ? (wasOn ? {} : { autoSweptAt: new Date() }) : { autoSweptAt: null }),
          autoPausedUntil: null,
          autoPauseReason: null,
        },
      });
      // Off (or a language dropped) stops what is already queued: those items aren't translated.
      await tx.translationJob.updateMany({
        where: {
          shopId: input.shopId,
          requestedBy: AUTO_REQUESTED_BY,
          status: { in: ["PENDING", "DISCOVERING", "RUNNING"] },
          ...(enabled ? { targetLocale: { notIn: locales } } : {}),
        },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date(), errorCode: "AUTO_OFF" },
      });
    },
    client,
  );
  await client.auditLog.createMany({
    data: [{
      shopId: input.shopId,
      actorType: "MERCHANT_USER",
      actorId: input.actorId,
      action: enabled ? "auto_translate.enabled" : "auto_translate.disabled",
      metadata: { locales: enabled ? locales : [] },
    }],
  });
  return { enabled, locales: enabled ? locales : [] };
}

/** Stops that pause automatic translation, and how long. */
const PAUSE_FOR: Record<string, (now: Date) => Date> = {
  // The daily caps reset at midnight UTC, the allowance with the next month.
  DAILY_LIMIT: (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
  PLATFORM_LIMIT: (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
  QUOTA_EXCEEDED: (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  // The provider is missing or refuses: try again in an hour.
  AI_NOT_CONFIGURED: (now) => new Date(now.getTime() + 60 * 60_000),
  PROVIDER_AUTH: (now) => new Date(now.getTime() + 60 * 60_000),
  PROVIDER_QUOTA: (now) => new Date(now.getTime() + 60 * 60_000),
};

/** Whether automatic translation waits for a limit or the provider (autoPauseAfterStop). */
export function autoTranslatePaused(settings: { autoPausedUntil: Date | null }, now = new Date()): boolean {
  return settings.autoPausedUntil !== null && settings.autoPausedUntil > now;
}

/**
 * An automatic job stopped: for a limit or the provider, automatic
 * translation pauses until it can work again, instead of creating a failed
 * job for every change. The periodic check keeps its position meanwhile, so
 * the changes are translated after the pause. Returns the end of the pause,
 * or null for a stop that isn't a pause. `allowanceRisesAt`: a Shopify
 * trial's lower allowance ends then (the plan's applies), so a pause for the
 * used-up allowance ends then too when that is sooner than the next month.
 */
export async function autoPauseAfterStop(
  shopId: string,
  code: string,
  now = new Date(),
  client: PrismaClient = defaultClient,
  allowanceRisesAt: Date | null = null,
): Promise<Date | null> {
  const scheduled = PAUSE_FOR[code]?.(now) ?? null;
  if (!scheduled) return null;
  const until = code === "QUOTA_EXCEEDED" && allowanceRisesAt && allowanceRisesAt > now && allowanceRisesAt < scheduled ? allowanceRisesAt : scheduled;
  await withTenant(
    shopId,
    (tx) =>
      tx.shopSettings.updateMany({
        where: { shopId, autoTranslateNew: true },
        data: { autoPausedUntil: until, autoPauseReason: code },
      }),
    client,
  );
  return until;
}
