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
  bulkTypesOf,
  CATEGORIES,
  CATEGORY_IDS,
  categoryOf,
  categoryPath,
  categoryState,
  categoryTallies,
  EXTRA_IDS,
  EXTRAS,
  isCategoryId,
  ITEM_STATE_OF,
  ITEM_STATES,
  itemState,
  languagePath,
  nextSteps,
  payoffPercent,
  reviewPayoff,
  stepCounts,
  textStates,
  tierOf,
  TIERS,
  type CategoryId,
  type CategoryState,
  type LanguageStepsInput,
} from "../../app/lib/language-categories";

const figure = (counts: Partial<StateCounts>) => tally({ ...emptyCounts(), ...counts });
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

  it("says when Linguva may not read a type, and where to allow it", () => {
    const checkout = [...read(CATEGORIES.checkout.types.filter((t: string) => t !== "SHOP_POLICY")), seg("SHOP_POLICY", "DENIED")];
    expect(categoryState(checkout, "da", "checkout", idle)).toEqual({ kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content/policies" });
    const menus = [seg("MENU", "DENIED"), seg("LINK", "DENIED"), seg("FILTER", "SCANNING")];
    expect(categoryState(menus, "da", "navigation", { scanning: true })).toEqual({ kind: "no-access", types: ["MENU", "LINK"], href: "/app/content/menus" });
    // Types without a permission page of their own.
    expect(categoryState([seg("PRODUCT", "DENIED")], "da", "products", idle)).toEqual({ kind: "no-access", types: ["PRODUCT"], href: null });
    expect(categoryState([seg("ONLINE_STORE_THEME", "DENIED")], "da", "theme", idle)).toMatchObject({ kind: "no-access", href: "/app/content/theme" });
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
    })),
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
      { kind: "category", category: "products", missing: 58, outdated: 4, failed: 2, action: "translate", href: "/app/languages/da/products" },
      { kind: "category", category: "navigation", missing: 12, outdated: 0, failed: 0, action: "translate", href: "/app/languages/da/navigation" },
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
          navigation: { kind: "no-access", types: ["MENU", "LINK"], href: "/app/content/menus" },
          checkout: { kind: "no-access", types: ["SHOP_POLICY"], href: "/app/content/policies" },
          blog: { kind: "incomplete" },
        },
      }),
    );
    expect(steps).toEqual([
      { kind: "category", category: "products", missing: 10, outdated: 0, failed: 0, action: "translate", href: "/app/languages/da/products" },
      { kind: "recount", categories: ["blog"] },
      { kind: "access", categories: ["navigation", "checkout"], href: "/app/content/menus" },
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
