/**
 * Server side of the translation editor, shared by every resource type
 * (products, collections). Routes only authenticate and pick the kind.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { data } from "react-router";
import { aiUsageLimits, getConfig } from "../lib/config";
import { sanitizeHtml } from "../lib/sanitize-html";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { getTranslationProvider } from "../providers";
import { TranslationProviderError } from "../providers/types";
import { getShopSettings, hasCurrentAiConsent, setAiConsent } from "../settings/shop-settings";
import { requireShop } from "../shopify/require-shop";
import { getTranslatableResource } from "../shopify/translations-api";
import { fuzzyMatches } from "../memory/translation-memory";
import { resolveGlossary } from "../glossary/glossary";
import { getDailyUsage, getMonthlyUsage, QuotaExceededError } from "../usage/usage-ledger";
import { getRequestLimiter, RequestRateLimitedError } from "../usage/request-limits";
import { aiLimitsFor, shopBilling } from "../billing/billing";
import { allowedTargetLocales, type BillingStatus } from "../billing/subscription";
import { fieldLabel } from "../../lib/field-labels";
import {
  CONTENT_TYPES,
  contentGid,
  isContentType,
  kindMeta,
  resourceGid,
  resourceTitle,
  type TranslatableKind,
} from "../../lib/resource-kinds";
import {
  AiConsentRequiredError,
  AiRequestTooLargeError,
  aiTranslateResource,
  ResourceNotFoundError,
  saveResourceTranslations,
  sourceLocaleOf,
} from "./product-translation-service";
import { collectEditorEdits } from "./editor-edits";
import { isMachineTranslatable, segmentField } from "./translate-fields";
import { listRevisions } from "./revisions";
import { removeTranslation, restoreRevision } from "./history";
import { HANDLE_PROBLEM_MESSAGES, validateHandle } from "../../lib/handles";
import type { TranslationEdit } from "./product-translation-service";
import type { TranslatableResourceData } from "../shopify/translations-api";
import {
  attachedAiTargets,
  attachedRef,
  collectAttachedEdits,
  listEditorAttachments,
  loadAttachedData,
} from "./attached-editor";

type Admin = Pick<AdminApiContext, "graphql">;

export interface EditorContext {
  admin: Admin;
  shopId: string;
  /** For previews only. */
  shopDomain?: string;
  actorId: string | null;
  kind: TranslatableKind;
  resourceId: string;
  /** Search and page within resources with many texts (theme content). */
  view?: { query: string; page: number };
  target: { locale: string; name: string; rtl: boolean };
  sourceName: string | null;
  /** Billing status (absent: billing not checked, as in tests). */
  billing?: BillingStatus;
  /** The shop's additional languages in Shopify's order (for plan limits). */
  targetLocales?: string[];
}

/** Authenticates the request and resolves the resource and target language. */
export async function resolveEditorContext(
  request: Request,
  kind: TranslatableKind,
  id: string | undefined,
): Promise<EditorContext> {
  const { admin, shop, actorId } = await requireShop(request);
  const billing = await shopBilling(admin, shop);
  // Content types are addressed by an encoded GID, validated here; Shopify
  // only returns resources of the authenticated shop.
  const resourceId = isContentType(kind) ? contentGid(id ?? "") : resourceGid(kind, id ?? "");
  if (!resourceId) throw new Response("Not found", { status: 404 });

  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const url = new URL(request.url);
  const requested = url.searchParams.get("lang");
  const target = locales.locales.find((l) => !l.primary && l.locale === requested);
  if (!target) throw new Response("Unknown language", { status: 404 });

  return {
    admin,
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    actorId,
    kind,
    resourceId,
    target: { locale: target.locale, name: target.name, rtl: target.rtl },
    sourceName: locales.primary?.name ?? null,
    billing,
    targetLocales: locales.locales.filter((l) => !l.primary).map((l) => l.locale),
    view: {
      query: (url.searchParams.get("q") ?? "").slice(0, 100),
      page: Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1)),
    },
  };
}

