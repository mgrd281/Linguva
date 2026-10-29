/**
 * Smart Auto-Translate rules (pure): which types a check plans, when its
 * full checks run, when a pause lifts, and the server-side validation of
 * the settings form (every value from the browser is checked again).
 */
import { describe, expect, it } from "vitest";
import { normaliseSmartSettings, type SmartSettingsContext, type SmartSettingsInput } from "../../app/.server/smart/validate";
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
