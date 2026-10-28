/**
 * The fictional catalog for the next dev-store run, as a file for
 * Shopify's own product import (Products → Import): the products of the
 * App Store screenshots (tests/ui/fixtures/demo-store.ts), tagged
 * linguva-demo so they are easy to find and delete. Columns follow
 * Shopify's product CSV template (help.shopify.com, "Using CSV files to
 * import and export products"); only Title is required for new products.
 *
 * The file in docs/dev-store/ is generated from this and checked by
 * tests/unit/demo-catalog.test.ts:
 *   UPDATE_DEMO_CATALOG=1 pnpm test tests/unit/demo-catalog.test.ts
 */
import { DEMO_PRODUCTS } from "../ui/fixtures/demo-store";
import { toCsv } from "../../app/.server/glossary/csv";

export const DEMO_CATALOG_FILE = "docs/dev-store/demo-catalog-products.csv";
export const DEMO_TAG = "linguva-demo";

const HEADER = ["Title", "URL handle", "Description", "Vendor", "Type", "Tags", "Published on online store", "Status", "SEO title", "SEO description"];
const TYPES = ["Sweaters", "Jackets", "Shoes", "Accessories", "Accessories", "Trousers", "Vests", "Socks"];

export function demoCatalogCsv(): string {
  return toCsv([
    HEADER,
    ...DEMO_PRODUCTS.map((p, i) => [p.title, p.handle, p.body, "Linguva Demo Outdoor", TYPES[i] ?? "Outdoor", DEMO_TAG, "TRUE", "active", p.metaTitle, p.metaDescription]),
  ]);
}
