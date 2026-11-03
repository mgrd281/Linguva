/**
 * The Plan page's parts, rendered on the server for the states one browser
 * test server can't show (billing off, no AI provider: KARINEX today) and
 * for the display rules that hold in every state and language
 * (docs/PRICING_DECISION.md §10.3): list prices from PLAN_PRICES, Free as a
 * word, a yearly line only where a yearly price exists, no switch, no
 * popularity claim, the trial line only for a store without a plan, and an
 * icon for every feature.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanCards, type PlanCardsProps } from "../../app/components/plan/PlanCards";
import { PlanFeatureTable } from "../../app/components/plan/PlanFeatureTable";
import { PlanFaq } from "../../app/components/plan/PlanFaq";
import { PlanHero, type PlanHeroProps } from "../../app/components/plan/PlanHero";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { everyPlanRows, FEATURE_ICON, FEATURE_TINT, PLAN_CARD_FEATURES } from "../../app/lib/plan-features";
import { formatUsd, priceLabel } from "../../app/lib/plan-prices";
import { planView, recommendPlan, type PlanViewInput, type ShopUse } from "../../app/lib/plan-view";
import { PLAN_PRICES, PLANS, TRIAL_AI_CHARS, TRIAL_DAYS, UNMETERED } from "../../app/lib/plans";

const NOW = "2026-10-30T09:12:00.000Z";
const URL = "https://admin.shopify.com/store/shop/charges/linguva/pricing_plans";
const USE: ShopUse = { languages: 4, monthChars: 120_000, bulk: true, auto: false, autoPublish: false, smart: false };

/** Markup as text: tags dropped, entities, no-break spaces and German no-break hyphens ("KI\u2011Zeichen") normalised. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u2011/g, "-")
    .replace(/[\u00A0\u202F\s]+/g, " ");
const flat = (s: string) => s.replace(/[\u00A0\u202F\s]+/g, " ").replace(/\u00AD/g, "").replace(/\u2011/g, "-");

type State = { name: string; input: PlanViewInput; trial: boolean; use: ShopUse | null };
const sub = { planHandle: "pro", pendingPlanHandle: null, trialEndsAt: null, cancelAtEndOfCycle: false, currentPeriodEnd: null, checkedAt: NOW };
const STATES: State[] = [
  { name: "active", input: { configured: true, state: "ACTIVE", stale: false, subscription: sub, choosePlanUrl: URL, now: NOW }, trial: false, use: USE },
  { name: "none", input: { configured: true, state: "NONE", stale: false, subscription: { ...sub, planHandle: null }, choosePlanUrl: URL, now: NOW }, trial: true, use: USE },
  { name: "unknown", input: { configured: true, state: "UNKNOWN", stale: false, subscription: null, choosePlanUrl: URL, now: NOW }, trial: false, use: USE },
  { name: "owner", input: { configured: true, state: "COMPLIMENTARY", stale: false, subscription: null, choosePlanUrl: null, now: NOW }, trial: false, use: null },
  { name: "billing off", input: { configured: false, state: "ACTIVE", stale: false, subscription: null, choosePlanUrl: null, now: NOW }, trial: false, use: null },
];

function cards(locale: AppLocale, state: State, extra: Partial<PlanCardsProps> = {}) {
  const i18n = translator(locale);
  const hero = planView(state.input);
  const choosePlanUrl = state.input.state === "COMPLIMENTARY" ? null : state.input.choosePlanUrl;
  const intro = state.input.state === "COMPLIMENTARY" ? "plan.compare.introComplimentary" : choosePlanUrl ? "plan.compare.intro" : "plan.compare.introUnconfigured";
  const recommendation = state.input.configured && choosePlanUrl && state.use ? recommendPlan(state.use) : null;
  return renderToStaticMarkup(createElement(PlanCards, { i18n, hero, now: NOW, intro, choosePlanUrl, trial: state.trial, recommendation, use: state.use, ...extra }));
}

function hero(locale: AppLocale, extra: Partial<PlanHeroProps> = {}) {
  const i18n = translator(locale);
  const props: PlanHeroProps = {
    i18n,
    hero: planView({ configured: false, state: "ACTIVE", stale: false, subscription: null, choosePlanUrl: null, now: NOW }),
    now: NOW,
    resetsOn: "2026-11-01T00:00:00.000Z",
    entitlements: UNMETERED,
    usage: { month: 516, today: 0 },
    limits: { limit: 20_000, dailyLimit: 20_000 },
    aiAvailable: false,
    languages: {
      primary: "de",
      primaryName: "German",
      shopifyRoom: 15,
      items: [
        { locale: "da", name: "Danish", published: true, inPlan: true },
        { locale: "en", name: "English", published: true, inPlan: true },
        { locale: "fr", name: "French", published: true, inPlan: true },
        { locale: "nl", name: "Dutch", published: true, inPlan: true },
      ],
    },
    costPerMillion: null,
    actions: null,
    ...extra,
  };
  return renderToStaticMarkup(createElement(PlanHero, props));
}

describe("prices on the cards", () => {
  it("shows today's list prices from PLAN_PRICES in every state, with Free as a word", () => {
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      for (const state of STATES) {
        const page = flat(text(cards(locale, state)));
        for (const handle of ["starter", "pro", "business"] as const) expect(page, `${locale} ${state.name}`).toContain(flat(formatUsd(locale, PLAN_PRICES[handle].monthlyUsd)));
        expect(page, `${locale} ${state.name}`).toContain(flat(priceLabel(i18n, "free")));
        expect(page, `${locale} ${state.name}`).not.toMatch(/\b0\s?\$|\$\s?0\b/);
      }
    }
  });

  it("gives Starter and Pro their yearly line with the months free, Business 'Monthly only', Free nothing, and has no switch", () => {
    const page = cards("de", STATES[0]!);
    const yearly = [...page.matchAll(/oder ([\d.]+)\u00A0\$ \/ Jahr/g)].map((m) => Number(m[1]));
    expect(yearly).toEqual([PLAN_PRICES.starter.yearlyUsd, PLAN_PRICES.pro.yearlyUsd]);
    expect(page.match(/2 Monate gratis/g)).toHaveLength(2);
    expect(page.match(/Nur monatlich/g)).toHaveLength(1);
    expect(page).not.toMatch(/role="switch"|<s-switch/);
  });

  it("never claims popularity in any state or language", () => {
    for (const locale of APP_LOCALES)
      for (const state of STATES) {
        const page = cards(locale, state);
        const badges = [...page.matchAll(/<s-badge[^>]*>(.*?)<\/s-badge>/g)].map((m) => text(m[1]!));
        for (const badge of badges) expect(badge, `${locale} ${state.name}`).not.toMatch(/popular|beliebt|empfohlen|recommended|best/i);
        // Nor anywhere else on the cards ("bestätigen" is fine, "best" isn't).
        expect(text(page), `${locale} ${state.name}`).not.toMatch(/popular|populaire|beliebt|empfohlen|recommended|recommandé|recomendado|(?<!\p{L})best(?!\p{L})|meilleur|mejor/iu);
      }
  });

  it("marks the current plan with a strong badge, distinct from the neutral ones", () => {
    // Polaris renders tone="neutral" color="strong" like a plain neutral badge (measured): the spec's fallback is info + strong.
    const page = cards("de", STATES[0]!);
    expect(page.match(/<s-badge[^>]*>Dein Tarif<\/s-badge>/g)).toEqual(['<s-badge tone="info" color="strong" icon="check-circle">Dein Tarif</s-badge>']);
  });

  it("shows the trial line on the three paid cards only for a store without a plan", () => {
    const line = translator("de").t("plan.price.trial", { count: TRIAL_DAYS, chars: translator("de").number(TRIAL_AI_CHARS) });
    expect(cards("de", STATES[1]!).split(line)).toHaveLength(4);
    for (const state of STATES.filter((s) => !s.trial)) expect(cards("de", state), state.name).not.toContain(line);
  });

  it("gives every feature row its icon, and the cards their five rows in the same order", () => {
    const page = cards("en", STATES[0]!);
    for (const row of PLAN_CARD_FEATURES) expect(page.split(`type="${FEATURE_ICON[row.key]}"`).length - 1, row.key).toBeGreaterThanOrEqual(4);
    const table = renderToStaticMarkup(createElement(PlanFeatureTable, { i18n: translator("en"), current: "pro" }));
    const rows = [...table.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)];
    expect(rows).toHaveLength(19);
    for (const [cell] of rows) expect(cell).toMatch(/<s-icon type="[a-z-]+"/);
  });
});

describe("type that stands out", () => {
  // Polaris draws <s-text type="strong"> at the body weight (450, measured): these use the app's type scale
  // (app/styles/ui.css: .lv-strong 600, .lv-h3 650, the fold's summary 600).
  it("sets the fitting plan's lead, the meters' names, the table's title and the questions in semibold", () => {
    const fits = cards("de", STATES[0]!);
    // The Pro store's own plan fits (4 languages, whole areas): said as its plan.
    expect(fits).toMatch(/<strong class="lv-strong">Dein Tarif passt zu deinem Shop\.<\/strong> Der kleinste Tarif für deine 4 Sprachen\./);
    const meters = hero("de", { aiAvailable: true, limits: { limit: 1_200_000, dailyLimit: 1_000_000 } });
    const de = translator("de");
    for (const name of [de.t("plan.usage.label"), de.t("plan.languages.label")]) expect(meters).toContain(`<h3 class="lv-h3">${name}</h3>`);
    // The app's fold (Disclosure, its summary semibold), a full-width row with the chevron at its end.
    const table = renderToStaticMarkup(createElement(PlanFeatureTable, { i18n: translator("de"), current: "pro" }));
    expect(table).toMatch(/<div class="lv-plan-fold lv-plan-fold--table"><details class="lv-more"><summary class="lv-more__summary"><span>Alle Funktionen vergleichen /);
    const faq = renderToStaticMarkup(createElement(PlanFaq, { i18n: translator("de"), canChange: true }));
    expect(faq.match(/<div class="lv-plan-fold"><details class="lv-more"><summary class="lv-more__summary">/g)).toHaveLength(4);
    // No browser triangle left: every fold is the app's.
    expect([...table.matchAll(/<summary\b[^>]*>/g), ...faq.matchAll(/<summary\b[^>]*>/g)].every(([tag]) => tag === '<summary class="lv-more__summary">')).toBe(true);
  });
});

describe("fits your store, said for the store's own plan", () => {
  const de = translator("de");
  const starterStore = { ...STATES[0]!.input, subscription: { ...sub, planHandle: "starter" } };
  /** Each card's markup, by plan handle. */
  const perCard = (html: string) =>
    Object.fromEntries(
      html
        .split('role="group"')
        .slice(1)
        .map((part) => [/aria-labelledby="plan-([a-z-]+)"/.exec(part)![1]!, part]),
    );
  const FITS = /<s-badge[^>]*>Passt zu deinem Shop<\/s-badge>/g;

  it("the store's own plan: 'Your plan fits your store', and no second badge on its card", () => {
    const html = cards("de", STATES[0]!);
    expect(flat(text(html))).toContain("Dein Tarif passt zu deinem Shop. Der kleinste Tarif für deine 4 Sprachen.");
    expect(html.match(FITS)).toBeNull();
    expect(perCard(html).pro).toContain(">Dein Tarif</s-badge>");
  });

  it("a smaller plan: '… is enough too' with its reason, never an order to downgrade; the badge on that card only", () => {
    const html = cards("de", { name: "pro, two languages", input: STATES[0]!.input, trial: false, use: { ...USE, languages: 2 } });
    expect(flat(text(html))).toContain(
      "Für das, was dein Shop gerade nutzt, reicht auch Starter. Der kleinste Tarif für deine 2 Sprachen, deine 120.000 KI-Zeichen diesen Monat und das Übersetzen ganzer Bereiche auf einmal.",
    );
    expect(text(html)).not.toContain("Passt zu deinem Shop: Starter.");
    expect(html.match(FITS)).toHaveLength(1);
    expect(perCard(html).starter).toMatch(FITS);
  });

  it("Free is enough for a store on Pro: the lead alone, no reason that repeats it", () => {
    const html = cards("de", { name: "pro, little use", input: STATES[0]!.input, trial: false, use: { ...USE, languages: 1, monthChars: 0, bulk: false } });
    expect(flat(text(html))).toContain("Für das, was dein Shop gerade nutzt, reicht auch Free.");
    expect(text(html)).not.toContain(de.t("plan.recommend.reasonFree"));
    expect(perCard(html).free).toMatch(FITS);
  });

  it("a bigger plan, or a store without one: 'Fits your store: Pro.' as before", () => {
    const bigger = cards("de", { name: "starter, four languages", input: starterStore, trial: false, use: USE });
    expect(bigger).toMatch(/<strong class="lv-strong">Passt zu deinem Shop: Pro\.<\/strong> Der kleinste Tarif für deine 4 Sprachen\./);
    expect(perCard(bigger).pro).toMatch(FITS);
    expect(perCard(bigger).starter).toContain(">Dein Tarif</s-badge>");
    const none = cards("de", STATES[1]!);
    expect(text(none)).toContain("Passt zu deinem Shop: Pro.");
    expect(none.match(FITS)).toHaveLength(1);
  });

  it("gives the recommendation the whole row: no legend beside it (each row says it in words and marks)", () => {
    for (const state of STATES) expect(cards("de", state), state.name).not.toContain(">nicht enthalten<");
  });

  it("says each of the three in every language, without a popularity claim", () => {
    const uses: Array<[State["input"], ShopUse]> = [
      [STATES[0]!.input, USE],
      [STATES[0]!.input, { ...USE, languages: 2 }],
      [starterStore, USE],
    ];
    for (const locale of APP_LOCALES)
      for (const [input, use] of uses) {
        const words = text(cards(locale, { name: "fits", input, trial: false, use }));
        expect(words, locale).not.toMatch(/popular|populaire|beliebt|empfohlen|recommended|recommandé|recomendado|(?<!\p{L})best(?!\p{L})|meilleur|mejor/iu);
      }
  });
});

