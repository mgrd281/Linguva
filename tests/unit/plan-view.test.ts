/**
 * The Plan page's logic: the hero for each billing state (precedence:
 * owner access → billing off → UNKNOWN → stale → NONE → ACTIVE), the
 * meters' figures, and "Fits your store", computed only from the store's
 * own use.
 */
import { describe, expect, it } from "vitest";
import { allowedTargetLocales } from "../../app/.server/billing/subscription";
import {
  languageRoom,
  missedBy,
  planName,
  planView,
  recommendPlan,
  smallestPlanForLanguages,
  splitLanguages,
  usagePercent,
  type PlanViewInput,
  type ShopUse,
} from "../../app/lib/plan-view";
import { PLANS } from "../../app/lib/plans";

const NOW = "2026-10-30T09:12:00.000Z";
const URL = "https://admin.shopify.com/store/shop/charges/linguva/pricing_plans";
const sub = (extra: Partial<NonNullable<PlanViewInput["subscription"]>> = {}): NonNullable<PlanViewInput["subscription"]> => ({
  planHandle: "pro",
  pendingPlanHandle: null,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  currentPeriodEnd: "2026-11-28T00:00:00.000Z",
  checkedAt: "2026-10-30T09:00:00.000Z",
  ...extra,
});
const view = (extra: Partial<PlanViewInput> = {}) =>
  planView({ configured: true, state: "ACTIVE", stale: false, subscription: sub(), choosePlanUrl: URL, now: NOW, ...extra });

