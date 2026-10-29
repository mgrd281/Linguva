/**
 * A realistic demo catalog (a fictional outdoor store) for the App Store
 * screenshots (tests/ui/app-store-screenshots.spec.ts): real German
 * translations (one outdated, one partial), French drafts waiting in
 * Review (one flagged by the number check) and glossary terms. Not used by
 * the regular UI tests.
 */
import { createHash } from "node:crypto";
import { FakeShopifyStore } from "../../support/fake-store";

const P = (n: number) => `gid://shopify/Product/${n}`;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

interface DemoProduct {
  title: string;
  body: string;
  handle: string;
  metaTitle: string;
  metaDescription: string;
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    title: "Merino Wool Sweater",
    body: "<p>Soft <strong>merino wool</strong> that keeps you warm on cold mornings and comfortable when the sun comes out.</p><ul><li>100% merino wool</li><li>Machine washable at 30 °C</li></ul>",
    handle: "merino-wool-sweater",
    metaTitle: "Merino Wool Sweater – Warm and Breathable",
    metaDescription: "A soft merino sweater for hiking and everyday wear. Warm, breathable and machine washable.",
  },
  {
    title: "Waterproof Hiking Jacket",
    body: "<p>A light, <strong>waterproof</strong> shell with taped seams and a hood that fits over a helmet.</p><ul><li>2 chest pockets</li><li>Packs into its own pocket</li></ul>",
    handle: "waterproof-hiking-jacket",
    metaTitle: "Waterproof Hiking Jacket with Hood",
    metaDescription: "Stay dry on the trail: a light waterproof jacket with taped seams that packs into its own pocket.",
  },
  {
    title: "Trail Running Shoes",
    body: "<p>Grippy soles and a cushioned midsole for long days on rocky trails.</p>",
    handle: "trail-running-shoes",
    metaTitle: "Trail Running Shoes with Grip",
    metaDescription: "Cushioned trail running shoes with a grippy sole for rocky and muddy paths.",
  },
  {
    title: "Insulated Water Bottle",
    body: "<p>Double-walled steel keeps drinks cold for 24 hours or hot for 12 hours.</p>",
    handle: "insulated-water-bottle",
    metaTitle: "Insulated Water Bottle, 750 ml",
    metaDescription: "A 750 ml steel bottle that keeps drinks cold for 24 hours or hot for 12 hours.",
  },
  {
    title: "Wool Beanie",
    body: "<p>A warm beanie knitted from soft wool, with a fleece lining around the ears.</p>",
    handle: "wool-beanie",
    metaTitle: "Warm Wool Beanie",
    metaDescription: "A soft wool beanie with a fleece lining for cold and windy days.",
  },
  {
    title: "Rain Trousers",
    body: "<p>Waterproof trousers with side zips, so you can pull them on over your boots.</p>",
    handle: "rain-trousers",
    metaTitle: "Waterproof Rain Trousers",
    metaDescription: "Waterproof trousers with full-length side zips to pull on over hiking boots.",
  },
  {
    title: "Down Vest",
    body: "<p>A light down vest that adds warmth without bulk under any jacket.</p>",
    handle: "down-vest",
    metaTitle: "Light Down Vest",
    metaDescription: "A light, packable down vest that adds warmth under any jacket.",
  },
  {
    title: "Hiking Socks, 3-Pack",
    body: "<p>Cushioned merino socks that stay dry and don't slip in your boots.</p>",
    handle: "hiking-socks-3-pack",
    metaTitle: "Merino Hiking Socks, 3-Pack",
    metaDescription: "Three pairs of cushioned merino hiking socks that stay dry and don't slip.",
  },
];

const GERMAN: Record<number, Partial<Record<"title" | "body_html" | "handle" | "meta_title" | "meta_description", string>>> = {
  1: {
    title: "Merino-Wollpullover",
    body_html:
      "<p>Weiche <strong>Merinowolle</strong>, die dich an kalten Morgen wärmt und angenehm bleibt, wenn die Sonne herauskommt.</p><ul><li>100 % Merinowolle</li><li>Maschinenwaschbar bei 30 °C</li></ul>",
    handle: "merino-wollpullover",
    meta_title: "Merino-Wollpullover – warm und atmungsaktiv",
    meta_description: "Ein weicher Merinopullover für Wanderungen und den Alltag. Warm, atmungsaktiv und maschinenwaschbar.",
  },
  2: {
    title: "Wasserdichte Wanderjacke",
    body_html: "<p>Eine leichte, <strong>wasserdichte</strong> Jacke mit verschweißten Nähten.</p>",
    handle: "wasserdichte-wanderjacke",
    meta_title: "Wasserdichte Wanderjacke mit Kapuze",
  },
  3: { title: "Trailrunning-Schuhe" },
  5: {
    title: "Wollmütze",
    body_html: "<p>Eine warme Mütze aus weicher Wolle, mit Fleecefutter an den Ohren.</p>",
    handle: "wollmuetze",
    meta_title: "Warme Wollmütze",
    meta_description: "Eine weiche Wollmütze mit Fleecefutter für kalte und windige Tage.",
  },
  7: {
    title: "Daunenweste",
    body_html: "<p>Eine leichte Daunenweste, die unter jeder Jacke wärmt, ohne aufzutragen.</p>",
    handle: "daunenweste",
    meta_title: "Leichte Daunenweste",
    meta_description: "Eine leichte, verstaubare Daunenweste, die unter jeder Jacke wärmt.",
  },
};