describe("the page's colours and signs", () => {
  it("draws the plans' signs in the Plan page's colour and the strip's features in Settings' colours", () => {
    const html = cards("de", STATES[0]!);
    expect(html.match(/data-tint="rose" aria-hidden="true"><s-icon type="(nature|rocket|bolt|organization)"/g)).toHaveLength(4);
    for (const row of everyPlanRows(Object.values(PLANS)))
      expect(html, row.key).toMatch(new RegExp(`data-tint="${FEATURE_TINT[row.key]}" aria-hidden="true"( style="[^"]*")?><s-icon type="${FEATURE_ICON[row.key]}"`));
    const meters = hero("de", { aiAvailable: true });
    expect(meters).toMatch(/data-tint="rose" aria-hidden="true" style="[^"]*"><s-icon type="unlock"/);
    expect(meters).toMatch(/data-tint="rose" aria-hidden="true" style="[^"]*"><s-icon type="gauge"/);
    expect(meters).toMatch(/data-tint="blue" aria-hidden="true" style="[^"]*"><s-icon type="language"/);
  });

  it("marks a language outside the plan with the lock, used up with the stop sign, almost used up with the warning", () => {
    const languages = { primary: "en", primaryName: "English", shopifyRoom: 15, items: [{ locale: "de", name: "German", published: true, inPlan: false }] };
    const outside = hero("de", { aiAvailable: true, entitlements: PLANS.free, languages });
    expect(outside).toContain('<s-icon type="lock" size="small" color="subdued"></s-icon><s-text color="subdued">nicht im Tarif</s-text>');
    expect(outside).not.toContain("minus-circle");
    const usedUp = hero("de", { aiAvailable: true, usage: { month: 20_000, today: 0 } });
    expect(usedUp).toContain('<s-icon type="alert-circle" tone="critical">');
    const almost = hero("de", { aiAvailable: true, usage: { month: 18_000, today: 0 } });
    expect(almost).toContain('<s-icon type="alert-triangle" tone="caution">');
  });

  it("starts every badge with a capital letter, as Settings' states do", () => {
    const periodEnd = "2026-11-28T00:00:00.000Z";
    const inputs: PlanViewInput[] = [
      STATES[0]!.input,
      { ...STATES[0]!.input, subscription: { ...sub, cancelAtEndOfCycle: true, currentPeriodEnd: periodEnd } },
      { ...STATES[0]!.input, subscription: { ...sub, cancelAtEndOfCycle: true } },
      { ...STATES[0]!.input, subscription: { ...sub, planHandle: "business", trialEndsAt: "2026-11-05T00:00:00.000Z" } },
      { ...STATES[0]!.input, stale: true },
      { ...STATES[0]!.input, subscription: { ...sub, pendingPlanHandle: "starter", currentPeriodEnd: periodEnd } },
      STATES[1]!.input,
      STATES[2]!.input,
      STATES[4]!.input,
    ];
    for (const locale of APP_LOCALES)
      for (const input of inputs) {
        const html = hero(locale, { hero: planView(input) }) + cards(locale, { name: "badges", input, trial: false, use: { ...USE, languages: 2 } });
        const badges = [...html.matchAll(/<s-badge[^>]*>(.*?)<\/s-badge>/g)].map((m) => text(m[1]!).trim());
        expect(badges.length, locale).toBeGreaterThan(0);
        for (const badge of badges) expect(badge, `${locale}: ${badge}`).toMatch(/^[\p{Lu}\d]/u);
      }
  });
});

