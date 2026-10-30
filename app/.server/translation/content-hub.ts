/**
 * "Everything you can translate", the one place every list opens from:
 * which Shopify content types the shop has, and which need an extra
 * permission (optional access scope). Products and collections come first.
 *
 * - One probe per type (translatableResources, first: 1), six at a time.
 *   A probe Shopify doesn't answer marks only its type "unknown"; auth
 *   redirects and the page's time limit (thrown Responses) still end the
 *   page as before.
 * - The raw probe results are kept for a minute per shop and set of granted
 *   optional scopes (in this process). Statuses are worked out from the
 *   granted scopes on every view, so the permission state is always exact,
 *   and a change of scopes changes the key: the probes run again. A result
 *   with an unknown type isn't kept.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { logger } from "../lib/logger";
import { probeTranslatableType, type ProbeResult } from "../shopify/translations-api";
import { CONTENT_TYPES, kindMeta, type ContentType, type TranslatableKind } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;

/** `unknown`: Shopify didn't answer for the type this time (nothing is known about it). */
export type HubStatus = "has-content" | "empty" | "needs-permission" | "unavailable" | "unknown";

export interface HubEntry {
  type: TranslatableKind;
  label: string;
  path: string;
  group: string;
  status: HubStatus;
  scope: string | null;
  bulk: boolean;
  caution: "legal" | "liquid" | null;
}

/** The types with their own list pages in the app (the catalog first), shown before the other content types. */
const MAIN_ON_HUB: Array<{ type: TranslatableKind; group: string }> = [
  { type: "PRODUCT", group: "Catalog" },
  { type: "COLLECTION", group: "Catalog" },
  { type: "PAGE", group: "Online store" },
  { type: "ARTICLE", group: "Online store" },
  { type: "BLOG", group: "Online store" },
];

/** At most this many probe queries run at once (Admin API rate limit). */
const CONCURRENCY = 6;

/** Probe results are kept this long per shop and set of granted optional scopes. */
export const HUB_CACHE_MS = 60_000;
/** At most this many shops' results are kept (the oldest goes first). */
const HUB_CACHE_MAX = 2000;

const hubCache = new Map<string, { at: number; probes: ReadonlyMap<TranslatableKind, ProbeResult> }>();

/** The cache key: the shop and the optional scopes it granted that decide what a probe may read. */
function cacheKey(shopId: string, granted: readonly string[]) {
  return `${shopId}|${requestableScopes()
    .filter((scope) => granted.includes(scope))
    .join(",")}`;
}

/** Forget the kept probe results: one shop's (before asking for a permission), or all (tests). */
export function clearContentHubCache(shopId?: string) {
  if (shopId === undefined) {
    hubCache.clear();
    return;
  }
  for (const key of [...hubCache.keys()]) if (key.startsWith(`${shopId}|`)) hubCache.delete(key);
}

function hubEntries(): Array<Omit<HubEntry, "status">> {
  return [
    ...MAIN_ON_HUB.map(({ type, group }) => ({ type, group, label: kindMeta(type).label, path: kindMeta(type).path, scope: null, bulk: true, caution: null })),
    ...(Object.entries(CONTENT_TYPES) as Array<[ContentType, (typeof CONTENT_TYPES)[ContentType]]>).map(([type, meta]) => ({
      type,
      group: meta.group,
      label: meta.label,
      path: kindMeta(type).path,
      scope: meta.scope,
      bulk: meta.bulk,
      caution: (meta as { caution?: "legal" | "liquid" }).caution ?? null,
    })),
  ];
}

/** One type's probe; null when Shopify didn't answer it (anything but a thrown Response). */
async function probe(admin: Admin, type: TranslatableKind): Promise<ProbeResult | null> {
  try {
    return await probeTranslatableType(admin, type);
  } catch (error) {
    // Auth redirects and the page's time limit (admin-timeout.ts) stay the page's answer.
    if (error instanceof Response) throw error;
    // The error's name only: a message may quote the store's data.
    logger.warn({ type, err: error instanceof Error ? error.name : typeof error }, "content hub: probe failed");
    return null;
  }
}

/**
 * Every content type with its status. `options.shopId` turns on the cache
 * (HUB_CACHE_MS per shop and granted optional scopes); without it, every
 * call probes.
 */
export async function loadContentHub(admin: Admin, grantedScopes: readonly string[], options: { shopId?: string; now?: number } = {}): Promise<HubEntry[]> {
  const entries = hubEntries();
  const now = options.now ?? Date.now();
  const key = options.shopId === undefined ? null : cacheKey(options.shopId, grantedScopes);
  const cached = key === null ? undefined : hubCache.get(key);
  let probes: ReadonlyMap<TranslatableKind, ProbeResult | null>;
  if (cached && now - cached.at < HUB_CACHE_MS) {
    probes = cached.probes;
  } else {
    const fresh = new Map<TranslatableKind, ProbeResult | null>();
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((entry) => probe(admin, entry.type)));
      batch.forEach((entry, j) => fresh.set(entry.type, results[j] ?? null));
    }
    probes = fresh;
    // A view with an unknown type probes again next time.
    if (key !== null && [...fresh.values()].every((result) => result !== null)) {
      hubCache.delete(key);
      hubCache.set(key, { at: now, probes: fresh as ReadonlyMap<TranslatableKind, ProbeResult> });
      if (hubCache.size > HUB_CACHE_MAX) hubCache.delete(hubCache.keys().next().value!);
    }
  }
  return entries.map((entry): HubEntry => {
    const result = probes.get(entry.type) ?? null;
    if (result === null) return { ...entry, status: "unknown" };
    if (result.status === "available") return { ...entry, status: result.hasItems ? "has-content" : "empty" };
    // Denied: a permission the merchant can grant, or not available to apps here.
    const grantable = entry.scope !== null && !grantedScopes.includes(entry.scope);
    return { ...entry, status: grantable ? "needs-permission" : "unavailable" };
  });
}

/** Optional scopes the content pages may request (never anything else). */
export function requestableScopes(): string[] {
  return [...new Set(Object.values(CONTENT_TYPES).map((m) => m.scope).filter((s): s is NonNullable<typeof s> => s !== null))];
}

/**
 * The optional scopes a form asks for: at least one, every value
 * allow-listed (requestableScopes), duplicates dropped, in the allow-list's
 * order; otherwise null (nothing is requested).
 */
export function scopesToRequest(values: readonly FormDataEntryValue[]): string[] | null {
  const allowed = requestableScopes();
  if (!values.length || values.some((value) => typeof value !== "string" || !allowed.includes(value))) return null;
  return allowed.filter((scope) => values.includes(scope));
}
