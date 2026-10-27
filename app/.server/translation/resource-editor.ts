/**
 * Server side of the translation editor, shared by every resource type
 * (products, collections). Routes only authenticate and pick the kind.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { data } from "react-router";
import { getConfig } from "../lib/config";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { getTranslationProvider } from "../providers";
import { TranslationProviderError } from "../providers/types";
import { getShopSettings, hasCurrentAiConsent, setAiConsent } from "../settings/shop-settings";
import { requireShop } from "../shopify/require-shop";
import { getTranslatableResource } from "../shopify/translations-api";
import { fuzzyMatches } from "../memory/translation-memory";
import { resolveGlossary } from "../glossary/glossary";
import { getMonthlyUsage, QuotaExceededError } from "../usage/usage-ledger";
import { fieldLabel } from "../../lib/field-labels";
import { RESOURCE_KINDS, resourceGid, type ResourceKind } from "../../lib/resource-kinds";
import {
  AiConsentRequiredError,
  aiTranslateResource,
  ResourceNotFoundError,
  saveResourceTranslations,
  sourceLocaleOf,
} from "./product-translation-service";
import { collectEditorEdits } from "./editor-edits";
import { isMachineTranslatable, segmentField } from "./translate-fields";
import { listRevisions } from "./revisions";
import { restoreRevision } from "./history";

type Admin = Pick<AdminApiContext, "graphql">;

export interface EditorContext {
  admin: Admin;
  shopId: string;
  actorId: string | null;
  kind: ResourceKind;
  resourceId: string;
  target: { locale: string; name: string; rtl: boolean };
  sourceName: string | null;
}

/** Authenticates the request and resolves the resource and target language. */
export async function resolveEditorContext(
  request: Request,
  kind: ResourceKind,
  id: string | undefined,
): Promise<EditorContext> {
  const { admin, shop, actorId } = await requireShop(request);
  const resourceId = resourceGid(kind, id ?? "");
  if (!resourceId) throw new Response("Not found", { status: 404 });

  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const requested = new URL(request.url).searchParams.get("locale");
  const target = locales.locales.find((l) => !l.primary && l.locale === requested);
  if (!target) throw new Response("Unknown language", { status: 404 });

  return {
    admin,
    shopId: shop.id,
    actorId,
    kind,
    resourceId,
    target: { locale: target.locale, name: target.name, rtl: target.rtl },
    sourceName: locales.primary?.name ?? null,
  };
}

export async function loadEditorData(ctx: EditorContext) {
  const { admin, shopId, resourceId, target } = ctx;
  const resource = await getTranslatableResource(admin, resourceId, target.locale);
  if (!resource) throw new Response("Not found", { status: 404 });

  const config = getConfig();
  const settings = await getShopSettings(shopId);
  const translations = new Map(resource.translations.map((t) => [t.key, t]));
  const digests = new Map(resource.content.map((c) => [c.key, c.digest]));
  const revisions = await listRevisions(shopId, resourceId, target.locale);
  const history: Record<
    string,
    Array<{ id: string; value: string; origin: string; approved: boolean; createdAt: string; restorable: boolean }>
  > = {};
  for (const r of revisions) {
    const list = (history[r.key] ??= []);
    if (list.length >= 10) continue;
    list.push({
      id: r.id,
      value: r.value,
      origin: r.origin,
      approved: r.approved,
      createdAt: r.createdAt.toISOString(),
      // Shopify only accepts translations of the current source text.
      restorable: r.sourceDigest === digests.get(r.key) && r.value !== (translations.get(r.key)?.value ?? ""),
    });
  }

  const meta = RESOURCE_KINDS[ctx.kind];
  return {
    kind: { label: meta.label, singular: meta.singular, path: meta.path },
    title: resource.content.find((c) => c.key === "title")?.value ?? "(untitled)",
    target,
    sourceName: ctx.sourceName ?? resource.content[0]?.locale ?? "",
    fields: resource.content
      .filter((c) => c.value && c.value.trim() && c.digest)
      .map((c) => ({
        key: c.key,
        label: fieldLabel(c.key),
        type: c.type,
        source: c.value!,
        digest: c.digest!,
        translation: translations.get(c.key)?.value ?? "",
        outdated: translations.get(c.key)?.outdated ?? false,
        machine: isMachineTranslatable({ key: c.key, value: c.value, type: c.type }),
        history: history[c.key] ?? [],
      })),
    ai: {
      available: getTranslationProvider() !== null,
      consent: hasCurrentAiConsent(settings),
      used: await getMonthlyUsage(shopId),
      limit: config.AI_MONTHLY_CHAR_LIMIT,
    },
  };
}

