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
  PAGE: { gidType: "Page", path: "/app/pages", singular: "page", plural: "pages", label: "Pages" },
  ARTICLE: { gidType: "Article", path: "/app/articles", singular: "blog post", plural: "blog posts", label: "Blog posts" },
  BLOG: { gidType: "Blog", path: "/app/blogs", singular: "blog", plural: "blogs", label: "Blogs" },
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

/** Short hint for the translation provider, e.g. "Collection: Summer sale" or "Menu: Main menu". */
export function providerContext(gid: string, title: string | null | undefined, resourceType?: string | null): string | undefined {
  if (!title) return undefined;
  if (resourceType && isContentType(resourceType)) {
    const singular = CONTENT_TYPES[resourceType].singular;
    return `${singular.charAt(0).toUpperCase()}${singular.slice(1)}: ${title}`;
  }
  const kind = kindOfGid(gid);
  return `${kind ? RESOURCE_KINDS[kind].gidType : "Item"}: ${title}`;
}

/**
 * Every other Shopify translatable resource type (TranslatableResourceType,
 * Admin API 2026-10). They share one list page and one editor under
 * /app/content/<slug>. Their GIDs aren't always numeric (theme resources),
 * so pages address them by an encoded GID (contentRef), validated on the
 * server; Shopify only returns resources of the authenticated shop.
 *
 * `scope`: optional access scope that may be needed (requested on the
 * content page); null when the app's required scopes should suffice or the
 * scope isn't documented (verified on a development store).
 * `bulk`: "Translate all" in background jobs. Theme content, legal policies
 * and notification templates are translated one by one with review.
 */
