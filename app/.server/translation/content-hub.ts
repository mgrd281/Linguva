/**
 * "Everything you can translate": which Shopify content types the shop has,
 * and which need an extra permission (optional access scope).
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { probeTranslatableType } from "../shopify/translations-api";
import { CONTENT_TYPES, kindMeta, type ContentType, type TranslatableKind } from "../../lib/resource-kinds";

type Admin = Pick<AdminApiContext, "graphql">;

export type HubStatus = "has-content" | "empty" | "needs-permission" | "unavailable";

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

/** Storefront pages that have their own pages in the app, shown with the rest. */
const MAIN_ON_HUB: Array<{ type: TranslatableKind; group: string }> = [
  { type: "PAGE", group: "Online store" },
  { type: "ARTICLE", group: "Online store" },
  { type: "BLOG", group: "Online store" },
];

/** At most this many probe queries run at once (Admin API rate limit). */
const CONCURRENCY = 6;

export async function loadContentHub(admin: Admin, grantedScopes: readonly string[]): Promise<HubEntry[]> {
  const entries: Array<Omit<HubEntry, "status">> = [
    ...MAIN_ON_HUB.map(({ type, group }) => ({ type, group, label: kindMeta(type).label, path: kindMeta(type).path, scope: null, bulk: true, caution: null })),
    ...(Object.entries(CONTENT_TYPES) as Array<[ContentType, (typeof CONTENT_TYPES)[ContentType]]>).map(([type, meta]) => ({
      type,
      group: meta.group,
      label: meta.label,
      path: kindMeta(type).path,
      scope: meta.scope,
      bulk: meta.bulk,
      caution: ((meta as { caution?: "legal" | "liquid" }).caution ?? null),
    })),
  ];
  const results: HubEntry[] = [];
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map(async (entry): Promise<HubEntry> => {
          const probe = await probeTranslatableType(admin, entry.type);
          if (probe.status === "available") return { ...entry, status: probe.hasItems ? "has-content" : "empty" };
          // Denied: a permission the merchant can grant, or not available to apps here.
          const grantable = entry.scope !== null && !grantedScopes.includes(entry.scope);
          return { ...entry, status: grantable ? "needs-permission" : "unavailable" };
        }),
      )),
    );
  }
  return results;
}

/** Optional scopes the content pages may request (never anything else). */
export function requestableScopes(): string[] {
  return [...new Set(Object.values(CONTENT_TYPES).map((m) => m.scope).filter((s): s is NonNullable<typeof s> => s !== null))];
}
