/**
 * The Overview's one next step (app/.server/overview/next-step.ts): the
 * order, and never a step that can't be done here.
 */
import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "../../app/.server/overview/next-step";
import { analyzeCountries, missingLanguages, type MarketCountries } from "../../app/lib/country-coverage";

const fr = { locale: "fr", name: "French", published: true };
const es = { locale: "es", name: "Spanish", published: false };
const row = (l: { locale: string; name: string; published: boolean }, complete: number, total: number, measured = true) => ({ ...l, measured, complete, total });

/** A store that measured French at 100 %, with nothing else to do. */
function input(overrides: Partial<NextStepInput> = {}): NextStepInput {
  return {
    targets: [fr],
    consent: true,
    firstTranslation: { done: true, href: "/app/products?lang=fr" },
    pendingDrafts: 0,
    aiAvailable: true,
    jobsAvailable: true,
    measuredLocales: ["fr"],
    progress: [row(fr, 10, 10)],
    countries: null,
    remainingLocales: 18,
    ...overrides,
  };
}

function countries(markets: MarketCountries[], shop: { primary: string; published: string[]; enabled?: string[] }, percents = new Map<string, number | null>()) {
  const rows = analyzeCountries(markets, shop, percents);
  return { rows, missing: missingLanguages(rows) };
}
const market = (codes: string[], locales: MarketCountries["locales"] = null): MarketCountries => ({
  name: "M",
  status: "ACTIVE",
  countries: codes.map((code) => ({ code, name: code })),
  locales,
});

describe("next step", () => {
  it("starts with a language, then a measurement", () => {
    expect(nextStep(input({ targets: [], progress: [], measuredLocales: [] }))).toEqual({ id: "add-language" });
    expect(nextStep(input({ measuredLocales: [], progress: [row(fr, 0, 0, false)] }))).toEqual({ id: "measure" });
    // A language published after the last measurement brings the measurement back.
    const de = { locale: "de", name: "German", published: true };
    expect(nextStep(input({ targets: [fr, de], progress: [row(fr, 10, 10), row(de, 0, 0, false)] }))).toEqual({ id: "measure" });
    // A hidden language added later doesn't.
    expect(nextStep(input({ targets: [fr, es], progress: [row(fr, 10, 10), row(es, 0, 0, false)] }))).toEqual({ id: "done" });
  });

  it("never offers measuring without background jobs", () => {
    expect(nextStep(input({ jobsAvailable: false, measuredLocales: [], progress: [row(fr, 0, 0, false)] }))).toBeNull();
    // Nor "all caught up" while a published language was never measured.
    const de = { locale: "de", name: "German", published: true };
    expect(nextStep(input({ jobsAvailable: false, targets: [fr, de], progress: [row(fr, 10, 10), row(de, 0, 0, false)] }))).toBeNull();
    expect(nextStep(input({ jobsAvailable: false, measuredLocales: [], progress: [row(fr, 0, 0, false)], pendingDrafts: 2 }))).toEqual({ id: "review", count: 2 });
  });

  it("asks for drafts before consent, consent before the first translation (AI on), and skips both without AI", () => {
    expect(nextStep(input({ pendingDrafts: 3, consent: false }))).toEqual({ id: "review", count: 3 });
    expect(nextStep(input({ consent: false, firstTranslation: { done: false, href: "/x" } }))).toEqual({ id: "consent" });
    expect(nextStep(input({ aiAvailable: false, consent: false, firstTranslation: { done: false, href: "/x" } }))).toEqual({ id: "first-translation", href: "/x" });
    // The measurement still comes first.
    expect(nextStep(input({ pendingDrafts: 3, measuredLocales: [], progress: [row(fr, 0, 0, false)] }))).toEqual({ id: "measure" });
  });

  it("asks to publish a language when none is visible to customers", () => {
    const hidden = { ...fr, published: false };
    expect(nextStep(input({ targets: [hidden], progress: [row(hidden, 10, 10)] }))).toEqual({ id: "publish-language" });
  });

  it("sends to the least translated language: under 50 % before the countries, under 100 % after", () => {
    const de = { locale: "de", name: "German", published: true };
    const markets = countries([market(["CZ"])], { primary: "en", published: ["fr", "de"] });
    expect(nextStep(input({ targets: [fr, de], measuredLocales: ["fr", "de"], progress: [row(fr, 49, 100), row(de, 80, 100)], countries: markets }))).toEqual({
      id: "translate",
      locale: "fr",
      name: "French",
      complete: 49,
      total: 100,
    });
    // 50 %: the countries come first, then the language.
    expect(nextStep(input({ targets: [fr, de], measuredLocales: ["fr", "de"], progress: [row(fr, 50, 100), row(de, 80, 100)], countries: markets }))?.id).toBe("countries");
    expect(nextStep(input({ targets: [fr, de], measuredLocales: ["fr", "de"], progress: [row(fr, 99, 100), row(de, 100, 100)] }))).toMatchObject({ id: "translate", locale: "fr" });
    expect(nextStep(input({ targets: [fr, de], measuredLocales: ["fr", "de"], progress: [row(fr, 100, 100), row(de, 100, 100)] }))).toEqual({ id: "done" });
  });

  it("picks the cheapest fix for countries: offer in the market, then publish, then add", () => {
    const shop = { primary: "en", published: ["fr"], enabled: ["fr", "es"] };
    const all = countries([market(["CZ", "ES"]), market(["FR"], [{ locale: "en", published: true }])], shop);
    // The card counts the countries of the fix it names (France), not every country with a gap.
    expect(nextStep(input({ countries: all }))).toMatchObject({ id: "countries", reason: "not-in-market", locales: [{ locale: "fr", countries: 1 }], countries: 1 });
    const noMarketGap = countries([market(["CZ", "ES"])], shop);
    expect(nextStep(input({ countries: noMarketGap }))).toMatchObject({ id: "countries", reason: "unpublished", locales: [{ locale: "es" }] });
    const onlyAdd = countries([market(["CZ", "HU"])], { primary: "en", published: ["fr"] });
    expect(nextStep(input({ countries: onlyAdd }))).toMatchObject({ id: "countries", reason: "not-added", notAdded: 2, free: 18, locales: [{ locale: "cs" }, { locale: "hu" }] });
  });

  it("never asks to add more languages than Shopify's limit leaves", () => {
    const onlyAdd = countries([market(["CZ", "HU", "EE"])], { primary: "en", published: ["fr"] });
    expect(nextStep(input({ countries: onlyAdd, remainingLocales: 2 }))).toMatchObject({ id: "countries", reason: "not-added", notAdded: 3, free: 2 });
    expect(nextStep(input({ countries: onlyAdd, remainingLocales: 0 }))).toEqual({ id: "done" });
  });

  it("never says all caught up while the measurement skipped some of a published language's content", () => {
    const partial = { ...row(fr, 10, 10), partial: true };
    expect(nextStep(input({ progress: [partial] }))).toEqual({ id: "unread", locale: "fr" });
    // Other steps still come first; a hidden language's skipped content doesn't count.
    expect(nextStep(input({ progress: [{ ...row(fr, 4, 10), partial: true }] }))).toMatchObject({ id: "translate", locale: "fr" });
    expect(nextStep(input({ targets: [fr, es], progress: [row(fr, 10, 10), { ...row(es, 10, 10), partial: true }] }))).toEqual({ id: "done" });
  });

  it("skips countries it can't know about", () => {
    expect(nextStep(input({ countries: null }))).toEqual({ id: "done" });
    expect(nextStep(input({ countries: { rows: [], missing: [] } }))).toEqual({ id: "done" });
  });
});
