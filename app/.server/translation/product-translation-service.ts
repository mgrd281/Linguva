import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import type { TranslationProvider } from "../providers/types";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import {
  getTranslatableResource,
  registerTranslations,
  type TranslatableResourceData,
} from "../shopify/translations-api";
import { withTenant } from "../tenancy/with-tenant";
import { releaseUsage, reserveUsage, settleUsage } from "../usage/usage-ledger";
import { estimateCharacters, translateFields } from "./translate-fields";

type Admin = Pick<AdminApiContext, "graphql">;

export class AiConsentRequiredError extends Error {
  constructor() {
    super("AI data processing consent is required");
    this.name = "AiConsentRequiredError";
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

function sourceLocaleOf(resource: TranslatableResourceData): string {
  return resource.content[0]?.locale ?? "en";
}

/**
 * Machine-translates selected fields of a resource. Nothing is written to
 * Shopify: results are drafts for the merchant to review and save.
 */
export async function aiTranslateResource(
  input: {
    admin: Admin;
    shopId: string;
    resourceId: string;
    targetLocale: string;
    keys: readonly string[];
    provider: TranslationProvider;
    monthlyLimit: number;
  },
  client: PrismaClient = defaultClient,
) {
  const settings = await getShopSettings(input.shopId, client);
  if (!hasCurrentAiConsent(settings)) throw new AiConsentRequiredError();

  const resource = await loadResource(input.admin, input.resourceId, input.targetLocale);
  const wanted = new Set(input.keys);
  const fields = resource.content.filter((f) => wanted.has(f.key));
  const titleField = resource.content.find((f) => f.key === "title");

  const reservation = await reserveUsage(
    {
      shopId: input.shopId,
      key: `ai:${randomUUID()}`,
      chars: estimateCharacters(fields),
      limit: input.monthlyLimit,
      provider: input.provider.id,
    },
    client,
  );

  try {
    const result = await translateFields({
      provider: input.provider,
      fields,
      sourceLocale: sourceLocaleOf(resource),
      targetLocale: input.targetLocale,
      context: titleField?.value ? `Product: ${titleField.value}` : undefined,
    });
    await settleUsage(reservation, result.billedCharacters, client);
    return {
      outcomes: result.outcomes,
      provider: result.provider,
      digests: Object.fromEntries(resource.content.map((f) => [f.key, f.digest])),
    };
  } catch (error) {
    await releaseUsage(reservation, client);
    throw error;
  }
}

export interface TranslationEdit {
  key: string;
  value: string;
  /** Digest of the source the merchant saw when editing. */
  digest: string;
  origin: "AI" | "MANUAL";
  provider?: string | null;
}

export type SaveOutcome =
  | { key: string; status: "saved" }
  | { key: string; status: "conflict" }
  | { key: string; status: "error"; message: string };

/**
 * Writes translations to Shopify. Each edit is checked against the current
 * source digest first; if the source changed since the merchant loaded it,
 * the edit is refused as a conflict instead of saving a translation of stale
 * text. Saved values are verified from the mutation response and recorded
 * as revisions.
 */
export async function saveResourceTranslations(
  input: {
    admin: Admin;
    shopId: string;
    actorId: string | null;
    resourceId: string;
    locale: string;
    edits: readonly TranslationEdit[];
  },
  client: PrismaClient = defaultClient,
): Promise<SaveOutcome[]> {
  const resource = await loadResource(input.admin, input.resourceId, input.locale);
  const current = new Map(resource.content.map((f) => [f.key, f]));
  const outcomes: SaveOutcome[] = [];
  const writable: TranslationEdit[] = [];

  for (const edit of input.edits) {
    const field = current.get(edit.key);
    if (!field || !field.digest) {
      outcomes.push({ key: edit.key, status: "error", message: "Unknown field" });
    } else if (field.digest !== edit.digest) {
      outcomes.push({ key: edit.key, status: "conflict" });
    } else if (!edit.value.trim()) {
      outcomes.push({ key: edit.key, status: "error", message: "Translation is empty" });
    } else {
      writable.push(edit);
    }
  }
  if (writable.length === 0) return outcomes;

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
      const message =
        result.userErrors.map((e) => e.message).join("; ") || "Shopify did not confirm the translation";
      outcomes.push({ key: edit.key, status: "error", message });
    }
  }
  if (result.userErrors.length) {
    logger.warn(
      { resourceId: input.resourceId, codes: result.userErrors.map((e) => e.code) },
      "translationsRegister returned user errors",
    );
  }

  if (saved.length) {
    await withTenant(
      input.shopId,
      (tx) =>
        tx.translationRevision.createMany({
          data: saved.map((e) => ({
            shopId: input.shopId,
            resourceGid: input.resourceId,
            key: e.key,
            locale: input.locale,
            value: e.value,
            sourceDigest: e.digest,
            origin: e.origin,
            provider: e.origin === "AI" ? (e.provider ?? null) : null,
          })),
        }),
      client,
    );
    await client.auditLog.create({
      data: {
        shopId: input.shopId,
        actorType: "MERCHANT_USER",
        actorId: input.actorId,
        action: "translations.saved",
        targetType: "TranslatableResource",
        targetId: input.resourceId,
        metadata: { locale: input.locale, keys: saved.map((e) => e.key) },
      },
    });
  }
  return outcomes;
}
