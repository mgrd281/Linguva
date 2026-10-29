/**
 * Server side of the resource list pages (products, collections): coverage
 * per language and the "translate all" bulk action.
 */
import { randomUUID } from "node:crypto";
import { redirect } from "react-router";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { requireShop } from "../shopify/require-shop";
import { AccessDeniedError, isAccessDenied, listTranslatableResources } from "../shopify/translations-api";
import { getTranslationProvider } from "../providers";
import { getQueues } from "../queue/client";
import { BackgroundJobsUnavailableError, startBulkJob } from "../jobs/start-job";
import { getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { summarizeCoverage } from "../../lib/coverage";
import { shopBilling } from "../billing/billing";
import { allowedTargetLocales } from "../billing/subscription";
import {
  CONTENT_TYPES,
  contentRef,
  isContentType,
  kindMeta,
  numericId,
  resourceTitle,
  type TranslatableKind,
} from "../../lib/resource-kinds";
import { ATTACHED_BULK_TYPES, isBulkResourceType } from "../jobs/bulk-jobs";

export async function loadResourceList(request: Request, kind: TranslatableKind) {
  const { admin, shop } = await requireShop(request);
  const meta = kindMeta(kind);
  const url = new URL(request.url);
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const targets = locales.locales.filter((l) => !l.primary);
  const caution = isContentType(kind) ? ((CONTENT_TYPES[kind] as { caution?: "legal" | "liquid" }).caution ?? null) : null;
  // English names as before; the page names the type by `type` in its language.
  const kindInfo = { type: kind, label: meta.label, singular: meta.singular, plural: meta.plural, path: meta.path, caution, bulk: isBulkResourceType(kind) };

  const requested = url.searchParams.get("lang");
  const target = targets.find((l) => l.locale === requested) ?? targets[0];
  if (!target) {
    return { kind: kindInfo, targets: [], target: null, items: [], nextCursor: null, isFirstPage: true, bulk: null, denied: null };
  }

  const after = url.searchParams.get("after");
  let page: Awaited<ReturnType<typeof listTranslatableResources>>;
  try {
    page = await listTranslatableResources(admin, { resourceType: kind, locale: target.locale, after, first: 25 });
  } catch (error) {
    if (!(error instanceof AccessDeniedError) && !isAccessDenied(error)) throw error;
    // An optional permission the merchant hasn't granted (yet).
    const scope = isContentType(kind) ? CONTENT_TYPES[kind].scope : null;
    return {
      kind: kindInfo,
      targets: targets.map((l) => ({ locale: l.locale, name: l.name })),
      target: { locale: target.locale, name: target.name },
      items: [],
      nextCursor: null,
      isFirstPage: true,
      bulk: null,
      denied: { scope },
    };
  }
  const { resources, pageInfo } = page;
  const settings = await getShopSettings(shop.id);
  const billing = await shopBilling(admin, shop);
  const allowed = allowedTargetLocales(billing.entitlements, targets.map((l) => l.locale));

  return {
    kind: kindInfo,
    targets: targets.map((l) => ({ locale: l.locale, name: l.name })),
    target: { locale: target.locale, name: target.name },
    items: resources.map((r) => ({
      // Content types (theme resources included) are addressed by an encoded GID.
      id: isContentType(kind) ? contentRef(r.resourceId) : numericId(r.resourceId),
      title: resourceTitle(kind, r.content),
      ...summarizeCoverage(r.content, r.translations),
    })),
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    isFirstPage: !after,
    bulk: {
      publishMode: settings.bulkPublishMode,
      // One key per page view: a double submit creates only one job.
      idempotencyKey: randomUUID(),
      available: getTranslationProvider() !== null && getQueues() !== null,
      consent: hasCurrentAiConsent(settings),
      planAllowsBulk: billing.entitlements.bulk,
      planAllowsLocale: allowed.includes(target.locale),
      // Image alt text and custom fields can be included for these types.
      attached: ATTACHED_BULK_TYPES.has(kind),
    },
    denied: null,
  };
}

export async function runResourceListAction(request: Request, kind: TranslatableKind) {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") !== "bulk-translate") return { error: "UNKNOWN_INTENT" };
  if (!isBulkResourceType(kind)) return { error: "BULK_NOT_SUPPORTED" };
  const billing = await shopBilling(admin, shop);
  if (!billing.entitlements.bulk) return { error: "PLAN_BULK" };

  // The target must be one of the shop's own additional languages.
  const locales = await fetchAndSyncShopLocales(admin, shop.id);
  const locale = String(form.get("locale") ?? "");
  if (!locales.locales.some((l) => !l.primary && l.locale === locale)) {
    return { error: "UNKNOWN_LOCALE" };
  }
  const targets = locales.locales.filter((l) => !l.primary).map((l) => l.locale);
  if (!allowedTargetLocales(billing.entitlements, targets).includes(locale)) return { error: "PLAN_LANGUAGE" };
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) return { error: "INVALID_REQUEST" };

  try {
    const { job } = await startBulkJob({
      shopId: shop.id,
      resourceType: kind,
      targetLocale: locale,
      requestedBy: actorId,
      idempotencyKey,
      overwriteProtected: form.get("overwriteProtected") === "on",
      fieldScope: form.get("fieldScope") === "SEO" ? "SEO" : "ALL",
      includeAttached: form.get("includeAttached") === "on",
    });
    return redirect(`/app/jobs/${job.id}`);
  } catch (error) {
    if (error instanceof BackgroundJobsUnavailableError) return { error: "JOBS_UNAVAILABLE" };
    throw error;
  }
}