export function buildDemoStore(): FakeShopifyStore {
  const store = new FakeShopifyStore(0);
  DEMO_PRODUCTS.forEach((p, i) => {
    const gid = P(i + 1);
    store.products.set(gid, [
      { key: "title", value: p.title, type: "SINGLE_LINE_TEXT_FIELD" },
      { key: "body_html", value: p.body, type: "HTML" },
      { key: "handle", value: p.handle, type: "URI" },
      { key: "meta_title", value: p.metaTitle, type: "SINGLE_LINE_TEXT_FIELD" },
      { key: "meta_description", value: p.metaDescription, type: "MULTI_LINE_TEXT_FIELD" },
    ]);
  });
  for (const [n, fields] of Object.entries(GERMAN)) {
    for (const [key, value] of Object.entries(fields)) store.translate(P(Number(n)), "de", key, value!);
  }
  // The jacket's description changed after it was translated: outdated in German.
  store.updateSource(
    P(2),
    "body_html",
    "<p>A light, <strong>waterproof</strong> shell with taped seams and a hood that fits over a helmet.</p><ul><li>2 chest pockets</li><li>Packs into its own pocket</li><li>New: recycled fabric</li></ul>",
  );
  store.addImage(P(1), "Grey merino wool sweater, front view", "sweater");
  store.addMetafield(P(1), { namespace: "custom", key: "care", type: "multi_line_text_field", value: "Wash at 30 °C on a wool cycle. Dry flat." });
  return store;
}

/** French drafts waiting in Review: real translations, one with a changed number. */
export function demoDrafts() {
  const french: Array<{ n: number; key: "title" | "body_html" | "meta_description"; value: string; issues?: Array<{ code: string }> }> = [
    { n: 4, key: "title", value: "Gourde isotherme" },
    {
      n: 4,
      key: "body_html",
      value: "<p>L'acier à double paroi garde les boissons froides pendant 24 heures ou chaudes pendant 6 heures.</p>",
      issues: [{ code: "NUMBERS_CHANGED" }],
    },
    { n: 6, key: "title", value: "Pantalon de pluie" },
    { n: 6, key: "body_html", value: "<p>Un pantalon imperméable avec zips latéraux, à enfiler par-dessus vos chaussures.</p>" },
    { n: 8, key: "title", value: "Chaussettes de randonnée, lot de 3" },
    { n: 8, key: "meta_description", value: "Trois paires de chaussettes de randonnée en mérinos, rembourrées, qui restent sèches et ne glissent pas." },
  ];
  return french.map((d) => {
    const product = DEMO_PRODUCTS[d.n - 1]!;
    const source = { title: product.title, body_html: product.body, meta_description: product.metaDescription }[d.key];
    return {
      jobId: null,
      resourceGid: P(d.n),
      resourceTitle: product.title,
      locale: "fr",
      key: d.key,
      sourceDigest: digest(source),
      sourceValue: source,
      value: d.value,
      segmentPairs: [],
      issues: d.issues ?? [],
      provider: "deepl",
      currentDigest: "none",
      valueType: d.key === "body_html" ? "HTML" : "SINGLE_LINE_TEXT_FIELD",
    };
  });
}

export const DEMO_GLOSSARY = [
  { rule: "DO_NOT_TRANSLATE" as const, term: "Alpine Demo", translation: null, targetLocale: "", notes: "Brand name" },
  { rule: "DO_NOT_TRANSLATE" as const, term: "Merino", translation: null, targetLocale: "", notes: null },
  { rule: "PREFERRED" as const, term: "trail running", translation: "Trailrunning", targetLocale: "de", notes: null },
  { rule: "PREFERRED" as const, term: "down vest", translation: "doudoune sans manches", targetLocale: "fr", notes: null },
  { rule: "FORBIDDEN" as const, term: "wasserfest", translation: null, targetLocale: "de", notes: "We say \"wasserdicht\"" },
];
