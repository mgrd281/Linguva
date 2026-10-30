/**
 * What the Plan page compares (client-safe): the five rows every plan card
 * shows, the full table's 18 rows in 5 groups, the "In every plan" strip and
 * one icon per feature. Values come from PLANS for every row a plan gates;
 * `true` only for rows verified ungated in the code (docs/BILLING_DESIGN.md,
 * the Plan page spec's Appendix A), so the page can't promise more than
 * enforcement gives. Labels are literal message keys.
 */
import type { MessageKey } from "../i18n/i18n";
import type { IconType } from "./icons";
import type { Entitlements, PlanHandle } from "./plans";

export type FeatureKey =
  | "price"
  | "chars"
  | "languages"
  | "manual"
  | "aiOne"
  | "bulk"
  | "seo"
  | "images"
  | "glossary"
  | "hints"
  | "auto"
  | "smart"
  | "approve"
  | "autoPublish"
  | "restore"
  | "memory"
  | "csv"
  | "coverage"
  | "markets";

/**
 * One icon per feature, used for that feature everywhere (card, table,
 * strip) and for nothing else. Where the app already shows the same thing
 * with an icon, it is that icon (Settings › Tools, AI buttons, the smart
 * schedule).
 */
export const FEATURE_ICON: Record<FeatureKey, IconType> = {
  price: "cash-dollar",
  chars: "gauge",
  languages: "language",
  manual: "edit",
  aiOne: "wand",
  bulk: "categories",
  seo: "search",
  images: "image-alt",
  glossary: "book-open",
  hints: "alert-bubble",
  auto: "automation",
  smart: "calendar-time",
  approve: "eye-check-mark",
  autoPublish: "send",
  restore: "clock-revert",
  memory: "database",
  csv: "transfer",
  coverage: "chart-donut",
  markets: "globe",
};

/** Each plan's own sign (never a feature's icon, never a star: that would read as "popular"). */
export const PLAN_ICON: Record<PlanHandle, IconType> = {
  free: "play-circle",
  starter: "rocket",
  pro: "bolt",
  business: "organization",
};

/** The hero's sign when the store has no plan of its own to show. */
export const STATE_ICON = {
  complimentary: "key",
  unconfigured: "unlock",
  none: "plan",
  unknown: "plan",
} as const satisfies Record<string, IconType>;

export interface FeatureRow {
  key: FeatureKey;
  label: MessageKey;
  detail: MessageKey | null;
  /** The plan's value: a number (characters, languages) or whether it is included. */
  value: (plan: Entitlements) => number | boolean;
  /** The strip's wording, where it differs from the table's. */
  everyPlanLabel?: MessageKey;
}

export interface FeatureGroup {
  key: "limits" | "translate" | "automatic" | "publish" | "tools";
  label: MessageKey;
  rows: FeatureRow[];
}

const all = () => true;

const ROWS = {
  chars: { key: "chars", label: "plan.compare.chars", detail: "plan.row.chars.detail", value: (p) => p.monthlyChars },
  // The table's details are phrases without a full stop; the hero says the same as a sentence (plan.languages.manualAlways).
  languages: { key: "languages", label: "plan.languages.label", detail: "plan.row.languages.detail", value: (p) => p.maxTargetLocales },
  manual: { key: "manual", label: "plan.row.manual", detail: "plan.row.manual.detail", value: all, everyPlanLabel: "plan.everyPlan.manual" },
  aiOne: { key: "aiOne", label: "plan.row.aiOne", detail: "plan.row.aiOne.detail", value: all },
  bulk: { key: "bulk", label: "plan.feature.bulk", detail: "plan.row.bulk.detail", value: (p) => p.bulk },
  seo: { key: "seo", label: "plan.row.seo", detail: "plan.row.seo.detail", value: all },
  images: { key: "images", label: "plan.row.images", detail: null, value: all },
  glossary: { key: "glossary", label: "plan.feature.glossary", detail: "plan.row.glossary.detail", value: (p) => p.glossary },
  hints: { key: "hints", label: "plan.everyPlan.hints", detail: "plan.row.hints.detail", value: all },
  // Automatic translation of new content needs bulk translation (app.settings.tsx, auto-translate.ts).
  auto: { key: "auto", label: "plan.feature.auto", detail: "plan.row.auto.detail", value: (p) => p.bulk },
  smart: { key: "smart", label: "automatic.name", detail: "plan.row.smart.detail", value: (p) => p.smartAuto },
  approve: { key: "approve", label: "plan.everyPlan.approve", detail: "plan.row.approve.detail", value: all },
  autoPublish: { key: "autoPublish", label: "plan.feature.autoPublish", detail: "plan.row.autoPublish.detail", value: (p) => p.autoPublish },
  restore: { key: "restore", label: "plan.row.restore", detail: null, value: all },
  memory: { key: "memory", label: "common.nav.memory", detail: "plan.row.memory.detail", value: all },
  csv: { key: "csv", label: "plan.everyPlan.csv", detail: null, value: all },
  coverage: { key: "coverage", label: "plan.row.coverage", detail: "plan.row.coverage.detail", value: all },
  markets: { key: "markets", label: "settings.tools.markets.label", detail: "settings.tools.markets.detail", value: all },
} as const satisfies Record<Exclude<FeatureKey, "price">, FeatureRow>;

/** The full table: 18 rows in 5 groups (the price row comes first, outside the groups). */
export const PLAN_FEATURE_ROWS: FeatureGroup[] = [
  { key: "limits", label: "plan.table.group.limits", rows: [ROWS.chars, ROWS.languages] },
  { key: "translate", label: "plan.table.group.translate", rows: [ROWS.manual, ROWS.aiOne, ROWS.bulk, ROWS.seo, ROWS.images, ROWS.glossary, ROWS.hints] },
  { key: "automatic", label: "plan.table.group.automatic", rows: [ROWS.auto, ROWS.smart] },
  { key: "publish", label: "plan.table.group.publish", rows: [ROWS.approve, ROWS.autoPublish, ROWS.restore] },
  { key: "tools", label: "settings.tools.heading", rows: [ROWS.memory, ROWS.csv, ROWS.coverage, ROWS.markets] },
];

/** The table's first row: the monthly price (its detail names the yearly prices). */
export const PRICE_ROW = { key: "price", label: "plan.price.rowMonth", detail: "plan.price.rowYearly" } as const satisfies Pick<FeatureRow, "key" | "label" | "detail">;

/** What the plans differ in besides the numbers: five rows, the same order on every card. */
export const PLAN_CARD_FEATURES: FeatureRow[] = [ROWS.bulk, ROWS.auto, ROWS.glossary, ROWS.autoPublish, ROWS.smart];

/** The rows every plan includes, in the table's order: the "In every plan" strip is derived, so it can't drift. */
export function everyPlanRows(plans: readonly Entitlements[]): FeatureRow[] {
  return PLAN_FEATURE_ROWS.flatMap((group) => group.rows).filter((row) => plans.every((plan) => row.value(plan) === true));
}
