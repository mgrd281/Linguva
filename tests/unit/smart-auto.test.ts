/**
 * Smart Auto-Translate rules (pure): which types a check plans, when its
 * full checks run, when a pause lifts, and the server-side validation of
 * the settings form (every value from the browser is checked again).
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normaliseSmartSettings, type SmartSettingsContext, type SmartSettingsInput } from "../../app/.server/smart/validate";
import { BudgetMeter, budgetMeter, DayToggles, failedAction, sameScope, shortWeekday, SmartPreview, SmartStateBanner, whenIn } from "../../app/components/SmartAutoCard";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import { PLANS } from "../../app/lib/plans";
import { attachedOwner, budgetWindows, checkSpec, pauseLiftsAt, SMART_PAUSE_REASONS, smartCoverageTypes, smartStatus } from "../../app/lib/smart-auto";
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
  // How often, the texts and outdated translations are Settings' option cards (tests/unit/smart-page-render.test.ts).
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

  it("for outdated translations never end a line in “KI-” in German: a narrow card keeps the compound whole", () => {
    const { t } = translator("de");
    const lines = [t("automatic.outdated.replace.details"), t("automatic.outdated.keep.details", { outdated: t("coverage.state.outdated") })];
    for (const line of lines) expect(line).not.toContain("KI-");
    expect(lines[0]).toContain("KI‑Übersetzungen");
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

describe("the smart schedule's state row", () => {
  const waiting = { state: "waiting", reason: "NO_LANGUAGE" } as const;
  /** The row's bold title and the line under it (null without one), as read (React writes ' and & as entities). */
  const text = (html?: string) => (html === undefined ? null : html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  const row = (markup: string) => ({
    title: text(markup.match(/<strong class="lv-status__title">([^<]*)<\/strong>/)?.[1]),
    detail: text(markup.match(/<s-text color="subdued">([^<]*)<\/s-text>/)?.[1]),
  });

  it("is Settings' status row, not a banner: the reason as its title, what to do under it, a missing language sent to Settings' button elsewhere", () => {
    const markup = html(createElement(SmartStateBanner, { status: waiting, zone: "Europe/Berlin" }));
    expect(markup).toContain('<div class="lv-status" data-tone="warning">');
    expect(markup).not.toContain("<s-banner");
    expect(row(markup)).toEqual({ title: "No chosen language is in your plan", detail: "Choose languages under Schedule and options." });
    expect(markup).not.toContain("#smart-scope");
  });

  it("on the smart page leads to the page's own language choice, whose link needs no line saying it again", () => {
    const markup = html(createElement(SmartStateBanner, { status: waiting, zone: "Europe/Berlin", onChooseLanguages: () => undefined }), "de");
    expect(row(markup)).toEqual({ title: "Keine gewählte Sprache ist in deinem Tarif", detail: null });
    expect(markup).toContain('<s-link href="#smart-scope">Sprachen wählen</s-link>');
  });

  it("says what happens while jobs can't run, never a “background service”: paused, and Linguva continues by itself", () => {
    const markup = html(createElement(SmartStateBanner, { status: { state: "waiting", reason: "WORKER" }, zone: "Europe/Berlin" }));
    expect(row(markup)).toEqual({ title: "Translating paused", detail: "Linguva continues by itself as soon as it can." });
    for (const locale of APP_LOCALES) {
      expect(html(createElement(SmartStateBanner, { status: { state: "waiting", reason: "WORKER" }, zone: "UTC" }), locale), locale).not.toMatch(
        /background|worker|Hintergrund|arrière-plan|segundo plano/i,
      );
    }
  });

  it("not set up on this installation: its title alone (there is nothing the merchant can do)", () => {
    const markup = html(createElement(SmartStateBanner, { status: { state: "waiting", reason: "UNAVAILABLE" }, zone: "UTC" }));
    expect(row(markup)).toEqual({ title: "Not set up on this installation", detail: null });
  });

  it("waiting for the permission: the grant button beside it in place of a line; without one, the way to Settings", () => {
    const consent = { state: "waiting", reason: "CONSENT" } as const;
    const grant = createElement("button", { type: "submit" }, "Allow AI translation");
    const here = html(createElement(SmartStateBanner, { status: consent, zone: "UTC", consentAction: grant }));
    expect(row(here)).toEqual({ title: "Waiting for your permission", detail: null });
    expect(here).toContain('<button type="submit">Allow AI translation</button>');
    const elsewhere = html(createElement(SmartStateBanner, { status: consent, zone: "UTC" }));
    expect(row(elsewhere)).toEqual({ title: "Waiting for your permission", detail: "Allow AI translation first." });
    expect(elsewhere).toContain('<s-link href="/app/settings?section=ai">Settings</s-link>');
  });

  it("paused: Settings' few words for the reason, then when it continues by itself (the zone named)", () => {
    const until = at("2026-11-03T23:00:00Z");
    const budget = row(html(createElement(SmartStateBanner, { status: { state: "paused", reason: "BUDGET_DAILY", until }, zone: "Europe/Berlin" })));
    expect(budget.title).toBe("Today's budget used up");
    expect(budget.detail).toMatch(/^The smart schedule continues by itself from .+ \(Europe\/Berlin\)\. Whatever is still missing then is translated by the next check\.$/);
    // Paused by the merchant: no date and no second "paused".
    expect(row(html(createElement(SmartStateBanner, { status: { state: "paused", reason: "MANUAL", until: null }, zone: "UTC" }), "de"))).toEqual({
      title: "Von dir pausiert",
      detail: "Bis du fortsetzt, wird nichts abgeglichen oder übersetzt.",
    });
    // A changed main language: the page's own language choice beside it.
    const language = html(createElement(SmartStateBanner, { status: { state: "paused", reason: "PRIMARY_LANGUAGE", until: null }, zone: "UTC", onChooseLanguages: () => undefined }));
    expect(row(language).title).toBe("Main language changed");
    expect(language).toContain('<s-link href="#smart-scope">Choose languages</s-link>');
  });

  it("never says its title again in the line under it, for every reason in every language", () => {
    const until = at("2026-11-03T23:00:00Z");
    const statuses = [
      ...SMART_PAUSE_REASONS.map((reason) => ({ state: "paused" as const, reason, until })),
      ...(["PLAN", "CONSENT", "UNAVAILABLE", "WORKER", "NO_LANGUAGE"] as const).map((reason) => ({ state: "waiting" as const, reason })),
    ];
    for (const locale of APP_LOCALES) {
      for (const status of statuses) {
        const { title, detail } = row(html(createElement(SmartStateBanner, { status, zone: "Europe/Berlin" }), locale));
        expect(title, `${locale} ${status.state} ${status.reason}`).toBeTruthy();
        // Not set up on this installation: the title alone (the test before).
        if (status.reason === "UNAVAILABLE") continue;
        expect(detail, `${locale} ${status.state} ${status.reason}`).toBeTruthy();
        expect(detail!.toLocaleLowerCase(), `${locale} ${status.state} ${status.reason}`).not.toContain(title!.toLocaleLowerCase());
      }
    }
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
    // The state and its link apart: "Not counted yet · Count translations".
    expect(markup).toMatch(/Not counted yet · <span style="font-weight:400;white-space:nowrap"><s-link href="\/app\/coverage">Count translations<\/s-link><\/span>/);
  });

  it("picks its columns by the facts it shows, so no row ends half empty (cardColumns)", () => {
    const shown = (translating: number) =>
      html(
        createElement(SmartPreview, {
          data: { ...empty, zone: "UTC", config: null, lastSuccessAt: "2026-11-02T09:00:00.000Z", lastRun: { resourcesChanged: 3, fieldsDetected: 12 }, translating, estimate: null, publishing: "DRAFT" },
          languageNames: new Map(),
          omit: ["languages", "schedule", "content", "nextCheck"],
          now: at("2026-11-03T15:00:00Z"),
          shopZone: "UTC",
        }),
      );
    const columns = (markup: string) => markup.match(/<s-grid gridTemplateColumns="([^"]*)"/)![1];
    // Set up: the last complete check, what it found, publishing and the next check's characters, two by two.
    expect(columns(shown(0))).toBe("@container (inline-size &gt; 520px) 1fr 1fr, 1fr");
    expect(shown(0).match(/<s-icon type=/g)).toHaveLength(4);
    // Translating too: five, three in a row where there is room; work running now in the app's one look (in-progress, info).
    expect(columns(shown(4))).toBe("@container (inline-size &gt; 520px) 1fr 1fr, (inline-size &gt; 860px) 1fr 1fr 1fr, 1fr");
    expect(shown(4)).toContain('<s-icon type="in-progress" tone="info"></s-icon>');
    // The next check's figure in words that aren't the state's ("Waiting").
    expect(shown(0)).toContain(">For the next check</s-text>");
  });

  it("knows the scope the first check's figure was counted for, and no other", () => {
    const suggested = { locales: ["de", "fr"], types: ["PRODUCT", "COLLECTION"], fieldsChosen: false, attached: false, replace: true };
    // The form's lists come in its own order.
    expect(sameScope({ ...suggested, locales: ["fr", "de"], types: ["COLLECTION", "PRODUCT"] }, suggested)).toBe(true);
    // Any other languages or content, images and custom fields too, outdated ones kept, or only chosen fields.
    for (const other of [
      { locales: ["de"] },
      { locales: ["de", "fr", "es"] },
      { types: ["PRODUCT"] },
      { types: ["PRODUCT", "COLLECTION", "MENU"] },
      { types: ["PRODUCT", "MENU"] },
      { attached: true },
      { replace: false },
      { fieldsChosen: true },
    ]) {
      expect(sameScope({ ...suggested, ...other }, suggested), JSON.stringify(other)).toBe(false);
    }
    // Chosen fields aren't compared one by one: never the same, not even as each other.
    expect(sameScope({ ...suggested, fieldsChosen: true }, { ...suggested, fieldsChosen: true })).toBe(false);
  });
});
