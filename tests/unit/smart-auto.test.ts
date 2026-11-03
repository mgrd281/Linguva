/**
 * Smart Auto-Translate rules (pure): which types a check plans, when its
 * full checks run, when a pause lifts, and the server-side validation of
 * the settings form (every value from the browser is checked again).
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normaliseSmartSettings, type SmartSettingsContext, type SmartSettingsInput } from "../../app/.server/smart/validate";
import { BudgetMeter, budgetMeter, ChoiceTiles, DayToggles, failedAction, shortWeekday, SmartPreview, SmartStateBanner, whenIn } from "../../app/components/SmartAutoCard";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { PLANS } from "../../app/lib/plans";
import { attachedOwner, budgetWindows, checkSpec, pauseLiftsAt, smartCoverageTypes, smartStatus } from "../../app/lib/smart-auto";
import { nextOccurrence } from "../../app/lib/schedule";
import { waitsForSmartCheck } from "../../app/.server/smart/panel";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("what a check plans", () => {
  it("plans the chosen types, and their images and custom fields only when included", () => {
    expect(smartCoverageTypes({ resourceTypes: ["PRODUCT", "PAGE"], includeAttached: false })).toEqual(["PRODUCT", "PAGE"]);
    expect(smartCoverageTypes({ resourceTypes: ["PRODUCT", "PAGE", "MENU"], includeAttached: true })).toEqual([
      "PRODUCT",
      "PAGE",
      "MENU",
      "PRODUCT_METAFIELD",
      "MEDIA_IMAGE",
      "PAGE_METAFIELD",
    ]);
    // Never theme content or notifications, whatever the stored list says.
    expect(smartCoverageTypes({ resourceTypes: ["ONLINE_STORE_THEME", "EMAIL_TEMPLATE", "PRODUCT"], includeAttached: false })).toEqual(["PRODUCT"]);
  });
});

describe("items waiting for the next check (coverage)", () => {
  const note = { scope: { locales: ["de"], types: ["PRODUCT"], groups: ["title", "description"], states: ["missing", "failed", "outdated"] } };
  it("wait when a field in the scope is missing, failed or outdated", () => {
    expect(waitsForSmartCheck(note, { locale: "de", resourceType: "PRODUCT", fields: ["title:complete", "description:missing"] })).toBe(true);
    expect(waitsForSmartCheck(note, { locale: "de", resourceType: "PRODUCT", fields: ["title:outdated"] })).toBe(true);
    // A draft waits for review, not for the check; a field group outside the scope doesn't count.
    expect(waitsForSmartCheck(note, { locale: "de", resourceType: "PRODUCT", fields: ["title:draft", "seo_title:missing"] })).toBe(false);
    // Another language or type: not in the scope.
    expect(waitsForSmartCheck(note, { locale: "fr", resourceType: "PRODUCT", fields: ["title:missing"] })).toBe(false);
    expect(waitsForSmartCheck(note, { locale: "de", resourceType: "COLLECTION", fields: ["title:missing"] })).toBe(false);
    // Outdated translations kept as they are.
    const keep = { scope: { ...note.scope, states: ["missing", "failed"] } };
    expect(waitsForSmartCheck(keep, { locale: "de", resourceType: "PRODUCT", fields: ["title:outdated"] })).toBe(false);
  });
});

describe("full checks", () => {
  it("runs real-time mode's daily check at its time, and manual mode never", () => {
    const realtime = checkSpec({ mode: "realtime", timeZone: "Europe/Berlin", times: [], weekdays: [] })!;
    expect(iso(nextOccurrence(realtime, at("2026-10-29T12:00:00Z")))).toBe("2026-10-30T02:00:00.000Z");
    const late = checkSpec({ mode: "realtime", timeZone: "Europe/Berlin", times: [1380], weekdays: [] })!;
    expect(iso(nextOccurrence(late, at("2026-10-29T12:00:00Z")))).toBe("2026-10-29T22:00:00.000Z");
    expect(checkSpec({ mode: "manual", timeZone: "UTC", times: [], weekdays: [] })).toBeNull();
  });
});

describe("pauses", () => {
  it("lift at the next local midnight or month for budgets, and in UTC for the plan's limits", () => {
    const now = at("2026-10-29T22:30:00Z"); // 23:30 in Berlin (winter time)
    expect(iso(pauseLiftsAt("BUDGET_DAILY", now, "Europe/Berlin"))).toBe("2026-10-29T23:00:00.000Z");
    expect(iso(pauseLiftsAt("BUDGET_MONTHLY", now, "Europe/Berlin"))).toBe("2026-10-31T23:00:00.000Z");
    expect(iso(pauseLiftsAt("BUDGET_MONTHLY", at("2026-12-31T12:00:00Z"), "Europe/Berlin"))).toBe("2026-12-31T23:00:00.000Z");
    expect(iso(pauseLiftsAt("DAILY_CAP", now, "Europe/Berlin"))).toBe("2026-10-30T00:00:00.000Z");
    expect(iso(pauseLiftsAt("PLAN_ALLOWANCE", now, "Europe/Berlin"))).toBe("2026-11-01T00:00:00.000Z");
    expect(iso(pauseLiftsAt("PROVIDER", now, "UTC"))).toBe("2026-10-29T23:30:00.000Z");
    // The merchant resumes, or a re-check finds the cause gone.
    for (const reason of ["MANUAL", "PLAN", "CONSENT", "PRIMARY_LANGUAGE"] as const) expect(pauseLiftsAt(reason, now, "UTC")).toBeNull();
  });

  it("counts budgets per local day and month, also on the day the clocks change", () => {
    const { daySince, monthSince } = budgetWindows(at("2026-10-25T12:00:00Z"), "Europe/Berlin");
    expect(iso(daySince)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(monthSince)).toBe("2026-09-30T22:00:00.000Z");
  });
});

describe("the state every page shows", () => {
  const base = { enabled: true, pausedAt: null, pauseReason: null, pausedUntil: null, entitled: true, consent: true, available: true, languages: 1, now: at("2026-10-29T12:00:00Z") };
  it("says what keeps it from running, in the order the merchant can act on it", () => {
    expect(smartStatus({ ...base, enabled: false, entitled: false })).toEqual({ state: "off" });
    expect(smartStatus({ ...base, entitled: false, consent: false })).toEqual({ state: "waiting", reason: "PLAN" });
    expect(smartStatus({ ...base, consent: false })).toEqual({ state: "waiting", reason: "CONSENT" });
    expect(smartStatus({ ...base, available: false })).toEqual({ state: "waiting", reason: "UNAVAILABLE" });
    expect(smartStatus({ ...base, worker: false })).toEqual({ state: "waiting", reason: "WORKER" });
    expect(smartStatus({ ...base, languages: 0 })).toEqual({ state: "waiting", reason: "NO_LANGUAGE" });
    expect(smartStatus({ ...base, worker: true })).toEqual({ state: "on" });
  });

  it("shows a pause until it lifts, and a pause for the plan or consent as over once they are back", () => {
    const pausedAt = at("2026-10-29T08:00:00Z");
    expect(smartStatus({ ...base, pausedAt, pauseReason: "MANUAL" })).toEqual({ state: "paused", reason: "MANUAL", until: null });
    expect(smartStatus({ ...base, pausedAt, pauseReason: "BUDGET_DAILY", pausedUntil: at("2026-10-29T23:00:00Z") })).toMatchObject({ state: "paused", reason: "BUDGET_DAILY" });
    expect(smartStatus({ ...base, pausedAt, pauseReason: "BUDGET_DAILY", pausedUntil: at("2026-10-29T11:00:00Z") })).toEqual({ state: "on" });
    expect(smartStatus({ ...base, pausedAt, pauseReason: "PLAN" })).toEqual({ state: "on" });
    expect(smartStatus({ ...base, pausedAt, pauseReason: "CONSENT" })).toEqual({ state: "on" });
    // The merchant's own pause beats a stopped worker: resuming is theirs.
    expect(smartStatus({ ...base, pausedAt, pauseReason: "MANUAL", worker: false })).toMatchObject({ state: "paused" });
  });

  it("knows whose images and custom fields a coverage type holds", () => {
    expect(attachedOwner("PRODUCT_METAFIELD")).toBe("PRODUCT");
    expect(attachedOwner("MEDIA_IMAGE")).toBe("PRODUCT");
    expect(attachedOwner("COLLECTION_IMAGE")).toBe("COLLECTION");
    expect(attachedOwner("PRODUCT")).toBeNull();
  });
});

describe("the settings form, checked on the server", () => {
  const context: SmartSettingsContext = {
    targets: ["fr", "de", "it", "es"],
    allowed: ["fr", "de", "it"],
    shopTimeZone: "Europe/Berlin",
    entitlements: PLANS.business,
    currentPublishMode: "DRAFT",
  };
  const form = (over: Partial<SmartSettingsInput> = {}): SmartSettingsInput => ({
    mode: "daily",
    timeZone: "Europe/Berlin",
    times: ["23:00"],
    weekdays: [],
    locales: ["de,fr"],
    resourceTypes: ["PRODUCT", "COLLECTION"],
    fieldGroups: "all",
    includeAttached: false,
    publishMode: "DRAFT",
    confirmPublish: false,
    replaceOutdatedMachine: true,
    dailyBudget: "",
    monthlyBudget: "",
    ...over,
  });

  it("keeps a valid daily schedule, the languages in the shop's order, and no budgets", () => {
    expect(normaliseSmartSettings(form(), context)).toEqual({
      ok: true,
      value: {
        mode: "daily",
        timeZone: "Europe/Berlin",
        times: [1380],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        locales: ["fr", "de"],
        resourceTypes: ["PRODUCT", "COLLECTION"],
        fieldGroups: [],
        includeAttached: false,
        publishMode: "DRAFT",
        replaceOutdatedMachine: true,
        dailyBudget: null,
        monthlyBudget: null,
      },
    });
  });

  it("stores real-time with its daily check time, and manual without times", () => {
    expect(normaliseSmartSettings(form({ mode: "realtime", times: [] }), context)).toMatchObject({ ok: true, value: { mode: "realtime", times: [180] } });
    expect(normaliseSmartSettings(form({ mode: "manual", times: ["23:00"] }), context)).toMatchObject({ ok: true, value: { mode: "manual", times: [], weekdays: [] } });
    expect(normaliseSmartSettings(form({ mode: "custom", times: ["08:00", "20:00"], weekdays: ["1,3,5"] }), context)).toMatchObject({
      ok: true,
      value: { mode: "custom", times: [480, 1200], weekdays: [1, 3, 5] },
    });
  });

  it("refuses forged values and writes nothing for them", () => {
    const refused = (over: Partial<SmartSettingsInput>) => normaliseSmartSettings(form(over), context);
    expect(refused({ mode: "hourly" })).toEqual({ ok: false, problem: "MODE" });
    expect(refused({ timeZone: "+02:00" })).toEqual({ ok: false, problem: "TIME_ZONE" });
    expect(refused({ times: ["25:00"] })).toEqual({ ok: false, problem: "TIMES" });
    expect(refused({ mode: "weekly", weekdays: ["8"] })).toEqual({ ok: false, problem: "WEEKDAYS" });
    expect(refused({ locales: ["de", "xx"] })).toEqual({ ok: false, problem: "UNKNOWN_LANGUAGE" });
    expect(refused({ locales: ["es"] })).toEqual({ ok: false, problem: "PLAN_LANGUAGE" });
    expect(refused({ locales: [] })).toEqual({ ok: false, problem: "NO_LANGUAGE" });
    expect(refused({ resourceTypes: ["ONLINE_STORE_THEME"] })).toEqual({ ok: false, problem: "UNKNOWN_TYPE" });
    expect(refused({ resourceTypes: [] })).toEqual({ ok: false, problem: "NO_TYPE" });
    expect(refused({ fieldGroups: ["url"] })).toEqual({ ok: false, problem: "UNKNOWN_FIELD_GROUP" });
    expect(refused({ fieldGroups: [] })).toEqual({ ok: false, problem: "NO_FIELD_GROUP" });
    expect(refused({ dailyBudget: "-5" })).toEqual({ ok: false, problem: "BUDGET" });
    expect(refused({ monthlyBudget: "99999999999" })).toEqual({ ok: false, problem: "BUDGET" });
    expect(refused({ dailyBudget: "1e6" })).toEqual({ ok: false, problem: "BUDGET" });
    // A decimal is not a number of characters (not 15).
    expect(refused({ dailyBudget: "1.5" })).toEqual({ ok: false, problem: "BUDGET" });
  });

  it("reads budgets with thousands separators, up to the plan's allowance", () => {
    expect(normaliseSmartSettings(form({ dailyBudget: "20,000", monthlyBudget: "400.000" }), context)).toMatchObject({
      ok: true,
      value: { dailyBudget: 20000, monthlyBudget: 400000 },
    });
    expect(normaliseSmartSettings(form({ monthlyBudget: String(PLANS.business.monthlyChars + 1) }), context)).toEqual({ ok: false, problem: "BUDGET" });
  });

  it("limits fields to chosen groups (all of them is the same as all)", () => {
    expect(normaliseSmartSettings(form({ fieldGroups: ["title,seo_title"] }), context)).toMatchObject({ ok: true, value: { fieldGroups: ["title", "seo_title"] } });
    const every = ["title", "description", "seo_title", "seo_description", "alt", "value", "other"];
    expect(normaliseSmartSettings(form({ fieldGroups: every }), context)).toMatchObject({ ok: true, value: { fieldGroups: [] } });
  });

  it("publishes automatically only with the plan and an explicit confirmation", () => {
    expect(normaliseSmartSettings(form({ publishMode: "AUTO_PUBLISH" }), context)).toEqual({ ok: false, problem: "CONFIRMATION_REQUIRED" });
    expect(normaliseSmartSettings(form({ publishMode: "AUTO_PUBLISH", confirmPublish: true }), context)).toMatchObject({ ok: true, value: { publishMode: "AUTO_PUBLISH" } });
    // Already confirmed earlier: no new confirmation for other changes.
    expect(normaliseSmartSettings(form({ publishMode: "AUTO_PUBLISH" }), { ...context, currentPublishMode: "AUTO_PUBLISH" })).toMatchObject({ ok: true });
    expect(normaliseSmartSettings(form({ publishMode: "AUTO_PUBLISH", confirmPublish: true }), { ...context, entitlements: PLANS.starter })).toEqual({
      ok: false,
      problem: "PLAN_AUTO_PUBLISH",
    });
  });
});

// ─── The smart page's controls and its words (app/components/SmartAutoCard.tsx) ───

/** Server markup of a component, inside the interface language's provider. */
function html(node: ReactNode, locale: AppLocale = "en"): string {
  return renderToStaticMarkup(createElement(I18nProvider, { locale, timeZone: "Europe/Berlin" } as ComponentProps<typeof I18nProvider>, node));
}
/** The opening tags of one element, in document order. */
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