export type EditorActionResult =
  | {
      kind: "ai";
      drafts: Record<string, string>;
      rejected: Record<string, string>;
      warnings: Record<string, string[]>;
      provider: string;
      memoryHits?: number;
      scores?: Record<string, number>;
    }
  | { kind: "restored"; status: string }
  | { kind: "saved"; outcomes: Array<{ key: string; status: string; message?: string }> }
  | { kind: "consent" }
  | { kind: "error"; code: string };

export async function runEditorAction(ctx: EditorContext, form: FormData) {
  const { admin, shopId, actorId, resourceId, target } = ctx;
  const intent = form.get("intent");

  if (intent === "grant-consent") {
    await setAiConsent({ shopId, granted: true, actorId });
    return { kind: "consent" } satisfies EditorActionResult;
  }

  if (intent === "ai-translate") {
    const provider = getTranslationProvider();
    if (!provider) return { kind: "error", code: "AI_NOT_CONFIGURED" } satisfies EditorActionResult;
    const keys = form.getAll("key").map(String);
    try {
      const result = await aiTranslateResource({
        admin,
        shopId,
        resourceId,
        targetLocale: target.locale,
        keys,
        provider,
        monthlyLimit: getConfig().AI_MONTHLY_CHAR_LIMIT,
      });
      const drafts: Record<string, string> = {};
      const rejected: Record<string, string> = {};
      const warnings: Record<string, string[]> = {};
      for (const o of result.outcomes) {
        if (o.status === "translated") {
          drafts[o.key] = o.value;
          if (o.issues.length) warnings[o.key] = o.issues.map((i) => i.code);
        } else if (o.status === "rejected") {
          rejected[o.key] = o.reason;
        }
      }
      return {
        kind: "ai",
        drafts,
        rejected,
        warnings,
        provider: result.provider,
        memoryHits: result.memoryHits,
      } satisfies EditorActionResult;
    } catch (error) {
      if (error instanceof AiConsentRequiredError) {
        return { kind: "error", code: "CONSENT_REQUIRED" } satisfies EditorActionResult;
      }
      if (error instanceof QuotaExceededError) return { kind: "error", code: "QUOTA_EXCEEDED" } satisfies EditorActionResult;
      if (error instanceof ResourceNotFoundError) throw new Response("Not found", { status: 404 });
      if (error instanceof TranslationProviderError) {
        return { kind: "error", code: `PROVIDER_${error.kind.toUpperCase()}` } satisfies EditorActionResult;
      }
      throw error;
    }
  }

  if (intent === "memory-suggest") {
    // Fuzzy matches are suggestions: they fill the form, never publish.
    const resource = await getTranslatableResource(admin, resourceId, target.locale);
    if (!resource) throw new Response("Not found", { status: 404 });
    const glossary = await resolveGlossary(shopId, target.locale);
    const drafts: Record<string, string> = {};
    const scores: Record<string, number> = {};
    for (const field of resource.content) {
      if (!field.value || !isMachineTranslatable(field)) continue;
      const doc = segmentField(field, glossary.protect);
      if (doc.segments.length !== 1) continue;
      const [best] = await fuzzyMatches(
        { shopId, sourceLocale: sourceLocaleOf(resource), targetLocale: target.locale },
        doc.segments[0]!.source,
        { threshold: 0.6, limit: 1 },
      );
      if (!best) continue;
      try {
        drafts[field.key] = doc.render(new Map([[doc.segments[0]!.id, best.targetText]]));
        scores[field.key] = Math.round(best.score * 100);
      } catch {
        // The suggestion's formatting doesn't fit this source; skip it.
      }
    }
    const none: Record<string, never> = {};
    return { kind: "ai", drafts, rejected: none, warnings: none, provider: "memory", scores } satisfies EditorActionResult;
  }

  if (intent === "restore") {
    const result = await restoreRevision({
      admin,
      shopId,
      actorId,
      revisionId: String(form.get("revisionId") ?? ""),
      // A revision of another resource can't be restored from this page.
      resourceGid: resourceId,
    });
    return { kind: "restored", status: result.status } satisfies EditorActionResult;
  }

  if (intent === "save") {
    const resource = await getTranslatableResource(admin, resourceId, target.locale);
    if (!resource) throw new Response("Not found", { status: 404 });
    const edits = collectEditorEdits(resource, form);
    const outcomes = await saveResourceTranslations({
      admin,
      shopId,
      actorId,
      resourceId,
      locale: target.locale,
      edits,
    });
    return data({ kind: "saved", outcomes } satisfies EditorActionResult);
  }

  return data({ kind: "error", code: "UNKNOWN_INTENT" } satisfies EditorActionResult, { status: 400 });
}
