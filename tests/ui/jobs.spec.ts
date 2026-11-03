/**
 * The Jobs pages (Redesign 3) on the `jobs` store, a job in each state
 * (fixtures/jobs-store.ts): the list's attention card, tabs, live group,
 * days, the click's cluster, search and filters; a job's hero, its next
 * steps, the problems with their names and the results in detail. Both
 * pages save a full-page screenshot in the test's output folder (CI keeps it
 * in the report artifact) for the design review.
 */
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { testEnv } from "../support/env";
import { UI_SHOPS } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
test.afterAll(() => owner.$disconnect());

/** The seeded jobs' ids by their key (ui-jobs-<key>). */
async function jobIds(): Promise<Record<string, string>> {
  const [shop] = await owner.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Shop" WHERE "shopDomain" = ${UI_SHOPS.jobs.domain}`;
  const rows = await owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.shop_id', ${shop!.id}, true)`;
    return tx.translationJob.findMany({ where: { shopId: shop!.id }, select: { id: true, idempotencyKey: true } });
  });
  return Object.fromEntries(rows.map((r) => [r.idempotencyKey.replace(/^ui-jobs-/, ""), r.id]));
}

/** The list's job rows (the live group and the days; not the attention card's links). */
const rows = (page: Page) => page.locator('section[aria-labelledby="jobs-live"], section[aria-labelledby^="day-"]').locator('s-clickable[href^="/app/jobs/"]');

