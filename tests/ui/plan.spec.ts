/**
 * The Plan page (docs/PRICING_DECISION.md §10.3, SPEC-plan C.8): list prices
 * from PLAN_PRICES (never typed here), a yearly line only where a yearly
 * price exists, the trial line only for a store without a plan, "Fits your
 * store" computed from the store's own use and never a popularity claim,
 * every feature with its icon, and each billing state in words.
 *
 * The Partner API is simulated: no charge can be created, and the plan
 * buttons only link to Shopify's plan page. Billing off (a server without
 * Partner settings, KARINEX today) is rendered in
 * tests/unit/plan-components.test.ts: this server has billing on.
 */
import { expect, test, type Page } from "@playwright/test";
import { translator } from "../../app/i18n/i18n";
import { FEATURE_ICON } from "../../app/lib/plan-features";
import { formatUsd, monthsFree, priceLabel, yearlyHandles } from "../../app/lib/plan-prices";
import { PLAN_PRICES, PLANS, TRIAL_AI_CHARS, TRIAL_DAYS, type PlanHandle } from "../../app/lib/plans";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp } from "./helpers";

const de = translator("de");
const en = translator("en");
const NAMES: Record<PlanHandle, string> = { free: "Free", starter: "Starter", pro: "Pro", business: "Business" };
const HANDLES = Object.keys(NAMES) as PlanHandle[];
const POPULAR = /popular|beliebt|empfohlen|recommended|best/i;
const FEATURE_ICONS = new Set<string>(Object.values(FEATURE_ICON));

/** A plan's card: a group named by the plan. */
const card = (page: Page, handle: PlanHandle) => page.getByRole("group", { name: NAMES[handle], exact: true });
const trialLine = (i18n: typeof en) => i18n.t("plan.price.trial", { count: TRIAL_DAYS, chars: i18n.number(TRIAL_AI_CHARS) });

async function badges(page: Page) {
  return page.locator("s-page s-badge").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
}

test("German, on Pro: list prices, the yearly lines, the footnote and one fitting plan, no popularity claim", async ({ page }) => {
  await openApp(page, "full", "/app/plan", { locale: "de" });
  await expect(page.getByRole("heading", { name: "Dein Tarif: Pro" })).toBeVisible();

  for (const handle of HANDLES) {
    const price = PLAN_PRICES[handle];
    const c = card(page, handle);
    await expect(c, handle).toContainText(priceLabel(de, handle));
    if (price.monthlyUsd > 0) await expect(c, handle).toContainText(de.t("plan.price.perMonth"));
    else await expect(c, handle).not.toContainText(de.t("plan.price.perMonth"));
    if (price.yearlyUsd !== null) {
      await expect(c, handle).toContainText(de.t("plan.price.yearly", { amount: formatUsd("de", price.yearlyUsd) }));
      await expect(c.locator("s-badge", { hasText: de.t("plan.price.monthsFree", { count: monthsFree(handle)! }) }), handle).toHaveCount(1);
    } else {
      await expect(c, handle).not.toContainText(" / Jahr");
      if (price.monthlyUsd > 0) await expect(c, handle).toContainText(de.t("plan.price.monthlyOnly"));
      else await expect(c, handle).not.toContainText(de.t("plan.price.monthlyOnly"));
    }
  }
  // Two yearly lines (Starter, Pro), no switch between monthly and yearly, no "0 $".
  await expect(page.getByText(/^oder [\d.]+\s\$ \/ Jahr$/)).toHaveCount(yearlyHandles().length);
  await expect(page.locator('[role="switch"], s-switch')).toHaveCount(0);
  await expect(page.locator("s-page")).not.toContainText(/(^|\s)0\s\$/);
  await expect(page.getByText(de.t("plan.price.footnote"))).toBeVisible();

  // One plan fits the store, said with the reason, and marked on that card only.
  const line = page.getByText(/^Passt zu deinem Shop: (Free|Starter|Pro|Business)\.$/);
  await expect(line).toHaveCount(1);
  const fits = (await line.textContent())!.replace(/^Passt zu deinem Shop: |\.$/g, "");
  const badge = page.locator("s-badge", { hasText: de.t("plan.recommend.badge") });
  await expect(badge).toHaveCount(1);
  await expect(card(page, HANDLES.find((h) => NAMES[h] === fits)!).locator("s-badge", { hasText: de.t("plan.recommend.badge") })).toHaveCount(1);
  for (const text of await badges(page)) expect(text).not.toMatch(POPULAR);

  // The store has a plan: no trial offer.
  await expect(page.getByText(trialLine(de))).toHaveCount(0);
  // The current plan is marked, and it has no button of its own.
  await expect(card(page, "pro").locator("s-badge", { hasText: "Dein Tarif" })).toHaveCount(1);
  await expect(card(page, "pro").locator("s-button")).toHaveCount(0);
  for (const handle of ["free", "starter", "business"] as const) {
    const choose = card(page, handle).locator("s-button");
    await expect(choose).toHaveText(de.t("plan.compare.choose", { plan: NAMES[handle] }));
    await expect(choose).toHaveAttribute("href", "https://admin.shopify.com/store/ui-full/charges/linguva-ui-test/pricing_plans");
    await expect(choose).toHaveAttribute("target", "_top");
  }
});

