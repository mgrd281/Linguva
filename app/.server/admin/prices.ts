/**
 * The list prices the website and the app's Plan page show, set in the admin
 * console. Shopify charges what the Partner Dashboard says (there is no API
 * to change a plan's price there): saving here changes only what Linguva
 * shows, so the console asks for the same price in the Partner Dashboard
 * first. A plan without a PlanPrice row shows its default (DEFAULT_PRICES,
 * app/lib/plans.ts). Amounts are whole cents in the database and dollars
 * (cents / 100) everywhere else. Global tables: no shop data, no tenant.
 */
import type { PrismaClient } from "@prisma/client";
import { getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { settleAll } from "../lib/settle";
import { centsToUsd, estimatedMargin, includedChars, priceWarnings, usdToCents, type PriceWarning } from "../../lib/plan-prices";
import { DEFAULT_PRICES, PRICE_HANDLES, type KnownPriceHandle, type ListPrice, type PriceTable } from "../../lib/plans";

export type PriceHandle = KnownPriceHandle;
export type { PriceTable };

/** The database's CHECK (migration 20261107090000_admin_console), in cents: a paid plan costs $1 to $100,000 a month. */
const MIN_CENTS = 100;
const MAX_MONTHLY_CENTS = 10_000_000;
const MAX_YEARLY_CENTS = 120_000_000;
const REASON_MIN = 3;
const REASON_MAX = 500;

/** Pages read the table at most this often (the website's own Cache-Control adds up to 5 minutes). */
const CACHE_MS = 30_000;

let cache: { table: PriceTable; at: number } | null = null;
let reading: Promise<PriceTable> | null = null;
/** Bumped by invalidatePriceCache: a read that started before is used once, never cached. */
let generation = 0;
/** The last table read from the database: what an unreadable database shows. */
let lastGood: PriceTable | null = null;
let warned = false;

type PriceRow = { handle: string; monthlyCents: number; yearlyCents: number | null };

function isPriceHandle(handle: string): handle is PriceHandle {
  return (PRICE_HANDLES as readonly string[]).includes(handle);
}

function tableFrom(rows: readonly PriceRow[]): PriceTable {
  const table: Record<PriceHandle, Readonly<ListPrice>> = { ...DEFAULT_PRICES };
  for (const row of rows) {
    if (!isPriceHandle(row.handle)) continue;
    table[row.handle] = { monthlyUsd: centsToUsd(row.monthlyCents), yearlyUsd: row.yearlyCents === null ? null : centsToUsd(row.yearlyCents) };
  }
  return Object.freeze(table);
}

async function readTable(client: PrismaClient): Promise<PriceTable> {
  return tableFrom(await client.planPrice.findMany({ select: { handle: true, monthlyCents: true, yearlyCents: true } }));
}

/**
 * The prices to show: the database's rows over the defaults, cached for 30 s
 * (one read for every page in that time). Never throws: when the database
 * can't be read, the last table read, else the defaults (logged once per
 * outage, the error's class only).
 */
export async function getPriceTable(client: PrismaClient = defaultClient): Promise<PriceTable> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.table;
  if (reading) return reading;
  const started = generation;
  const read: Promise<PriceTable> = readTable(client)
    .then(
      (table) => {
        // A read from before a save is shown once, never kept.
        if (started === generation) lastGood = table;
        warned = false;
        return table;
      },
      (error: unknown) => {
        if (!warned) {
          warned = true;
          logger.warn({ error: error instanceof Error ? error.name : typeof error }, "list prices unreadable; showing the last known or the default prices");
        }
        return lastGood ?? DEFAULT_PRICES;
      },
    )
    .then((table) => {
      // A failed read is cached too: an outage costs one attempt per 30 s, not one per page.
      if (started === generation) cache = { table, at: Date.now() };
      return table;
    })
    .finally(() => {
      if (reading === read) reading = null;
    });
  reading = read;
  return read;
}

