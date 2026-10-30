import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { providerContext } from "../../lib/resource-kinds";
import { logger } from "../lib/logger";
import { alignDocuments, type SegmentPair } from "../memory/alignment";
import { recordMemoryUse, storeMemory } from "../memory/translation-memory";
import { billedBeforeFailure, type TranslationProvider } from "../providers/types";
import { formalityFor, getShopSettings, hasCurrentAiConsent, translationContext } from "../settings/shop-settings";
import {
  getTranslatableResource,
  registerTranslations,
  type TranslatableResourceData,
} from "../shopify/translations-api";
import { noteCoverageWrite } from "../coverage/items";
import { withTenant } from "../tenancy/with-tenant";
import { releaseUsage, reserveUsage, settleUsage } from "../usage/usage-ledger";
import { latestRevisions, revisionKey } from "./revisions";
import {
  completeTranslation,
  keepsSourceStructure,
  leavesItemUntranslated,
  prepareTranslation,
  segmentField,
} from "./translate-fields";
import { loadTranslationContext } from "./translation-context";

type Admin = Pick<AdminApiContext, "graphql">;

export class AiConsentRequiredError extends Error {
  constructor() {
    super("AI data processing consent is required");
    this.name = "AiConsentRequiredError";
  }
}

/** The request would send more text to the provider than one request may. */
export class AiRequestTooLargeError extends Error {
  constructor(
    readonly chars: number,
    readonly max: number,
  ) {
    super(`AI request too large (${chars} > ${max} characters)`);
    this.name = "AiRequestTooLargeError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super("Resource not found");
    this.name = "ResourceNotFoundError";
  }
}

async function loadResource(admin: Admin, resourceId: string, locale: string) {
  const resource = await getTranslatableResource(admin, resourceId, locale);
  if (!resource) throw new ResourceNotFoundError();
  return resource;
}

export function sourceLocaleOf(resource: TranslatableResourceData): string {
  return resource.content[0]?.locale ?? "en";
}

/**
 * Machine-translates selected fields of a resource, using the shop's
 * glossary and translation memory. Only segments that memory doesn't cover
 * are sent to the provider (and counted against the quota). Nothing is
 * written to Shopify: results are drafts for the merchant to review.
 */
export async function aiTranslateResource(
  input: {
    admin: Admin;
    shopId: string;
    resourceId: string;
    /** Content type (for the AI context), e.g. "MENU". */
    resourceType?: string;
    targetLocale: string;
    keys: readonly string[];
    provider: TranslationProvider;
    monthlyLimit: number;
    /** Optional caps (see aiUsageLimits) and the largest single request. */
    dailyLimit?: number;
    platformDailyLimit?: number;
    maxRequestChars?: number;
  },
  client: PrismaClient = defaultClient,
) {
  const settings = await getShopSettings(input.shopId, client);
  if (!hasCurrentAiConsent(settings)) throw new AiConsentRequiredError();

  const resource = await loadResource(input.admin, input.resourceId, input.targetLocale);
  const wanted = new Set(input.keys);
  const fields = resource.content.filter((f) => wanted.has(f.key));
  const titleField = resource.content.find((f) => f.key === "title");
  const context = await loadTranslationContext(
    {
      shopId: input.shopId,
      sourceLocale: sourceLocaleOf(resource),
      targetLocale: input.targetLocale,
      reuseMachineMemory: settings.reuseMachineMemory,
    },
    client,
  );

  const prepared = await prepareTranslation({ fields, protect: context.glossary.protect, memory: context.memory });
  if (input.maxRequestChars !== undefined && prepared.providerChars > input.maxRequestChars) {
    throw new AiRequestTooLargeError(prepared.providerChars, input.maxRequestChars);
  }
  const reservation = prepared.providerChars
    ? await reserveUsage(
        {
          shopId: input.shopId,
          key: `ai:${randomUUID()}`,
          chars: prepared.providerChars,
          limit: input.monthlyLimit,
          dailyLimit: input.dailyLimit,
          platformDailyLimit: input.platformDailyLimit,
          provider: input.provider.id,
        },
        client,
      )
    : null;

  let result: Awaited<ReturnType<typeof completeTranslation>>;
  try {
    result = await completeTranslation(prepared, {
      provider: input.provider,
      sourceLocale: sourceLocaleOf(resource),
      targetLocale: input.targetLocale,
      glossary: context.glossary.rules,
      context: translationContext(settings.aiStoreContext, providerContext(resource.resourceId, titleField?.value, input.resourceType)),
      formality: formalityFor(settings, input.targetLocale),
    });
  } catch (error) {
    // Only the provider call failed: release what it didn't bill.
    if (reservation) {
      const billed = billedBeforeFailure(error);
      await (billed > 0 ? settleUsage(reservation, billed, client) : releaseUsage(reservation, client));
    }
    throw error;
  }
  if (reservation) await settleUsage(reservation, result.billedCharacters, client);
  await recordMemoryUse(input.shopId, result.memoryEntryIds, client);
  return {
    outcomes: result.outcomes,
    provider: result.provider,
    memoryHits: result.memoryHits,
    charsSaved: result.charsSaved,
    digests: Object.fromEntries(resource.content.map((f) => [f.key, f.digest])),
  };
}

