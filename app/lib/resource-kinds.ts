/**
 * Shopify resource types Linguva translates, shared by server and UI.
 * GIDs are always built server-side from a numeric id, never taken from
 * the browser.
 */
export const RESOURCE_KINDS = {
  PRODUCT: { gidType: "Product", path: "/app/products", singular: "product", plural: "products", label: "Products" },
  COLLECTION: {
    gidType: "Collection",
    path: "/app/collections",
    singular: "collection",
    plural: "collections",
    label: "Collections",
  },
} as const;

export type ResourceKind = keyof typeof RESOURCE_KINDS;

export function resourceGid(kind: ResourceKind, id: string): string | null {
  return /^\d{1,20}$/.test(id) ? `gid://shopify/${RESOURCE_KINDS[kind].gidType}/${id}` : null;
}

export function numericId(gid: string): string {
  return gid.slice(gid.lastIndexOf("/") + 1);
}

/** Kind of a Shopify GID, or null for types Linguva doesn't edit. */
export function kindOfGid(gid: string): ResourceKind | null {
  const match = /^gid:\/\/shopify\/(\w+)\/\d+$/.exec(gid);
  if (!match) return null;
  for (const [kind, meta] of Object.entries(RESOURCE_KINDS)) {
    if (meta.gidType === match[1]) return kind as ResourceKind;
  }
  return null;
}

/** Editor URL for a resource in the app, or null if it has no editor. */
export function editorPath(gid: string, locale: string): string | null {
  const kind = kindOfGid(gid);
  if (!kind) return null;
  return `${RESOURCE_KINDS[kind].path}/${numericId(gid)}?locale=${encodeURIComponent(locale)}`;
}

/** Short hint for the translation provider, e.g. "Collection: Summer sale". */
export function providerContext(gid: string, title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const kind = kindOfGid(gid);
  return `${kind ? RESOURCE_KINDS[kind].gidType : "Item"}: ${title}`;
}