describe("times on the smart page", () => {
  const now = at("2026-11-03T15:00:00Z"); // 16:00 in Berlin
  it("say today, yesterday or the date, and name the zone only where it isn't the store's", () => {
    const en = translator("en");
    const tonight = at("2026-11-03T22:00:00Z");
    expect(whenIn(en, tonight, "Europe/Berlin", now, "Europe/Berlin", true)).toBe("today, 11:00 PM");
    expect(whenIn(en, tonight, "Europe/Berlin", now, "Europe/Berlin")).toBe("Today, 11:00 PM");
    expect(whenIn(en, tonight, "Europe/Berlin", now, "America/New_York", true)).toBe("today, 11:00 PM (Europe/Berlin)");
    expect(whenIn(en, tonight, "Europe/Berlin", now, null, true)).toBe("today, 11:00 PM (Europe/Berlin)");
    expect(whenIn(translator("de"), at("2026-11-02T23:06:00Z"), "Europe/Berlin", now, "Europe/Berlin")).toBe("Heute, 00:06");
    expect(whenIn(translator("de"), at("2026-11-02T22:06:00Z"), "Europe/Berlin", now, "Europe/Berlin")).toBe("Gestern, 23:06");
  });

  it("write a weekday short on its toggle, without the abbreviation's dot", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => shortWeekday(translator("en"), d))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect([1, 2, 7].map((d) => shortWeekday(translator("de"), d))).toEqual(["Mo", "Di", "So"]);
    expect([1, 3].map((d) => shortWeekday(translator("fr"), d))).toEqual(["Lun", "Mer"]);
    expect([3, 6].map((d) => shortWeekday(translator("es"), d))).toEqual(["Mié", "Sáb"]);
  });
});

