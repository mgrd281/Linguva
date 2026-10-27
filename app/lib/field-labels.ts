const LABELS: Record<string, string> = {
  title: "Title",
  body_html: "Description",
  summary_html: "Summary",
  handle: "URL handle",
  product_type: "Product type",
  meta_title: "SEO title",
  meta_description: "SEO description",
  name: "Name",
  alt: "Image alt text",
};

/** Human-readable label for a Shopify translatable content key. */
export function fieldLabel(key: string): string {
  return LABELS[key] ?? key.replace(/[_.]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