describe("the hero for each billing state", () => {
  it("shows an active plan with its sign, the change link and the quiet refresh", () => {
    expect(view()).toMatchObject({
      kind: "active",
      name: { handle: "pro" },
      icon: "bolt",
      badge: { tone: "success", icon: "check-circle", words: { key: "plan.status.active" } },
      lines: [],
      primary: "change",
      secondary: null,
      checkedAt: "2026-10-30T09:00:00.000Z",
      refresh: true,
      current: "pro",
      freeAppliesNow: false,
      pending: null,
      trialEndsAt: null,
    });
  });

  it("shows a running trial with its end and the trial allowance; a trial in the past is ignored", () => {
    const trial = view({ subscription: sub({ planHandle: "business", trialEndsAt: "2026-11-05T00:00:00.000Z" }) });
    expect(trial.badge).toEqual({ tone: "info", icon: "clock", words: { key: "plan.status.trial", dates: { date: "2026-11-05T00:00:00.000Z" } } });
    expect(trial.lines).toEqual([{ icon: null, words: { key: "plan.current.trialAllowance", vars: { trial: 100_000, limit: 4_000_000 } } }]);
    expect(trial.trialEndsAt).toBe("2026-11-05T00:00:00.000Z");
    const over = view({ subscription: sub({ trialEndsAt: "2026-10-29T00:00:00.000Z" }) });
    expect(over.badge?.words.key).toBe("plan.status.active");
    expect(over.lines).toEqual([]);
    expect(over.trialEndsAt).toBeNull();
  });

  it("names a pending change with its date, or the next billing period without one, and marks the plan's card", () => {
    const pending = view({ subscription: sub({ pendingPlanHandle: "starter" }) });
    expect(pending.lines).toEqual([{ icon: "calendar", words: { key: "plan.hero.line.pending", plans: { plan: "starter" }, dates: { date: "2026-11-28T00:00:00.000Z" } } }]);
    expect(pending.pending).toEqual({ handle: "starter", date: "2026-11-28T00:00:00.000Z" });
    const noDate = view({ subscription: sub({ pendingPlanHandle: "starter", currentPeriodEnd: null }) });
    expect(noDate.lines[0]!.words).toEqual({ key: "plan.hero.line.pendingNoDate", plans: { plan: "starter" } });
    expect(noDate.pending).toEqual({ handle: "starter", date: null });
  });

  it("shows a trial and a pending change together, the trial first", () => {
    const both = view({ subscription: sub({ planHandle: "business", trialEndsAt: "2026-11-05T00:00:00.000Z", pendingPlanHandle: "pro" }) });
    expect(both.lines.map((l) => l.words.key)).toEqual(["plan.current.trialAllowance", "plan.hero.line.pending"]);
  });

  it("says when a cancelled plan ends, before a trial, also without a date", () => {
    const ends = view({ subscription: sub({ cancelAtEndOfCycle: true, trialEndsAt: "2026-11-05T00:00:00.000Z" }) });
    expect(ends.badge).toEqual({ tone: "caution", icon: "calendar", words: { key: "plan.status.ends", dates: { date: "2026-11-28T00:00:00.000Z" } } });
    expect(ends.lines.map((l) => l.words.key)).toContain("plan.hero.line.ends");
    const noDate = view({ subscription: sub({ cancelAtEndOfCycle: true, currentPeriodEnd: null }) });
    expect(noDate.badge?.words).toEqual({ key: "plan.status.endsNoDate" });
  });

  it("names an unknown plan by its handle, says Free's limits apply, and marks Free's card, never 'Your plan'", () => {
    const unknown = view({ subscription: sub({ planHandle: "enterprise-private" }) });
    expect(unknown).toMatchObject({ name: { handle: "enterprise-private" }, icon: "plan", current: null, freeAppliesNow: true });
    expect(unknown.lines).toEqual([{ icon: "info", words: { key: "plan.hero.line.unknownHandle" } }]);
    expect(planName("enterprise-private")).toBe("Enterprise-private");
  });

  it("shows a verified 'no plan' with Free's limits and the choose link", () => {
    expect(view({ state: "NONE", subscription: sub({ planHandle: null }) })).toMatchObject({
      kind: "none",
      name: { key: "plan.hero.name.none" },
      icon: "plan",
      badge: null,
      lines: [{ icon: null, words: { key: "plan.hero.line.none" } }],
      primary: "choose",
      checkedAt: "2026-10-30T09:00:00.000Z",
      freeAppliesNow: true,
      current: null,
    });
  });

  it("never turns 'couldn't check' into 'no plan': UNKNOWN and stale offer 'Try again' first", () => {
    expect(view({ state: "UNKNOWN", subscription: null })).toMatchObject({
      kind: "unknown",
      name: { key: "plan.hero.name.unknown" },
      badge: { tone: "caution", icon: "alert-triangle", words: { key: "plan.status.unknown" } },
      lines: [{ icon: null, words: { key: "plan.hero.line.unknown" } }],
      primary: "retry",
      secondary: "change",
      checkedAt: null,
      freeAppliesNow: true,
    });
    // The last known plan, with the time it was confirmed; no trial or pending lines (they may be out of date).
    const stale = view({ stale: true, subscription: sub({ trialEndsAt: "2026-11-05T00:00:00.000Z", pendingPlanHandle: "starter" }) });
    expect(stale).toMatchObject({ kind: "stale", name: { handle: "pro" }, icon: "bolt", primary: "retry", secondary: "change", checkedAt: null, current: "pro" });
    expect(stale.badge?.words.key).toBe("plan.status.stale");
    expect(stale.lines).toEqual([{ icon: null, words: { key: "plan.hero.line.stale", dateTimes: { date: "2026-10-30T09:00:00.000Z" } } }]);
    expect(stale.pending).toBeNull();
    const staleNone = view({ stale: true, state: "NONE", subscription: sub({ planHandle: null }) });
    expect(staleNone).toMatchObject({ kind: "stale", name: { key: "plan.hero.name.none" }, secondary: "choose", current: null, freeAppliesNow: true });
  });

  it("shows owner access and billing off without plan links or a refresh", () => {
    expect(view({ state: "COMPLIMENTARY", subscription: null })).toMatchObject({
      kind: "complimentary",
      name: { key: "plan.hero.name.complimentary" },
      icon: "key",
      lines: [{ icon: null, words: { key: "plan.hero.line.complimentary" } }],
      primary: null,
      refresh: false,
      current: null,
    });
    expect(view({ configured: false, subscription: null, choosePlanUrl: null })).toMatchObject({
      kind: "unconfigured",
      name: { key: "plan.hero.name.unconfigured" },
      icon: "unlock",
      badge: { tone: "info", icon: "info", words: { key: "plan.status.unconfigured" } },
      lines: [],
      primary: null,
      refresh: false,
    });
  });

  it("without the app's handle there is no plan link; the quiet refresh stays", () => {
    expect(view({ choosePlanUrl: null })).toMatchObject({ primary: null, refresh: true, checkedAt: "2026-10-30T09:00:00.000Z" });
    expect(view({ state: "NONE", choosePlanUrl: null })).toMatchObject({ primary: null, refresh: true });
    expect(view({ state: "UNKNOWN", subscription: null, choosePlanUrl: null })).toMatchObject({ primary: "retry", secondary: null });
  });
});