describe("the full comparison", () => {
  it("draws the current plan's column in the cards' chosen look, its head saying 'Your plan'", () => {
    const table = renderToStaticMarkup(createElement(PlanFeatureTable, { i18n: translator("de"), current: "pro" }));
    // Its head, its price and its 18 rows; no other column.
    expect(table.match(/data-current=""/g)).toHaveLength(20);
    expect(table).toContain('data-current="">Pro<span class="lv-plan-table__mine"><s-text accessibilityVisibility="exclusive"> – </s-text>Dein Tarif</span></th>');
    expect(renderToStaticMarkup(createElement(PlanFeatureTable, { i18n: translator("de"), current: null }))).not.toContain("data-current");
  });
});

describe("the hero for screen readers", () => {
  it("names the plan once: no hidden section label before the heading 'Your plan: …'", () => {
    // Polaris turns a section's accessibilityLabel into a hidden heading ("Your plan" before "Your plan: Pro").
    expect(hero("de")).not.toMatch(/<s-section[^>]*accessibilityLabel/i);
  });
});

describe("states the browser tests can't show", () => {
  it("billing off (KARINEX today): list prices, no plan buttons, no recommendation, the short footnote", () => {
    const off = STATES.find((s) => s.name === "billing off")!;
    const page = cards("de", off);
    expect(page).not.toContain("href=");
    expect(text(page)).not.toMatch(/wählen|Passt zu deinem Shop/);
    expect(text(page)).toContain("Noch nicht wählbar, weil die Abrechnung noch nicht eingerichtet ist.");
    expect(text(page)).toContain("Preise in US-Dollar.");
    expect(text(page)).not.toContain("abgerechnet über Shopify");
    // Without a plan button, the question how to change it isn't asked.
    expect(text(renderToStaticMarkup(createElement(PlanFaq, { i18n: translator("de"), canChange: false })))).not.toContain("Wie wechsle ich den Tarif?");
  });

  it("without an AI provider: no meter, the note that nothing is sent to AI, and only the store's languages", () => {
    const page = text(hero("de"));
    expect(page).toContain("KI-Übersetzung ist nicht eingerichtet");
    expect(page).toContain("Du übersetzt selbst. Nichts wird an einen KI-Dienst gesendet.");
    expect(page).toContain("Deine Sprachen");
    expect(page).toContain("4 weitere neben Deutsch");
    expect(page).not.toMatch(/von 20\.000|genutzt|nicht im Tarif/);
    expect(hero("de")).not.toContain('role="progressbar"');
    expect(page.indexOf("Dänisch")).toBeLessThan(page.indexOf("Niederländisch"));
  });

  it("owner access: prices for reference, no plan buttons, and the internal cost at the production rate", () => {
    const owner = STATES.find((s) => s.name === "owner")!;
    const page = cards("de", owner);
    expect(page).not.toContain("href=");
    expect(text(page)).toContain("Mit Inhaber-Zugang brauchst du keinen Tarif.");
    const ownerHero = text(
      hero("de", {
        hero: planView(owner.input),
        aiAvailable: true,
        entitlements: { ...PLANS.business, plan: "complimentary", monthlyChars: 2_000_000 },
        usage: { month: 80_000, today: 2_600 },
        limits: { limit: 2_000_000, dailyLimit: 1_000_000 },
        costPerMillion: 27.5,
      }),
    );
    expect(flat(ownerHero)).toContain("Geschätzte KI-Kosten diesen Monat (intern): 2,20 $ bei 27,50 $ pro Million Zeichen");
    expect(ownerHero).toContain("Inhaber-Zugang");
    expect(ownerHero).toContain("Heute: 2.600 von 1.000.000 KI-Zeichen (Tageslimit)");
  });
});