describe("what a check's failed items offer", () => {
  it("retries only what a new try can fix, and leads to the job for the rest", () => {
    expect(failedAction({ failed: 3, retryable: 3, jobs: [{ id: "a", failed: 3 }] })).toEqual({ retry: 3, job: null });
    // Only failures Retry can't fix: no Retry ("0 items will be translated again"), the job instead.
    expect(
      failedAction({
        failed: 3,
        retryable: 0,
        jobs: [
          { id: "a", failed: 0 },
          { id: "b", failed: 3 },
        ],
      }),
    ).toEqual({ retry: 0, job: "b" });
    expect(failedAction({ failed: 4, retryable: 1, jobs: [{ id: "a", failed: 4 }] })).toEqual({ retry: 1, job: "a" });
    expect(failedAction({ failed: 0, retryable: 0, jobs: [{ id: "a", failed: 0 }] })).toEqual({ retry: 0, job: null });
  });
});

describe("a budget's meter", () => {
  it("fills by the share used, in the Plan page's tones, and shows none without a budget", () => {
    expect(budgetMeter(0, 50_000)).toEqual({ percent: 0, tone: "success" });
    expect(budgetMeter(12_400, 50_000)).toEqual({ percent: 24, tone: "success" });
    expect(budgetMeter(45_000, 50_000)).toEqual({ percent: 90, tone: "warning" });
    expect(budgetMeter(52_000, 50_000)).toEqual({ percent: 100, tone: "critical" });
    expect(budgetMeter(12_400, null)).toBeNull();
  });

  it("names the window and the figures in its bar, and says when no budget is set", () => {
    const withBudget = html(createElement(BudgetMeter, { label: "Used today", used: 12_400, budget: 50_000 }));
    expect(tags(withBudget, "div").find((tag) => tag.includes('role="progressbar"'))).toContain('aria-label="Used today: 12,400 of 50,000"');
    const without = html(createElement(BudgetMeter, { label: "Heute verbraucht", used: 12_400, budget: null }), "de");
    expect(without).not.toContain("progressbar");
    expect(without).toContain("12.400");
    expect(without).toContain("kein Limit gesetzt");
  });
});

