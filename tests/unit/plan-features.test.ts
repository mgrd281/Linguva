/**
 * What the Plan page compares: values from PLANS (never copied numbers),
 * "In every plan" exactly the rows every plan includes, and one public
 * Polaris icon per feature, used for nothing else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureTableCounts } from "../../app/components/plan/PlanFeatureTable";
import { everyPlanRows, FEATURE_ICON, PLAN_CARD_FEATURES, PLAN_FEATURE_ROWS, PLAN_ICON, PRICE_ROW, STATE_ICON, type FeatureKey } from "../../app/lib/plan-features";
import { PLAN_PRICES, PLANS, type PlanHandle } from "../../app/lib/plans";

const HANDLES = Object.keys(PLANS) as PlanHandle[];
const ROWS = PLAN_FEATURE_ROWS.flatMap((group) => group.rows);
const row = (key: FeatureKey) => ROWS.find((r) => r.key === key)!;

/** The public icon names (@shopify/polaris-types: `type IconType = …`). */
const PUBLIC_ICONS = (() => {
  const types = readFileSync(join(__dirname, "..", "..", "node_modules", "@shopify", "polaris-types", "dist", "polaris.d.ts"), "utf8");
  const union = /type IconType = ([^;]+);/.exec(types)![1]!;
  return new Set([...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!));
})();

describe("plan comparison", () => {
  it("has 18 rows in 5 groups, as the table's summary says (the price row isn't counted)", () => {
    expect(ROWS).toHaveLength(18);
    expect(PLAN_FEATURE_ROWS).toHaveLength(5);
    expect(featureTableCounts()).toEqual({ rows: 18, groups: 5 });
    expect(ROWS.map((r) => r.key)).not.toContain(PRICE_ROW.key);
  });

  it("takes every gated value from PLANS, for every plan", () => {
    for (const handle of HANDLES) {
      const plan = PLANS[handle];
      expect(row("chars").value(plan), handle).toBe(plan.monthlyChars);
      expect(row("languages").value(plan), handle).toBe(plan.maxTargetLocales);
      expect(row("bulk").value(plan), handle).toBe(plan.bulk);
      // Automatic translation of new content needs bulk translation.
      expect(row("auto").value(plan), handle).toBe(plan.bulk);
      expect(row("glossary").value(plan), handle).toBe(plan.glossary);
      expect(row("autoPublish").value(plan), handle).toBe(plan.autoPublish);
      expect(row("smart").value(plan), handle).toBe(plan.smartAuto);
    }
  });

  it("shows on each card the five rows plans differ in, in the same order", () => {
    expect(PLAN_CARD_FEATURES.map((r) => r.key)).toEqual(["bulk", "auto", "glossary", "autoPublish", "smart"]);
  });

  it("lists in 'In every plan' exactly the rows every plan includes (verified ungated in the code), in the table's order", () => {
    const strip = everyPlanRows(Object.values(PLANS));
    expect(strip.map((r) => r.key)).toEqual(["manual", "aiOne", "seo", "images", "hints", "approve", "restore", "memory", "csv", "coverage", "markets"]);
    // Every other row differs between plans.
    for (const r of ROWS.filter((x) => !strip.includes(x))) expect(new Set(HANDLES.map((h) => r.value(PLANS[h]))).size, r.key).toBeGreaterThan(1);
  });

  it("has a price for exactly the plans compared", () => {
    expect(Object.keys(PLAN_PRICES).sort()).toEqual([...HANDLES].sort());
  });
});

describe("icons", () => {
  it("gives every feature its own public Polaris icon", () => {
    const keys = [PRICE_ROW.key, ...ROWS.map((r) => r.key)];
    expect(Object.keys(FEATURE_ICON).sort()).toEqual([...keys].sort());
    const icons = Object.values(FEATURE_ICON);
    expect(icons).toHaveLength(19);
    expect(new Set(icons).size).toBe(19);
    for (const icon of [...icons, ...Object.values(PLAN_ICON), ...Object.values(STATE_ICON)]) expect(PUBLIC_ICONS.has(icon), icon).toBe(true);
  });

  it("never reuses a feature's icon for a plan or a state, and no star (it would read as 'popular')", () => {
    const features = new Set(Object.values(FEATURE_ICON));
    for (const icon of [...Object.values(PLAN_ICON), ...Object.values(STATE_ICON)]) expect(features.has(icon), icon).toBe(false);
    expect(new Set(Object.values(PLAN_ICON)).size).toBe(4);
    expect([...Object.values(PLAN_ICON), ...Object.values(STATE_ICON)].some((icon) => icon.startsWith("star"))).toBe(false);
  });
});