/** Resources with more texts than this are searched and paged in the editor. */
export const EDITOR_PAGE_SIZE = 50;
const PAGING_THRESHOLD = 60;

/** Plan limits for this editor request (config limits when billing isn't checked). */
function editorLimits(ctx: EditorContext) {
  const config = getConfig();
  return ctx.billing ? aiLimitsFor(config, ctx.billing) : aiUsageLimits(config);
}

export async function loadEditorData(ctx: EditorContext) {
  const { admin, shopId, resourceId, target } = ctx;
  const resource = await getTranslatableResource(admin, resourceId, target.locale);
  if (!resource) throw new Response("Not found", { status: 404 });

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

  const meta = kindMeta(ctx.kind);
  const attached = await loadAttachedData(admin, ctx.kind, resourceId, target.locale);
  const allFields = resource.content
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
    }));
  // Theme content can have thousands of texts: search and page them.
  let fields = allFields;
  let paging: { total: number; matching: number; page: number; pages: number; query: string; pageSize: number } | null = null;
  if (allFields.length > PAGING_THRESHOLD) {
    const query = ctx.view?.query.trim().toLowerCase() ?? "";
    const matching = query
      ? allFields.filter((f) => [f.key, f.label, f.source, f.translation].some((v) => v.toLowerCase().includes(query)))
      : allFields;
    const pages = Math.max(1, Math.ceil(matching.length / EDITOR_PAGE_SIZE));
    const page = Math.min(ctx.view?.page ?? 1, pages);
    fields = matching.slice((page - 1) * EDITOR_PAGE_SIZE, page * EDITOR_PAGE_SIZE);
    paging = { total: allFields.length, matching: matching.length, page, pages, query: ctx.view?.query ?? "", pageSize: EDITOR_PAGE_SIZE };
  }
  const caution = isContentType(ctx.kind) ? ((CONTENT_TYPES[ctx.kind] as { caution?: "legal" | "liquid" }).caution ?? null) : null;
  return {
    attached,
    // English names stay for the URL path; the page names the type by `type` in its language.
    kind: { type: ctx.kind, label: meta.label, singular: meta.singular, path: meta.path, plural: meta.plural },
    shopDomain: ctx.shopDomain ?? "",
    title: resourceTitle(ctx.kind, resource.content),
    target,
    sourceName: ctx.sourceName ?? resource.content[0]?.locale ?? "",
    sourceLocale: sourceLocaleOf(resource),
    // HTML is shown rendered: sanitised here, and in a sandboxed frame in the page.
    fields: fields.map((f) => ({ ...f, sourcePreview: f.type === "HTML" ? sanitizeHtml(f.source) : null })),
    paging,
    caution,
    // The search result preview applies to storefront pages only.
    seoPreview: !isContentType(ctx.kind),
    ai: {
      available: getTranslationProvider() !== null,
      consent: hasCurrentAiConsent(settings),
      used: await getMonthlyUsage(shopId),
      limit: editorLimits(ctx).limit,
      usedToday: await getDailyUsage(shopId),
      dailyLimit: editorLimits(ctx).dailyLimit,
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
  | {
      kind: "attached-ai";
      /** Keyed by attachedRef(resourceId, key). */
      drafts: Record<string, string>;
      rejected: Record<string, string>;
      warnings: Record<string, string[]>;
      provider: string;
      /** Set when translation stopped early (drafts so far are kept). */
      stopped?: string;
    }
  | { kind: "attached-saved"; outcomes: Array<{ ref: string; status: string; message?: string; code?: string }> }
  | { kind: "restored"; status: string }
  | { kind: "removed"; key: string; status: string }
  | { kind: "saved"; outcomes: Array<{ key: string; status: string; message?: string; code?: string }> }
  | { kind: "consent" }
  | { kind: "error"; code: string; retryAfterSeconds?: number };

function rateLimited(error: RequestRateLimitedError) {
  return {
    kind: "error",
    code: error.scope === "user" ? "RATE_LIMITED_USER" : "RATE_LIMITED_SHOP",
    retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
  } satisfies EditorActionResult;
}

/** Error code for a failed AI translation, or undefined if the error is unexpected. */
function aiErrorCode(error: unknown): string | undefined {
  if (error instanceof AiConsentRequiredError) return "CONSENT_REQUIRED";
  if (error instanceof AiRequestTooLargeError) return "REQUEST_TOO_LARGE";
  if (error instanceof QuotaExceededError) {
    return { monthly: "QUOTA_EXCEEDED", daily: "DAILY_LIMIT", platform: "PLATFORM_LIMIT" }[error.scope];
  }
  if (error instanceof TranslationProviderError) return `PROVIDER_${error.kind.toUpperCase()}`;
  return undefined;
}

function planAllowsTarget(ctx: EditorContext) {
  return !(ctx.billing && ctx.targetLocales && !allowedTargetLocales(ctx.billing.entitlements, ctx.targetLocales).includes(ctx.target.locale));
}

/**
 * URL handles are never changed by accident: a handle must be well-formed,
 * and changing a translated handle that is already published needs the
 * merchant's explicit confirmation (old language URLs don't redirect).
 */
export function checkHandleEdits(resource: TranslatableResourceData, edits: TranslationEdit[], form: Pick<FormData, "get">) {
  const current = resource.translations.find((t) => t.key === "handle")?.value ?? "";
  // `code` names the problem for the page (editor.handle.problem.*); `message` is the English text.
  const refused: Array<{ key: string; status: "error"; message: string; code: string }> = [];
  const kept = edits.filter((edit) => {
    if (edit.key !== "handle") return true;
    const problem = validateHandle(edit.value);
    if (problem) {
      refused.push({ key: "handle", status: "error", message: HANDLE_PROBLEM_MESSAGES[problem], code: problem });
      return false;
    }
    if (current && current !== edit.value && form.get("confirm-handle") !== "on") {
      refused.push({
        key: "handle",
        status: "error",
        message: "Confirm the URL change below: links to the old address in this language will stop working.",
        code: "CONFIRM",
      });
      return false;
    }
    return true;
  });
  return { edits: kept, refused };
}

export async function runEditorAction(ctx: EditorContext, form: FormData) {
  const { admin, shopId, actorId, resourceId, target } = ctx;
  const intent = form.get("intent");

  if (intent === "grant-consent") {
    await setAiConsent({ shopId, granted: true, actorId });
    return { kind: "consent" } satisfies EditorActionResult;
  }

  if (intent === "ai-translate") {
    if (!planAllowsTarget(ctx)) return { kind: "error", code: "PLAN_LANGUAGE" } satisfies EditorActionResult;
    const provider = getTranslationProvider();
    if (!provider) return { kind: "error", code: "AI_NOT_CONFIGURED" } satisfies EditorActionResult;
    const keys = form.getAll("key").map(String).slice(0, 100);
    try {
      await getRequestLimiter().consume(shopId, actorId, "ai-translate");
      const config = getConfig();
      const limits = editorLimits(ctx);
      const result = await aiTranslateResource({
        admin,
        shopId,
        resourceId,
        resourceType: ctx.kind,
        targetLocale: target.locale,
        keys,
        provider,
        monthlyLimit: limits.limit,
        dailyLimit: limits.dailyLimit,
        platformDailyLimit: limits.platformDailyLimit,
        maxRequestChars: config.AI_MAX_CHARS_PER_REQUEST,
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
      if (error instanceof RequestRateLimitedError) return rateLimited(error);
      if (error instanceof ResourceNotFoundError) throw new Response("Not found", { status: 404 });
      const code = aiErrorCode(error);
      if (code) return { kind: "error", code } satisfies EditorActionResult;
      throw error;
    }
  }

  if (intent === "ai-translate-attached") {
    // Which images and metafields to translate is decided here, from
    // Shopify's list for this parent: the form carries no resource ids.
    if (!planAllowsTarget(ctx)) return { kind: "error", code: "PLAN_LANGUAGE" } satisfies EditorActionResult;
    const provider = getTranslationProvider();
    if (!provider) return { kind: "error", code: "AI_NOT_CONFIGURED" } satisfies EditorActionResult;
    try {
      await getRequestLimiter().consume(shopId, actorId, "ai-translate");
    } catch (error) {
      if (error instanceof RequestRateLimitedError) return rateLimited(error);
      throw error;
    }
    const resources = await listEditorAttachments(admin, ctx.kind, resourceId, target.locale);
    const config = getConfig();
    const limits = editorLimits(ctx);
    const drafts: Record<string, string> = {};
    const rejected: Record<string, string> = {};
    const warnings: Record<string, string[]> = {};
    let stopped: string | undefined;
    for (const item of attachedAiTargets(resources)) {
      try {
        const result = await aiTranslateResource({
          admin,
          shopId,
          resourceId: item.resourceId,
          targetLocale: target.locale,
          keys: item.keys,
          provider,
          monthlyLimit: limits.limit,
          dailyLimit: limits.dailyLimit,
          platformDailyLimit: limits.platformDailyLimit,
          maxRequestChars: config.AI_MAX_CHARS_PER_REQUEST,
        });
        for (const o of result.outcomes) {
          const ref = attachedRef(item.resourceId, o.key);
          if (o.status === "translated") {
            drafts[ref] = o.value;
            if (o.issues.length) warnings[ref] = o.issues.map((i) => i.code);
          } else if (o.status === "rejected") {
            rejected[ref] = o.reason;
          }
        }
      } catch (error) {
        if (error instanceof ResourceNotFoundError) continue;
        stopped = aiErrorCode(error);
        if (!stopped) throw error;
        break;
      }
    }
    return {
      kind: "attached-ai",
      drafts,
      rejected,
      warnings,
      provider: provider.id,
      ...(stopped ? { stopped } : {}),
    } satisfies EditorActionResult;
  }

  if (intent === "save-attached") {
    const resources = await listEditorAttachments(admin, ctx.kind, resourceId, target.locale);
    const outcomes: Array<{ ref: string; status: string; message?: string; code?: string }> = [];
    for (const { resource, edits, rejected } of collectAttachedEdits(resources, form)) {
      for (const key of rejected) {
        outcomes.push({
          ref: attachedRef(resource.resourceId, key),
          status: "error",
          message: "This rich text no longer matches the original's formatting. Translate it again with AI.",
          code: "RICH_TEXT_CHANGED",
        });
      }
      if (!edits.length) continue;
      const saved = await saveResourceTranslations({
        admin,
        shopId,
        actorId,
        resourceId: resource.resourceId,
        locale: target.locale,
        edits,
      });
      for (const o of saved) {
        outcomes.push({ ref: attachedRef(resource.resourceId, o.key), status: o.status, ...("message" in o ? { message: o.message } : {}) });
      }
    }
    return data({ kind: "attached-saved", outcomes } satisfies EditorActionResult);
  }

  if (intent === "memory-suggest") {
    // Fuzzy matches are suggestions: they fill the form, never publish.
    try {
      await getRequestLimiter().consume(shopId, actorId, "memory-suggest");
    } catch (error) {
      if (error instanceof RequestRateLimitedError) return rateLimited(error);
      throw error;
    }
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
    const { edits, refused } = checkHandleEdits(resource, collectEditorEdits(resource, form), form);
    const outcomes = edits.length
      ? await saveResourceTranslations({
          admin,
          shopId,
          actorId,
          resourceId,
          locale: target.locale,
          edits,
        })
      : [];
    return data({ kind: "saved", outcomes: [...refused, ...outcomes] } satisfies EditorActionResult);
  }

  if (intent === "remove") {
    const key = String(form.get("key") ?? "");
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) return data({ kind: "error", code: "INVALID_REQUEST" } satisfies EditorActionResult, { status: 400 });
    const result = await removeTranslation({ admin, shopId, actorId, resourceGid: resourceId, locale: target.locale, key });
    return { kind: "removed", key, status: result.status } satisfies EditorActionResult;
  }

  return data({ kind: "error", code: "UNKNOWN_INTENT" } satisfies EditorActionResult, { status: 400 });
}
