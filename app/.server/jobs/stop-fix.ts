/**
 * Whether a stopped job's cause is fixed by now (the stop causes of the Jobs
 * pages, app/lib/job-view.ts stopGroup): cheap checks only, from the data a
 * page already has (billing from the parent loader) and at most a few small
 * database reads; never a Shopify call. A check that says "fixed" turns the
 * job's look into "can go on" and shows the way back on a fix target; it never
 * decides anything: resuming stays the authority (an unfixed cause stops the
 * job again with the same code).
 *
 * The context loads what a check needs lazily and at most once per request,
 * so the list page's few stops share one read of settings, usage and keys.
 */
import type { PrismaClient, ShopSettings, SmartAutoConfig, TranslationJob } from "@prisma/client";
import { aiLimitsFor } from "../billing/billing";
import { listEngineKeys } from "../credentials/store";
import { getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { consentGap } from "../providers";
import { consentForShop, openShopTranslation } from "../providers/shop-translation";
import type { ConsentPayer } from "../settings/ai-consent";
import { consentedEngines, getShopSettings, hasCurrentAiConsent } from "../settings/shop-settings";
import { getSmartConfig } from "../smart/config";
import { withTenant } from "../tenancy/with-tenant";
import { getDailyUsage, getMonthlyUsage, getOriginUsageSince, nextPeriodStart, periodKey } from "../usage/usage-ledger";
import type { ConsentToken } from "../../lib/engines";
import type { StopGroup } from "../../lib/job-view";
import { parseOwnKeyCode, usableOwnKey, type OwnKeySummary } from "../../lib/own-keys";
import { usesOwnKeys, type Entitlements } from "../../lib/plans";
import { budgetWindows } from "../../lib/smart-auto";

/** What a check reads of the stopped job. */
export type StopFixJob = Pick<TranslationJob, "id" | "errorCode" | "targetLocale" | "finishedAt" | "updatedAt">;

/** The shop's billing as the page has it (requireShop's parent loader: shopBilling). */
export interface StopFixBilling {
  configured: boolean;
  entitlements: Entitlements;
}

export interface StopFixShop {
  shopId: string;
  billing: StopFixBilling;
  now?: Date;
  client?: PrismaClient;
  config?: AppConfig;
}

/** One stopped job and the shop's data, each read on first use and shared by every job of the same context. */
export interface StopFixContext {
  shopId: string;
  job: StopFixJob;
  now: Date;
  billing: StopFixBilling;
  config: AppConfig;
  settings: () => Promise<ShopSettings>;
  /** Linguva's characters today (UTC day) and this month (the allowance). */
  dailyUsage: () => Promise<number>;
  monthlyUsage: () => Promise<number>;
  /** The services consent is about and who pays them (the operator's engines, or the shop's keys). */
  consent: () => Promise<{ configured: ConsentToken[]; payer: ConsentPayer }>;
  /** Whether an engine the shop allowed serves the language (no consent: false). */
  allowedEngineServes: (locale: string) => Promise<boolean>;
  ownKeys: () => Promise<OwnKeySummary[]>;
  smartConfig: () => Promise<SmartAutoConfig | null>;
  /** The smart schedule's characters since a time (its budgets). */
  smartUsageSince: (since: Date) => Promise<number>;
  /** The store's primary language as last read from Shopify (the locale mirror); null when unknown. */
  primaryLocale: () => Promise<string | null>;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

/** The context factory for one shop and request: one context per stopped job, with shared reads. */
export function stopFixContext(shop: StopFixShop): (job: StopFixJob) => StopFixContext {
  const client = shop.client ?? defaultClient;
  const now = shop.now ?? new Date();
  const config = shop.config ?? getConfig();
  const settings = once(() => getShopSettings(shop.shopId, client));
  const translation = once(async () => openShopTranslation(shop.shopId, shop.billing, { settings: await settings(), client, config }));
  const serves = new Map<string, Promise<boolean>>();
  const smartUsage = new Map<number, Promise<number>>();
  const shared = {
    shopId: shop.shopId,
    now,
    billing: shop.billing,
    config,
    settings,
    dailyUsage: once(() => getDailyUsage(shop.shopId, client, now)),
    monthlyUsage: once(() => getMonthlyUsage(shop.shopId, periodKey(now), client)),
    consent: once(() => consentForShop(shop.shopId, shop.billing, client)),
    allowedEngineServes: (locale: string) => {
      let found = serves.get(locale);
      if (!found) {
        found = (async () => {
          const [s, t] = await Promise.all([settings(), translation()]);
          if (!hasCurrentAiConsent(s, t.configured, t.payer)) return false;
          // The engine to allow, when only an engine outside the consent serves it (cached language lists).
          return (await consentGap(t.provider, locale, consentedEngines(s, t.configured, t.payer))) === null;
        })();
        serves.set(locale, found);
      }
      return found;
    },
    ownKeys: once(() => listEngineKeys(shop.shopId, client)),
    smartConfig: once(() => getSmartConfig(shop.shopId, client)),
    smartUsageSince: (since: Date) => {
      let used = smartUsage.get(since.getTime());
      if (!used) {
        used = getOriginUsageSince(shop.shopId, "smart", since, client);
        smartUsage.set(since.getTime(), used);
      }
      return used;
    },
    primaryLocale: once(async () => {
      const row = await withTenant(shop.shopId, (tx) => tx.shopLocale.findFirst({ where: { shopId: shop.shopId, primary: true }, select: { locale: true } }), client);
      return row?.locale ?? null;
    }),
  };
  return (job) => ({ ...shared, job });
}

/** When the job stopped (a stop sets finishedAt; updatedAt for a row without it). */
const stoppedAt = (job: StopFixJob) => job.finishedAt ?? job.updatedAt;

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Whether the cause of the stop is gone: true (resuming goes on), false (not
 * yet), null (no cheap check: SHOP_AUTH, DISCOVERY_FAILED, PROVIDER,
 * SHOP_INACTIVE, UNKNOWN; resuming is offered anyway). A check that can't be
 * made is null too: it only advises, so it never breaks the page.
 */
export async function stopFix(group: StopGroup, ctx: StopFixContext): Promise<boolean | null> {
  try {
    return await check(group, ctx);
  } catch (error) {
    // Names only: a message may quote merchant data.
    logger.warn({ shopId: ctx.shopId, jobId: ctx.job.id, group, err: error instanceof Error ? error.name : "unknown" }, "stop cause: couldn't check whether it is fixed");
    return null;
  }
}

async function check(group: StopGroup, ctx: StopFixContext): Promise<boolean | null> {
  const ownKeys = usesOwnKeys(ctx.billing.entitlements);
  switch (group) {
    // Linguva's allowances: none applies to a shop that translates with its own keys now.
    case "DAILY_LIMIT":
      return ownKeys || (await ctx.dailyUsage()) < aiLimitsFor(ctx.config, ctx.billing).dailyLimit;
    case "QUOTA_EXCEEDED":
      return ownKeys || (await ctx.monthlyUsage()) < aiLimitsFor(ctx.config, ctx.billing).limit;
    // The app's limit across all shops renews at midnight UTC.
    case "PLATFORM_LIMIT":
      return stoppedAt(ctx.job) < startOfUtcDay(ctx.now);
    case "CONSENT_REQUIRED": {
      const { configured, payer } = await ctx.consent();
      return hasCurrentAiConsent(await ctx.settings(), configured, payer);
    }
    case "ENGINE_CONSENT":
      return ctx.allowedEngineServes(ctx.job.targetLocale);
    case "PLAN_REQUIRED":
      return ctx.billing.entitlements.bulk;
    case "PLAN_SMART":
      return ctx.billing.entitlements.smartAuto;
    // The merchant's own smart budgets: a new window (the schedule's zone), a raised budget or none any more.
    case "SMART_BUDGET_DAILY":
    case "SMART_BUDGET_MONTHLY": {
      const smart = await ctx.smartConfig();
      const daily = group === "SMART_BUDGET_DAILY";
      const budget = daily ? smart?.dailyBudget : smart?.monthlyBudget;
      if (!smart || !budget) return true;
      const windows = budgetWindows(ctx.now.getTime(), smart.timeZone);
      return (await ctx.smartUsageSince(new Date(daily ? windows.daySince : windows.monthSince))) < budget;
    }
    // Saving the schedule's languages records the store's primary language: the check compares with it.
    case "PRIMARY_LANGUAGE": {
      const smart = await ctx.smartConfig();
      if (!smart?.primaryLocale) return true;
      const primary = await ctx.primaryLocale();
      return primary === null ? null : primary === smart.primaryLocale;
    }
    // The shop's own keys: none are needed once the shop is on another plan.
    case "OWN_KEY_MISSING":
      return !ownKeys || (await ctx.ownKeys()).some(usableOwnKey);
    case "OWN_KEY_QUOTA":
    case "OWN_KEY_AUTH": {
      if (!ownKeys) return true;
      const own = parseOwnKeyCode(ctx.job.errorCode);
      const engine = own && own.kind !== "MISSING" ? own.engine : null;
      const since = stoppedAt(ctx.job);
      // The key's quota is back or the key is accepted again (a check, a later success, a
      // replacement), or another key was accepted since the stop.
      return (await ctx.ownKeys()).some((k) => k.status === "OK" && (engine === null || k.engine === engine || new Date(k.verifiedAt) > since));
    }
    default:
      return null;
  }
}

/**
 * When a limit's stop can go on by itself: the next midnight UTC for the daily
 * limits, the next usage period for the monthly allowance (a bigger plan is
 * sooner); null for every other cause.
 */
export function stopResumesAt(group: StopGroup, now: Date = new Date()): Date | null {
  if (group === "DAILY_LIMIT" || group === "PLATFORM_LIMIT") return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60_000);
  if (group === "QUOTA_EXCEEDED") return nextPeriodStart(now);
  return null;
}