describe("the smart page's choices", () => {
  const options = [
    { value: "daily", name: "Every day", line: "One full check a day", icon: "calendar-time" as const, tint: "violet" as const },
    { value: "manual", name: "Only on demand", line: "When you press “Check now”" },
  ];

  it("are native radio buttons in a fieldset named by its legend, each named by its tile and described by its line", () => {
    const markup = html(createElement(ChoiceTiles, { name: "mode", legend: "How often", options, defaultValue: "daily" }));
    expect(tags(markup, "fieldset")).toHaveLength(1);
    expect(markup).toContain('<legend class="lv-smart-choice__legend">How often</legend>');
    const radios = tags(markup, "input");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).toContain('type="radio"');
      expect(radio).toContain('name="mode"');
    }
    expect(radios[0]).toContain('value="daily"');
    expect(radios[0]).toContain("checked");
    expect(radios[1]).not.toContain("checked");
    // The line is the description, kept out of the name (never "Every dayOne full check a day").
    const describedBy = radios[0]!.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(markup).toContain(`<span id="${describedBy}" class="lv-smart-tile__line" aria-hidden="true">One full check a day</span>`);
    // A tile with an icon has it in its tinted square; one without shows its radio mark beside the name.
    expect(markup).toContain('data-tint="violet"');
    expect(markup).toContain("lv-smart-tile__face--plain");
  });

  it("are all disabled when read-only, and a legend a heading already says is for screen readers only", () => {
    const markup = html(createElement(ChoiceTiles, { name: "outdated", legend: "Outdated translations", legendHidden: true, options, defaultValue: "manual", disabled: true }));
    expect(tags(markup, "fieldset")[0]).toContain("disabled");
    for (const radio of tags(markup, "input")) expect(radio).toContain("disabled");
    expect(markup).toContain('<legend class="lv-sr">Outdated translations</legend>');
  });

  it("show the weekdays as seven toggles: native checkboxes named by the whole day, the chosen ones checked", () => {
    const markup = html(createElement(DayToggles, { name: "weekday", legend: "Tage", checked: [1, 4] }), "de");
    const boxes = tags(markup, "input");
    expect(boxes).toHaveLength(7);
    expect(boxes.map((box) => box.match(/aria-label="([^"]+)"/)?.[1])).toEqual(["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]);
    expect(boxes.map((box) => box.match(/value="(\d)"/)?.[1])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(boxes.filter((box) => box.includes("checked")).map((box) => box.match(/value="(\d)"/)?.[1])).toEqual(["1", "4"]);
    for (const box of boxes) expect(box).toContain('name="weekday"');
    expect(markup).toContain('<span class="lv-smart-day__face">Mo</span>');
    expect(markup).toContain('<legend class="lv-smart-days__legend">Tage</legend>');
  });
});

