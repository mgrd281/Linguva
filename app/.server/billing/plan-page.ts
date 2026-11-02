/**
 * The Plan page's data: the billing state, the enforced AI limits, the
 * store's languages with the ones its plan covers, and what the store
 * really uses (for "Fits your store"). Read-only: nothing here creates,
 * changes or cancels a subscription or a charge; the plan buttons are links
 * to Shopify's plan page. Every read is the shop's own (tenant-scoped).
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { AUTO_REQUESTED_BY } from "../jobs/bulk-jobs";
import { costRates, getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { fetchAndSyncShopLocales } from "../locales/shop-locales";
import { shopTranslationFacts } from "../providers/shop-translation";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage, getMonthlyUsageByProvider, getOwnKeyUsage, nextPeriodStart, periodKey } from "../usage/usage-ledger";
import { effectiveRatePerMillion, isOwnKeyHandle, OWN_KEY_PRICE, planSelectionUrl } from "../../lib/plans";
import type { OwnKeyPlanView, PlanOwnKeys, ShopUse } from "../../lib/plan-view";
import { SMART_REQUESTED_BY } from "../../lib/smart-auto";
import { aiLimitsFor } from "./billing";
import { allowedTargetLocales, type BillingStatus } from "./subscription";
import { settleAll } from "../lib/settle";

/**
 * The month's provider rate for a complimentary store: exactly DeepL's rate while only DeepL
 * translated (as before engines could be combined), else the blend of the engines' rates.
 */
async function complimentaryRate(shopId: string, period: string, config: AppConfig, client: PrismaClient): Promise<number> {
  return effectiveRatePerMillion(await getMonthlyUsageByProvider(shopId, period, client), costRates(config));
}

/** The refresh button asks Shopify again, but reuses a check that succeeded this recently (a double click asks once). */
export const REFRESH_MIN_INTERVAL_MS = 30_000;