describe("the AI meter's lines", () => {
  it("says what today's figure counts: the AI characters used today", () => {
    const meter = (locale: AppLocale) => flat(text(hero(locale, { aiAvailable: true, usage: { month: 516, today: 0 } })));
    expect(meter("de")).toContain("Heute genutzt: 0 KI-Zeichen");
    expect(meter("en")).toContain("Used today: 0 AI characters");
    expect(flat(text(hero("en", { aiAvailable: true, usage: { month: 516, today: 1 } })))).toContain("Used today: 1 AI character ");
  });

  it("writes the renewal's time where the 1st at 0:00 UTC is the evening before in the store's zone", () => {
    const now = "2026-11-20T15:00:00.000Z";
    const inZone = (timeZone: string, used = 0) =>
      flat(text(hero("de", { i18n: translator("de", { timeZone }), now, resetsOn: "2026-12-01T00:00:00.000Z", aiAvailable: true, usage: { month: used, today: 0 } })));
    expect(inZone("America/New_York")).toContain("Neue KI-Zeichen am 30. November um 19:00");
    expect(inZone("America/New_York", 20_000)).toContain("Aufgebraucht. Neue KI-Zeichen gibt es am 30. November um 19:00.");
    // The 1st there too: the day alone.
    expect(inZone("Europe/Berlin")).toContain("Neue KI-Zeichen am 1. Dezember");
    expect(inZone("Europe/Berlin")).not.toContain("1:00");
    const english = flat(text(hero("en", { i18n: translator("en", { timeZone: "America/Los_Angeles" }), now, resetsOn: "2026-12-01T00:00:00.000Z", aiAvailable: true })));
    expect(english).toContain("New AI characters on November 30 at 4:00 PM");
  });
});

