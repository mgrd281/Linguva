/**
 * Every store that installed the app, for the admin console: status, plan,
 * subscription (the cached Partner API answer), this UTC month's usage and
 * an estimated revenue. Counts, dates, plans and figures only: no merchant
 * content. The cache is refreshed only when the store uses the app (Shopify
 * sends no billing webhooks), so a row is read with its own dates: a cycle
 * that ended with a cancellation or a plan change counts as what followed.
 *
 * Shop is a global table; everything else is the shop's own and is read
 * inside withTenant(shop.id), as every job across shops does (never a bypass
 * role): one statement per shop, at most four shops at a time. The database
 * part is kept in the process for 60 s (`force` rebuilds it); plan, trial and
 * revenue are worked out on every call, from the current list prices.
 */
import { Prisma, type ComplimentaryAccess, type PrismaClient } from "@prisma/client";
import { isActiveGrant } from "../billing/complimentary";
import { complimentaryShopGids, costRates, getConfig, partnerApiSettings, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { periodKey } from "../usage/usage-ledger";
import { usdToCents } from "../../lib/plan-prices";
import { estimatedCostByProvider, isOwnKeyHandle, PLANS, type PlanHandle, type PriceTable } from "../../lib/plans";
import { getPriceTable } from "./prices";

export type AdminPlanKey = "free" | "starter" | "pro" | "business" | "own-key" | "complimentary" | "unknown";
export const ADMIN_PLAN_KEYS: readonly AdminPlanKey[] = ["free", "starter", "pro", "business", "own-key", "complimentary", "unknown"];

export interface ShopRow {
  id: string;
  shopDomain: string;
  name: string | null;
  status: "ACTIVE" | "UNINSTALLED";
  installedAt: string;
  uninstalledAt: string | null;
  hasGid: boolean;
  subscription: null | {
    state: "ACTIVE" | "NONE";
    planHandle: string | null;
    billingPeriod: string | null;
    trialEndsAt: string | null;
    cancelAtEndOfCycle: boolean;
    currentPeriodEnd: string | null;
    pendingPlanHandle: string | null;
    /** Null: not checked since the store was (re)installed (the cache was reset; see readShopFacts). */
    checkedAt: string | null;
  };
  plan: AdminPlanKey;
  inTrial: boolean;
  /** An installed store whose subscription ends with the current cycle, and that cycle hasn't ended yet. */
  cancelling: boolean;
  complimentary: boolean;
  /** This UTC month: Linguva's characters, the merchant's own keys' characters, Linguva's estimated engine cost. */
  usage: { chars: number; ownKeyChars: number; costUsd: number };
  /** Additional (non-primary) languages. */
  languages: number;
  lastJobAt: string | null;
  /** Estimated from the current list prices (ANNUAL: yearly ÷ 12); 0 for free, trial, complimentary, unknown and uninstalled stores. */
  monthlyRevenueUsd: number;
}

export interface Directory {
  rows: ShopRow[];
  /** When the database was read (the cache's age). */
  builtAt: string;
  billingConfigured: boolean;
  prices: PriceTable;
}

/** What one statement in the shop's tenant reads (exported for the customer page). */
export interface ShopFacts {
  shop: { id: string; shopDomain: string; name: string | null; status: "ACTIVE" | "UNINSTALLED"; installedAt: Date; uninstalledAt: Date | null; shopifyShopGid: string | null };
  subscription: null | {
    state: "ACTIVE" | "NONE";
    planHandle: string | null;
    billingPeriod: string | null;
    trialEndsAt: Date | null;
    cancelAtEndOfCycle: boolean;
    currentPeriodEnd: Date | null;
    pendingPlanHandle: string | null;
    /** Null: not checked since the store was (re)installed (NOT_CHECKED_SINCE_INSTALL). */
    checkedAt: Date | null;
  };
  grant: ComplimentaryAccess | null;
  /** Linguva's characters this month per engine (no engine: DeepL's, as getMonthlyUsageByProvider). */
  byProvider: Record<string, number>;
  ownKeyChars: number;
  languages: number;
  lastJobAt: Date | null;
}

type FactsRow = {
  subState: "ACTIVE" | "NONE" | null;
  planHandle: string | null;
  pendingPlanHandle: string | null;
  billingPeriod: string | null;
  trialEndsAt: Date | null;
  cancelAtEndOfCycle: boolean | null;
  currentPeriodEnd: Date | null;
  checkedAt: Date | null;
  grantShopId: string | null;
  grantGid: string | null;
  grantReason: string | null;
  grantGrantedBy: string | null;
  grantLimit: number | null;
  grantGrantedAt: Date | null;
  grantExpiresAt: Date | null;
  grantRevokedAt: Date | null;
  grantRevokedBy: string | null;
  grantRevokeReason: string | null;
  byProvider: Record<string, number | string> | null;
  ownKeyChars: bigint | number | null;
  languages: number | null;
  lastJobAt: Date | null;
};

export const SHOP_SELECT = { id: true, shopDomain: true, name: true, status: true, installedAt: true, uninstalledAt: true, shopifyShopGid: true } as const;

/**
 * The checkedAt an uninstall or reinstall writes (shop-service.ts,
 * CANCELLED_SUBSCRIPTION: state NONE, checked at the epoch): "not checked
 * since", never a check on Jan 1, 1970. The app asks the Partner API again
 * at the store's next request.
 */
const NOT_CHECKED_SINCE_INSTALL = 0;

/**
 * The shop's subscription cache, complimentary grant, month's usage, language count and newest job:
 * one statement, inside the shop's tenant (row-level security applies; the shopId conditions use the indexes).
 */
export async function readShopFacts(tx: TenantTx, shop: ShopFacts["shop"], period: string): Promise<ShopFacts> {
  const rows = await tx.$queryRaw<FactsRow[]>(Prisma.sql`
    SELECT s."state"::text AS "subState", s."planHandle", s."pendingPlanHandle", s."billingPeriod", s."trialEndsAt",
           s."cancelAtEndOfCycle", s."currentPeriodEnd", s."checkedAt",
           c."shopId"::text AS "grantShopId", c."shopifyShopGid" AS "grantGid", c."reason" AS "grantReason", c."grantedBy" AS "grantGrantedBy",
           c."monthlyCharLimit" AS "grantLimit", c."grantedAt" AS "grantGrantedAt", c."expiresAt" AS "grantExpiresAt",
           c."revokedAt" AS "grantRevokedAt", c."revokedBy" AS "grantRevokedBy", c."revokeReason" AS "grantRevokeReason",
           (SELECT COALESCE(json_object_agg(u."provider", u."chars"), '{}'::json)
              FROM (SELECT COALESCE("provider", 'deepl') AS "provider", SUM("chars")::bigint AS "chars"
                      FROM "UsageLedger"
                     WHERE "shopId" = ${shop.id}::uuid AND "periodKey" = ${period} AND "payer" IS NULL
                     GROUP BY 1) u) AS "byProvider",
           (SELECT COALESCE(SUM("chars"), 0)::bigint FROM "UsageLedger"
             WHERE "shopId" = ${shop.id}::uuid AND "periodKey" = ${period} AND "payer" = 'merchant') AS "ownKeyChars",
           (SELECT COUNT(*)::int FROM "ShopLocale" WHERE "shopId" = ${shop.id}::uuid AND NOT "primary") AS "languages",
           (SELECT MAX("createdAt") FROM "TranslationJob" WHERE "shopId" = ${shop.id}::uuid) AS "lastJobAt"
      FROM (SELECT 1) AS "one"
      LEFT JOIN "ShopSubscription" s ON s."shopId" = ${shop.id}::uuid
      LEFT JOIN "ComplimentaryAccess" c ON c."shopId" = ${shop.id}::uuid`);
  const row = rows[0]!;
  const byProvider: Record<string, number> = {};
  for (const [provider, chars] of Object.entries(row.byProvider ?? {})) byProvider[provider] = Number(chars);
  return {
    shop,
    subscription:
      row.subState && row.checkedAt
        ? {
            state: row.subState,
            planHandle: row.planHandle,
            billingPeriod: row.billingPeriod,
            trialEndsAt: row.trialEndsAt,
            cancelAtEndOfCycle: row.cancelAtEndOfCycle ?? false,
            currentPeriodEnd: row.currentPeriodEnd,
            pendingPlanHandle: row.pendingPlanHandle,
            checkedAt: row.checkedAt.getTime() === NOT_CHECKED_SINCE_INSTALL ? null : row.checkedAt,
          }
        : null,
    grant:
      row.grantShopId && row.grantGid && row.grantGrantedAt
        ? {
            shopId: row.grantShopId,
            shopifyShopGid: row.grantGid,
            reason: row.grantReason ?? "",
            grantedBy: row.grantGrantedBy ?? "",
            monthlyCharLimit: row.grantLimit ?? 0,
            grantedAt: row.grantGrantedAt,
            expiresAt: row.grantExpiresAt,
            revokedAt: row.grantRevokedAt,
            revokedBy: row.grantRevokedBy,
            revokeReason: row.grantRevokeReason,
          }
        : null,
    byProvider,
    ownKeyChars: Number(row.ownKeyChars ?? 0),
    languages: row.languages ?? 0,
    lastJobAt: row.lastJobAt,
  };
}

/** What the rows are worked out with on each call (not cached: the list prices and configuration of now). */
export interface RowContext {
  now: Date;
  prices: PriceTable;
  billingConfigured: boolean;
  complimentaryGids: readonly string[];
  rates: Record<string, number>;
}

export async function rowContext(opts: { client?: PrismaClient; now?: Date; config?: AppConfig } = {}): Promise<RowContext> {
  const config = opts.config ?? getConfig();
  return {
    now: opts.now ?? new Date(),
    prices: await getPriceTable(opts.client ?? defaultClient),
    billingConfigured: partnerApiSettings(config) !== null,
    complimentaryGids: complimentaryShopGids(config),
    rates: costRates(config),
  };
}

const PAID: ReadonlySet<AdminPlanKey> = new Set(["starter", "pro", "business", "own-key"]);

type Instant = Date | string | null;
const ms = (at: Date | string) => (typeof at === "string" ? Date.parse(at) : at.getTime());

/**
 * A cached ACTIVE subscription whose billing cycle is over by its own data:
 * Shopify answered before the cycle's end (currentPeriodEnd), and that end
 * has passed. Then what was due at the end of the cycle happened: a
 * cancellation ended it, a pending plan change took effect. (An answer
 * given after the end is Shopify's word on the new cycle.) Works on a
 * ShopFacts subscription (dates) and a ShopRow's (ISO strings).
 */
export function cycleEnded(sub: { state: string; currentPeriodEnd: Instant; checkedAt: Instant } | null, now: Date): boolean {
  if (sub?.state !== "ACTIVE" || sub.currentPeriodEnd === null) return false;
  const end = ms(sub.currentPeriodEnd);
  return end <= now.getTime() && (sub.checkedAt === null || ms(sub.checkedAt) < end);
}

function handleKey(handle: string | null): AdminPlanKey {
  if (isOwnKeyHandle(handle)) return "own-key";
  return handle && Object.hasOwn(PLANS, handle) ? (handle as PlanHandle) : "unknown";
}

function planKey(facts: ShopFacts, complimentary: boolean, ctx: Pick<RowContext, "billingConfigured" | "now">): AdminPlanKey {
  if (complimentary) return "complimentary";
  const sub = facts.subscription;
  // Never checked, or not since the store was (re)installed: unknown while billing is configured.
  if (!sub || sub.checkedAt === null) return ctx.billingConfigured ? "unknown" : "free";
  if (sub.state === "NONE") return "free";
  if (cycleEnded(sub, ctx.now)) {
    // Cancelled at the end of a cycle that is over: the subscription ended, so the store is on Free (what Shopify
    // does then: no subscription, no charge), never counted as paying. The store page still shows the cached
    // answer with its past period end; "Ask Shopify again" confirms it.
    if (sub.cancelAtEndOfCycle) return "free";
    // A plan change that waited for the end of the cycle: the new plan applies now.
    if (sub.pendingPlanHandle) return handleKey(sub.pendingPlanHandle);
  }
  return handleKey(sub.planHandle);
}

/**
 * A row's estimated monthly revenue in cents, unrounded (a yearly price ÷ 12
 * is rarely whole): sums stay exact and are rounded once. Only an installed
 * store on a paid plan outside its trial pays; ANNUAL counts the yearly price
 * ÷ 12 (the monthly price when the plan no longer has a yearly one).
 */
export function revenueCents(row: Pick<ShopRow, "plan" | "status" | "inTrial"> & { subscription: { billingPeriod: string | null } | null }, prices: PriceTable): number {
  if (row.status !== "ACTIVE" || row.inTrial || !PAID.has(row.plan)) return 0;
  const price = prices[row.plan as "starter" | "pro" | "business" | "own-key"];
  if (row.subscription?.billingPeriod === "ANNUAL" && price.yearlyUsd !== null) return usdToCents(price.yearlyUsd) / 12;
  return usdToCents(price.monthlyUsd);
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function shopRow(facts: ShopFacts, ctx: RowContext): ShopRow {
  const { shop } = facts;
  const complimentary = isActiveGrant(facts.grant, shop, ctx.complimentaryGids, ctx.now);
  const plan = planKey(facts, complimentary, ctx);
  const sub = facts.subscription;
  const inTrial = shop.status === "ACTIVE" && !complimentary && sub?.state === "ACTIVE" && sub.trialEndsAt !== null && sub.trialEndsAt.getTime() > ctx.now.getTime();
  const chars = Object.values(facts.byProvider).reduce((sum, n) => sum + n, 0);
  const cancelling = shop.status === "ACTIVE" && sub?.state === "ACTIVE" && sub.cancelAtEndOfCycle && !cycleEnded(sub, ctx.now);
  const row: Omit<ShopRow, "monthlyRevenueUsd"> = {
    id: shop.id,
    shopDomain: shop.shopDomain,
    name: shop.name,
    status: shop.status,
    installedAt: shop.installedAt.toISOString(),
    uninstalledAt: iso(shop.uninstalledAt),
    hasGid: shop.shopifyShopGid !== null,
    subscription: sub
      ? {
          state: sub.state,
          planHandle: sub.planHandle,
          billingPeriod: sub.billingPeriod,
          trialEndsAt: iso(sub.trialEndsAt),
          cancelAtEndOfCycle: sub.cancelAtEndOfCycle,
          currentPeriodEnd: iso(sub.currentPeriodEnd),
          pendingPlanHandle: sub.pendingPlanHandle,
          checkedAt: iso(sub.checkedAt),
        }
      : null,
    plan,
    inTrial,
    cancelling,
    complimentary,
    usage: { chars, ownKeyChars: facts.ownKeyChars, costUsd: estimatedCostByProvider(facts.byProvider, ctx.rates) },
    languages: facts.languages,
    lastJobAt: iso(facts.lastJobAt),
  };
  return { ...row, monthlyRevenueUsd: Math.round(revenueCents(row, ctx.prices)) / 100 };
}

/** `fn` over `items`, at most `limit` at a time, results in order; after a failure no new item starts, and it rejects once the running ones settled. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}

const CACHE_MS = 60_000;
const CONCURRENCY = 4;

interface Snapshot {
  facts: ShopFacts[];
  builtAt: Date;
}

let snapshot: Snapshot | null = null;
let building: Promise<Snapshot> | null = null;

async function buildSnapshot(client: PrismaClient, now: Date): Promise<Snapshot> {
  // Shop is global: the runtime role lists every shop without a tenant.
  const shops = await client.shop.findMany({ select: SHOP_SELECT, orderBy: [{ installedAt: "desc" }, { id: "asc" }] });
  const period = periodKey(now);
  const facts = await mapLimit(shops, CONCURRENCY, (shop) => withTenant(shop.id, (tx) => readShopFacts(tx, shop, period), client));
  return { facts, builtAt: now };
}

/** The next loadDirectory reads the database again (a store's subscription was refreshed). */
export function invalidateDirectoryCache(): void {
  snapshot = null;
  building = null;
}

/** Every store, newest install first. */
export async function loadDirectory(opts: { client?: PrismaClient; now?: Date; force?: boolean; config?: AppConfig } = {}): Promise<Directory> {
  const client = opts.client ?? defaultClient;
  const now = opts.now ?? new Date();
  let current = snapshot;
  if (opts.force || !current || now.getTime() - current.builtAt.getTime() >= CACHE_MS || now.getTime() < current.builtAt.getTime()) {
    if (opts.force || !building) {
      const build = buildSnapshot(client, now);
      building = build;
      build.then(
        (built) => {
          if (building === build) {
            snapshot = built;
            building = null;
          }
        },
        () => {
          if (building === build) building = null;
        },
      );
    }
    current = await building!;
  }
  const ctx = await rowContext({ client, now, config: opts.config });
  return {
    rows: current.facts.map((facts) => shopRow(facts, ctx)),
    builtAt: current.builtAt.toISOString(),
    billingConfigured: ctx.billingConfigured,
    prices: ctx.prices,
  };
}

export type DirectoryFilter = {
  q?: string;
  status?: "ACTIVE" | "UNINSTALLED" | "all";
  plan?: AdminPlanKey | "all";
  sort?: "newest" | "oldest" | "usage" | "revenue" | "name";
};

/** Search (name or domain, any case), status and plan filters, and the order (newest install first by default; ties by domain). */
export function filterRows(rows: ShopRow[], f: DirectoryFilter): ShopRow[] {
  const q = (f.q ?? "").trim().toLowerCase().slice(0, 200);
  const matches = rows.filter(
    (row) =>
      (!q || row.shopDomain.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q)) &&
      (!f.status || f.status === "all" || row.status === f.status) &&
      (!f.plan || f.plan === "all" || row.plan === f.plan),
  );
  const byDomain = (a: ShopRow, b: ShopRow) => (a.shopDomain < b.shopDomain ? -1 : a.shopDomain > b.shopDomain ? 1 : 0);
  const time = (iso: string) => Date.parse(iso);
  const order: Record<NonNullable<DirectoryFilter["sort"]>, (a: ShopRow, b: ShopRow) => number> = {
    newest: (a, b) => time(b.installedAt) - time(a.installedAt),
    oldest: (a, b) => time(a.installedAt) - time(b.installedAt),
    usage: (a, b) => b.usage.chars - a.usage.chars,
    revenue: (a, b) => b.monthlyRevenueUsd - a.monthlyRevenueUsd,
    name: (a, b) => (a.name ?? a.shopDomain).localeCompare(b.name ?? b.shopDomain, "en", { sensitivity: "base" }),
  };
  const compare = order[f.sort ?? "newest"] ?? order.newest;
  return [...matches].sort((a, b) => compare(a, b) || byDomain(a, b));
}