describe("the smart page's words for alt text and custom fields", () => {
  it("are its own field groups' names, also in the option that includes them (never “benutzerdefinierte Felder”)", () => {
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const label = i18n.t("automatic.attached.label").toLocaleLowerCase();
      for (const group of ["alt", "value"] as const) expect(label, `${locale} ${group}`).toContain(i18n.t(`coverage.group.${group}`).toLocaleLowerCase());
    }
    expect(translator("de").t("automatic.attached.label")).toBe("Auch Bildbeschreibungen und Zusatzinfos");
  });
});

describe("the smart schedule's banner", () => {
  const waiting = { state: "waiting", reason: "NO_LANGUAGE" } as const;

  it("waits with its own heading, and sends a missing language to Settings' button elsewhere", () => {
    const markup = html(createElement(SmartStateBanner, { status: waiting, zone: "Europe/Berlin" }));
    expect(markup).toContain('heading="Smart schedule is waiting"');
    expect(markup).toContain("Choose languages under Schedule and options.");
    expect(markup).not.toContain("#smart-scope");
  });

  it("on the smart page leads to the page's own language choice", () => {
    const markup = html(createElement(SmartStateBanner, { status: waiting, zone: "Europe/Berlin", onChooseLanguages: () => undefined }), "de");
    expect(markup).toContain('heading="Der intelligente Zeitplan wartet"');
    expect(markup).toContain("Wähle unter „Was übersetzt wird“ mindestens eine Sprache.");
    expect(markup).toContain('<s-link href="#smart-scope">Sprachen wählen</s-link>');
  });
});