describe("the AI meter during a trial", () => {
  // Business in its trial until 5 November; the month renews on 1 December.
  const now = "2026-11-02T09:00:00.000Z";
  const trialSub: NonNullable<PlanViewInput["subscription"]> = {
    planHandle: "business",
    pendingPlanHandle: null,
    trialEndsAt: "2026-11-05T00:00:00.000Z",
    cancelAtEndOfCycle: false,
    currentPeriodEnd: null,
    checkedAt: now,
  };
  const meter = (used: number, subscription = trialSub, resetsOn = "2026-12-01T00:00:00.000Z") =>
    flat(
      text(
        hero("de", {
          hero: planView({ configured: true, state: "ACTIVE", stale: false, subscription, choosePlanUrl: URL, now }),
          now,
          resetsOn,
          entitlements: { ...PLANS.business, monthlyChars: TRIAL_AI_CHARS },
          usage: { month: used, today: 0 },
          limits: { limit: TRIAL_AI_CHARS, dailyLimit: TRIAL_AI_CHARS },
          aiAvailable: true,
        }),
      ),
    );

  it("names the trial's end, when the plan's allowance starts, not the month's renewal after it", () => {
    const usedUp = meter(TRIAL_AI_CHARS);
    expect(usedUp).toContain("Aufgebraucht. Neue KI-Zeichen gibt es am 5. November.");
    expect(usedUp).toContain("Neue KI-Zeichen am 5. November");
    expect(usedUp).not.toContain("1. Dezember");
    expect(meter(TRIAL_AI_CHARS - 15_000)).toContain("Fast aufgebraucht: Bis zum 5. November sind noch 15.000 Zeichen frei.");
  });

  it("keeps the month's renewal when it comes first, and without a trial", () => {
    expect(meter(TRIAL_AI_CHARS, trialSub, "2026-11-01T00:00:00.000Z")).toContain("Aufgebraucht. Neue KI-Zeichen gibt es am 1. November.");
    expect(meter(TRIAL_AI_CHARS, { ...trialSub, trialEndsAt: null })).toContain("Aufgebraucht. Neue KI-Zeichen gibt es am 1. Dezember.");
  });
});
