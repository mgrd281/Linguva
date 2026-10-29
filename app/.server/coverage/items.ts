/**
 * Live coverage items: the translation state of one resource in one
 * language, kept current by scans (coverage.ts), after every translation
 * written or removed, and whenever drafts or job items change. Counts per
 * language, type, field group and state (CoverageCount) change with every
 * item in the same transaction, so the dashboard reads a few hundred rows,
 * not every item; scans rebuild them from the items as a check.
 *
 * Only keys, states, counts, ids and a hash of the translated SEO title are
 * stored, never merchant text. Writes for one shop and language are
 * serialised with an advisory lock, so count changes never interleave.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import type { TranslatableResourceData } from "../shopify/translations-api";
import { checkSeoField, SEO_TITLE_KEY } from "../../lib/seo";
import { FIELD_STATES, fieldGroupOf, fieldState, type FieldState, type StateCounts } from "../../lib/coverage-rules";

/** What Shopify says about a resource in a language (from a read or a write). */
export interface CoverageBase {
  sourceKeys: string[];
  /** digestTag of each source key's original, in the same order ("" when unknown). */
  sourceDigests: string[];
  currentKeys: string[];
  outdatedKeys: string[];
  seoIssues: number;
  seoTitleHash: string | null;
}

export interface CoverageOverlay {
  draftKeys: string[];
  reviewKeys: string[];
  /** digestTag of the original each pending draft was made for, by key. */
  draftDigests?: Readonly<Record<string, string>>;
  failed: boolean;
  failureCode: string | null;
}

const hasText = (value: string | null | undefined): value is string => Boolean(value && value.trim());

/** Normalised SEO title hash for finding duplicates (no text is kept). */
export function seoTitleHash(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 32);
}

/** The start of Shopify's digest of an original that items keep (16 hex digits), or "" when it isn't one. */
export function digestTag(digest: string | null | undefined): string {
  const tag = (digest ?? "").slice(0, 16).toLowerCase();
  return /^[0-9a-f]{16}$/.test(tag) ? tag : "";
}

/** The base state from Shopify's translatable content and translations. Pure. */
export function baseFromShopify(data: Pick<TranslatableResourceData, "content" | "translations">): CoverageBase {
  const translations = new Map(data.translations.map((t) => [t.key, t]));
  const base: CoverageBase = { sourceKeys: [], sourceDigests: [], currentKeys: [], outdatedKeys: [], seoIssues: 0, seoTitleHash: null };
  for (const field of data.content) {
    if (!hasText(field.value)) continue;
    base.sourceKeys.push(field.key);
    base.sourceDigests.push(digestTag(field.digest));
    const t = translations.get(field.key);
    if (!t || !hasText(t.value)) continue;
    if (t.outdated) base.outdatedKeys.push(field.key);
    else base.currentKeys.push(field.key);
    if (checkSeoField(field.key, field.value, t.value).length) base.seoIssues++;
    if (field.key === SEO_TITLE_KEY) base.seoTitleHash = seoTitleHash(t.value);
  }
  return base;
}

/**
 * The drafts that count for a base: only for fields that still have an
 * original, and made for that original. A draft made for an older one can't
 * be published (approving it is refused as stale), so its field shows as
 * missing or outdated. A digest unknown on either side (an item kept before
 * digests were) still counts the draft. Pure.
 */
export function currentOverlay(base: CoverageBase, overlay: CoverageOverlay): CoverageOverlay {
  const digests = new Map(base.sourceKeys.map((key, i) => [key, base.sourceDigests[i] ?? ""]));
  const counts = (key: string) => {
    const original = digests.get(key);
    const made = overlay.draftDigests?.[key] ?? "";
    return original !== undefined && (!original || !made || original === made);
  };
  return { ...overlay, draftKeys: overlay.draftKeys.filter(counts), reviewKeys: overlay.reviewKeys.filter(counts) };
}

/** Field states ("group:state") and counts per state. Pure. */
export function deriveStates(resourceType: string, base: CoverageBase, overlay: CoverageOverlay) {
  const current = new Set(base.currentKeys);
  const outdated = new Set(base.outdatedKeys);
  const drafts = new Set(overlay.draftKeys);
  const review = new Set(overlay.reviewKeys);
  const counts: StateCounts = { complete: 0, review: 0, draft: 0, failed: 0, outdated: 0, missing: 0 };
  const fieldStates: string[] = [];
  for (const key of base.sourceKeys) {
    const state = fieldState({
      current: current.has(key),
      outdated: outdated.has(key),
      draft: drafts.has(key),
      review: review.has(key),
      failed: overlay.failed,
    });
    counts[state]++;
    fieldStates.push(`${fieldGroupOf(key, resourceType)}:${state}`);
  }
  return { fieldStates, counts };
}