/** The next getPriceTable reads the database (after a save, and in tests). */
export function invalidatePriceCache(): void {
  generation++;
  cache = null;
  reading = null;
}

export interface PriceChangeView {
  id: string;
  handle: string;
  oldMonthlyUsd: number;
  oldYearlyUsd: number | null;
  newMonthlyUsd: number;
  newYearlyUsd: number | null;
  reason: string;
  /** The admin's e-mail; null once the account is gone. */
  by: string | null;
  at: string;
}

/** The newest list price changes, newest first (the history tables of Prices and Activity). */
export async function priceChangeHistory(take: number, client: PrismaClient = defaultClient): Promise<PriceChangeView[]> {
  const rows = await client.planPriceChange.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      handle: true,
      oldMonthlyCents: true,
      oldYearlyCents: true,
      newMonthlyCents: true,
      newYearlyCents: true,
      reason: true,
      createdAt: true,
      // Never the hash or the TOTP secret: the e-mail only.
      adminUser: { select: { email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    oldMonthlyUsd: centsToUsd(row.oldMonthlyCents),
    oldYearlyUsd: row.oldYearlyCents === null ? null : centsToUsd(row.oldYearlyCents),
    newMonthlyUsd: centsToUsd(row.newMonthlyCents),
    newYearlyUsd: row.newYearlyCents === null ? null : centsToUsd(row.newYearlyCents),
    reason: row.reason,
    by: row.adminUser?.email ?? null,
    at: row.createdAt.toISOString(),
  }));
}

/** Where the owner changes what Shopify charges: the organization's apps, else the Partner Dashboard's start page. */
export function partnerDashboardUrl(config: AppConfig = getConfig()): string {
  return config.SHOPIFY_PARTNER_ORG_ID ? `https://partners.shopify.com/${config.SHOPIFY_PARTNER_ORG_ID}/apps` : "https://partners.shopify.com/";
}

const samePrice = (a: Readonly<ListPrice>, b: Readonly<ListPrice>) =>
  usdToCents(a.monthlyUsd) === usdToCents(b.monthlyUsd) && (a.yearlyUsd === null ? null : usdToCents(a.yearlyUsd)) === (b.yearlyUsd === null ? null : usdToCents(b.yearlyUsd));

/** The Prices page: every plan's price as read now (no cache), its default and estimated margin, the history. */
export async function loadPricesPage(opts: { client?: PrismaClient; config?: AppConfig } = {}) {
  const client = opts.client ?? defaultClient;
  const [rows, history] = await settleAll([
    client.planPrice.findMany({ select: { handle: true, monthlyCents: true, yearlyCents: true, updatedAt: true } }),
    priceChangeHistory(20, client),
  ]);
  const table = tableFrom(rows);
  const updated = new Map(rows.map((row) => [row.handle, row.updatedAt.toISOString()]));
  const plans = PRICE_HANDLES.map((handle) => {
    const { monthlyUsd, yearlyUsd } = table[handle];
    const fallback = DEFAULT_PRICES[handle];
    const monthlyChars = includedChars(handle);
    return {
      handle,
      monthlyUsd,
      yearlyUsd,
      isDefault: samePrice(table[handle], fallback),
      /** When the console last saved this plan's price; null: never (the default). */
      updatedAt: updated.get(handle) ?? null,
      defaultMonthlyUsd: fallback.monthlyUsd,
      defaultYearlyUsd: fallback.yearlyUsd,
      /** At full use, worst case (estimatedMargin); null for Free. Yearly: the yearly price ÷ 12. */
      margin: { monthly: estimatedMargin(monthlyUsd, monthlyChars), yearly: yearlyUsd === null ? null : estimatedMargin(yearlyUsd / 12, monthlyChars) },
      monthlyChars,
      /** The newest change of this plan in the history shown, if any. */
      lastChange: history.find((change) => change.handle === handle) ?? null,
    };
  });
  return { plans, history, warnings: priceWarnings(table) satisfies PriceWarning[], partnerDashboardUrl: partnerDashboardUrl(opts.config) };
}