test.describe("the Jobs list", () => {
  test("puts what needs the merchant first, then the running jobs and the days @responsive", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", "/app/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Translation jobs" })).toBeVisible();

    // The attention card: two stops, the one that needs the merchant featured with its fix and the way to the job.
    const card = page.locator('s-section[accessibilitylabel="Needs your attention"]');
    await expect(card.getByRole("heading", { level: 2, name: "2 jobs stopped" })).toBeVisible();
    await expect(card.getByText("German · Collections: AI translation not allowed")).toBeVisible();
    await expect(card.getByText("Linguva needs your permission for AI translation.")).toBeVisible();
    await expect(card.locator("s-button", { hasText: "Allow in Settings" })).toHaveAttribute("href", `/app/settings?section=ai&job=${ids.stopped}`);
    await expect(card.locator("s-button", { hasText: "View job" })).toHaveAttribute("href", `/app/jobs/${ids.stopped}`);
    // The translations waiting for approval: a quiet row to Review.
    await expect(card.locator('s-clickable[href="/app/review"]')).toContainText("17 translations wait for your approval");

    // The tabs with their figures (problems: the two stops and the completed job with a failed page).
    const tabs = page.getByRole("navigation", { name: "Show jobs" });
    await expect(tabs.locator('[aria-current="page"]')).toContainText("All");
    for (const [tab, count] of [["All", "10"], ["Running", "2"], ["Problems", "3"], ["Completed", "5"], ["Cancelled", "1"]]) {
      await expect(tabs.locator("li", { hasText: tab })).toContainText(count);
    }

    // Running now: the live group, updating by itself.
    const live = page.locator('section[aria-labelledby="jobs-live"]');
    await expect(live.getByRole("heading", { name: "Running now" })).toBeVisible();
    await expect(live.getByText("Updates by itself")).toBeVisible();
    await expect(live.locator(`s-clickable[href="/app/jobs/${ids.running}"]`)).toContainText("21 of 40 done");
    await expect(live.locator(`s-clickable[href="/app/jobs/${ids.queued}"]`)).toContainText("Waiting for background jobs");

    // The history by the store's days, a stop's result in its words, and the click's two jobs together.
    // (The job that started 2 hours ago is on today's list unless the store's day began since.)
    await expect(page.getByRole("heading", { level: 3, name: /^Today · / })).toBeVisible();
    await expect(page.locator(`s-clickable[href="/app/jobs/${ids.stopped}"]`)).toContainText("AI translation not allowed");
    await expect(page.locator(`s-clickable[href="/app/jobs/${ids.errors}"]`)).toContainText("1 failed");
    await expect(page.locator(`s-clickable[href="/app/jobs/${ids.errors}"]`)).toContainText("by your team");
    await expect(page.getByText(/^Started together at /)).toBeVisible();
    await expect(page.locator(`s-clickable[href="/app/jobs/${ids["click:PRODUCT"]}"]`)).toContainText("Everything was already up to date");
    await expect(rows(page)).toHaveCount(10);

    await page.screenshot({ path: test.info().outputPath("jobs-list.png"), fullPage: true });
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("the Problems tab lists the stops and the failed items of the last 14 days", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", "/app/jobs");
    await page.getByRole("navigation", { name: "Show jobs" }).getByRole("link", { name: /^Problems/ }).click();
    await expect(page).toHaveURL(/[?&]status=problems/);
    await expect(rows(page)).toHaveCount(3);
    for (const key of ["stopped", "daily", "errors"]) await expect(page.locator(`s-clickable[href="/app/jobs/${ids[key]}"]`)).toBeVisible();
    // No live group and no attention card outside "All".
    await expect(page.locator('section[aria-labelledby="jobs-live"]')).toHaveCount(0);
    await expect(page.locator('s-section[accessibilitylabel="Needs your attention"]')).toHaveCount(0);
  });

  test("filters by language and finds a job by its reference", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", "/app/jobs?lang=fr");
    // French: the running products, the pages and the collections.
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/app/jobs");

    await openApp(page, "jobs", `/app/jobs?q=${ids.cancelled!.slice(0, 8)}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("href", `/app/jobs/${ids.cancelled}`);
    await expect(rows(page).first()).toContainText("8 of 20 done");

    await openApp(page, "jobs", "/app/jobs?status=cancelled&lang=de");
    await expect(page.getByText("No jobs match these filters.")).toBeVisible();
  });

  test("is German for a German admin user, with the store's days", async ({ page }) => {
    await openApp(page, "jobs", "/app/jobs", { locale: "de" });
    await expect(page.getByRole("heading", { level: 1, name: "Übersetzungsaufträge" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "2 Aufträge wurden angehalten" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: /^Heute · / })).toBeVisible();
    await expect(page.getByText("Läuft gerade", { exact: true })).toBeVisible();
    // German keeps "KI-" compounds whole with a non-breaking hyphen.
    await expect(page.getByText(/^Deutsch · Kollektionen: KI.Übersetzung nicht erlaubt$/)).toBeVisible();
  });
});

test.describe("a job's page", () => {
  test("a running job: the ring, the legend, its next steps and the items that need the merchant @responsive", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.running}`);
    await expect(page.getByRole("heading", { level: 1, name: "French · Products" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: "Translating" })).toBeVisible();
    await expect(page.getByText(/^Started today at .+ · by you$/)).toBeVisible();

    const hero = page.locator('s-section[accessibilitylabel="French · Products: summary"]');
    await expect(hero.getByRole("img", { name: /^52% done\. Products: 21 of 40 done\./ })).toBeVisible();
    await expect(hero.getByRole("heading", { level: 2, name: "Products: 21 of 40 done" })).toBeVisible();
    const legend = hero.getByRole("list", { name: "Results" });
    await expect(legend.locator("li")).toHaveText(["17 wait for your approval", "4 were already up to date", "1 incomplete", "2 failed", "16 still to do"]);
    // Next: approve first (the page's one primary button), then the one item a new try can fix; cancel in the foot.
    await expect(hero.getByText("Approve 17 translations")).toBeVisible();
    await expect(hero.locator('s-button[variant="primary"]')).toHaveCount(1);
    await expect(hero.locator('s-button[variant="primary"]')).toHaveAttribute("href", `/app/review?job=${ids.running}`);
    await expect(hero.getByText("Try 1 product again")).toBeVisible();
    await expect(hero.locator("s-button", { hasText: "Cancel job" })).toBeVisible();

    // The stats and the problems, by the products' names (read from Shopify), each opening the editor.
    await expect(page.getByText("AI characters", { exact: true })).toBeVisible();
    await expect(page.getByText("18,400", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "3 products need your attention" })).toBeVisible();
    const problems = page.getByRole("list", { name: "3 products need your attention" }).locator("li");
    await expect(problems).toHaveCount(3);
    await expect(problems.first().locator("s-clickable")).toHaveAttribute("href", /^\/app\/products\/\d+\?lang=fr$/);

    await page.screenshot({ path: test.info().outputPath("job-running.png"), fullPage: true });
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("cancelling asks first and says what stays", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.running}`);
    await page.locator("s-button", { hasText: "Cancel job" }).first().click();
    const dialog = page.locator("s-modal#job-cancel");
    await expect(dialog).toHaveAttribute("heading", "Cancel this job?");
    await expect(dialog.getByText("21 products are done and stay.")).toBeAttached();
    await expect(dialog.getByText("16 products are still to do and won't be translated.")).toBeAttached();
    await expect(dialog.locator("s-button", { hasText: "Keep translating" })).toBeAttached();
  });

  test("a stopped job: why, what fixes it, and Resume", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.stopped}`);
    await expect(page.getByRole("heading", { level: 1, name: "German · Collections" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: "Stopped" })).toBeVisible();
    const hero = page.locator('s-section[accessibilitylabel="German · Collections: summary"]');
    await expect(hero.getByText("Linguva needs your permission for AI translation.")).toBeVisible();
    await expect(hero.getByText("What is translated stays. Nothing is lost.")).toBeVisible();
    await expect(hero.getByText("How to continue", { exact: true })).toBeVisible();
    await expect(hero.getByText("Allow AI translation")).toBeVisible();
    await expect(hero.locator("s-button", { hasText: "Allow in Settings" })).toHaveAttribute("href", `/app/settings?section=ai&job=${ids.stopped}`);
    await expect(hero.locator("s-button", { hasText: "Resume job" })).toBeVisible();
    await expectAccessible(page);
  });

  test("a finished job explains every result and offers the report", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.errors}`);
    await expect(page.getByRole("heading", { level: 1, name: "French · Pages" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: "Completed with errors" })).toBeVisible();
    // Yesterday, or two days ago in the store's zone shortly after midnight.
    await expect(page.getByText(/^Started (yesterday|on .+) at .+ · by your team$/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "1 page needs your attention" })).toBeVisible();
    await expect(page.getByText("3 of 4 are fine.")).toBeVisible();
    await page.getByText("Results in detail").click();
    await expect(page.getByText(/^Reference for support: [0-9a-f-]{36}$/)).toBeVisible();
    await expect(page.locator("s-button", { hasText: "Download report (CSV)" })).toBeVisible();
  });

  test("a job whose items were all up to date says there was nothing to translate", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids["click:PRODUCT"]}`);
    await expect(page.getByRole("heading", { level: 2, name: "Products: all 5 were already up to date" })).toBeVisible();
    await expect(page.getByText("Nothing to do.")).toBeVisible();
  });
});