/** A store's own bulk jobs this recent count as using bulk translation. */
const BULK_USE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The plan features the store switched on, and whether it translated whole areas recently (its own jobs, not the smart schedule's). */
export async function shopUseFlags(shopId: string, now: Date, client: PrismaClient = defaultClient): Promise<Omit<ShopUse, "languages" | "monthChars">> {
  return withTenant(
    shopId,
    async (tx) => {
      const settings = await tx.shopSettings.findUnique({ where: { shopId }, select: { autoTranslateNew: true, bulkPublishMode: true } });
      const smart = await tx.smartAutoConfig.findUnique({ where: { shopId }, select: { enabled: true } });
      const job = await tx.translationJob.findFirst({
        where: {
          shopId,
          smartRunId: null,
          // Started by the merchant (signed in or not), not by automatic translation of new content or
          // the smart schedule's real-time mode: those run jobs of their own too (isAutomaticJob).
          OR: [{ requestedBy: null }, { requestedBy: { notIn: [AUTO_REQUESTED_BY, SMART_REQUESTED_BY] } }],
          createdAt: { gte: new Date(now.getTime() - BULK_USE_WINDOW_MS) },
        },
        select: { id: true },
      });
      return {
        bulk: job !== null,
        auto: settings?.autoTranslateNew ?? false,
        autoPublish: settings?.bulkPublishMode === "AUTO_PUBLISH",
        smart: smart?.enabled ?? false,
      };
    },
    client,
  );
}

export interface PlanPageInput {
  admin: Pick<AdminApiContext, "graphql">;
  shop: { id: string; shopDomain: string };
  /** The shop's billing status (shopBilling), started by the caller so every read runs in parallel. */
  billing: Promise<BillingStatus>;
  /** Back from Shopify's plan page (the welcome link): the success banner. */
  welcome: boolean;
  now?: Date;
}

export async function loadPlanPage(input: PlanPageInput, client: PrismaClient = defaultClient) {
  const now = input.now ?? new Date();
  // Every read settles before the page answers or fails: none keeps running
  // against the database after the request is gone.
  const [billing, fetched, month, today, flags] = await settleAll([
    input.billing,
    // The page renders without them: "couldn't load your languages", no recommendation.
    fetchAndSyncShopLocales(input.admin, input.shop.id, client).then(
      (summary) => ({ summary, reauth: null }),
      (error: unknown) => ({ summary: null, reauth: error instanceof Response ? error : null }),
    ),
    getMonthlyUsage(input.shop.id, periodKey(now), client),
    getDailyUsage(input.shop.id, client),
    shopUseFlags(input.shop.id, now, client),
  ]);
  // Shopify's re-authentication answer is passed on, once the other reads have finished.
  if (fetched.reauth) throw fetched.reauth;
  const locales = fetched.summary;
  const config = getConfig();
  const appHandle = config.SHOPIFY_APP_HANDLE;
  // The operator's engines, or the shop's own keys on the Own key plan (no decryption).
  const facts = await shopTranslationFacts(input.shop.id, billing, { client, config });
  const aiAvailable = facts.available;
  const sub = billing.subscription;
  const choosePlanUrl = billing.configured && appHandle ? planSelectionUrl(input.shop.shopDomain, appHandle) : null;
  // The Own key plan: shown by the flag, and always to its subscriber or a store changing to it.
  const ownKeyCurrent = billing.state === "ACTIVE" && isOwnKeyHandle(sub?.planHandle);
  const ownKeyPending = isOwnKeyHandle(sub?.pendingPlanHandle);
  const ownKeyPlan: OwnKeyPlanView = {
    visible: config.OWN_KEY_PLAN_VISIBLE === "on" || ownKeyCurrent || ownKeyPending,
    current: ownKeyCurrent,
    pending: ownKeyPending,
    choosePlanUrl,
    price: OWN_KEY_PRICE,
  };
  // Its keys (summaries only) and what went through them this month, for the subscriber's hero.
  const ownKeys: PlanOwnKeys | null = ownKeyCurrent && facts.keys ? { keys: facts.keys, usage: await getOwnKeyUsage(input.shop.id, periodKey(now), client) } : null;
  const targets = locales ? locales.locales.filter((l) => !l.primary) : null;
  // The same function enforcement uses: the page can't disagree with what the editor and jobs allow.
  const allowed = targets ? allowedTargetLocales(billing.entitlements, targets.map((l) => l.locale)) : [];
  // The allowance actually enforced (billing off: the server's limit; a trial: the trial's).
  const limits = aiLimitsFor(config, billing);
  return {
    configured: billing.configured,
    state: billing.state,
    stale: billing.stale,
    welcome: input.welcome,
    entitlements: billing.entitlements,
    subscription: sub
      ? {
          planHandle: sub.planHandle,
          pendingPlanHandle: sub.pendingPlanHandle,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          cancelAtEndOfCycle: sub.cancelAtEndOfCycle,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          checkedAt: sub.checkedAt.toISOString(),
        }
      : null,
    choosePlanUrl,
    usage: { month, today },
    // Not the platform cap: that is the operator's figure for all stores together.
    limits: { limit: limits.limit, dailyLimit: limits.dailyLimit },
    // The internal provider cost is for the owner's own stores only; no other shop receives it.
    // Several engines in the month: the blend of their rates (one engine: exactly its rate).
    costPerMillion: billing.state === "COMPLIMENTARY" ? await complimentaryRate(input.shop.id, periodKey(now), config, client) : null,
    now: now.toISOString(),
    // The allowance renews with the UTC month, not with Shopify's billing cycle.
    resetsOn: nextPeriodStart(now).toISOString(),
    aiAvailable,
    languages:
      locales && targets
        ? {
            primary: locales.primary?.locale ?? null,
            primaryName: locales.primary?.name ?? null,
            shopifyRoom: locales.remainingEnabled,
            items: targets.map((l) => ({ locale: l.locale, name: l.name, published: l.published, inPlan: allowed.includes(l.locale) })),
          }
        : null,
    // What the store uses, for "Fits your store" (nothing to recommend without its languages or without AI,
    // nor to an Own key subscriber: its fit depends on its own engine account, which this can't show).
    use: targets && aiAvailable && !ownKeyCurrent ? ({ languages: targets.length, monthChars: month, ...flags } satisfies ShopUse) : null,
    ownKeyPlan,
    ownKeys,
  };
}

export type PlanPageData = Awaited<ReturnType<typeof loadPlanPage>>;
