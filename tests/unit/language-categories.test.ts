/**
 * A language's categories and extras (app/lib/language-categories.ts): every
 * coverage type in exactly one of them, figures that add up to the
 * language's percentage, scan states, next steps and the one state of an
 * item in a list.
 */
import { describe, expect, it } from "vitest";
import { COVERAGE_TYPES } from "../../app/.server/coverage/coverage";
import { SUPPORTED_BULK_RESOURCE_TYPES } from "../../app/.server/jobs/bulk-jobs";
import { emptyCounts, FIELD_GROUPS, FIELD_STATES, HEADLINE_EXCLUDED_TYPES, type StateCounts } from "../../app/lib/coverage-rules";
import { headlineByLocale, tally, type CountInput } from "../../app/lib/coverage-view";
import {
  ATTACHED,
  ATTACHED_AREAS,
  attachedOpen,
  bulkTypesOf,
  CATEGORIES,
  CATEGORY_IDS,
  categoryOf,
  categoryPath,
  categoryState,
  categoryTallies,
  contentAccessPath,
  EXTRA_IDS,
  EXTRAS,
  isAttachedPart,
  isCategoryId,
  isUnlockGate,
  ITEM_STATE_OF,
  ITEM_STATES,
  itemState,
  languagePath,
  nextSteps,
  originOf,
  payoffPercent,
  reviewPayoff,
  stepCounts,
  textStates,
  tierOf,
  TIERS,
  UNLOCK_GATES,
  unlockHref,
  withOrigin,
  type AttachedOpen,
  type CategoryId,
  type CategoryState,
  type LanguageStepsInput,
} from "../../app/lib/language-categories";

const figure = (counts: Partial<StateCounts>) => tally({ ...emptyCounts(), ...counts });
/** A step's image descriptions and extra details when it carries none. */
const NONE: AttachedOpen = { images: 0, customFields: 0 };
const row = (locale: string, resourceType: string, fieldGroup: string, state: CountInput["state"], count: number): CountInput => ({
  locale,
  resourceType,
  fieldGroup,
  state,
  count,
});