describe("the summary before setup", () => {
  const empty = { status: { state: "off" } as const, nextChecks: [], lastSuccessAt: null, lastRun: null, translating: 0 };

  it("shows the suggestion the form holds, what the first check may use, and publishing in the option's words", () => {
    const markup = html(
      createElement(SmartPreview, {
        data: {
          ...empty,
          zone: "Europe/Berlin",
          config: { mode: "daily", times: [180], weekdays: [1, 2, 3, 4, 5, 6, 7], locales: ["de", "fr"] },
          estimate: 1234,
          publishing: "DRAFT",
          types: ["PRODUCT", "COLLECTION"],
        },
        languageNames: new Map([
          ["de", "Deutsch"],
          ["fr", "Französisch"],
        ]),
        omit: ["nextCheck", "lastSuccess", "lastRun"],
        now: at("2026-11-03T15:00:00Z"),
        shopZone: "Europe/Berlin",
        firstCheck: true,
      }),
      "de",
    );
    expect(markup).toContain("Jeden Tag um 03:00");
    expect(markup).toContain("Deutsch und Französisch");
    expect(markup).toContain("Produkte und Kollektionen");
    expect(markup).toContain("Erst prüfen");
    expect(markup).toContain("Beim ersten Abgleich");
    // An upper bound in AI characters, "KI-" never at a line's end.
    expect(markup).toContain("Höchstens 1.234 KI‑Zeichen; Wiederholtes wird nicht neu übersetzt");
  });

  it("says a schedule the server would refuse in its place, and counting in the app's one word for it", () => {
    const markup = html(
      createElement(SmartPreview, {
        data: {
          ...empty,
          zone: "UTC",
          config: { mode: "custom", times: [], weekdays: [], locales: [] },
          estimate: null,
          remeasure: false,
          scheduleNote: "Checks need to be at least an hour apart.",
        },
        languageNames: new Map(),
        omit: ["nextCheck", "lastSuccess", "lastRun"],
        now: at("2026-11-03T15:00:00Z"),
        shopZone: "UTC",
        firstCheck: true,
      }),
    );
    expect(markup).toContain('<s-text tone="caution">Checks need to be at least an hour apart.</s-text>');
    expect(markup).toContain("Not counted yet");
    expect(markup).toContain(">Count store</s-link>");
  });
});