export const CONTENT_TYPES = {
  SHOP: { slug: "store", label: "Store search listing", singular: "store listing", plural: "store listings", group: "Store", scope: null, bulk: true },
  SHOP_POLICY: { slug: "policies", label: "Policies", singular: "policy", plural: "policies", group: "Store", scope: "read_legal_policies", bulk: false, caution: "legal" },
  MENU: { slug: "menus", label: "Menus", singular: "menu", plural: "menus", group: "Navigation", scope: "read_online_store_navigation", bulk: true },
  LINK: { slug: "menu-links", label: "Menu links", singular: "menu link", plural: "menu links", group: "Navigation", scope: "read_online_store_navigation", bulk: true },
  FILTER: { slug: "filters", label: "Storefront filters", singular: "filter", plural: "filters", group: "Navigation", scope: null, bulk: true },
  PRODUCT_OPTION: { slug: "product-options", label: "Product options", singular: "product option", plural: "product options", group: "Catalog", scope: null, bulk: true },
  PRODUCT_OPTION_VALUE: { slug: "option-values", label: "Option values", singular: "option value", plural: "option values", group: "Catalog", scope: null, bulk: true },
  SELLING_PLAN_GROUP: { slug: "selling-plan-groups", label: "Subscription plan groups", singular: "plan group", plural: "plan groups", group: "Catalog", scope: null, bulk: true },
  SELLING_PLAN: { slug: "selling-plans", label: "Subscription plans", singular: "subscription plan", plural: "subscription plans", group: "Catalog", scope: null, bulk: true },
  METAOBJECT: { slug: "metaobjects", label: "Metaobjects", singular: "metaobject", plural: "metaobjects", group: "Content", scope: "read_metaobjects", bulk: true },
  ONLINE_STORE_THEME: { slug: "theme", label: "Theme content", singular: "theme", plural: "themes", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_LOCALE_CONTENT: { slug: "theme-locale", label: "Theme language files", singular: "language file", plural: "language files", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_JSON_TEMPLATE: { slug: "theme-templates", label: "Theme templates", singular: "template", plural: "templates", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_SECTION_GROUP: { slug: "theme-section-groups", label: "Theme section groups", singular: "section group", plural: "section groups", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: { slug: "theme-settings", label: "Theme settings", singular: "settings category", plural: "settings categories", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: { slug: "theme-static-sections", label: "Theme shared sections", singular: "shared section", plural: "shared sections", group: "Theme", scope: "read_themes", bulk: false },
  ONLINE_STORE_THEME_APP_EMBED: { slug: "theme-app-embeds", label: "Theme app embeds", singular: "app embed", plural: "app embeds", group: "Theme", scope: "read_themes", bulk: false },
  DELIVERY_METHOD_DEFINITION: { slug: "shipping-methods", label: "Shipping methods", singular: "shipping method", plural: "shipping methods", group: "Checkout", scope: "read_shipping", bulk: true },
  PAYMENT_GATEWAY: { slug: "payment-methods", label: "Payment methods", singular: "payment method", plural: "payment methods", group: "Checkout", scope: null, bulk: true },
  EMAIL_TEMPLATE: { slug: "email-templates", label: "Email templates", singular: "email template", plural: "email templates", group: "Notifications", scope: null, bulk: false, caution: "liquid" },
  PACKING_SLIP_TEMPLATE: { slug: "packing-slips", label: "Packing slip", singular: "packing slip", plural: "packing slips", group: "Notifications", scope: null, bulk: false, caution: "liquid" },
} as const satisfies Record<
  string,
  { slug: string; label: string; singular: string; plural: string; group: string; scope: string | null; bulk: boolean; caution?: "legal" | "liquid" }
>;

export type ContentType = keyof typeof CONTENT_TYPES;
export type TranslatableKind = ResourceKind | ContentType;

export function isContentType(value: string): value is ContentType {
  return Object.hasOwn(CONTENT_TYPES, value);
}

export function contentTypeBySlug(slug: string): ContentType | null {
  const entry = Object.entries(CONTENT_TYPES).find(([, meta]) => meta.slug === slug);
  return entry ? (entry[0] as ContentType) : null;
}

/** Label, nouns and list path for any kind. */
export function kindMeta(kind: TranslatableKind) {
  if (isContentType(kind)) {
    const meta = CONTENT_TYPES[kind];
    return { label: meta.label, singular: meta.singular, plural: meta.plural, path: `/app/content/${meta.slug}` };
  }
  const meta = RESOURCE_KINDS[kind];
  return { label: meta.label, singular: meta.singular, plural: meta.plural, path: meta.path };
}

const CONTENT_GID = /^gid:\/\/shopify\/[A-Za-z]{2,60}\/[A-Za-z0-9._~:?=&%/-]{1,300}$/;

/** URL-safe reference to a GID (base64url). */
export function contentRef(gid: string): string {
  const bytes = new TextEncoder().encode(gid);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The GID of a content reference, or null if it isn't a well-formed Shopify GID. */
export function contentGid(ref: string): string | null {
  if (!/^[A-Za-z0-9_-]{8,450}$/.test(ref)) return null;
  try {
    const binary = atob(ref.replace(/-/g, "+").replace(/_/g, "/"));
    const gid = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return CONTENT_GID.test(gid) && !gid.includes("..") ? gid : null;
  } catch {
    return null;
  }
}

/** Editor URL for any resource; content types need their resource type. */
export function editorPathFor(gid: string, locale: string, resourceType?: string | null): string | null {
  if (resourceType && isContentType(resourceType)) {
    return `/app/content/${CONTENT_TYPES[resourceType].slug}/${contentRef(gid)}?locale=${encodeURIComponent(locale)}`;
  }
  return editorPath(gid, locale);
}

/** A readable title for a resource without a "title" field. */
export function resourceTitle(
  kind: TranslatableKind,
  content: ReadonlyArray<{ key: string; value: string | null }>,
): string {
  const byKey = (key: string) => content.find((c) => c.key === key)?.value?.trim();
  const direct = byKey("title") ?? byKey("name") ?? byKey("label");
  if (direct) return direct.length > 80 ? `${direct.slice(0, 80)}…` : direct;
  if (kind === "SHOP") return byKey("meta_title") || "Store";
  const short = content.find((c) => c.value && c.value.trim().length > 0 && c.value.trim().length <= 80 && !/[<{]/.test(c.value));
  if (short?.value) return short.value.trim();
  return `${kindMeta(kind).singular.charAt(0).toUpperCase()}${kindMeta(kind).singular.slice(1)} (${content.length} text${content.length === 1 ? "" : "s"})`;
}

/** Image alt text rows of the coverage report, and the type they belong to. */
export const IMAGE_COVERAGE_TYPES = {
  MEDIA_IMAGE: { label: "Product images (alt text)", parent: "PRODUCT" },
  COLLECTION_IMAGE: { label: "Collection images (alt text)", parent: "COLLECTION" },
  ARTICLE_IMAGE: { label: "Blog post images (alt text)", parent: "ARTICLE" },
} as const satisfies Record<string, { label: string; parent: ResourceKind }>;

export type ImageCoverageType = keyof typeof IMAGE_COVERAGE_TYPES;

export function isImageCoverageType(type: string): type is ImageCoverageType {
  return Object.prototype.hasOwnProperty.call(IMAGE_COVERAGE_TYPES, type);
}

/** Label of a coverage report row type ("Products", "Product images (alt text)"). */
export function coverageTypeLabel(type: string): string {
  if (isImageCoverageType(type)) return IMAGE_COVERAGE_TYPES[type].label;
  return (RESOURCE_KINDS as Record<string, { label: string }>)[type]?.label ?? type;
}