/** A small deterministic random generator (mulberry32), so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("categories and extras", () => {
  it("come in three tiers, in the order customers meet them", () => {
    expect(TIERS.map((t) => t.id)).toEqual(["first", "beforeBuying", "content"]);
    expect(CATEGORY_IDS).toEqual(["products", "collections", "navigation", "options", "checkout", "customFields", "metaobjects", "pages", "blog", "images"]);
    expect(EXTRA_IDS).toEqual(["theme", "notifications", "urls"]);
    expect(tierOf("options")).toBe("first");
    expect(tierOf("metaobjects")).toBe("beforeBuying");
    expect(tierOf("images")).toBe("content");
    expect(isCategoryId("blog")).toBe(true);
    for (const value of ["urls", "theme", "PRODUCT", "", "constructor"]) expect(isCategoryId(value), value).toBe(false);
  });

  it("hold every coverage type exactly once, and nothing else", () => {
    const listed = [...CATEGORY_IDS.flatMap((id) => CATEGORIES[id].types), ...EXTRAS.theme.types, ...EXTRAS.notifications.types, ...EXTRAS.urls.types];
    for (const type of COVERAGE_TYPES) {
      expect(listed.filter((t) => t === type), type).toHaveLength(1);
      expect(categoryOf(type), type).not.toBeNull();
    }
    expect([...listed].sort()).toEqual([...COVERAGE_TYPES].sort());
    expect(categoryOf("ONLINE_STORE_THEME_JSON_TEMPLATE")).toBe("theme");
    expect(categoryOf("PACKING_SLIP_TEMPLATE")).toBe("notifications");
    expect(categoryOf("SELLING_PLAN")).toBe("checkout");
    expect(categoryOf("MEDIA_IMAGE")).toBe("images");
    expect(categoryOf("NOT_A_TYPE")).toBeNull();
  });

  it("keep the types the percentage leaves out in the extras, and only those", () => {
    expect([...EXTRAS.theme.types, ...EXTRAS.notifications.types].sort()).toEqual(Object.keys(HEADLINE_EXCLUDED_TYPES).sort());
    for (const id of CATEGORY_IDS) {
      for (const type of CATEGORIES[id].types) expect(Object.hasOwn(HEADLINE_EXCLUDED_TYPES, type), type).toBe(false);
      for (const type of CATEGORIES[id].itemTypes) expect(CATEGORIES[id].types as readonly string[], `${id} ${type}`).toContain(type);
    }
  });

  it("start bulk jobs only for types bulk jobs translate: never policies, image alt text or custom fields", () => {
    for (const id of CATEGORY_IDS) {
      const expected = CATEGORIES[id].types.filter((type: string) => (SUPPORTED_BULK_RESOURCE_TYPES as readonly string[]).includes(type));
      expect(bulkTypesOf(id), id).toEqual(expected);
    }
    expect(bulkTypesOf("checkout")).not.toContain("SHOP_POLICY");
    expect(bulkTypesOf("checkout")).toContain("DELIVERY_METHOD_DEFINITION");
    expect(bulkTypesOf("images")).toEqual([]);
    expect(bulkTypesOf("customFields")).toEqual([]);
    expect(bulkTypesOf("blog")).toEqual(["BLOG", "ARTICLE"]);
  });

  it("link to the language page and to a category's list", () => {
    expect(languagePath("da")).toBe("/app/languages/da");
    expect(languagePath("pt-BR")).toBe("/app/languages/pt-BR");
    expect(categoryPath("da", "customFields")).toBe("/app/languages/da/customFields");
  });

  it("keep where a page was opened from: Content, or nothing (the Overview's trail)", () => {
    expect(originOf("content")).toBe("content");
    for (const value of [null, undefined, "", "overview", "CONTENT", "content "]) expect(originOf(value), String(value)).toBeNull();
    expect(withOrigin("/app/languages/de", "content")).toBe("/app/languages/de?from=content");
    expect(withOrigin("/app/languages/de/products?state=missing", "content")).toBe("/app/languages/de/products?state=missing&from=content");
    expect(withOrigin("/app/content?lang=de#content-access", "content")).toBe("/app/content?lang=de&from=content#content-access");
    expect(withOrigin("/app/languages/de", null)).toBe("/app/languages/de");
  });

  it("give every area its own icon square: no two areas of a tier share a tint, image descriptions and extra details take their products' blue", () => {
    for (const tier of TIERS) {
      const tints = tier.categories.map((id) => CATEGORIES[id].tint);
      expect(new Set(tints).size, tier.id).toBe(tints.length);
    }
    expect(CATEGORIES.images.tint).toBe(CATEGORIES.products.tint);
    expect(CATEGORIES.customFields.tint).toBe(CATEGORIES.products.tint);
    // Shopify's own pictures: alt text and metaobjects.
    expect(CATEGORIES.images.icon).toBe("image-alt");
    expect(CATEGORIES.metaobjects.icon).toBe("metaobject");
  });

  it("translate image descriptions and extra details with their owners: every one of their types belongs to exactly one owner", () => {
    expect(ATTACHED_AREAS).toEqual(["products", "collections", "pages", "blog"]);
    const owned = ATTACHED_AREAS.flatMap((area) => [...ATTACHED[area].images, ...ATTACHED[area].customFields]);
    expect([...owned].sort()).toEqual([...CATEGORIES.images.types, ...CATEGORIES.customFields.types].sort());
    expect(new Set(owned).size).toBe(owned.length);
    expect(isAttachedPart("images")).toBe(true);
    expect(isAttachedPart("customFields")).toBe(true);
    for (const id of CATEGORY_IDS.filter((c) => c !== "images" && c !== "customFields")) expect(isAttachedPart(id), id).toBe(false);
  });
});

describe("image descriptions and extra details waiting with their owners", () => {
  it("count each owner's open texts of them in a language: missing, outdated and failed, never URL handles", () => {
    const rows = [
      row("da", "MEDIA_IMAGE", "alt", "missing", 3),
      row("da", "MEDIA_IMAGE", "alt", "outdated", 1),
      row("da", "MEDIA_IMAGE", "alt", "complete", 9),
      row("da", "MEDIA_IMAGE", "alt", "draft", 2),
      row("da", "PRODUCT_METAFIELD", "value", "failed", 2),
      row("da", "COLLECTION_IMAGE", "alt", "missing", 4),
      row("da", "ARTICLE_METAFIELD", "value", "missing", 5),
      row("da", "PAGE_METAFIELD", "url", "missing", 7),
      row("da", "PRODUCT", "title", "missing", 40),
      row("fr", "MEDIA_IMAGE", "alt", "missing", 50),
    ];
    expect(attachedOpen(rows, "da")).toEqual({
      products: { images: 4, customFields: 2 },
      collections: { images: 4, customFields: 0 },
      pages: { images: 0, customFields: 0 },
      blog: { images: 0, customFields: 5 },
    });
    expect(attachedOpen([], "da").products).toEqual(NONE);
  });
});

describe("figures per category", () => {
  it("count what the percentage counts; the extras count theme texts, notifications and URL handles", () => {
    const rows = [
      row("da", "PRODUCT", "title", "complete", 30),
      row("da", "PRODUCT", "description", "missing", 10),
      row("da", "PRODUCT", "url", "missing", 40),
      row("da", "MEDIA_IMAGE", "alt", "draft", 5),
      row("da", "PRODUCT_METAFIELD", "value", "outdated", 4),
      row("da", "SHOP_POLICY", "description", "complete", 2),
      row("da", "ONLINE_STORE_THEME_LOCALE_CONTENT", "other", "missing", 900),
      row("da", "EMAIL_TEMPLATE", "other", "complete", 3),
      row("da", "PAGE", "url", "complete", 6),
      row("fr", "PRODUCT", "title", "complete", 99),
    ];
    const da = categoryTallies(rows, "da");
    expect(da.products).toMatchObject({ total: 40, complete: 30, percent: 75 });
    expect(da.images).toMatchObject({ total: 5, complete: 0, percent: 0 });
    expect(da.images.counts.draft).toBe(5);
    expect(da.customFields.counts.outdated).toBe(4);
    expect(da.checkout).toMatchObject({ total: 2, percent: 100 });
    expect(da.collections).toMatchObject({ total: 0, percent: null });
    expect(da.theme).toMatchObject({ total: 900, complete: 0 });
    expect(da.notifications).toMatchObject({ total: 3, complete: 3 });
    expect(da.urls).toMatchObject({ total: 46, complete: 6 });
    expect(headlineByLocale(rows).get("da")).toMatchObject({ total: 51, complete: 32 });
  });

  it("add up to the language's percentage, state by state, for any counts", () => {
    const next = random(20261029);
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
    for (let round = 0; round < 300; round++) {
      const rows = Array.from({ length: 1 + Math.floor(next() * 60) }, () =>
        row(pick(["da", "fr"]), pick(COVERAGE_TYPES), pick(FIELD_GROUPS), pick(FIELD_STATES), Math.floor(next() * 1000)),
      );
      const headline = headlineByLocale(rows);
      for (const locale of ["da", "fr"]) {
        const areas = categoryTallies(rows, locale);
        const language = headline.get(locale) ?? figure({});
        for (const state of FIELD_STATES) {
          expect(CATEGORY_IDS.reduce((n, id) => n + areas[id].counts[state], 0), `${round} ${locale} ${state}`).toBe(language.counts[state]);
        }
        expect(CATEGORY_IDS.reduce((n, id) => n + areas[id].complete, 0)).toBe(language.complete);
        expect(CATEGORY_IDS.reduce((n, id) => n + areas[id].total, 0)).toBe(language.total);
        // With the extras, every field of the language is counted once.
        const all = rows.filter((r) => r.locale === locale).reduce((n, r) => n + r.count, 0);
        expect([...CATEGORY_IDS, ...EXTRA_IDS].reduce((n, id) => n + areas[id].total, 0)).toBe(all);
      }
    }
  });
});

describe("a category's state", () => {
  const seg = (resourceType: string, status: string, extra: { locale?: string; ahead?: boolean } = {}) => ({
    locale: extra.locale ?? "da",
    resourceType,
    status,
    ...(extra.ahead === undefined ? {} : { ahead: extra.ahead }),
  });
  const read = (types: readonly string[]) => types.map((t) => seg(t, "SCANNED"));
  const idle = { scanning: false };

  it("is ok when every type of it was read", () => {
    expect(categoryState(read(CATEGORIES.navigation.types), "da", "navigation", idle)).toEqual({ kind: "ok" });
    // Other languages' rows don't count.
    expect(categoryState([...read(CATEGORIES.navigation.types), seg("MENU", "FAILED", { locale: "fr" })], "da", "navigation", idle)).toEqual({ kind: "ok" });
  });

  it("says when Linguva may not read a type, and leads to the Content card that asks for every permission at once", () => {
    const checkout = [...read(CATEGORIES.checkout.types.filter((t: string) => t !== "SHOP_POLICY")), seg("SHOP_POLICY", "DENIED")];
    expect(categoryState(checkout, "da", "checkout", idle)).toEqual({ kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content?lang=da#content-access" });
    const menus = [seg("MENU", "DENIED"), seg("LINK", "DENIED"), seg("FILTER", "SCANNING")];
    expect(categoryState(menus, "da", "navigation", { scanning: true })).toEqual({ kind: "no-access", types: ["MENU", "LINK"], href: "/app/content?lang=da#content-access" });
    expect(categoryState([seg("ONLINE_STORE_THEME", "DENIED", { locale: "pt-BR" })], "pt-BR", "theme", idle)).toMatchObject({ kind: "no-access", href: "/app/content?lang=pt-BR#content-access" });
    // Nothing the merchant can allow: no way to "allow" it.
    expect(categoryState([seg("PRODUCT", "DENIED")], "da", "products", idle)).toEqual({ kind: "no-access", types: ["PRODUCT"], href: null });
    expect(categoryState([...read(["SHOP", "SHOP_POLICY", "DELIVERY_METHOD_DEFINITION", "SELLING_PLAN_GROUP", "SELLING_PLAN"]), seg("PAYMENT_GATEWAY", "DENIED")], "da", "checkout", idle)).toEqual({
      kind: "no-access",
      types: ["PAYMENT_GATEWAY"],
      href: null,
    });
    expect(contentAccessPath("pt-BR")).toBe("/app/content?lang=pt-BR#content-access");
  });

  it("is being counted while a measurement reads it, and incomplete when none will", () => {
    expect(categoryState([seg("PRODUCT", "SCANNING")], "da", "products", { scanning: true })).toEqual({ kind: "counting" });
    // Left half read by a measurement that stopped.
    expect(categoryState([seg("PRODUCT", "SCANNING")], "da", "products", idle)).toEqual({ kind: "incomplete" });
    expect(categoryState([seg("PRODUCT", "FAILED")], "da", "products", idle)).toEqual({ kind: "incomplete" });
    // Skipped earlier: the measurement under way reads it again only while it is still ahead of it.
    expect(categoryState([seg("PRODUCT", "FAILED", { ahead: true })], "da", "products", { scanning: true })).toEqual({ kind: "counting" });
    expect(categoryState([seg("PRODUCT", "FAILED", { ahead: false })], "da", "products", { scanning: true })).toEqual({ kind: "incomplete" });
    // Not read yet: by the measurement under way, or never (a type the last one didn't have).
    expect(categoryState([seg("BLOG", "SCANNED")], "da", "blog", { scanning: true })).toEqual({ kind: "counting" });
    expect(categoryState([seg("BLOG", "SCANNED")], "da", "blog", idle)).toEqual({ kind: "incomplete" });
    expect(categoryState([], "da", "blog", idle)).toEqual({ kind: "incomplete" });
  });
});

describe("figures for the three steps and the payoff of approving", () => {
  it("splits texts into to translate, waiting for approval and live", () => {
    expect(stepCounts({ complete: 211, review: 6, draft: 30, failed: 3, outdated: 16, missing: 454 })).toEqual({ open: 473, waiting: 36, live: 211 });
  });

  it("rounds the percentage after approving down, like the percentage", () => {
    const danish = figure({ complete: 211, review: 6, draft: 30, failed: 3, outdated: 16, missing: 454 });
    expect(danish.percent).toBe(29);
    expect(payoffPercent(danish)).toBe(34);
    expect(reviewPayoff(danish)).toBe(34);
    expect(payoffPercent(figure({ complete: 1, draft: 2 }))).toBe(100);
    expect(payoffPercent(figure({ complete: 1, draft: 1, missing: 1 }))).toBe(66);
    expect(payoffPercent(figure({}))).toBeNull();
  });

  it("names the payoff only when drafts wait and approving gains at least a point", () => {
    expect(reviewPayoff(figure({ complete: 50, missing: 50 }))).toBeNull();
    // 29.0 % → 29.1 %: nothing worth promising.
    expect(reviewPayoff(figure({ complete: 290, draft: 1, missing: 709 }))).toBeNull();
    expect(reviewPayoff(figure({ complete: 290, review: 10, missing: 700 }))).toBe(30);
  });
});

describe("next steps for a language", () => {
  const input = (options: {
    headline: Partial<StateCounts>;
    categories?: Partial<Record<CategoryId, Partial<StateCounts>>>;
    states?: Partial<Record<CategoryId, CategoryState>>;
    bulk?: CategoryId[];
    measured?: boolean;
    canCount?: boolean;
    attached?: Partial<Record<CategoryId, Partial<AttachedOpen>>>;
    unlock?: LanguageStepsInput["unlock"];
  }): LanguageStepsInput => ({
    locale: "da",
    measured: options.measured ?? true,
    canCount: options.canCount ?? true,
    headline: figure(options.headline),
    categories: CATEGORY_IDS.map((id) => ({
      id,
      tally: figure(options.categories?.[id] ?? {}),
      state: options.states?.[id] ?? { kind: "ok" },
      bulk: (options.bulk ?? [...CATEGORY_IDS]).includes(id),
      ...(options.attached?.[id] ? { attached: { ...NONE, ...options.attached[id] } } : {}),
    })),
    ...(options.unlock ? { unlock: options.unlock } : {}),
  });

  it("counts a language first", () => {
    expect(nextSteps(input({ headline: { draft: 5 }, measured: false }))).toEqual([{ kind: "count" }]);
    // Without background jobs (or with a measurement under way) there is nothing to do here yet.
    expect(nextSteps(input({ headline: {}, measured: false, canCount: false }))).toEqual([]);
  });

  it("asks to approve drafts first, with the payoff, then the biggest gaps of the first tier", () => {
    const steps = nextSteps(
      input({
        headline: { complete: 211, review: 6, draft: 30, failed: 3, outdated: 16, missing: 454 },
        categories: {
          products: { complete: 74, draft: 18, outdated: 4, failed: 2, missing: 58 },
          navigation: { complete: 40, missing: 12 },
          collections: { complete: 18, outdated: 1, missing: 9 },
          checkout: { complete: 9, missing: 300 },
          images: { complete: 17, missing: 70 },
        },
      }),
    );
    expect(steps).toEqual([
      { kind: "review", count: 36, payoff: 34, href: "/app/review?lang=da" },
      { kind: "category", category: "products", missing: 58, outdated: 4, failed: 2, attached: NONE, action: "translate", href: "/app/languages/da/products" },
      { kind: "category", category: "navigation", missing: 12, outdated: 0, failed: 0, attached: NONE, action: "translate", href: "/app/languages/da/navigation" },
    ]);
  });

  it("without drafts, gives the first step to the categories, and offers a list where bulk isn't possible", () => {
    const steps = nextSteps(
      input({
        headline: { complete: 10, missing: 120 },
        categories: { pages: { missing: 5 }, customFields: { missing: 100 }, options: { missing: 10 }, images: { missing: 5 } },
        bulk: ["options", "pages"],
      }),
    );
    expect(steps.map((s) => (s.kind === "category" ? [s.category, s.action] : s.kind))).toEqual([
      ["options", "translate"],
      ["customFields", "view"],
      // Equal gaps keep the categories' order.
      ["pages", "translate"],
    ]);
  });

  it("then content that wasn't read, so it never says done over it", () => {
    const steps = nextSteps(
      input({
        headline: { complete: 90, missing: 10 },
        categories: { products: { complete: 90, missing: 10 } },
        states: {
          navigation: { kind: "no-access", types: ["MENU", "LINK"], href: "/app/content?lang=da#content-access" },
          checkout: { kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content?lang=da#content-access" },
          blog: { kind: "incomplete" },
        },
      }),
    );
    expect(steps).toEqual([
      { kind: "category", category: "products", missing: 10, outdated: 0, failed: 0, attached: NONE, action: "translate", href: "/app/languages/da/products" },
      { kind: "recount", categories: ["blog"] },
      { kind: "access", categories: ["navigation", "checkout"], href: "/app/content?lang=da#content-access" },
    ]);
    // Counting again needs background jobs and no measurement under way.
    const noJobs = nextSteps(input({ headline: { complete: 100 }, states: { blog: { kind: "incomplete" } }, canCount: false }));
    expect(noJobs).toEqual([]);
  });

  it("says done only when everything was read and every text is live", () => {
    expect(nextSteps(input({ headline: { complete: 100 } }))).toEqual([{ kind: "done" }]);
    expect(nextSteps(input({ headline: { complete: 100 }, states: { pages: { kind: "counting" } } }))).toEqual([]);
    // A count under way reads the language again: types it hasn't reached yet show their last read.
    expect(nextSteps({ ...input({ headline: { complete: 100 } }), scanning: true })).toEqual([]);
    expect(nextSteps(input({ headline: { complete: 100 }, states: { images: { kind: "no-access", types: ["MEDIA_IMAGE"], href: null } } }))).toEqual([
      { kind: "access", categories: ["images"], href: null },
    ]);
    // Nothing to translate at all is not "done" either.
    expect(nextSteps(input({ headline: {} }))).toEqual([]);
  });

  it("never lists more than three steps", () => {
    const categories = Object.fromEntries(CATEGORY_IDS.map((id, i) => [id, { missing: i + 1 }]));
    expect(nextSteps(input({ headline: { draft: 1, missing: 55 }, categories }))).toHaveLength(3);
    expect(nextSteps(input({ headline: { missing: 55 }, categories }))).toHaveLength(3);
    expect(nextSteps(input({ headline: { draft: 1, missing: 55 }, categories, unlock: "PLAN_BULK" }))).toHaveLength(3);
  });

  it("gives image descriptions and extra details no step of their own while their owner has one: the owner's step names them", () => {
    const steps = nextSteps(
      input({
        headline: { complete: 10, missing: 40 },
        categories: { products: { missing: 12 }, images: { missing: 3 }, customFields: { missing: 2, outdated: 1 } },
        attached: { products: { images: 3, customFields: 3 } },
      }),
    );
    expect(steps).toEqual([
      { kind: "category", category: "products", missing: 12, outdated: 0, failed: 0, attached: { images: 3, customFields: 3 }, action: "translate", href: "/app/languages/da/products" },
    ]);
    // Without the owner's step (its own texts are done), they keep theirs: a list to translate them one by one.
    const alone = nextSteps(
      input({
        headline: { complete: 10, missing: 5 },
        categories: { products: { complete: 10 }, images: { missing: 3 }, customFields: { missing: 2 } },
        attached: { products: { images: 3, customFields: 2 } },
        bulk: ["products"],
      }),
    );
    expect(alone.map((s) => (s.kind === "category" ? [s.category, s.action, s.attached] : s.kind))).toEqual([
      ["customFields", "view", NONE],
      ["images", "view", NONE],
    ]);
    // Only what no owner's step carries gets a step: a blog's image when only the products have a step.
    const partly = nextSteps(
      input({
        headline: { missing: 20 },
        categories: { products: { missing: 12 }, images: { missing: 4 } },
        attached: { products: { images: 3 }, blog: { images: 1 } },
      }),
    );
    expect(partly.map((s) => (s.kind === "category" ? s.category : s.kind))).toEqual(["products", "images"]);
  });

  it("ranks an owner within its tier with the image descriptions and extra details it carries", () => {
    const steps = nextSteps(
      input({
        headline: { missing: 30 },
        categories: { products: { missing: 5 }, collections: { missing: 8 }, images: { missing: 6 } },
        attached: { products: { images: 6 } },
      }),
    );
    expect(steps.map((s) => (s.kind === "category" ? s.category : s.kind))).toEqual(["products", "collections"]);
  });

  it("puts what keeps translating from starting right after approving, with the place that lifts it", () => {
    const steps = nextSteps(input({ headline: { draft: 2, missing: 10 }, categories: { products: { missing: 10 } }, bulk: [], unlock: "CONSENT_REQUIRED" }));
    expect(steps).toEqual([
      { kind: "review", count: 2, payoff: reviewPayoff(figure({ draft: 2, missing: 10 })), href: "/app/review?lang=da" },
      { kind: "unlock", gate: "CONSENT_REQUIRED", href: "/app/settings?section=ai" },
      { kind: "category", category: "products", missing: 10, outdated: 0, failed: 0, attached: NONE, action: "view", href: "/app/languages/da/products" },
    ]);
    // A new store without the permission: it is the first step, so its button is the page's primary one.
    expect(nextSteps(input({ headline: { missing: 10 }, categories: { products: { missing: 10 } }, bulk: [], unlock: "PLAN_BULK" }))[0]).toEqual({
      kind: "unlock",
      gate: "PLAN_BULK",
      href: "/app/plan",
    });
    // Not counted yet: counting comes first, whatever keeps translating.
    expect(nextSteps(input({ headline: {}, measured: false, unlock: "CONSENT_REQUIRED" }))).toEqual([{ kind: "count" }]);
  });

  it("knows which gates the merchant can lift, and where", () => {
    expect(UNLOCK_GATES.map((gate) => [gate, unlockHref(gate)])).toEqual([
      ["CONSENT_REQUIRED", "/app/settings?section=ai"],
      ["ENGINE_CONSENT", "/app/settings?section=ai"],
      ["OWN_KEY_MISSING", "/app/settings?section=keys"],
      ["OWN_KEY_REFUSED", "/app/settings?section=keys"],
      ["PLAN_BULK", "/app/plan"],
      ["PLAN_LANGUAGE", "/app/plan"],
    ]);
    // The app's own setup isn't the merchant's to fix.
    for (const code of ["JOBS_UNAVAILABLE", "AI_NOT_CONFIGURED", "", null, undefined]) expect(isUnlockGate(code), String(code)).toBe(false);
  });
});

describe("an item's state in lists", () => {
  it("ranks open work first: failed, outdated, missing, waiting, complete", () => {
    expect(ITEM_STATES).toEqual(["failed", "outdated", "missing", "waiting", "complete"]);
    expect(FIELD_STATES.map((s) => ITEM_STATE_OF[s])).toEqual(["complete", "waiting", "waiting", "failed", "outdated", "missing"]);
    expect(itemState(["title:failed", "description:outdated"])).toBe("failed");
    expect(itemState(["title:outdated", "description:missing"])).toBe("outdated");
    expect(itemState(["title:draft", "description:missing"])).toBe("missing");
    expect(itemState(["title:review", "description:complete"])).toBe("waiting");
    expect(itemState(["title:complete", "description:complete"])).toBe("complete");
  });

  it("leaves URL handles out, like the percentage", () => {
    expect(itemState(["title:complete", "url:missing"])).toBe("complete");
    expect(itemState(["url:missing"])).toBeNull();
    expect(itemState([])).toBeNull();
  });

  it("gives each text its worst field, in the field groups' order, and skips what it can't read", () => {
    expect(textStates(["seo_title:draft", "description:complete", "url:missing", "title:complete", "description:missing", "bogus", "title:unknown", "nogroup:complete"])).toEqual([
      { group: "title", state: "complete" },
      { group: "description", state: "missing" },
      { group: "seo_title", state: "waiting" },
    ]);
  });
});
