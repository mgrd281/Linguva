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
import { centsToUsd, estimatedMargin, includedChars, offersYearly, priceWarnings, usdToCents, type PriceWarning } from "../../lib/plan-prices";
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
/**
 * The longest a page waits for the database (the first read in a process
 * only: after that, pages are served from the cache while it is refreshed):
 * then the last table read, else the defaults. Healthy reads take ~50 ms;
 * an unreachable host takes Prisma's 5 s connect timeout, a full pool 10 s.
 */
const READ_TIMEOUT_MS = 1_500;
/** After a failed or slow read, the next try (in the background: no page waits for it). */
const RETRY_MS = 5_000;

/** The table pages are served from until `until`, and after it while it is read again. */
let cache: { table: PriceTable; until: number } | null = null;
/** The one read under way, shared by every page: `done` settles when the database answers, `bounded` after READ_TIMEOUT_MS at the latest. */
let reading: { done: Promise<PriceTable>; bounded: Promise<PriceTable> } | null = null;
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

/** Logged once per outage (the error's class only, never its message: it may hold the database URL). */
function warnOnce(error: string): void {
  if (warned) return;
  warned = true;
  logger.warn({ error }, "list prices unreadable; showing the last known or the default prices");
}

function startRead(client: PrismaClient): NonNullable<typeof reading> {
  const started = generation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = readTable(client)
    .then(
      (table) => {
        // A read from before a save is shown once, never kept.
        if (started === generation) {
          lastGood = table;
          cache = { table, until: Date.now() + CACHE_MS };
        }
        warned = false;
        return table;
      },
      (error: unknown) => {
        warnOnce(error instanceof Error ? error.name : typeof error);
        const fallback = lastGood ?? DEFAULT_PRICES;
        // A failed read is kept too: an outage costs one try per RETRY_MS, never one per page.
        if (started === generation) cache = { table: fallback, until: Date.now() + RETRY_MS };
        return fallback;
      },
    )
    .finally(() => {
      clearTimeout(timer);
      if (reading === entry) reading = null;
    });
  const slow = new Promise<PriceTable>((resolve) => {
    timer = setTimeout(() => {
      warnOnce("PriceReadTimeout");
      const fallback = lastGood ?? DEFAULT_PRICES;
      // Pages from now on get the fallback at once; the read goes on, and its table replaces it when it arrives.
      if (started === generation && !cache) cache = { table: fallback, until: Date.now() + RETRY_MS };
      resolve(fallback);
    }, READ_TIMEOUT_MS);
    // Never keeps the process alive.
    (timer as { unref?: () => void }).unref?.();
  });
  const entry = { done, bounded: Promise.race([done, slow]) };
  return entry;
}

/**
 * The prices to show: the database's rows over the defaults, cached for
 * 30 s (one read for every page in that time). Never throws, and never
 * keeps a page waiting on a slow or unreachable database: once a table is
 * known it is served at once while it is read again in the background
 * (stale while revalidate); before that (a process's first page, or right
 * after a save here), a page waits at most READ_TIMEOUT_MS. Without an
 * answer: the last table read, else the defaults (logged once per outage,
 * the error's class only). One read at a time, shared by every page.
 */
