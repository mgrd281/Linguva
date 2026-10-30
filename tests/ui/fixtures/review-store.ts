/**
 * The stores of Review's own tests (tests/ui/review.spec.ts), one per
 * project so the desktop and phone runs never decide each other's texts.
 * A finished German job (with the products' pictures and a custom field)
 * fills them; on top come texts that need a particular state: a Google
 * title that is too long, an imported new web address, collections and a
 * page, Spanish with one text whose original changed after it was made
 * (it can't be published any more), and Arabic, which customers can't
 * choose yet. Each test works on its own texts.
 */
import { checkSeoField } from "../../../app/lib/seo";
import { FakeShopifyStore, collectionFields, productFields } from "../../support/fake-store";
import { digest } from "./demo-store";
import type { UiLocale } from "./shops";

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;

export const REVIEW_LOCALES: UiLocale[] = [
  { locale: "en", name: "English", primary: true, published: true },
  { locale: "de", name: "German", primary: false, published: true },
  { locale: "fr", name: "French", primary: false, published: true },
  { locale: "es", name: "Spanish", primary: false, published: true },
  { locale: "ar", name: "Arabic", primary: false, published: false },
];

const SEO_TITLE = "Product 1 jacket – warm, light and waterproof for every day";

export function buildReviewStore(): FakeShopifyStore {
  const store = new FakeShopifyStore(6).addCollections(2).addContent(1);
  store.locales = [...REVIEW_LOCALES];
  store.setField(P(1), "meta_title", SEO_TITLE);
  store.setField(P(1), "meta_description", "A warm, light jacket with two pockets for long walks in wind and rain.", "MULTI_LINE_TEXT_FIELD");
  store.addImage(P(1), "Red wool jacket, front view", "jacket");
  store.addImage(P(2), "Blue sweater, folded", "sweater");
  store.addImage(P(3), "Purple rain trousers", "trousers");
  store.addImage(P(4), "Yellow down vest", "vest");
  store.addMetafield(P(1), { namespace: "custom", key: "material", type: "single_line_text_field", value: "100 % wool", name: "Material" });
  return store;
}

interface Draft {
  gid: string;
  title: string;
  locale: string;
  key: string;
  source: string;
  value: string;
  issues?: unknown[];
  provider?: string;
  /** The original the text was made from, when it differs from the store's (changed since). */
  madeFrom?: string;
  jobId?: string | null;
  valueType?: string;
}

const field = (fields: Array<{ key: string; value: string }>, key: string) => fields.find((f) => f.key === key)!.value;

/** The texts beside the job's (jobId: the German job, for the Google title it replaces). */
export function reviewDrafts(jobId: string) {
  const product = (n: number) => productFields(n);
  const collection = (n: number) => collectionFields(n);
  const seoValue = "Produkt 1 Jacke – warm, leicht und wasserdicht für jeden Tag im Jahr";
  const drafts: Draft[] = [
    // The job's Google title, too long for search results (the browser checks it again while it's edited).
    {
      gid: P(1),
      title: "Product 1 jacket",
      locale: "de",
      key: "meta_title",
      source: SEO_TITLE,
      value: seoValue,
      issues: checkSeoField("meta_title", SEO_TITLE, seoValue),
      provider: "mock",
      jobId,
    },
    // Imported: a new web address (approved one by one, after a question).
    { gid: P(1), title: "Product 1 jacket", locale: "de", key: "handle", source: field(product(1), "handle"), value: "produkt-1-jacke", provider: "csv", valueType: "URI" },
    // Collections: one text looks untranslated.
    { gid: C(1), title: "Collection 1 winter", locale: "de", key: "title", source: field(collection(1), "title"), value: "Kollektion 1 Winter" },
    { gid: C(1), title: "Collection 1 winter", locale: "de", key: "body_html", source: field(collection(1), "body_html"), value: "<p>Unsere <em>Winter</em>-Auswahl, Teil 1.</p>", valueType: "HTML" },
    {
      gid: C(2),
      title: "Collection 2 winter",
      locale: "de",
      key: "title",
      source: field(collection(2), "title"),
      value: field(collection(2), "title"),
      issues: [{ code: "UNTRANSLATED", severity: "warning" }],
    },
    { gid: C(1), title: "Collection 1 winter", locale: "ar", key: "title", source: field(collection(1), "title"), value: "مجموعة الشتاء 1" },
    // A page.
    { gid: "gid://shopify/Page/1", title: "About us 1", locale: "de", key: "title", source: "About us 1", value: "Über uns 1" },
    {
      gid: "gid://shopify/Page/1",
      title: "About us 1",
      locale: "de",
      key: "body_html",
      source: "<p>We make <strong>warm</strong> clothes since 1991.</p>",
      value: "<p>Wir machen <strong>warme</strong> Kleidung seit 1991.</p>",
      valueType: "HTML",
    },
    // Spanish: the description's original changed after this was made (Outdated when approved).
    { gid: P(2), title: "Product 2 jacket", locale: "es", key: "title", source: field(product(2), "title"), value: "Chaqueta producto 2" },
    {
      gid: P(2),
      title: "Product 2 jacket",
      locale: "es",
      key: "body_html",
      source: field(product(2), "body_html"),
      madeFrom: "<p>Warm <b>jacket</b> number 2, old text.</p>",
      value: "<p>Chaqueta <b>cálida</b> número 2.</p>",
      valueType: "HTML",
    },
    // Arabic: customers can't choose it yet (right to left).
    { gid: P(5), title: "Product 5 jacket", locale: "ar", key: "title", source: field(product(5), "title"), value: "سترة المنتج 5" },
    // French: one more language.
    { gid: P(6), title: "Product 6 jacket", locale: "fr", key: "title", source: field(product(6), "title"), value: "Veste produit 6" },
  ];
  return drafts.map((d) => ({
    jobId: d.jobId ?? null,
    resourceGid: d.gid,
    resourceTitle: d.title,
    locale: d.locale,
    key: d.key,
    sourceDigest: digest(d.madeFrom ?? d.source),
    sourceValue: d.madeFrom ?? d.source,
    value: d.value,
    segmentPairs: [],
    issues: d.issues ?? [],
    provider: d.provider ?? "deepl",
    currentDigest: "none",
    valueType: d.valueType ?? "SINGLE_LINE_TEXT_FIELD",
  }));
}

/** The hidden Arabic text of the `full` store (tabs, the hidden marker and right-to-left in the shared tests). */
export function fullArabicDraft() {
  const source = field(productFields(3), "title");
  return {
    jobId: null,
    resourceGid: P(3),
    resourceTitle: "Product 3 jacket",
    locale: "ar",
    key: "title",
    sourceDigest: digest(source),
    sourceValue: source,
    value: "سترة المنتج 3",
    segmentPairs: [],
    issues: [],
    provider: "deepl",
    currentDigest: "none",
    valueType: "SINGLE_LINE_TEXT_FIELD",
  };
}
