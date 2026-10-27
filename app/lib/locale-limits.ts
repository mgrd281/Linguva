// Shopify limits: "Shops are limited to 20 enabled locales" and
// "20 published locales" (docs/SHOPIFY_API_MATRIX.md §2).
// Shared by server code and UI, so it must stay free of server imports.
export const MAX_ENABLED_LOCALES = 20;
export const MAX_PUBLISHED_LOCALES = 20;