test("English: prices like $29, Free as a word, and the price row in the full comparison", async ({ page }) => {
  await openApp(page, "full", "/app/plan");
  for (const handle of HANDLES) await expect(card(page, handle)).toContainText(priceLabel(en, handle));
  await expect(card(page, "starter")).toContainText(formatUsd("en", PLAN_PRICES.starter.monthlyUsd));
  await expect(card(page, "free")).not.toContainText("$");

  const table = page.locator("details", { hasText: en.t("plan.table.summary") });
  await table.locator("summary").click();
  const priceRow = table.locator("tbody").first().locator("tr");
  await expect(priceRow.locator("th")).toContainText(en.t("plan.price.rowMonth"));
  const yearly = yearlyHandles();
  await expect(priceRow.locator("th")).toContainText(
    en.t("plan.price.rowYearly", { plans: new Intl.ListFormat("en-US", { type: "conjunction" }).format(yearly.map((h) => NAMES[h])), count: monthsFree(yearly[0]!)! }),
  );
  await expect(priceRow.locator("td")).toHaveText(HANDLES.map((h) => priceLabel(en, h)));
});

test("a store without a plan: Free applies now, the trial on the three paid cards, the smallest fitting plan @responsive", async ({ page }, info) => {
  await openApp(page, "empty", "/app/plan");
  await expect(page.getByRole("heading", { name: "Your plan: No plan chosen" })).toBeVisible();
  await expect(page.getByText(en.t("plan.hero.line.none"))).toBeVisible();
  await expect(page.locator("s-button", { hasText: "Choose a plan" })).toHaveAttribute("href", /\/charges\/linguva-ui-test\/pricing_plans$/);

  await expect(card(page, "free").locator("s-badge", { hasText: en.t("plan.compare.appliesNow") })).toHaveCount(1);
  // The paid plans' trial, only while they have one (TRIAL_DAYS 0: no trial text anywhere).
  await expect(page.getByText(trialLine(en))).toHaveCount(TRIAL_DAYS > 0 ? 3 : 0);
  await expect(card(page, "free")).not.toContainText(trialLine(en));
  if (TRIAL_DAYS > 0) for (const handle of ["starter", "pro", "business"] as const) await expect(card(page, handle)).toContainText(trialLine(en));

  // Nothing used yet: Free is enough, and the page says so.
  await expect(page.getByText("Fits your store: Free.")).toBeVisible();
  await expect(page.getByText(en.t("plan.recommend.reasonFree"))).toBeVisible();
  await expect(card(page, "free").locator("s-badge", { hasText: en.t("plan.recommend.badge") })).toHaveCount(1);
  // Every plan can be chosen on Shopify's page.
  for (const handle of HANDLES) await expect(card(page, handle).locator("s-button")).toHaveAttribute("target", "_top");

  // On a phone the cards stand one below the other, in a desktop window side by side.
  const boxes = await Promise.all(HANDLES.map((h) => card(page, h).boundingBox()));
  const xs = boxes.map((b) => Math.round(b!.x));
  const ys = boxes.map((b) => Math.round(b!.y));
  if (info.project.name === "mobile") {
    expect(new Set(xs).size).toBe(1);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  } else {
    expect(new Set(ys).size).toBe(1);
  }
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("a running trial: the trial's AI characters until it ends, then the plan's", async ({ page }) => {
  await openApp(page, "planTrial", "/app/plan", { locale: "de" });
  await expect(page.getByRole("heading", { name: "Dein Tarif: Business" })).toBeVisible();
  await expect(page.locator("s-badge", { hasText: /^Testphase bis \d{1,2}\. \p{L}+( \d{4})?$/u })).toHaveCount(1);
  await expect(page.getByText(de.t("plan.current.trialAllowance", { trial: de.number(TRIAL_AI_CHARS), limit: de.number(PLANS.business.monthlyChars) }))).toBeVisible();
  await expect(page.getByText(de.t("plan.usage.ofLimit", { limit: TRIAL_AI_CHARS }), { exact: true })).toBeVisible();
  // A store with a plan (in its trial) isn't offered a trial again.
  await expect(page.getByText(trialLine(de))).toHaveCount(0);
});

test("the owner's store: prices for reference, no plan buttons, no recommendation, no trial", async ({ page }) => {
  await openApp(page, "owner", "/app/plan");
  await expect(page.getByRole("heading", { name: "Your plan: Owner access" })).toBeVisible();
  await expect(page.getByText(en.t("plan.compare.introComplimentary"))).toBeVisible();
  for (const handle of HANDLES) await expect(card(page, handle)).toContainText(priceLabel(en, handle));
  await expect(page.getByText(en.t("plan.price.usd"), { exact: true })).toBeVisible();
  await expect(page.locator("s-page s-button[href]")).toHaveCount(0);
  await expect(page.getByText(/^Fits your store/)).toHaveCount(0);
  await expect(page.getByText(trialLine(en))).toHaveCount(0);
});

test("every feature has its icon, on the cards and in the full comparison (closed until opened)", async ({ page }) => {
  await openApp(page, "full", "/app/plan", { locale: "de" });
  // The store's languages, in German, hidden ones said in words.
  const languages = page.getByRole("list", { name: de.t("plan.languages.listLabel") });
  await expect(languages).toContainText("Französisch");
  await expect(languages.locator("s-badge", { hasText: "Versteckt" })).toHaveCount(1);

  const details = page.locator("details", { hasText: de.t("plan.table.summary") });
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");

  // 18 features and the price row, each with its icon; the same on the cards.
  const rows = details.locator('tbody th[scope="row"]');
  await expect(rows).toHaveCount(19);
  for (const type of await rows.evaluateAll((ths) => ths.map((th) => th.querySelector("s-icon")?.getAttribute("type") ?? ""))) expect(FEATURE_ICONS.has(type), type).toBe(true);
  const features = page.locator('[role="group"] li');
  await expect(features).toHaveCount(20);
  for (const type of await features.evaluateAll((lis) => lis.map((li) => li.querySelector("s-icon")?.getAttribute("type") ?? ""))) expect(FEATURE_ICONS.has(type), type).toBe(true);
});

test.describe("fits your store, from the store's own use", () => {
  test("four languages on Starter: Pro, and the language outside the plan is named", async ({ page }) => {
    await openApp(page, "planLanguages", "/app/plan", { locale: "de" });
    await expect(page.getByText("Passt zu deinem Shop: Pro.")).toBeVisible();
    await expect(page.getByText("Der kleinste Tarif für deine 4 Sprachen.")).toBeVisible();
    await expect(card(page, "pro").locator("s-badge", { hasText: de.t("plan.recommend.badge") })).toHaveCount(1);
    await expect(card(page, "starter").locator("s-badge", { hasText: "Dein Tarif" })).toHaveCount(1);

    const german = page.getByRole("listitem").filter({ hasText: "Deutsch" });
    await expect(german).toContainText(de.t("plan.languages.outside"));
    await expect(page.getByText(de.t("plan.languages.outsideAiPlan", { languages: "Deutsch", plan: "Pro" }), { exact: false })).toBeVisible();
    // 258,000 of 300,000 used: almost used up, in words.
    await expect(page.getByText(/^Fast aufgebraucht: Bis zum \d{1,2}\. \p{L}+( \d{4})? sind noch 42\.000 Zeichen frei\.$/u)).toBeVisible();
  });

  test("automatic publishing switched on: Pro", async ({ page }) => {
    await openApp(page, "planAutoPublish", "/app/plan");
    await expect(page.getByText("Fits your store: Pro.")).toBeVisible();
    await expect(page.getByText("The smallest plan for automatic publishing.")).toBeVisible();
  });

  test("Free used up: Starter, for this month's AI characters", async ({ page }) => {
    await openApp(page, "planFreeUsed", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: Free" })).toBeVisible();
    await expect(page.getByText(/^Used up\. New AI characters arrive on [A-Z][a-z]+ \d{1,2}(, \d{4})?\. You can still translate by hand\.$/)).toBeVisible();
    await expect(page.getByText("Fits your store: Starter.")).toBeVisible();
    await expect(page.getByText("The smallest plan for your 20,000 AI characters this month.")).toBeVisible();
  });
});

test.describe("billing states in words", () => {
  test("a change at the end of the cycle and a cancellation", async ({ page }) => {
    await openApp(page, "planPending", "/app/plan");
    await expect(page.getByText(/^Changes to Starter on [A-Z][a-z]+ \d{1,2}(, \d{4})?$/)).toBeVisible();
    await expect(card(page, "starter").locator("s-badge", { hasText: /^from [A-Z][a-z]+ \d{1,2}(, \d{4})?$/ })).toHaveCount(1);

    await openApp(page, "planEnding", "/app/plan");
    await expect(page.locator("s-badge", { hasText: /^ends on [A-Z][a-z]+ \d{1,2}(, \d{4})?$/ })).toHaveCount(1);
    await expect(page.getByText(en.t("plan.hero.line.ends"))).toBeVisible();
  });

  test("Shopify not answering: the last known plan or 'unknown', never 'no plan', and trying again says so", async ({ page }) => {
    await openApp(page, "planStale", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: Pro" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: en.t("plan.status.stale") })).toHaveCount(1);
    await expect(page.getByText(/^Shopify didn't answer just now\. The state from .+ applies\.$/)).toBeVisible();

    await openApp(page, "planDown", "/app/plan");
    await expect(page.getByRole("heading", { name: "Your plan: Plan unknown" })).toBeVisible();
    await expect(page.getByText(en.t("plan.hero.line.unknown"))).toBeVisible();
    await expect(page.getByText(trialLine(en))).toHaveCount(0);
    await page.locator("s-button", { hasText: "Try again" }).click();
    await expectToast(page, en.t("plan.toast.failed"));
  });

  test("Refresh asks Shopify and confirms the plan", async ({ page }) => {
    await openApp(page, "full", "/app/plan");
    await page.locator("s-button", { hasText: "Refresh" }).click();
    await expectToast(page, "Confirmed with Shopify: Pro");
  });
});
