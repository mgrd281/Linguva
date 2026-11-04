/**
 * The Jobs pages (Redesign 3, Redesign 4) on the `jobs` store, a job in each
 * state (fixtures/jobs-store.ts): the list's attention card, tabs as tiles,
 * live group, days, the click's cluster, search and filters (applied at
 * once, folded on a phone); a job's hero, its next steps, the problems with
 * their names right under it, and the results in detail with the report and
 * the reference in view. Both pages save a full-page screenshot in the
 * test's output folder (CI keeps it in the report artifact) for the design
 * review.
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
/** The attention card: Settings' tinted status row, a section of the page by its name. */
const attention = (page: Page) => page.locator('section[aria-label="Needs your attention"]');

test.describe("the Jobs list", () => {
  test("puts what needs the merchant first, then the running jobs and the days @responsive", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", "/app/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Translation jobs" })).toBeVisible();

    // The attention card: two stops, the one that needs the merchant featured with its fix and the way to the job, tinted in its tone.
    const card = attention(page);
    await expect(card).toHaveAttribute("data-tone", "critical");
    await expect(card.getByRole("heading", { level: 2, name: "2 jobs stopped" })).toBeVisible();
    await expect(card.getByText("German · Collections: AI translation not allowed")).toBeVisible();
    await expect(card.getByText("Linguva needs your permission for AI translation.")).toBeVisible();
    await expect(card.locator("[data-button]", { hasText: "Allow in Settings" })).toHaveAttribute("href", `/app/settings?section=ai&job=${ids.stopped}`);
    await expect(card.locator("[data-button]", { hasText: "View job" })).toHaveAttribute("href", `/app/jobs/${ids.stopped}`);
    // The translations waiting for approval: a quiet row to Review.
    await expect(card.locator('s-clickable[href="/app/review"]')).toContainText("17 translations wait for your approval");

    // The tabs as tiles with their figures (problems: the two stops and the completed job with a failed page),
    // each named by its word first; Problems with its dot in critical, since a stop needs the merchant.
    const tabs = page.getByRole("navigation", { name: "Show jobs" });
    await expect(tabs.locator('[aria-current="page"]')).toContainText("All");
    for (const [tab, count] of [["All", "10"], ["Running", "2"], ["Problems", "3"], ["Done", "5"], ["Cancelled", "1"]]) {
      await expect(tabs.locator("li", { hasText: tab })).toContainText(count);
    }
    await expect(tabs.getByRole("link", { name: "All 10" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: /^Problems 3, Needs your attention$/ })).toHaveAttribute("data-tone", "critical");
    // Every tile within the page's width, no sideways scrolling, also on a phone (two rows there).
    const width = page.viewportSize()!.width;
    for (const tile of await tabs.getByRole("link").all()) {
      const box = (await tile.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    // Running now: the live group, updating by itself.
    const live = page.locator('section[aria-labelledby="jobs-live"]');
    await expect(live.getByRole("heading", { name: "Running now" })).toBeVisible();
    await expect(live.getByText("Updates by itself")).toBeVisible();
    await expect(live.locator(`s-clickable[href="/app/jobs/${ids.running}"]`)).toContainText("21 of 40 done");
    await expect(live.locator(`s-clickable[href="/app/jobs/${ids.queued}"]`)).toContainText("Starts with a delay");

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
    // No live group and no attention card outside "All"; the chosen tile is framed.
    await expect(page.locator('section[aria-labelledby="jobs-live"]')).toHaveCount(0);
    await expect(attention(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Show jobs" }).locator('[aria-current="page"]')).toContainText("Problems");
  });

  test("the Problems tile carries its dot only while a problem needs the merchant", async ({ page }) => {
    // Spanish: only the stop for today's AI allowance, which goes on by itself after midnight UTC.
    await openApp(page, "jobs", "/app/jobs?lang=es");
    const tabs = page.getByRole("navigation", { name: "Show jobs" });
    const problems = tabs.getByRole("link", { name: "Problems 1", exact: true });
    await expect(problems).toBeVisible();
    await expect(problems).not.toHaveAttribute("data-tone");
    await expect(tabs.locator(".lv-tile__dot")).toHaveCount(0);
  });

  test("a filter applies as soon as it is chosen, without Search", async ({ page }) => {
    await openApp(page, "jobs", "/app/jobs");
    await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "French" });
    await expect(page).toHaveURL(/[?&]lang=fr(&|$)/);
    // French: the running products, the pages and the collections.
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole("combobox", { name: "Started by" }).selectOption({ label: "Automatic translation" });
    await expect(page).toHaveURL(/[?&]lang=fr&by=auto(&|$)/);
    await expect(rows(page)).toHaveCount(1);
    // Back to all languages: the "All" option is no filter.
    await page.getByRole("combobox", { name: "Language" }).selectOption({ label: "All languages" });
    await expect(page).not.toHaveURL(/[?&]lang=/);
    await expect(page).toHaveURL(/[?&]by=auto(&|$)/);
  });

  test("filters by language and finds a job by its reference", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", "/app/jobs?lang=fr");
    // French: the running products, the pages and the collections.
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/app/jobs");

    // The search runs as you type (no Search button): the reference finds its job.
    const reference = ids.cancelled!.slice(0, 8);
    await openApp(page, "jobs", "/app/jobs");
    await expect(page.getByRole("search").locator("[data-button]", { hasText: "Search" })).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "Search jobs" });
    await search.pressSequentially(reference, { delay: 30 });
    await expect(page).toHaveURL(new RegExp(`[?&]q=${reference}(&|$)`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("href", `/app/jobs/${ids.cancelled}`);
    await expect(rows(page).first()).toContainText("8 of 20 done");

    // Nothing found: said so, with the way back (the tab stays).
    await openApp(page, "jobs", "/app/jobs?status=cancelled&lang=de");
    await expect(page.getByText("No jobs match these filters.")).toBeVisible();
    await expect(page.locator("[data-button]", { hasText: "Clear filters" })).toHaveAttribute("href", "/app/jobs?status=cancelled");
  });

  test("on a phone the filters fold behind one button that counts them @responsive", async ({ page }, info) => {
    await openApp(page, "jobs", "/app/jobs?lang=fr");
    const toggle = page.locator("[data-button]", { hasText: "Filters (1)" });
    // The select inside Polaris' host (the host itself draws no box).
    const language = page.getByRole("combobox", { name: "Language" });
    if (info.project.name !== "mobile") {
      // A wide card shows the four filters and no button.
      await expect(language).toBeVisible();
      await expect(toggle).toBeHidden();
      return;
    }
    await expect(language).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "jobs-filters");
    // The first job is in the first screen (its group's section: a row's Polaris host draws no box of its own).
    await expect(page.locator('section[aria-labelledby="jobs-live"], section[aria-labelledby^="day-"]').first()).toBeInViewport();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(language).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("a store without jobs says where they come from, with the way there", async ({ page }) => {
    await openApp(page, "emptyCatalog", "/app/jobs");
    await expect(page.getByRole("heading", { level: 2, name: "No jobs yet" })).toBeVisible();
    await expect(page.getByText("Jobs appear when you choose “Translate” on a language's page.")).toBeVisible();
    await expect(page.locator('[data-button][data-variant="primary"]', { hasText: "Choose a language" })).toHaveAttribute("href", "/app");
    // Nothing to filter yet.
    await expect(page.getByRole("navigation", { name: "Show jobs" })).toHaveCount(0);
    await expect(page.getByRole("search")).toHaveCount(0);
    await expectAccessible(page);
  });

  test("is German for a German admin user, with the store's days", async ({ page }) => {
    await openApp(page, "jobs", "/app/jobs", { locale: "de" });
    await expect(page.getByRole("heading", { level: 1, name: "Übersetzungsaufträge" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "2 Aufträge wurden angehalten" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: /^Heute · / })).toBeVisible();
    await expect(page.getByText("Läuft gerade", { exact: true })).toBeVisible();
    // German keeps "KI-" compounds whole with a non-breaking hyphen.
    await expect(page.getByText(/^Deutsch · Kollektionen: KI.Übersetzung nicht erlaubt$/)).toBeVisible();
    // The filters' names, and a period that isn't "whenever".
    await expect(page.locator('s-select[name="by"]')).toHaveAttribute("label", "Gestartet von");
    await expect(page.locator('s-select[name="since"]')).toHaveAttribute("label", "Zeitraum");
    await expect(page.locator('s-select[name="since"] s-option').first()).toHaveText("Gesamter Zeitraum");
  });
});

test.describe("a job's page", () => {
  test("a running job: the ring, the legend, its next steps and the items that need the merchant @responsive", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.running}`);
    await expect(page.getByRole("heading", { level: 1, name: "French · Products" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: "Translating" })).toBeVisible();
    await expect(page.getByText(/^Started today at .+ · by you$/)).toBeVisible();
    // The language's flag beside the h1, as the Jobs list's row shows the job.
    await expect(page.locator('.lv-icon-square img[src="/flags/FR.svg"]')).toBeVisible();

    // The hero is a card on a phone too (a named region, not a Polaris section drawn flat there).
    const hero = page.getByRole("region", { name: "French · Products: summary" });
    await expect(hero.getByRole("img", { name: /^52% done\. Products: 21 of 40 done\./ })).toBeVisible();
    await expect(hero.getByRole("heading", { level: 2, name: "Products: 21 of 40 done" })).toBeVisible();
    const legend = hero.getByRole("list", { name: "Results" });
    await expect(legend.locator("li")).toHaveText(["17 wait for your approval", "4 were already up to date", "1 incomplete", "2 failed", "16 still to do"]);
    // Each line's key is its arc's colour: "already up to date" has its pale green beside the same check as "translated".
    const keys = await legend.locator("li > s-stack > span[aria-hidden='true']").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(keys).toEqual(["rgb(0, 148, 213)", "rgb(159, 200, 181)", "rgb(185, 137, 0)", "rgb(199, 10, 36)", "rgb(235, 235, 235)"]);
    // Next: approve first (the page's one primary button), then the one item a new try can fix; cancel in the foot.
    // Two steps: numbered, their order matters.
    await expect(hero.getByRole("heading", { level: 2, name: "Next", exact: true })).toBeVisible();
    await expect(hero.locator("ol")).toHaveCount(1);
    await expect(hero.getByText("Approve 17 translations")).toBeVisible();
    await expect(hero.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
    await expect(hero.locator('[data-button][data-variant="primary"]')).toHaveAttribute("href", `/app/review?job=${ids.running}`);
    await expect(hero.getByText("Try 1 product again")).toBeVisible();
    await expect(hero.locator("[data-button]", { hasText: "Cancel job" })).toBeVisible();

    // The problems right under the hero, by the products' names (read from Shopify), each opening the editor; then the stats.
    await expect(page.getByText("AI characters", { exact: true })).toBeVisible();
    await expect(page.getByText("18,400", { exact: true })).toBeVisible();
    const heading = page.getByRole("heading", { level: 2, name: "3 products need your attention" });
    await expect(heading).toBeVisible();
    const problems = page.getByRole("list", { name: "3 products need your attention" }).locator("li");
    await expect(problems).toHaveCount(3);
    await expect(problems.first().locator("s-clickable")).toHaveAttribute("href", /^\/app\/products\/\d+\?lang=fr$/);
    // Measured on the stats' own box (a Polaris s-text host draws no box of its own).
    expect((await heading.boundingBox())!.y).toBeLessThan((await page.locator(".lv-jobstats").boundingBox())!.y);

    await page.screenshot({ path: test.info().outputPath("job-running.png"), fullPage: true });
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("cancelling asks first and says what stays", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.running}`);
    await page.locator("[data-button]", { hasText: "Cancel job" }).first().click();
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
    const hero = page.getByRole("region", { name: "German · Collections: summary" });
    await expect(hero.getByText("Linguva needs your permission for AI translation.")).toBeVisible();
    await expect(hero.getByText("What is translated stays.", { exact: true })).toBeVisible();
    await expect(hero.getByText("How to continue", { exact: true })).toBeVisible();
    await expect(hero.getByText("Allow AI translation")).toBeVisible();
    await expect(hero.locator("[data-button]", { hasText: "Allow in Settings" })).toHaveAttribute("href", `/app/settings?section=ai&job=${ids.stopped}`);
    await expect(hero.locator("[data-button]", { hasText: "Resume job" })).toBeVisible();
    await expectAccessible(page);
  });

  test("a finished job explains every result and offers the report", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.errors}`);
    await expect(page.getByRole("heading", { level: 1, name: "French · Pages" })).toBeVisible();
    await expect(page.locator("s-badge", { hasText: "Done with errors" })).toBeVisible();
    // Yesterday, or two days ago in the store's zone shortly after midnight.
    await expect(page.getByText(/^Started (yesterday|on .+) at .+ · by your team$/)).toBeVisible();
    // The one page only the editor finishes: its step opens that page's editor (the page's one primary button).
    const hero = page.getByRole("region", { name: "French · Pages: summary" });
    await expect(hero.getByText("Finish 1 page in the editor")).toBeVisible();
    // A lone step has no number (numbers only where order matters), and its reason never says "done".
    await expect(hero.locator("ol")).toHaveCount(0);
    await expect(hero.getByText("Trying again won't help here – finish it yourself in the editor.")).toBeVisible();
    await expect(hero.locator('[data-button][data-variant="primary"]')).toHaveCount(1);
    await expect(hero.locator('[data-button][data-variant="primary"]', { hasText: "Open in editor" })).toHaveAttribute("href", "/app/pages/4?lang=fr");
    await expect(page.getByRole("heading", { level: 2, name: "1 page needs your attention" })).toBeVisible();
    // What a row does, on a phone too (no "click").
    await expect(page.getByText("3 of 4 are fine. Open one to finish it in the editor.")).toBeVisible();
    // Shopify has no name for it: its kind and number.
    await expect(page.getByRole("list", { name: "1 page needs your attention" }).getByText("Page 4", { exact: true })).toBeVisible();
    // The report and the reference in view, the table folded.
    await expect(page.getByText(/^Reference for support: [0-9a-f]{8}$/)).toBeVisible();
    await expect(page.getByText(`Reference for support: ${ids.errors!.slice(0, 8)}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy reference" })).toBeVisible();
    await expect(page.locator("[data-button]", { hasText: "Download report (CSV)" })).toBeVisible();
    // The table's reasons in the app's words ("Done", not "Translated and published"), drawn once opened.
    const done = page.locator("s-table-cell").filter({ hasText: /^Done$/ });
    await expect(done).toHaveCount(0);
    await page.getByText("Results in detail").click();
    await expect(done).toBeVisible();
  });

  test("a queued job was created, not started, and says why it starts with a delay", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids.queued}`);
    await expect(page.getByRole("heading", { level: 1, name: "Italian · Collections" })).toBeVisible();
    await expect(page.getByText(/^Created today at .+ · by you$/)).toBeVisible();
    // No worker runs in these tests.
    await expect(page.getByRole("heading", { level: 2, name: "Starts with a delay" })).toBeVisible();
    // What happens, never a "background service".
    await expect(page.getByText("Linguva starts it by itself as soon as it can.")).toBeVisible();
    await expect(page.getByText(/background service/)).toHaveCount(0);
    await expect(page.locator("[data-button]", { hasText: "Cancel job" })).toBeVisible();
  });

  test("a job whose items were all up to date says there was nothing to translate", async ({ page }) => {
    const ids = await jobIds();
    await openApp(page, "jobs", `/app/jobs/${ids["click:PRODUCT"]}`);
    await expect(page.getByRole("heading", { level: 2, name: "Products: all 5 were already up to date" })).toBeVisible();
    // The title says it: no line under it repeats it.
    await expect(page.getByText(/^Linguva looked through/)).toHaveCount(0);
    await expect(page.getByText("Nothing to do.")).toBeVisible();
  });
});
