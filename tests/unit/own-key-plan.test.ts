/**
 * The Own key plan on the Plan page and the Overview (app/lib/plan-view.ts,
 * plan-features.ts, components/plan/*, next-step.ts, TranslateConfirm),
 * rendered on the server like plan-components.test.ts: "Own key" for every
 * handle, its hero (sign, lines, "Add your key" first while no key works),
 * its card under the four (only when shown: the four-card page is unchanged
 * otherwise), the table's note, its question, the own-key downgrade
 * sentence, the hero's usage through the keys, the Overview's step, and
 * the translate dialog's cost sentence, in all four languages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "../../app/.server/overview/next-step";
import { PlanCards } from "../../app/components/plan/PlanCards";
import { PlanFaq } from "../../app/components/plan/PlanFaq";
import { PlanFeatureTable } from "../../app/components/plan/PlanFeatureTable";
import { PlanHero, type PlanHeroProps } from "../../app/components/plan/PlanHero";
import { TranslateConfirm } from "../../app/components/TranslateConfirm";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { FEATURE_ICON, OWN_KEY_ICON, PLAN_ICON, STATE_ICON } from "../../app/lib/plan-features";
import { formatUsd } from "../../app/lib/plan-prices";
import { planName, planView, usableEngines, type OwnKeyPlanView, type PlanViewInput } from "../../app/lib/plan-view";
import { OWN_KEY_HANDLES, OWN_KEY_PLAN, OWN_KEY_PRICE, TRIAL_AI_CHARS, TRIAL_DAYS } from "../../app/lib/plans";

const NOW = "2026-10-30T09:12:00.000Z";
const URL = "https://admin.shopify.com/store/shop/charges/linguva/pricing_plans";
const sub = (planHandle: string | null, extra: Partial<NonNullable<PlanViewInput["subscription"]>> = {}) => ({
  planHandle,
  pendingPlanHandle: null,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: null,
  checkedAt: NOW,
  ...extra,
});
const active = (planHandle: string, extra: Partial<PlanViewInput> = {}, subscription: Partial<NonNullable<PlanViewInput["subscription"]>> = {}): PlanViewInput => ({
  configured: true,
  state: "ACTIVE",
  stale: false,
  subscription: sub(planHandle, subscription),
  choosePlanUrl: URL,
  now: NOW,
  ...extra,
});
const OWN_PLAN: OwnKeyPlanView = { visible: true, current: false, pending: false, choosePlanUrl: URL, price: OWN_KEY_PRICE };

/** Markup as text: tags dropped, entities, no-break spaces and German no-break hyphens normalised. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u2011/g, "-")
    .replace(/[\u00A0\u202F\s]+/g, " ");

function cards(locale: AppLocale, input: PlanViewInput, ownKeyPlan: OwnKeyPlanView | null) {
  return renderToStaticMarkup(
    createElement(PlanCards, { i18n: translator(locale), hero: planView(input), now: NOW, intro: "plan.compare.intro", choosePlanUrl: URL, trial: false, recommendation: null, use: null, ownKeyPlan }),
  );
}

describe("the plan's name and sign", () => {
  it("is 'Own key' for every Own key handle; other handles keep their names", () => {
    for (const handle of OWN_KEY_HANDLES) expect(planName(handle)).toBe("Own key");
    expect(planName("pro")).toBe("Pro");
    expect(planName("Own-Key")).toBe("Own-Key");
  });

  it("has a sign of its own: no feature's, no other plan's, not the complimentary key", () => {
    expect(OWN_KEY_ICON).toBe("connect");
    expect(Object.values(FEATURE_ICON)).not.toContain(OWN_KEY_ICON);
    expect(Object.values(PLAN_ICON)).not.toContain(OWN_KEY_ICON);
    expect(OWN_KEY_ICON).not.toBe(STATE_ICON.complimentary);
  });
});

describe("the hero on Own key", () => {
  it("without a usable key: 'Add your key' first, changing the plan beside it, and the missing line", () => {
    const hero = planView(active("own-key", { ownKeys: { engines: [] } }));
    expect(hero).toMatchObject({ kind: "active", current: "own-key", icon: "connect", primary: "addKey", secondary: "change", freeAppliesNow: false, allowanceRisesAt: null });
    expect(hero.lines.map((l) => l.words.key)).toEqual(["plan.hero.line.ownKey.missing"]);
    // Without a plan page to link to: still the key first.
    expect(planView(active("own-key", { choosePlanUrl: null })).primary).toBe("addKey");
    expect(planView(active("own-key", { choosePlanUrl: null })).secondary).toBeNull();
  });

  it("with a usable key: changing the plan is the main action, the line names the keys' services", () => {
    const hero = planView(active("ownkey", { ownKeys: { engines: ["deepl", "google"] } }));
    expect(hero).toMatchObject({ current: "ownkey", primary: "change", secondary: null });
    expect(hero.lines).toEqual([{ icon: "connect", words: { key: "plan.hero.line.ownKey.ready", engines: { engines: ["deepl", "google"] } } }]);
    const html = text(
      renderToStaticMarkup(
        createElement(PlanHero, {
          i18n: translator("en"),
          hero,
          now: NOW,
          resetsOn: "2026-11-01T00:00:00.000Z",
          entitlements: OWN_KEY_PLAN,
          usage: { month: 0, today: 0 },
          limits: { limit: 0, dailyLimit: 0 },
          aiAvailable: true,
          languages: null,
          costPerMillion: null,
          actions: null,
          ownKeys: { keys: [], usage: { total: 12_345, byEngine: { deepl: 12_000, google: 345 } } },
        } satisfies PlanHeroProps),
      ),
    );
    expect(html).toContain("Own key");
    expect(html).toContain("Translates with your keys: DeepL and Google Cloud");
    // The characters through the keys instead of an allowance meter.
    expect(html).toContain("Through your keys this calendar month (UTC), as counted by Linguva: 12,345 characters.");
    expect(html).toContain("DeepL: 12,000 characters");
    expect(html).toContain("Google Cloud: 345 characters");
    expect(html).not.toMatch(/of 0|used up/i);
  });

  it("names only the usable keys' engines, in routing order", () => {
    const key = (engine: "deepl" | "azure" | "google", status: "OK" | "QUOTA" | "REFUSED" | "UNREADABLE" | "RECHECK") => ({ engine, status });
    expect(usableEngines([key("google", "OK"), key("deepl", "QUOTA"), key("azure", "REFUSED")])).toEqual(["deepl", "google"]);
    expect(usableEngines([key("deepl", "UNREADABLE"), key("azure", "RECHECK")])).toEqual([]);
  });

  it("no trial allowance line on Own key (0 included characters), the test plan and aliases are known", () => {
    const trial = planView(active("own-key-test", { ownKeys: { engines: ["deepl"] } }, { trialEndsAt: "2026-11-05T00:00:00.000Z" }));
    expect(trial.badge?.words.key).toBe("plan.status.trial");
    expect(trial.lines.map((l) => l.words.key)).toEqual(["plan.hero.line.ownKey.ready"]);
    expect(trial.allowanceRisesAt).toBeNull();
    for (const handle of OWN_KEY_HANDLES) expect(planView(active(handle)).lines.map((l) => l.words.key)).not.toContain("plan.hero.line.unknownHandle");
  });

  it("a pending change to Own key: the 'from …' line and the card's badge", () => {
    const hero = planView(active("pro", {}, { pendingPlanHandle: "own-key", currentPeriodEnd: "2026-11-28T00:00:00.000Z" }));
    expect(hero.pending).toEqual({ handle: "own-key", date: "2026-11-28T00:00:00.000Z" });
    expect(hero.current).toBe("pro");
    expect(hero.primary).toBe("change");
    const html = text(cards("en", active("pro", {}, { pendingPlanHandle: "own-key", currentPeriodEnd: "2026-11-28T00:00:00.000Z" }), { ...OWN_PLAN, pending: true }));
    expect(html).toContain("Own key");
    expect(html).toContain("from November 28");
  });
});

describe("the Own key card", () => {
  it("hidden: the page has its four cards and no word of Own key", () => {
    for (const locale of APP_LOCALES) {
      const html = cards(locale, active("pro"), { ...OWN_PLAN, visible: false });
      expect(html.match(/role="group" aria-labelledby="plan-/g), locale).toHaveLength(4);
      expect(text(html), locale).not.toContain("Own key");
      expect(html).toBe(cards(locale, active("pro"), null));
    }
  });

  it("shown: once, after the four, $49 a month only, its features and limits, never a trial line or '0 AI characters per month'", () => {
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const html = cards(locale, active("pro"), OWN_PLAN);
      const words = text(html);
      expect(html.match(/aria-labelledby="plan-own-key"/g), locale).toHaveLength(1);
      expect(html.indexOf('aria-labelledby="plan-own-key"')).toBeGreaterThan(html.indexOf('aria-labelledby="plan-business"'));
      expect(words, locale).toContain(text(formatUsd(locale, 49)));
      expect(words, locale).toContain(text(i18n.t("plan.price.monthlyOnly")));
      expect(words, locale).toContain(text(i18n.t("plan.ownKey.stat")));
      expect(words, locale).toContain(text(i18n.t("plan.ownKey.engines")));
      expect(words, locale).toContain(text(i18n.t("plan.ownKey.cost")));
      expect(words, locale).toContain(text(i18n.t("plan.ownKey.noFallback")));
      expect(words, locale).toContain(text(i18n.t("plan.compare.languages", { count: 10 })));
      expect(words, locale).toContain(text(i18n.t("plan.compare.choose", { plan: "Own key" })));
      expect(words, locale).not.toContain(text(i18n.t("plan.price.trial", { count: TRIAL_DAYS, chars: i18n.number(TRIAL_AI_CHARS) })));
      // The card itself (after the four): its figure is the key's quota, never "0 AI characters per month".
      const card = text(html.slice(html.indexOf('aria-labelledby="plan-own-key"')));
      expect(card, locale).not.toContain(text(i18n.t("plan.compare.chars")));
      // No popularity claim.
      const badges = [...html.matchAll(/<s-badge[^>]*>(.*?)<\/s-badge>/g)].map((m) => text(m[1]!));
      for (const badge of badges) expect(badge).not.toMatch(/popular|beliebt|empfohlen|recommended|best/i);
    }
  });

  it("the subscriber's card: 'Your plan', no button; the four cards aren't current", () => {
    const html = cards("de", active("own-key", { ownKeys: { engines: ["deepl"] } }), { ...OWN_PLAN, current: true });
    expect(html.match(/<s-badge[^>]*>Dein Tarif<\/s-badge>/g)).toEqual(['<s-badge tone="info" color="strong" icon="check-circle">Dein Tarif</s-badge>']);
    expect(text(html)).not.toContain("Own key wählen");
    expect(text(html)).toContain("Pro wählen");
  });

  it("the table's note and the question only when shown; a subscriber's downgrade answer", () => {
    const i18n = translator("en");
    const table = (visible: boolean) => renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: "pro", ownKeyPlan: { visible, price: OWN_KEY_PRICE } }));
    expect(table(false)).toBe(renderToStaticMarkup(createElement(PlanFeatureTable, { i18n, current: "pro" })));
    expect(text(table(true))).toContain("Own key: Pro's features with your own translation key instead of AI characters, $49 a month, monthly only.");
    const faq = (ownKeyPlan: { visible: boolean; current: boolean } | null) => text(renderToStaticMarkup(createElement(PlanFaq, { i18n, canChange: true, ownKeyPlan })));
    expect(faq(null)).not.toContain("What is the Own key plan?");
    expect(faq({ visible: true, current: false })).toContain("What is the Own key plan?");
    expect(faq({ visible: true, current: false })).toContain(i18n.t("plan.faq.downgrade.allowance"));
    expect(faq({ visible: true, current: true })).toContain(i18n.t("plan.faq.downgrade.allowance.ownKey"));
    expect(faq({ visible: true, current: true })).not.toContain(i18n.t("plan.faq.downgrade.allowance"));
  });
});

describe("the Overview's next step", () => {
  const input = (overrides: Partial<NextStepInput> = {}): NextStepInput => ({
    targets: [{ locale: "fr", name: "French", published: true }],
    consent: false,
    firstTranslation: { done: false, href: "/app/products?lang=fr" },
    pendingDrafts: 0,
    aiAvailable: false,
    jobsAvailable: true,
    measuredLocales: ["fr"],
    progress: [{ locale: "fr", name: "French", published: true, measured: true, complete: 1, total: 10 }],
    countries: null,
    remainingLocales: 18,
    ...overrides,
  });

  it("asks for the key before the permission on Own key; without it, today's order", () => {
    expect(nextStep(input({ ownKeyMissing: true }))).toEqual({ id: "own-key" });
    expect(nextStep(input({ ownKeyMissing: true, aiAvailable: true }))).toEqual({ id: "own-key" });
    expect(nextStep(input({ aiAvailable: true }))).toEqual({ id: "consent" });
    expect(nextStep(input())).toEqual({ id: "first-translation", href: "/app/products?lang=fr" });
    // Drafts to review still come first.
    expect(nextStep(input({ ownKeyMissing: true, pendingDrafts: 3 }))).toEqual({ id: "review", count: 3 });
  });
});

describe("the translate dialog on Own key", () => {
  it("says the characters go through the merchant's key and its service bills them, never 'more than is left'", () => {
    const estimate = { items: 4, texts: { missing: 3, outdated: 1, failed: 0 }, chars: 1_234, attached: false };
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const render = (chars: number | null) =>
        text(
          renderToStaticMarkup(
            createElement(TranslateConfirm, {
              id: "confirm",
              target: { category: "products", estimate: { ...estimate, chars } } as never,
              languageName: "German",
              publishMode: "DRAFT",
              aiRemaining: null,
              i18n,
              onConfirm: () => {},
            }),
          ),
        );
      expect(render(1_234), locale).toContain(text(i18n.t("language.confirm.ownKey", { chars: 1_234 })));
      expect(render(null), locale).toContain(text(i18n.t("language.confirm.ownKeyUnknown")));
      expect(render(1_234), locale).not.toContain(text(i18n.t("language.confirm.charsOver")));
    }
  });
});