export type PricesPageData = Awaited<ReturnType<typeof loadPricesPage>>;

export type PriceError = "REQUIRED" | "NOT_A_PRICE" | "TOO_LOW" | "TOO_HIGH" | "YEARLY_TOO_LOW" | "FREE_IS_FREE" | "REASON_REQUIRED" | "CODE_REQUIRED";

const AMOUNT = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** "29", "9.99", "9,9" → cents; at most 2 decimals, no thousands separators ("1,000" isn't a price). */
function amountCents(raw: string): number | "NOT_A_PRICE" | "TOO_HIGH" {
  const match = AMOUNT.exec(raw);
  if (!match) return "NOT_A_PRICE";
  if (match[1]!.replace(/^0+(?=\d)/, "").length > 9) return "TOO_HIGH";
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** One plan's prices in cents, or the errors of its two fields. */
function planCents(handle: PriceHandle, monthlyRaw: string, yearlyRaw: string, errors: Record<string, PriceError>): { monthly: number; yearly: number | null } | null {
  const monthlyField = `${handle}.monthly` as const;
  const yearlyField = `${handle}.yearly` as const;
  if (handle === "free") {
    // Free stays free: a missing or zero monthly price, never a yearly one.
    const monthly = monthlyRaw === "" ? 0 : amountCents(monthlyRaw);
    if (monthly !== 0) errors[monthlyField] = "FREE_IS_FREE";
    if (yearlyRaw !== "") errors[yearlyField] = "FREE_IS_FREE";
    return monthly === 0 && yearlyRaw === "" ? { monthly: 0, yearly: null } : null;
  }
  let monthly: number | null = null;
  if (monthlyRaw === "") errors[monthlyField] = "REQUIRED";
  else {
    const cents = amountCents(monthlyRaw);
    if (typeof cents === "string") errors[monthlyField] = cents;
    else if (cents < MIN_CENTS) errors[monthlyField] = "TOO_LOW";
    else if (cents > MAX_MONTHLY_CENTS) errors[monthlyField] = "TOO_HIGH";
    else monthly = cents;
  }
  let yearly: number | null = null;
  let yearlyOk = true;
  if (yearlyRaw !== "") {
    const cents = amountCents(yearlyRaw);
    yearlyOk = false;
    if (typeof cents === "string") errors[yearlyField] = cents;
    else if (cents < MIN_CENTS) errors[yearlyField] = "TOO_LOW";
    else if (cents > MAX_YEARLY_CENTS) errors[yearlyField] = "TOO_HIGH";
    // A year never costs less than one month.
    else if (monthly !== null && cents < monthly) errors[yearlyField] = "YEARLY_TOO_LOW";
    else {
      yearly = cents;
      yearlyOk = true;
    }
  }
  return monthly !== null && yearlyOk ? { monthly, yearly } : null;
}

function normalReason(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The Prices form: `<handle>.monthly` and `<handle>.yearly` per plan (decimal
 * dollars with "." or ",", at most 2 decimals; an empty yearly field: no
 * yearly price; Free's fields may be left out), `reason` (3 to 500
 * characters: REASON_REQUIRED for both too short and too long) and `code`
 * (the 6-digit code, spaces ignored; the route checks it with
 * verifyFreshCode). Errors are keyed by field name.
 */
export function parsePriceForm(form: FormData): { ok: true; table: PriceTable; reason: string; code: string } | { ok: false; errors: Record<string, PriceError> } {
  const errors: Record<string, PriceError> = {};
  const table: Partial<Record<PriceHandle, ListPrice>> = {};
  for (const handle of PRICE_HANDLES) {
    const cents = planCents(handle, field(form, `${handle}.monthly`), field(form, `${handle}.yearly`), errors);
    if (cents) table[handle] = { monthlyUsd: centsToUsd(cents.monthly), yearlyUsd: cents.yearly === null ? null : centsToUsd(cents.yearly) };
  }
  const reason = normalReason(field(form, "reason"));
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) errors.reason = "REASON_REQUIRED";
  const code = field(form, "code").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) errors.code = "CODE_REQUIRED";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, table: Object.freeze(table as Record<PriceHandle, ListPrice>), reason, code };
}

