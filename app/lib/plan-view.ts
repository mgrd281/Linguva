/**
 * What the Plan page says, as pure functions of its data (client-safe):
 * the hero's state with its badge, lines and actions, the meters'
 * figures, and the recommendation "Fits your store", computed only from
 * the store's own use. Every state is an icon and words.
 */
import type { MessageKey, MessageVars } from "../i18n/i18n";
import type { IconType } from "./icons";
import { PLAN_ICON, STATE_ICON } from "./plan-features";
import { inTrial } from "./plan-prices";
import { PLANS, TRIAL_AI_CHARS, type Entitlements, type PlanHandle } from "./plans";

export const PLAN_ORDER = Object.keys(PLANS) as PlanHandle[];

export function isPlanHandle(handle: string | null | undefined): handle is PlanHandle {
  return Boolean(handle) && Object.hasOwn(PLANS, handle!);
}

/** A plan's name as the app shows it: the brand name from the handle ("Pro"), also for a handle the app doesn't know. */
export function planName(handle: string): string {
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

export interface PlanSubscriptionView {
  planHandle: string | null;
  pendingPlanHandle: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  currentPeriodEnd: string | null;
  checkedAt: string;
}

export interface PlanViewInput {
  configured: boolean;
  state: "ACTIVE" | "NONE" | "UNKNOWN" | "COMPLIMENTARY";
  stale: boolean;
  subscription: PlanSubscriptionView | null;
  choosePlanUrl: string | null;
  /** The loader's time (ISO). */
  now: string;
}

/** A text as a message key with its values; dates are passed as ISO strings and formatted by the page. */
export interface Words {
  key: MessageKey;
  vars?: MessageVars;
  /** Values that are dates (ISO), shown as day and month. */
  dates?: Record<string, string>;
  /** Values that are times (ISO), shown as date and time in UTC. */
  dateTimes?: Record<string, string>;
  /** Values that are plan handles, shown as plan names. */
  plans?: Record<string, string>;
}

export type Tone = "success" | "info" | "caution";

export interface HeroView {
  kind: "complimentary" | "unconfigured" | "unknown" | "stale" | "none" | "active";
  /** A plan's handle (its brand name), or a state's name. */
  name: { handle: string } | { key: MessageKey };
  icon: IconType;
  badge: { tone: Tone; icon: IconType; words: Words } | null;
  lines: Array<{ icon: IconType | null; words: Words }>;
  /** The main action: change or choose a plan (a link to Shopify's page), or try the check again. */
  primary: "change" | "choose" | "retry" | null;
  /** A second link to Shopify's page next to "Try again". */
  secondary: "change" | "choose" | null;
  /** "As of …" with the quiet refresh. */
  checkedAt: string | null;
  /** The refresh form exists (as the primary "Try again" or the quiet "Refresh"). */
  refresh: boolean;
  /** The plan card marked "Your plan". */
  current: PlanHandle | null;
  /** Free's card says "Applies now": the store has no (known) plan. */
  freeAppliesNow: boolean;
  /** The plan the store changes to, with its date (card badge "from …"). */
  pending: { handle: PlanHandle; date: string | null } | null;
  /** A Shopify trial runs (its end, ISO). */
  trialEndsAt: string | null;
  /** The trial's end when the plan's own allowance is bigger than the trial's (ISO): more AI characters from then on. */
  allowanceRisesAt: string | null;
}

/**
 * The hero for each billing state. Precedence: owner access → billing off
 * → UNKNOWN → stale → NONE → ACTIVE (badge: ends > trial > active; a
 * pending change adds its line). "Couldn't check" is never "no plan".
 */
export function planView(input: PlanViewInput): HeroView {
  const sub = input.subscription;
  const canChoose = input.choosePlanUrl !== null;
  const base: Pick<HeroView, "lines" | "checkedAt" | "refresh" | "current" | "freeAppliesNow" | "pending" | "trialEndsAt" | "allowanceRisesAt" | "secondary"> = {
    lines: [],
    checkedAt: null,
    refresh: false,
    current: null,
    freeAppliesNow: false,
    pending: null,
    trialEndsAt: null,
    allowanceRisesAt: null,
    secondary: null,
  };
  if (input.state === "COMPLIMENTARY") {
    return {
      ...base,
      kind: "complimentary",
      name: { key: "plan.hero.name.complimentary" },
      icon: STATE_ICON.complimentary,
      badge: { tone: "success", icon: "check-circle", words: { key: "plan.status.active" } },
      lines: [{ icon: null, words: { key: "plan.hero.line.complimentary" } }],
      primary: null,
    };
  }
  if (!input.configured) {
    return {
      ...base,
      kind: "unconfigured",
      name: { key: "plan.hero.name.unconfigured" },
      icon: STATE_ICON.unconfigured,
      badge: { tone: "info", icon: "info", words: { key: "plan.status.unconfigured" } },
      primary: null,
    };
  }
  if (input.state === "UNKNOWN") {
    return {
      ...base,
      kind: "unknown",
      name: { key: "plan.hero.name.unknown" },
      icon: STATE_ICON.unknown,
      badge: { tone: "caution", icon: "alert-triangle", words: { key: "plan.status.unknown" } },
      lines: [{ icon: null, words: { key: "plan.hero.line.unknown" } }],
      primary: "retry",
      secondary: canChoose ? "change" : null,
      refresh: true,
      freeAppliesNow: true,
    };
  }
  const handle = input.state === "ACTIVE" ? (sub?.planHandle ?? null) : null;
  const known = isPlanHandle(handle) ? handle : null;
  if (input.stale) {
    return {
      ...base,
      kind: "stale",
      name: handle ? { handle } : { key: "plan.hero.name.none" },
      icon: known ? PLAN_ICON[known] : STATE_ICON.none,
      badge: { tone: "caution", icon: "alert-triangle", words: { key: "plan.status.stale" } },
      // No trial or pending lines: they may be out of date.
      lines: [{ icon: null, words: { key: "plan.hero.line.stale", dateTimes: sub ? { date: sub.checkedAt } : {} } }],
      primary: "retry",
      secondary: canChoose ? (handle ? "change" : "choose") : null,
      refresh: true,
      current: known,
      freeAppliesNow: !known,
    };
  }
  if (input.state === "NONE") {
    return {
      ...base,
      kind: "none",
      name: { key: "plan.hero.name.none" },
      icon: STATE_ICON.none,
      badge: null,
      lines: [{ icon: null, words: { key: "plan.hero.line.none" } }],
      primary: canChoose ? "choose" : null,
      checkedAt: sub?.checkedAt ?? null,
      refresh: true,
      freeAppliesNow: true,
    };
  }
  // ACTIVE: a plan (an unknown handle gets Free's limits and says so).
  const trial = inTrial({ state: input.state, stale: input.stale, subscription: sub, now: input.now });
  const ends = sub?.cancelAtEndOfCycle ?? false;
  const badge: HeroView["badge"] = ends
    ? { tone: "caution", icon: "calendar", words: sub?.currentPeriodEnd ? { key: "plan.status.ends", dates: { date: sub.currentPeriodEnd } } : { key: "plan.status.endsNoDate" } }
    : trial
      ? { tone: "info", icon: "clock", words: { key: "plan.status.trial", dates: { date: sub!.trialEndsAt! } } }
      : { tone: "success", icon: "check-circle", words: { key: "plan.status.active" } };
  const lines: HeroView["lines"] = [];
  // The trial's allowance is lower than the plan's: the plan's applies when the trial ends.
  const rises = trial && known !== null && PLANS[known].monthlyChars > TRIAL_AI_CHARS;
  if (rises) {
    lines.push({ icon: null, words: { key: "plan.current.trialAllowance", vars: { trial: TRIAL_AI_CHARS, limit: PLANS[known!].monthlyChars } } });
  }
  const pendingHandle = sub?.pendingPlanHandle ?? null;
  if (pendingHandle) {
    lines.push({
      icon: "calendar",
      words: sub?.currentPeriodEnd
        ? { key: "plan.hero.line.pending", plans: { plan: pendingHandle }, dates: { date: sub.currentPeriodEnd } }
        : { key: "plan.hero.line.pendingNoDate", plans: { plan: pendingHandle } },
    });
  }
  if (ends) lines.push({ icon: null, words: { key: "plan.hero.line.ends" } });
  if (!known) lines.push({ icon: "info", words: { key: "plan.hero.line.unknownHandle" } });
  return {
    kind: "active",
    name: { handle: handle ?? "free" },
    icon: known ? PLAN_ICON[known] : STATE_ICON.unknown,
    badge,
    lines,
    primary: canChoose ? "change" : null,
    secondary: null,
    checkedAt: sub?.checkedAt ?? null,
    refresh: true,
    current: known,
    freeAppliesNow: !known,
    pending: isPlanHandle(pendingHandle) ? { handle: pendingHandle, date: sub?.currentPeriodEnd ?? null } : null,
    trialEndsAt: trial ? sub!.trialEndsAt : null,
    allowanceRisesAt: rises ? sub!.trialEndsAt : null,
  };
}

/**
 * When the store next gets more AI characters: the 1st of the next UTC
 * month, or a running trial's end when that comes first and the plan's own
 * allowance starts then (enforcement follows the clock: subscription.ts).
 */
export function nextCharsOn(hero: Pick<HeroView, "allowanceRisesAt">, resetsOn: string): string {
  const rises = hero.allowanceRisesAt;
  return rises && Date.parse(rises) < Date.parse(resetsOn) ? rises : resetsOn;
}

/** "10 % used": whole percent, 0–100; `tiny` when something is used but less than 1 %. */
export function usagePercent(used: number, limit: number): { percent: number; tiny: boolean } {
  if (limit <= 0) return { percent: 100, tiny: false };
  const percent = Math.max(0, Math.min(100, Math.floor((used * 100) / limit)));
  return { percent, tiny: used > 0 && percent === 0 };
}

/**
 * What the languages meter says about room: "Room for 6 more languages"
 * (the plan's room, but never more than Shopify still allows), "All places
 * taken" when the plan is full, or nothing when only Shopify is full.
 */
export function languageRoom(maxTargetLocales: number, inPlan: number, shopifyRoom: number): { kind: "room"; count: number } | { kind: "full" } | null {
  if (inPlan >= maxTargetLocales) return { kind: "full" };
  const count = Math.min(maxTargetLocales - inPlan, shopifyRoom);
  return count > 0 ? { kind: "room", count } : null;
}

export interface LanguageItem {
  locale: string;
  name: string;
  published: boolean;
  inPlan: boolean;
}

/** The store's languages: inside the plan first, then outside, each by name in the interface language. */
export function splitLanguages<T extends LanguageItem>(items: readonly T[], label: (item: T) => string, collator: Intl.Collator): { inside: T[]; outside: T[] } {
  const sorted = [...items].sort((a, b) => collator.compare(label(a), label(b)));
  return { inside: sorted.filter((i) => i.inPlan), outside: sorted.filter((i) => !i.inPlan) };
}

/** The smallest plan whose languages cover this many (for "you need at least Pro"); null if none does. */
export function smallestPlanForLanguages(count: number): PlanHandle | null {
  return PLAN_ORDER.find((handle) => PLANS[handle].maxTargetLocales >= count) ?? null;
}

/** What the store really uses (the Plan page's loader): its languages, this month's AI characters and the plan features it switched on. */
export interface ShopUse {
  /** Every additional language, published or hidden (they all count toward the plan). */
  languages: number;
  /** AI characters this UTC month. */
  monthChars: number;
  /** A bulk job of its own in the last 30 days. */
  bulk: boolean;
  /** Automatic translation of new content is on. */
  auto: boolean;
  /** Automatic publishing is on. */
  autoPublish: boolean;
  /** The smart schedule is on. */
  smart: boolean;
}

export type FitReason = "languages" | "chars" | "bulk" | "auto" | "autoPublish" | "smart";

/** Why a plan doesn't fit the store's use, in this order. Glossary terms are no reason: they apply on every plan. */
export function missedBy(plan: Entitlements, use: ShopUse): FitReason[] {
  const reasons: FitReason[] = [];
  if (use.languages > plan.maxTargetLocales) reasons.push("languages");
  // The plan must allow more than is already used.
  if (use.monthChars >= plan.monthlyChars) reasons.push("chars");
  if (use.bulk && !plan.bulk) reasons.push("bulk");
  if (use.auto && !plan.bulk) reasons.push("auto");
  if (use.autoPublish && !plan.autoPublish) reasons.push("autoPublish");
  if (use.smart && !plan.smartAuto) reasons.push("smart");
  return reasons;
}

/**
 * "Fits your store": the smallest plan that covers what the store really
 * uses, and why (what the next smaller plan misses). Compared with the
 * plans' own allowances (PLANS), never a trial's. Null when no plan fits.
 */
export function recommendPlan(use: ShopUse): { plan: PlanHandle; reasons: FitReason[] } | null {
  for (let i = 0; i < PLAN_ORDER.length; i++) {
    if (missedBy(PLANS[PLAN_ORDER[i]!], use).length === 0) {
      return { plan: PLAN_ORDER[i]!, reasons: i === 0 ? [] : missedBy(PLANS[PLAN_ORDER[i - 1]!], use) };
    }
  }
  return null;
}
