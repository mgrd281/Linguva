/**
 * Server side of the resource list pages (products, collections): coverage
 * per language and the "translate all" bulk action.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { redirect } from "react-router";
import { prisma as defaultClient } from "../lib/db";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { requireShop } from "../shopify/require-shop";
import { AccessDeniedError, isAccessDenied, listTranslatableResources } from "../shopify/translations-api";
import { shopTranslationFacts } from "../providers/shop-translation";
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
  const { admin, shop, scopes } = await requireShop(request);
  const url = new URL(request.url);
  return resourceListPage(admin, shop, kind, {
    lang: url.searchParams.get("lang"),
    after: url.searchParams.get("after"),
    granted: async () => (await scopes.query()).granted,
  });
}

export interface ResourceListInput {
  /** The URL's ?lang (the language to translate into) and ?after (where the previous page ended). */
  lang: string | null;
  after: string | null;
  /** The optional scopes the store granted; read only when Shopify refuses the list. */
  granted: () => Promise<readonly string[]>;
}

/**
 * One page of a type's list in a language: `?lang` when it is one of the
 * store's additional languages, else the first visible one (a hidden one
 * only when none is visible), with each item's coverage and what "Translate
 * all" may do. Refused by Shopify: the permission the merchant can grant,
 * or none when it is granted already and Shopify refuses anyway.
 */
export async function resourceListPage(
  admin: Pick<AdminApiContext, "graphql">,
  shop: { id: string; shopifyShopGid: string | null },
  kind: TranslatableKind,
  input: ResourceListInput,
  client: PrismaClient = defaultClient,
) {
  const meta = kindMeta(kind);
  const locales = await fetchAndSyncShopLocales(admin, shop.id, client);
  const targets = locales.locales.filter((l) => !l.primary);
  const caution = isContentType(kind) ? ((CONTENT_TYPES[kind] as { caution?: "legal" | "liquid" }).caution ?? null) : null;
  // English names as before; the page names the type by `type` in its language.
  const kindInfo = { type: kind, label: meta.label, singular: meta.singular, plural: meta.plural, path: meta.path, caution, bulk: isBulkResourceType(kind) };

  const target = targets.find((l) => l.locale === input.lang) ?? targets.find((l) => l.published) ?? targets[0];
  if (!target) {
    return { kind: kindInfo, targets: [], target: null, items: [], nextCursor: null, isFirstPage: true, bulk: null, denied: null };
  }
  const languages = targets.map((l) => ({ locale: l.locale, name: l.name, published: l.published }));

  const after = input.after;
  let page: Awaited<ReturnType<typeof listTranslatableResources>>;
  try {
    page = await listTranslatableResources(admin, { resourceType: kind, locale: target.locale, after, first: 25 });
  } catch (error) {
    if (!(error instanceof AccessDeniedError) && !isAccessDenied(error)) throw error;
    // An optional permission the merchant hasn't granted (yet); once granted, asking again can't help.
    const scope = isContentType(kind) ? CONTENT_TYPES[kind].scope : null;
    const grantable = scope !== null && !(await input.granted()).includes(scope);
    return {
      kind: kindInfo,
      targets: languages,
      target: { locale: target.locale, name: target.name },
      items: [],
      nextCursor: null,
      isFirstPage: true,
      bulk: null,
      denied: { scope: grantable ? scope : null },
    };
  }
  const { resources, pageInfo } = page;
  const settings = await getShopSettings(shop.id, client);
  const billing = await shopBilling(admin, shop);
  // Who translates for the shop (the operator's engines or its own keys), without decrypting.
  const facts = await shopTranslationFacts(shop.id, billing, { client });
  const allowed = allowedTargetLocales(billing.entitlements, targets.map((l) => l.locale));

  return {
    kind: kindInfo,
    targets: languages,
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
      available: facts.available && getQueues() !== null,
      consent: hasCurrentAiConsent(settings, facts.configured, facts.payer),
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