export async function getPriceTable(client: PrismaClient = defaultClient): Promise<PriceTable> {
  if (cache && Date.now() < cache.until) return cache.table;
  reading ??= startRead(client);
  if (cache) return cache.table;
  return reading.bounded;
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

type VersionedRow = PriceRow & { updatedAt: Date };

/**
 * What a plan's price was when a page read it: its row's last save and
 * amounts, or "default" without a row. The Prices form sends every plan's
 * version back, and a save refuses when one moved on in the meantime
 * (another admin's save, an older tab): never a stale form's prices over newer ones.
 */
export type PriceVersions = Readonly<Record<PriceHandle, string>>;

function versionOf(row: VersionedRow | undefined): string {
  return row ? `${row.updatedAt.toISOString()}/${row.monthlyCents}/${row.yearlyCents ?? "-"}` : "default";
}

function versionsFrom(rows: readonly VersionedRow[]): PriceVersions {
  const byHandle = new Map(rows.map((row) => [row.handle, row]));
  return Object.fromEntries(PRICE_HANDLES.map((handle) => [handle, versionOf(byHandle.get(handle))])) as Record<PriceHandle, string>;
}

/** The plans whose version isn't the expected one (a missing version never matches). */
function movedOn(current: PriceVersions, expected: Readonly<Partial<Record<PriceHandle, string>>>): PriceHandle[] {
  return PRICE_HANDLES.filter((handle) => expected[handle] !== current[handle]);
}

const VERSIONED_SELECT = { handle: true, monthlyCents: true, yearlyCents: true, updatedAt: true } as const;

/**
 * The plans saved since `expected` was read (the route asks before it uses
 * up the admin's code; savePrices asks again under its locks).
 */
export async function pricesChangedSince(expected: PriceVersions, client: PrismaClient = defaultClient): Promise<PriceHandle[]> {
  return movedOn(versionsFrom(await client.planPrice.findMany({ select: VERSIONED_SELECT })), expected);
}

/** The Prices page: every plan's price as read now (no cache), its default and estimated margin, the history. */
export async function loadPricesPage(opts: { client?: PrismaClient; config?: AppConfig } = {}) {
  const client = opts.client ?? defaultClient;
  const [rows, history] = await settleAll([client.planPrice.findMany({ select: VERSIONED_SELECT }), priceChangeHistory(20, client)]);
  const table = tableFrom(rows);
  const versions = versionsFrom(rows);
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
      /** The form sends it back (`<handle>.version`): see PriceVersions. */
      version: versions[handle],
      /** Whether the console takes a yearly price for it (Own key and Free: monthly only). */
      offersYearly: offersYearly(handle),
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

export type PriceError =
  | "REQUIRED"
  | "NOT_A_PRICE"
  | "TOO_LOW"
  | "TOO_HIGH"
  | "YEARLY_TOO_LOW"
  | "FREE_IS_FREE"
  | "MONTHLY_ONLY"
  | "REASON_REQUIRED"
  | "REASON_INVALID"
  | "CODE_REQUIRED"
  | "SAVE_REFUSED";

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
  if (yearlyRaw !== "" && !offersYearly(handle)) {
    // Own key: monthly only (offersYearly); the page has no field for it.
    errors[yearlyField] = "MONTHLY_ONLY";
    yearlyOk = false;
  } else if (yearlyRaw !== "") {
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
 * Control characters, after normalReason turned tab, line feed and carriage
 * return into spaces: PostgreSQL refuses NUL in text (and \u0000 in JSON),
 * and none belongs in a sentence.
 */
// eslint-disable-next-line no-control-regex -- matching them is the point
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * A normalized reason's problem, checked as the database checks it:
 * PostgreSQL's length() counts code points, not UTF-16 units ("📈a" is 2,
 * too short), and text never holds NUL.
 */
function reasonError(reason: string): "REASON_REQUIRED" | "REASON_INVALID" | null {
  if (CONTROL.test(reason)) return "REASON_INVALID";
  const length = [...reason].length;
  return length < REASON_MIN || length > REASON_MAX ? "REASON_REQUIRED" : null;
}

/**
 * The Prices form: `<handle>.monthly` and `<handle>.yearly` per plan (decimal
 * dollars with "." or ",", at most 2 decimals; an empty yearly field: no
 * yearly price; Free's fields may be left out; Own key's yearly field must
 * stay empty: MONTHLY_ONLY), `<handle>.version` per plan (what the page was
 * read from: PriceVersions; a missing one never matches, so savePrices
 * refuses), `reason` (3 to 500 characters as PostgreSQL counts them:
 * REASON_REQUIRED for both too short and too long; control characters:
 * REASON_INVALID) and `code` (the 6-digit code, spaces ignored; the route
 * checks it with verifyFreshCode). Errors are keyed by field name.
 */
export function parsePriceForm(
  form: FormData,
): { ok: true; table: PriceTable; versions: PriceVersions; reason: string; code: string } | { ok: false; errors: Record<string, PriceError> } {
  const errors: Record<string, PriceError> = {};
  const table: Partial<Record<PriceHandle, ListPrice>> = {};
  const versions: Partial<Record<PriceHandle, string>> = {};
  for (const handle of PRICE_HANDLES) {
    const cents = planCents(handle, field(form, `${handle}.monthly`), field(form, `${handle}.yearly`), errors);
    if (cents) table[handle] = { monthlyUsd: centsToUsd(cents.monthly), yearlyUsd: cents.yearly === null ? null : centsToUsd(cents.yearly) };
    versions[handle] = field(form, `${handle}.version`);
  }
  const reason = normalReason(field(form, "reason"));
  const reasonProblem = reasonError(reason);
  if (reasonProblem) errors.reason = reasonProblem;
  const code = field(form, "code").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) errors.code = "CODE_REQUIRED";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, table: Object.freeze(table as Record<PriceHandle, ListPrice>), versions: Object.freeze(versions as Record<PriceHandle, string>), reason, code };
}