/** A table that passes the form's rules (savePrices checks again: the database's CHECK is the last line). */
function priceTableValid(table: PriceTable): boolean {
  return PRICE_HANDLES.every((handle) => {
    const price = table[handle];
    if (!price || !Number.isFinite(price.monthlyUsd) || (price.yearlyUsd !== null && !Number.isFinite(price.yearlyUsd))) return false;
    const monthly = usdToCents(price.monthlyUsd);
    const yearly = price.yearlyUsd === null ? null : usdToCents(price.yearlyUsd);
    if (handle === "free") return monthly === 0 && yearly === null;
    return monthly >= MIN_CENTS && monthly <= MAX_MONTHLY_CENTS && (yearly === null || (yearly >= monthly && yearly <= MAX_YEARLY_CENTS));
  });
}

export class InvalidPriceTableError extends Error {
  constructor() {
    super("The price table or the reason doesn't pass the form's rules");
    this.name = "InvalidPriceTableError";
  }
}

/**
 * Saves a price table from parsePriceForm (the route checked the admin's
 * "prices" capability and a fresh code first). One transaction, one writer
 * at a time: the plans whose price differs from the stored one get their
 * PlanPrice row, a PlanPriceChange row (before and after, the reason, who)
 * and an AuditLog entry (admin.prices.changed); nothing changes, nothing is
 * written. The website and the Plan page show the new prices once the
 * cache is cleared here (other processes: within 30 s).
 */
export async function savePrices(
  table: PriceTable,
  reason: string,
  actor: { userId: string },
  opts: { client?: PrismaClient } = {},
): Promise<{ changed: PriceHandle[] }> {
  const why = normalReason(reason);
  if (!priceTableValid(table) || why.length < REASON_MIN || why.length > REASON_MAX) throw new InvalidPriceTableError();
  const client = opts.client ?? defaultClient;
  const result = await client.$transaction(async (tx) => {
    // Two saves at once: the second sees the first's prices as "before".
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"admin:plan-prices"}, 0))`;
    const current = tableFrom(await tx.planPrice.findMany({ select: { handle: true, monthlyCents: true, yearlyCents: true } }));
    const changed = PRICE_HANDLES.filter((handle) => !samePrice(current[handle], table[handle]));
    if (changed.length === 0) return { changed };
    const cents = (price: Readonly<ListPrice>) => ({ monthly: usdToCents(price.monthlyUsd), yearly: price.yearlyUsd === null ? null : usdToCents(price.yearlyUsd) });
    const changes = changed.map((handle) => {
      const before = cents(current[handle]);
      const after = cents(table[handle]);
      return { handle, oldMonthlyCents: before.monthly, oldYearlyCents: before.yearly, newMonthlyCents: after.monthly, newYearlyCents: after.yearly };
    });
    for (const change of changes) {
      const data = { monthlyCents: change.newMonthlyCents, yearlyCents: change.newYearlyCents };
      await tx.planPrice.upsert({ where: { handle: change.handle }, create: { handle: change.handle, ...data }, update: data });
    }
    // The time of the save (after the lock), not of the transaction's start: the history's order is the saves' order.
    const at = new Date();
    await tx.planPriceChange.createMany({ data: changes.map((change) => ({ ...change, reason: why, adminUserId: actor.userId, createdAt: at })) });
    // createMany: the runtime role may only add to the audit log, never read it back.
    await tx.auditLog.createMany({
      data: changes.map((change) => ({
        actorType: "ADMIN" as const,
        actorId: actor.userId,
        action: "admin.prices.changed",
        targetType: "PlanPrice",
        targetId: change.handle,
        metadata: { ...change, reason: why },
      })),
    });
    return { changed };
  });
  if (result.changed.length > 0) invalidatePriceCache();
  return result;
}