export interface TranslationEdit {
  key: string;
  value: string;
  /** Digest of the source the merchant saw when editing. */
  digest: string;
  origin: "AI" | "MANUAL";
  provider?: string | null;
  /** A person wrote or approved this value (protected from bulk jobs). */
  approved: boolean;
  /** Pairs from the engine; when absent they are aligned from the value. */
  segmentPairs?: SegmentPair[];
  restoredFromId?: string | null;
  /**
   * translationDigest of the translation this edit was made to replace. When
   * given and the field's translation is different now (someone wrote one
   * in the meantime), the edit is refused instead of overwriting it.
   */
  expectedCurrent?: string;
}

/** Identifies a field's current translation: sha256 of the value, or "none". */
export function translationDigest(value: string | null | undefined): string {
  return value ? createHash("sha256").update(value).digest("hex") : "none";
}

export type SaveOutcome =
  | { key: string; status: "saved" }
  | { key: string; status: "conflict"; reason: "SOURCE_CHANGED" | "TRANSLATION_CHANGED" }
  | { key: string; status: "error"; message: string; code: SaveErrorCode };

/** Why a field wasn't saved; the editor names it in the interface language (editor.saveError.*). */
export type SaveErrorCode = "UNKNOWN_FIELD" | "EMPTY_TRANSLATION" | "STRUCTURE_CHANGED" | "SHOPIFY_REJECTED" | "NOT_CONFIRMED";

/**
 * Writes translations to Shopify. Each edit is checked against the current
 * source digest first; if the source changed since the merchant loaded it,
 * the edit is refused as a conflict instead of saving a translation of stale
 * text. Saved values are verified from the mutation response and recorded
 * as revisions. A translation that existed before and wasn't written by
 * Linguva is kept as an EXTERNAL revision, so it can be restored. Saved
 * segments go to translation memory.
 */
/**
 * Digest recorded for a value Linguva didn't write. An outdated value was
 * written for an older source, so it gets a digest that never matches:
 * restoring it would otherwise mark it current for the new source text.
 */
export function externalDigest(currentDigest: string, outdated: boolean): string {
  return outdated ? `outdated:${currentDigest}` : currentDigest;
}