/** A table that passes the form's rules (savePrices checks again: the database's CHECK is the last line). */
function priceTableValid(table: PriceTable): boolean {
  return PRICE_HANDLES.every((handle) => {
    const price = table[handle];
    if (!price || !Number.isFinite(price.monthlyUsd) || (price.yearlyUsd !== null && !Number.isFinite(price.yearlyUsd))) return false;
    const monthly = usdToCents(price.monthlyUsd);
    const yearly = price.yearlyUsd === null ? null : usdToCents(price.yearlyUsd);
    if (handle === "free") return monthly === 0 && yearly === null;
    if (yearly !== null && !offersYearly(handle)) return false;
    return monthly >= MIN_CENTS && monthly <= MAX_MONTHLY_CENTS && (yearly === null || (yearly >= monthly && yearly <= MAX_YEARLY_CENTS));
  });
}

/**
 * A save refused before anything was written: a table or reason the form
 * wouldn't accept, or one the database refused (its CHECKs or encoding).
 * `field` and `code` are what the form shows: "reason" with the reason's
 * error, or "prices" with SAVE_REFUSED.
 */
export class InvalidPriceTableError extends Error {
  constructor(
    readonly field: "prices" | "reason" = "prices",
    readonly code: PriceError = "SAVE_REFUSED",
  ) {
    super("The price table or the reason doesn't pass the form's rules");
    this.name = "InvalidPriceTableError";
  }
}

/**
 * The field a database refusal is about, or null for any other error
 * (Prisma reports PostgreSQL's SQLSTATE and the constraint in its message):
 * 22021 (NUL in text) and 22P05 (\u0000 in JSON) only come from the reason,
 * the free text; a CHECK (23514, P2004) names its constraint.
 */
function refusal(error: unknown): InvalidPriceTableError | null {
  if (!(error instanceof Error)) return null;
  const sqlState = /\bcode: "([0-9A-Z]{5})"/.exec(error.message)?.[1] ?? (error as { meta?: { code?: unknown } }).meta?.code;
  const prismaCode = (error as { code?: unknown }).code;
  if (sqlState === "22021" || sqlState === "22P05") return new InvalidPriceTableError("reason", "REASON_INVALID");
  if (sqlState === "23514" || prismaCode === "P2004") {
    return /reason_check/.test(error.message) ? new InvalidPriceTableError("reason", "REASON_REQUIRED") : new InvalidPriceTableError("prices", "SAVE_REFUSED");
  }
  return null;
}

export type SaveResult =
  /** Saved: the plans whose price changed (none: nothing was written). */
  | { ok: true; changed: PriceHandle[] }
  /** Nothing written: these plans were saved since the form's versions were read. */
  | { ok: false; conflict: PriceHandle[] };

/**
 * Saves a price table from parsePriceForm (the route checked the admin's
 * "prices" capability and a fresh code first). One transaction, one writer
 * at a time (an advisory lock, and the rows read FOR UPDATE). With
 * `expected` (the route always passes the form's versions), a save refuses
 * when any plan was saved since those versions were read: { ok: false,
 * conflict }, nothing written. Otherwise the plans whose price differs from
 * the stored one get their PlanPrice row, a PlanPriceChange row (before and
 * after, the reason, who) and an AuditLog entry (admin.prices.changed);
 * nothing changes, nothing is written. A table or reason the form wouldn't
 * accept, or one the database refuses, throws InvalidPriceTableError
 * (nothing written). The website and the Plan page show the new prices once
 * the cache is cleared here (other processes: within about 30 s).
 */
export async function savePrices(
  table: PriceTable,
  reason: string,
  actor: { userId: string },
  opts: { client?: PrismaClient; expected?: PriceVersions } = {},
): Promise<SaveResult> {
  const why = normalReason(reason);
  if (!priceTableValid(table)) throw new InvalidPriceTableError("prices", "SAVE_REFUSED");
  const reasonProblem = reasonError(why);
  if (reasonProblem) throw new InvalidPriceTableError("reason", reasonProblem);
  const client = opts.client ?? defaultClient;
  let result: SaveResult;
  try {
    result = await client.$transaction(async (tx): Promise<SaveResult> => {
      // Two saves at once: the second waits here, then sees the first's prices (and versions).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"admin:plan-prices"}, 0))`;
      const rows = await tx.$queryRaw<VersionedRow[]>`SELECT "handle", "monthlyCents", "yearlyCents", "updatedAt" FROM "PlanPrice" FOR UPDATE`;
      if (opts.expected) {
        const conflict = movedOn(versionsFrom(rows), opts.expected);
        if (conflict.length > 0) return { ok: false, conflict };
      }
      const current = tableFrom(rows);
      const changed = PRICE_HANDLES.filter((handle) => !samePrice(current[handle], table[handle]));
      if (changed.length === 0) return { ok: true, changed };
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
      return { ok: true, changed };
    });
  } catch (error) {
    // The transaction rolled back: a refused value is the form's error, never a 500.
    throw refusal(error) ?? error;
  }
  if (result.ok && result.changed.length > 0) invalidatePriceCache();
  return result;
}