export interface CoverageChange {
  resourceGid: string;
  /** Required to create an item. */
  resourceType?: string;
  parentGid?: string | null;
  /** A Shopify read (or a read plus the values just written), and when it was made. */
  observed?: { data: Pick<TranslatableResourceData, "content" | "translations">; at: Date };
}

export interface SyncOptions {
  /** Create items that don't exist yet (scans and refreshes; writes only update). */
  create: boolean;
  /** The change comes from finding the resource in Shopify (scan or refresh). */
  seen: boolean;
}

type ItemRow = {
  resourceGid: string;
  resourceType: string;
  parentGid: string | null;
  sourceKeys: string[];
  sourceDigests: string[];
  currentKeys: string[];
  outdatedKeys: string[];
  seoIssues: number;
  seoTitleHash: string | null;
  fieldStates: string[];
  syncedAt: Date;
  seenAt: Date;
};

const lockKey = (shopId: string, locale: string) => `coverage-items:${shopId}:${locale}`;

async function lock(tx: TenantTx, shopId: string, locale: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(shopId, locale)}, 0))`;
}

/** Pending drafts (with or without quality notes) and the latest job attempt per resource. */
async function loadOverlays(tx: TenantTx, shopId: string, locale: string, gids: string[]) {
  const overlays = new Map<string, CoverageOverlay & { draftDigests: Record<string, string> }>();
  const get = (gid: string) => {
    let o = overlays.get(gid);
    if (!o) overlays.set(gid, (o = { draftKeys: [], reviewKeys: [], draftDigests: {}, failed: false, failureCode: null }));
    return o;
  };
  if (!gids.length) return overlays;
  const drafts = await tx.translationDraft.findMany({
    where: { shopId, locale, status: "PENDING", resourceGid: { in: gids } },
    select: { resourceGid: true, key: true, issues: true, sourceDigest: true },
  });
  for (const d of drafts) {
    const o = get(d.resourceGid);
    o.draftKeys.push(d.key);
    o.draftDigests[d.key] = digestTag(d.sourceDigest);
    if (Array.isArray(d.issues) && d.issues.length > 0) o.reviewKeys.push(d.key);
  }
  // The latest finished attempt in a job for this language decides "failed".
  const attempts = await tx.$queryRaw<Array<{ resourceGid: string; status: string; errorCode: string | null }>>`
    SELECT DISTINCT ON (i."resourceGid") i."resourceGid", i."status"::text AS "status", i."errorCode"
    FROM "TranslationJobItem" i
    JOIN "TranslationJob" j ON j."id" = i."jobId"
    WHERE i."shopId" = ${shopId}::uuid AND j."shopId" = ${shopId}::uuid AND j."targetLocale" = ${locale}
      AND i."resourceGid" = ANY(${gids}::text[])
      AND i."status" IN ('SUCCEEDED', 'SKIPPED', 'FAILED', 'DEAD')
    ORDER BY i."resourceGid", COALESCE(i."finishedAt", i."updatedAt") DESC, i."id"`;
  for (const a of attempts) {
    if (a.status !== "FAILED" && a.status !== "DEAD") continue;
    const o = get(a.resourceGid);
    o.failed = true;
    o.failureCode = a.errorCode;
  }
  return overlays;
}

type DeltaKey = string;
const deltaKey = (resourceType: string, groupState: string): DeltaKey => `${resourceType}\u0000${groupState}`;

function addDeltas(deltas: Map<DeltaKey, number>, resourceType: string, states: readonly string[], sign: 1 | -1) {
  for (const s of states) {
    const k = deltaKey(resourceType, s);
    deltas.set(k, (deltas.get(k) ?? 0) + sign);
  }
}

async function applyDeltas(tx: TenantTx, shopId: string, locale: string, deltas: Map<DeltaKey, number>) {
  const rows = [...deltas.entries()]
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => {
      const [resourceType, groupState] = k.split("\u0000") as [string, string];
      const [fieldGroup, state] = groupState.split(":") as [string, string];
      return { resourceType, fieldGroup, state, count: n };
    });
  if (!rows.length) return;
  await tx.$executeRaw`
    INSERT INTO "CoverageCount" ("shopId", "locale", "resourceType", "fieldGroup", "state", "count")
    SELECT ${shopId}::uuid, ${locale}, x."resourceType", x."fieldGroup", x."state", x."count"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x("resourceType" text, "fieldGroup" text, "state" text, "count" integer)
    ON CONFLICT ("shopId", "locale", "resourceType", "fieldGroup", "state")
    DO UPDATE SET "count" = "CoverageCount"."count" + EXCLUDED."count"`;
  await tx.$executeRaw`DELETE FROM "CoverageCount" WHERE "shopId" = ${shopId}::uuid AND "locale" = ${locale} AND "count" = 0`;
}

/**
 * Applies changes for one shop and language in one transaction: a Shopify
 * read newer than the item's state replaces its base; drafts and the latest
 * job attempt are read again for every changed item. Returns how many items
 * were written.
 */
export async function syncCoverageTx(
  tx: TenantTx,
  shopId: string,
  locale: string,
  changes: readonly CoverageChange[],
  options: SyncOptions,
): Promise<number> {
  if (!changes.length) return 0;
  await lock(tx, shopId, locale);
  const gids = [...new Set(changes.map((c) => c.resourceGid))];
  const existing = new Map(
    (
      await tx.coverageItem.findMany({
        where: { shopId, locale, resourceGid: { in: gids } },
        select: {
          resourceGid: true,
          resourceType: true,
          parentGid: true,
          sourceKeys: true,
          sourceDigests: true,
          currentKeys: true,
          outdatedKeys: true,
          seoIssues: true,
          seoTitleHash: true,
          fieldStates: true,
          syncedAt: true,
          seenAt: true,
        },
      })
    ).map((i) => [i.resourceGid, i as ItemRow]),
  );
  const overlays = await loadOverlays(tx, shopId, locale, gids);
  const deltas = new Map<DeltaKey, number>();
  const rows: Array<Record<string, unknown>> = [];

  for (const change of changes) {
    const before = existing.get(change.resourceGid);
    const resourceType = before?.resourceType ?? change.resourceType;
    if (!resourceType) continue;
    if (!before && !(options.create && change.observed)) continue;
    let base: CoverageBase = before ?? { sourceKeys: [], sourceDigests: [], currentKeys: [], outdatedKeys: [], seoIssues: 0, seoTitleHash: null };
    let syncedAt = before?.syncedAt ?? change.observed!.at;
    // A read older than the item's state (a scan page read before a save) never replaces it.
    if (change.observed && (!before || change.observed.at >= before.syncedAt)) {
      base = baseFromShopify(change.observed.data);
      syncedAt = change.observed.at;
    }
    const seenAt =
      options.seen && change.observed && (!before || change.observed.at > before.seenAt) ? change.observed.at : (before?.seenAt ?? syncedAt);
    const overlay = overlays.get(change.resourceGid) ?? { draftKeys: [], reviewKeys: [], failed: false, failureCode: null };
    // Drafts only count for fields that still have the original they were made for.
    const relevant = currentOverlay(base, overlay);
    const derived = deriveStates(resourceType, base, relevant);
    if (before) addDeltas(deltas, before.resourceType, before.fieldStates, -1);
    addDeltas(deltas, resourceType, derived.fieldStates, 1);
    existing.set(change.resourceGid, { ...base, resourceGid: change.resourceGid, resourceType, parentGid: before?.parentGid ?? null, fieldStates: derived.fieldStates, syncedAt, seenAt });
    rows.push({
      resourceType,
      resourceGid: change.resourceGid,
      parentGid: change.parentGid ?? before?.parentGid ?? null,
      sourceKeys: base.sourceKeys,
      sourceDigests: base.sourceDigests,
      currentKeys: base.currentKeys,
      outdatedKeys: base.outdatedKeys,
      draftKeys: relevant.draftKeys,
      reviewKeys: relevant.reviewKeys,
      lastAttemptFailed: relevant.failed,
      failureCode: relevant.failed ? relevant.failureCode : null,
      fieldStates: derived.fieldStates,
      stateComplete: derived.counts.complete,
      stateReview: derived.counts.review,
      stateDraft: derived.counts.draft,
      stateFailed: derived.counts.failed,
      stateOutdated: derived.counts.outdated,
      stateMissing: derived.counts.missing,
      seoIssues: base.seoIssues,
      seoTitleHash: base.seoTitleHash,
      syncedAt: syncedAt.toISOString(),
      seenAt: seenAt.toISOString(),
    });
  }
  if (!rows.length) return 0;
  // The last change for an item wins (a page lists each item once; hooks may repeat one).
  const unique = [...new Map(rows.map((r) => [r.resourceGid as string, r])).values()];
  await tx.$executeRaw`
    INSERT INTO "CoverageItem" (
      "shopId", "locale", "resourceType", "resourceGid", "parentGid", "sourceKeys", "sourceDigests", "currentKeys", "outdatedKeys",
      "draftKeys", "reviewKeys", "lastAttemptFailed", "failureCode", "fieldStates", "stateComplete", "stateReview",
      "stateDraft", "stateFailed", "stateOutdated", "stateMissing", "seoIssues", "seoTitleHash", "syncedAt", "seenAt", "updatedAt"
    )
    SELECT ${shopId}::uuid, ${locale}, x."resourceType", x."resourceGid", x."parentGid", x."sourceKeys", x."sourceDigests", x."currentKeys",
      x."outdatedKeys", x."draftKeys", x."reviewKeys", x."lastAttemptFailed", x."failureCode", x."fieldStates",
      x."stateComplete", x."stateReview", x."stateDraft", x."stateFailed", x."stateOutdated", x."stateMissing",
      x."seoIssues", x."seoTitleHash", x."syncedAt", x."seenAt", now()
    FROM jsonb_to_recordset(${JSON.stringify(unique)}::jsonb) AS x(
      "resourceType" text, "resourceGid" text, "parentGid" text, "sourceKeys" text[], "sourceDigests" text[], "currentKeys" text[],
      "outdatedKeys" text[], "draftKeys" text[], "reviewKeys" text[], "lastAttemptFailed" boolean, "failureCode" text,
      "fieldStates" text[], "stateComplete" integer, "stateReview" integer, "stateDraft" integer, "stateFailed" integer,
      "stateOutdated" integer, "stateMissing" integer, "seoIssues" integer, "seoTitleHash" text,
      "syncedAt" timestamptz, "seenAt" timestamptz
    )
    ON CONFLICT ("shopId", "locale", "resourceGid") DO UPDATE SET
      "resourceType" = EXCLUDED."resourceType", "parentGid" = EXCLUDED."parentGid", "sourceKeys" = EXCLUDED."sourceKeys",
      "sourceDigests" = EXCLUDED."sourceDigests",
      "currentKeys" = EXCLUDED."currentKeys", "outdatedKeys" = EXCLUDED."outdatedKeys", "draftKeys" = EXCLUDED."draftKeys",
      "reviewKeys" = EXCLUDED."reviewKeys", "lastAttemptFailed" = EXCLUDED."lastAttemptFailed",
      "failureCode" = EXCLUDED."failureCode", "fieldStates" = EXCLUDED."fieldStates",
      "stateComplete" = EXCLUDED."stateComplete", "stateReview" = EXCLUDED."stateReview", "stateDraft" = EXCLUDED."stateDraft",
      "stateFailed" = EXCLUDED."stateFailed", "stateOutdated" = EXCLUDED."stateOutdated", "stateMissing" = EXCLUDED."stateMissing",
      "seoIssues" = EXCLUDED."seoIssues", "seoTitleHash" = EXCLUDED."seoTitleHash", "syncedAt" = EXCLUDED."syncedAt",
      "seenAt" = EXCLUDED."seenAt", "updatedAt" = now()`;
  await applyDeltas(tx, shopId, locale, deltas);
  return unique.length;
}

export async function syncCoverage(
  shopId: string,
  locale: string,
  changes: readonly CoverageChange[],
  options: SyncOptions,
  client: PrismaClient = defaultClient,
) {
  if (!changes.length) return 0;
  return withTenant(shopId, (tx) => syncCoverageTx(tx, shopId, locale, changes, options), client);
}

/**
 * Re-reads drafts and job attempts for the given resources (after drafts
 * were saved, approved, rejected or retired, or an item finished). Only
 * existing items change. Never fails the caller: coverage is a view, and the
 * next scan corrects it.
 */
export async function refreshCoverageOverlays(
  shopId: string,
  targets: ReadonlyArray<{ resourceGid: string; locale: string }>,
  client: PrismaClient = defaultClient,
) {
  const byLocale = new Map<string, Set<string>>();
  for (const t of targets) byLocale.set(t.locale, (byLocale.get(t.locale) ?? new Set()).add(t.resourceGid));
  for (const [locale, gids] of byLocale) {
    try {
      await syncCoverage(shopId, locale, [...gids].map((resourceGid) => ({ resourceGid })), { create: false, seen: false }, client);
    } catch (error) {
      logger.warn({ shopId, err: (error as Error).name }, "coverage overlay refresh failed");
    }
  }
}

/**
 * Records what a translation job read from Shopify (the resource and its
 * images and custom fields, with the time the read started): a changed
 * original then shows as outdated, and the job's drafts as drafts, instead
 * of a stale "complete". Only existing items change, and an older read never
 * replaces a newer state; never fails the caller.
 */
export async function noteCoverageRead(
  shopId: string,
  locale: string,
  reads: ReadonlyArray<Pick<TranslatableResourceData, "resourceId" | "content" | "translations">>,
  at: Date,
  client: PrismaClient = defaultClient,
) {
  try {
    await syncCoverage(
      shopId,
      locale,
      reads.map((r) => ({ resourceGid: r.resourceId, observed: { data: { content: r.content, translations: r.translations }, at } })),
      { create: false, seen: false },
      client,
    );
  } catch (error) {
    logger.warn({ shopId, err: (error as Error).name }, "coverage update after a job read failed");
  }
}

/**
 * Records the state right after translations were written or removed: the
 * resource as read before the write, with the written values (or the
 * removal) applied. Only existing items change; never fails the caller.
 */
export async function noteCoverageWrite(
  input: {
    shopId: string;
    locale: string;
    resource: Pick<TranslatableResourceData, "resourceId" | "content" | "translations">;
    written?: ReadonlyArray<{ key: string; value: string }>;
    removed?: readonly string[];
  },
  client: PrismaClient = defaultClient,
) {
  try {
    const written = new Map((input.written ?? []).map((w) => [w.key, w.value]));
    const removed = new Set(input.removed ?? []);
    const translations = input.resource.translations
      .filter((t) => !written.has(t.key) && !removed.has(t.key))
      .concat([...written].map(([key, value]) => ({ key, value, outdated: false, updatedAt: null })));
    await syncCoverage(
      input.shopId,
      input.locale,
      [{ resourceGid: input.resource.resourceId, observed: { data: { content: input.resource.content, translations }, at: new Date() } }],
      { create: false, seen: false },
      client,
    );
  } catch (error) {
    logger.warn({ shopId: input.shopId, err: (error as Error).name }, "coverage update after a write failed");
  }
}

/** Removes items (a resource deleted in Shopify) and their counts. */
export async function dropCoverageItemsTx(tx: TenantTx, shopId: string, locale: string, gids: readonly string[]) {
  if (!gids.length) return;
  await lock(tx, shopId, locale);
  const items = await tx.coverageItem.findMany({
    where: { shopId, locale, resourceGid: { in: [...gids] } },
    select: { resourceType: true, fieldStates: true },
  });
  const deltas = new Map<DeltaKey, number>();
  for (const i of items) addDeltas(deltas, i.resourceType, i.fieldStates, -1);
  await tx.coverageItem.deleteMany({ where: { shopId, locale, resourceGid: { in: [...gids] } } });
  await applyDeltas(tx, shopId, locale, deltas);
}

/**
 * Removes a resource deleted in Shopify in every language, with the custom
 * fields it owns (their parentGid), and their counts. Languages are locked
 * in a fixed order, so two removals never wait on each other. (Images carry
 * no owner yet: the next scan of their type removes them.)
 */
export async function dropDeletedResourceTx(tx: TenantTx, shopId: string, gid: string) {
  const rows = await tx.coverageItem.findMany({
    where: { shopId, OR: [{ resourceGid: gid }, { parentGid: gid }] },
    select: { locale: true, resourceGid: true },
  });
  const byLocale = new Map<string, string[]>();
  for (const r of rows) byLocale.set(r.locale, [...(byLocale.get(r.locale) ?? []), r.resourceGid]);
  for (const locale of [...byLocale.keys()].sort()) await dropCoverageItemsTx(tx, shopId, locale, byLocale.get(locale)!);
  return rows.length;
}

export async function dropDeletedResource(shopId: string, gid: string, client: PrismaClient = defaultClient) {
  return withTenant(shopId, (tx) => dropDeletedResourceTx(tx, shopId, gid), client);
}

/** As dropDeletedResource, for a job that found the resource gone: never fails the caller. */
export async function noteResourceGone(shopId: string, gid: string, client: PrismaClient = defaultClient) {
  try {
    await dropDeletedResource(shopId, gid, client);
  } catch (error) {
    logger.warn({ shopId, err: (error as Error).name }, "coverage removal of a deleted resource failed");
  }
}

/**
 * Removes the items, counts and scan states of every language that is no
 * longer one of the store's additional languages (removed in Shopify, or
 * now the primary language). Returns those languages.
 */
export async function dropOtherLocalesTx(tx: TenantTx, shopId: string, targets: readonly string[]) {
  const rows = await tx.$queryRaw<Array<{ locale: string }>>`
    SELECT "locale" FROM "CoverageSegment" WHERE "shopId" = ${shopId}::uuid AND NOT ("locale" = ANY(${[...targets]}::text[]))
    UNION SELECT "locale" FROM "CoverageCount" WHERE "shopId" = ${shopId}::uuid AND NOT ("locale" = ANY(${[...targets]}::text[]))
    UNION SELECT "locale" FROM "CoverageItem" WHERE "shopId" = ${shopId}::uuid AND NOT ("locale" = ANY(${[...targets]}::text[]))`;
  const locales = rows.map((r) => r.locale).sort();
  for (const locale of locales) {
    await lock(tx, shopId, locale);
    await tx.coverageItem.deleteMany({ where: { shopId, locale } });
    await tx.coverageCount.deleteMany({ where: { shopId, locale } });
    await tx.coverageSegment.deleteMany({ where: { shopId, locale } });
  }
  return locales;
}

/** Removes every item of one language and type, and their counts (the app has no access to the type). */
export async function dropCoverageTypeTx(tx: TenantTx, shopId: string, locale: string, resourceType: string) {
  await lock(tx, shopId, locale);
  await tx.coverageItem.deleteMany({ where: { shopId, locale, resourceType } });
  await tx.coverageCount.deleteMany({ where: { shopId, locale, resourceType } });
}

/** Recomputes the counts of one language and type from its items (after a scan). */
export async function rebuildCountsTx(tx: TenantTx, shopId: string, locale: string, resourceType: string) {
  await lock(tx, shopId, locale);
  await tx.coverageCount.deleteMany({ where: { shopId, locale, resourceType } });
  await tx.$executeRaw`
    INSERT INTO "CoverageCount" ("shopId", "locale", "resourceType", "fieldGroup", "state", "count")
    SELECT ${shopId}::uuid, ${locale}, ${resourceType}, split_part(fs, ':', 1), split_part(fs, ':', 2), count(*)::integer
    FROM "CoverageItem" i, unnest(i."fieldStates") AS fs
    WHERE i."shopId" = ${shopId}::uuid AND i."locale" = ${locale} AND i."resourceType" = ${resourceType}
    GROUP BY 4, 5`;
}

/**
 * Ends a segment's scan: items the scan didn't find (deleted in Shopify) are
 * removed, and the counts are rebuilt from the items.
 */
export async function finishSegmentTx(tx: TenantTx, shopId: string, locale: string, resourceType: string, startedAt: Date) {
  await lock(tx, shopId, locale);
  await tx.coverageItem.deleteMany({ where: { shopId, locale, resourceType, seenAt: { lt: startedAt } } });
  await rebuildCountsTx(tx, shopId, locale, resourceType);
}

export type CountRow = { locale: string; resourceType: string; fieldGroup: string; state: FieldState; count: number };

/** All counts of a shop. */
export async function loadCounts(shopId: string, client: PrismaClient = defaultClient): Promise<CountRow[]> {
  const rows = await withTenant(shopId, (tx) => tx.coverageCount.findMany({ where: { shopId } }), client);
  return rows
    .filter((r) => (FIELD_STATES as readonly string[]).includes(r.state) && r.count > 0)
    .map((r) => ({ locale: r.locale, resourceType: r.resourceType, fieldGroup: r.fieldGroup, state: r.state as FieldState, count: r.count }));
}