export async function saveResourceTranslations(
  input: {
    admin: Admin;
    shopId: string;
    actorId: string | null;
    resourceId: string;
    locale: string;
    edits: readonly TranslationEdit[];
    /**
     * Ids of the drafts these edits publish (Review's approval). They are
     * left to the caller, which records them as published; every other
     * waiting draft of a saved field is retired.
     */
    publishing?: readonly string[];
  },
  client: PrismaClient = defaultClient,
): Promise<SaveOutcome[]> {
  const resource = await loadResource(input.admin, input.resourceId, input.locale);
  const current = new Map(resource.content.map((f) => [f.key, f]));
  const existing = new Map(resource.translations.map((t) => [t.key, t]));
  const outcomes: SaveOutcome[] = [];
  const writable: TranslationEdit[] = [];

  for (const edit of input.edits) {
    const field = current.get(edit.key);
    if (!field || !field.digest) {
      outcomes.push({ key: edit.key, status: "error", message: "Unknown field", code: "UNKNOWN_FIELD" });
    } else if (field.digest !== edit.digest) {
      outcomes.push({ key: edit.key, status: "conflict", reason: "SOURCE_CHANGED" });
    } else if (edit.expectedCurrent !== undefined && translationDigest(existing.get(edit.key)?.value) !== edit.expectedCurrent) {
      outcomes.push({ key: edit.key, status: "conflict", reason: "TRANSLATION_CHANGED" });
    } else if (!edit.value.trim()) {
      outcomes.push({ key: edit.key, status: "error", message: "Translation is empty", code: "EMPTY_TRANSLATION" });
    } else if (!keepsSourceStructure(field, edit.value)) {
      // Rich text, lists and links keep the original's structure and link addresses.
      outcomes.push({
        key: edit.key,
        status: "error",
        message: "The translation doesn't keep the original's structure (formatting, list items or link addresses)",
        code: "STRUCTURE_CHANGED",
      });
    } else if (leavesItemUntranslated(field, edit.value)) {
      outcomes.push({ key: edit.key, status: "error", message: "An item of the list is empty", code: "EMPTY_TRANSLATION" });
    } else {
      writable.push(edit);
    }
  }
  if (writable.length === 0) return outcomes;

  const previous = await latestRevisions(input.shopId, [input.resourceId], input.locale, client);

  const result = await registerTranslations(
    input.admin,
    input.resourceId,
    input.locale,
    writable.map((e) => ({ key: e.key, value: e.value, translatableContentDigest: e.digest })),
  );

  const written = new Map(result.translations.map((t) => [t.key, t.value]));
  const saved: TranslationEdit[] = [];
  for (const edit of writable) {
    if (written.get(edit.key) === edit.value) {
      outcomes.push({ key: edit.key, status: "saved" });
      saved.push(edit);
    } else {
      // Shopify's own wording is kept as the detail (it is only available in English).
      const shopifyMessage = result.userErrors.map((e) => e.message).join("; ");
      outcomes.push({
        key: edit.key,
        status: "error",
        message: shopifyMessage || "Shopify did not confirm the translation",
        code: shopifyMessage ? "SHOPIFY_REJECTED" : "NOT_CONFIRMED",
      });
    }
  }
  if (result.userErrors.length) {
    logger.warn(
      { resourceId: input.resourceId, codes: result.userErrors.map((e) => e.code) },
      "translationsRegister returned user errors",
    );
  }
  if (saved.length === 0) return outcomes;

  const now = Date.now();
  const revisions: Prisma.TranslationRevisionCreateManyInput[] = [];
  for (const edit of saved) {
    const before = existing.get(edit.key);
    const latest = previous.get(revisionKey(input.resourceId, edit.key));
    // Keep the value Linguva is replacing if we have no record of it.
    if (before?.value && before.value.trim() && latest?.value !== before.value) {
      revisions.push({
        shopId: input.shopId,
        resourceGid: input.resourceId,
        key: edit.key,
        locale: input.locale,
        value: before.value,
        sourceDigest: externalDigest(current.get(edit.key)!.digest!, before.outdated),
        origin: "EXTERNAL",
        approved: true,
        createdAt: new Date(now - 1),
      });
    }
    revisions.push({
      shopId: input.shopId,
      resourceGid: input.resourceId,
      key: edit.key,
      locale: input.locale,
      value: edit.value,
      sourceDigest: edit.digest,
      origin: edit.origin,
      provider: edit.origin === "AI" ? (edit.provider ?? null) : null,
      approved: edit.approved,
      actorId: input.actorId,
      restoredFromId: edit.restoredFromId ?? null,
      createdAt: new Date(now),
    });
  }

  await withTenant(
    input.shopId,
    async (tx) => {
      await tx.translationRevision.createMany({ data: revisions });
      // A field saved directly retires any pending draft for it; a draft
      // being published here is the caller's to record (as published).
      await tx.translationDraft.updateMany({
        where: {
          shopId: input.shopId,
          resourceGid: input.resourceId,
          locale: input.locale,
          key: { in: saved.map((e) => e.key) },
          status: "PENDING",
          ...(input.publishing?.length ? { id: { notIn: [...input.publishing] } } : {}),
        },
        data: { status: "STALE" },
      });
    },
    client,
  );

  await noteCoverageWrite(
    { shopId: input.shopId, locale: input.locale, resource, written: saved.map((e) => ({ key: e.key, value: e.value })) },
    client,
  );

  await storeSavedInMemory(input.shopId, resource, input.locale, saved, client);

  // createMany: no RETURNING, so the runtime role needs no SELECT on AuditLog.
  await client.auditLog.createMany({
    data: [{
      shopId: input.shopId,
      actorType: input.actorId ? "MERCHANT_USER" : "SYSTEM",
      actorId: input.actorId,
      action: "translations.saved",
      targetType: "TranslatableResource",
      targetId: input.resourceId,
      metadata: {
        locale: input.locale,
        keys: saved.map((e) => e.key),
        approved: saved.every((e) => e.approved),
      },
    }],
  });
  return outcomes;
}

async function storeSavedInMemory(
  shopId: string,
  resource: TranslatableResourceData,
  locale: string,
  saved: readonly TranslationEdit[],
  client: PrismaClient,
) {
  const settings = await getShopSettings(shopId, client);
  const context = await loadTranslationContext(
    { shopId, sourceLocale: sourceLocaleOf(resource), targetLocale: locale, reuseMachineMemory: settings.reuseMachineMemory },
    client,
  );
  // The target is segmented with the same protections, plus the preferred
  // translations, so glossary codes line up on both sides.
  const targetProtect = {
    protectedTerms: [
      ...(context.glossary.protect.protectedTerms ?? []),
      ...(context.glossary.protect.replacements ?? []).map((r) => ({ term: r.value, caseSensitive: r.caseSensitive })),
    ],
  };
  for (const status of ["APPROVED", "MACHINE"] as const) {
    const pairs = saved
      .filter((e) => (status === "APPROVED") === e.approved)
      .flatMap((edit) => {
        if (edit.segmentPairs) return edit.segmentPairs;
        const field = resource.content.find((f) => f.key === edit.key);
        if (!field) return [];
        return alignDocuments(
          segmentField(field, context.glossary.protect),
          segmentField({ ...field, value: edit.value }, targetProtect),
        );
      });
    await storeMemory(context.memoryContext, pairs, status, client);
  }
}