describe("the meters", () => {
  it("shows whole percent, never rounding a little use up or down to a wrong word", () => {
    expect(usagePercent(120_000, 1_200_000)).toEqual({ percent: 10, tiny: false });
    expect(usagePercent(516, 1_200_000)).toEqual({ percent: 0, tiny: true });
    expect(usagePercent(0, 20_000)).toEqual({ percent: 0, tiny: false });
    expect(usagePercent(25_000, 20_000)).toEqual({ percent: 100, tiny: false });
    expect(usagePercent(1, 0)).toEqual({ percent: 100, tiny: false });
  });

  it("says the room for more languages, never more than Shopify allows", () => {
    expect(languageRoom(10, 4, 15)).toEqual({ kind: "room", count: 6 });
    // Business with 4 additional languages: the plan has 16 more, Shopify 15 (20 including the original).
    expect(languageRoom(20, 4, 15)).toEqual({ kind: "room", count: 15 });
    expect(languageRoom(3, 3, 10)).toEqual({ kind: "full" });
    expect(languageRoom(10, 4, 0)).toBeNull();
  });

  it("lists the plan's languages first, then the others, each by name; the plan's are the ones enforcement allows", () => {
    // Shopify's order (by English name): Danish, Dutch, French, German. Starter covers the first three.
    const targets = ["da", "nl", "fr", "de"];
    const allowed = allowedTargetLocales(PLANS.starter, targets);
    const names: Record<string, string> = { da: "Dänisch", nl: "Niederländisch", fr: "Französisch", de: "Deutsch" };
    const items = targets.map((locale) => ({ locale, name: locale, published: true, inPlan: allowed.includes(locale) }));
    const { inside, outside } = splitLanguages(items, (item) => names[item.locale]!, new Intl.Collator("de-DE"));
    expect(inside.map((i) => i.locale)).toEqual(["da", "fr", "nl"]);
    expect(outside.map((i) => i.locale)).toEqual(["de"]);
  });

  it("names the smallest plan that covers a number of languages", () => {
    expect(smallestPlanForLanguages(0)).toBe("free");
    expect(smallestPlanForLanguages(4)).toBe("pro");
    expect(smallestPlanForLanguages(20)).toBe("business");
    expect(smallestPlanForLanguages(21)).toBeNull();
  });
});

describe("Fits your store", () => {
  const use = (extra: Partial<ShopUse> = {}): ShopUse => ({ languages: 1, monthChars: 0, bulk: false, auto: false, autoPublish: false, smart: false, ...extra });

  it("recommends the smallest plan that covers the store's use, and says why (what the next smaller plan misses)", () => {
    expect(recommendPlan(use({ languages: 4 }))).toEqual({ plan: "pro", reasons: ["languages"] });
    expect(recommendPlan(use({ smart: true }))).toEqual({ plan: "business", reasons: ["smart"] });
    expect(recommendPlan(use({ languages: 2, autoPublish: true }))).toEqual({ plan: "pro", reasons: ["autoPublish"] });
    expect(recommendPlan(use({ monthChars: 20_000 }))).toEqual({ plan: "starter", reasons: ["chars"] });
    expect(recommendPlan(use({ languages: 3, bulk: true }))).toEqual({ plan: "starter", reasons: ["languages", "bulk"] });
    expect(recommendPlan(use({ auto: true }))).toEqual({ plan: "starter", reasons: ["auto"] });
  });

  it("recommends Free, without reasons, for a store that uses little", () => {
    expect(recommendPlan(use({ languages: 0 }))).toEqual({ plan: "free", reasons: [] });
    expect(recommendPlan(use({ monthChars: 19_999 }))).toEqual({ plan: "free", reasons: [] });
  });

  it("recommends nothing when no plan fits", () => {
    expect(recommendPlan(use({ monthChars: 4_000_000 }))).toBeNull();
    expect(recommendPlan(use({ languages: 21 }))).toBeNull();
  });

  it("compares with the plans' own allowances, never a trial's, and doesn't count glossary terms", () => {
    // 150,000 used during a trial (allowance 100,000): Starter's 300,000 still fits.
    expect(recommendPlan(use({ monthChars: 150_000 }))).toEqual({ plan: "starter", reasons: ["chars"] });
    expect(missedBy(PLANS.free, use({ languages: 2, monthChars: 20_000, bulk: true, auto: true, autoPublish: true, smart: true }))).toEqual([
      "languages",
      "chars",
      "bulk",
      "auto",
      "autoPublish",
      "smart",
    ]);
  });
});
