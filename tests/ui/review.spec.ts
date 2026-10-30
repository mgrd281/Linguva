/**
 * Review ("Übersetzungen prüfen"), redesigned: one card per item and
 * language, decided per text, per card or per page, with the result in
 * place of each text and the page's counts following. Runs on a store of
 * its own per project (fixtures/review-store.ts: review on desktop,
 * reviewPhone on the phone), and each test decides its own texts.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { testEnv } from "../support/env";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp } from "./helpers";
import { UI_SHOPS, type UiShopKey } from "./fixtures/shops";

const shop = (): UiShopKey => (test.info().project.name === "mobile" ? "reviewPhone" : "review");
const open = (page: Page, path = "/app/review") => openApp(page, shop(), path);

// What happens in the store while the page is open (another tab, a running job), as the store's tenant.
const owner = new PrismaClient({ datasources: { db: { url: testEnv.MIGRATION_DATABASE_URL } } });
test.afterAll(() => owner.$disconnect());
async function inStore<T>(write: (shopId: string) => Prisma.PrismaPromise<T>): Promise<T> {
  const { id } = await owner.shop.findUniqueOrThrow({ where: { shopDomain: UI_SHOPS[shop()].domain } });
  const [, result] = await owner.$transaction([owner.$executeRaw`SELECT set_config('app.shop_id', ${id}, true)`, write(id)]);
  return result;
}

/** The copy of a control that is shown (wide cards: the label row; phones: under the texts). */
const button = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole("button", typeof name === "string" ? { name, exact: true } : { name }).filter({ visible: true }).first();
const card = (page: Page, label: string) => page.locator(`s-section[accessibilitylabel="${label}"]`);
/** A text's row in its card, by the name its Approve button carries ("Name – Product 2 jacket"). */
const row = (page: Page, text: string) => page.locator("s-section[accessibilitylabel] li").filter({ has: page.getByRole("button", { name: `Approve: ${text}`, exact: true }) });
/** The last number in an element's own text ("German 25", "Approve all 12"): Polaris hosts, whose text is theirs (a role finds the control inside). */
const numberIn = async (locator: Locator) => Number(((await locator.textContent()) ?? "").match(/\d+/g)!.at(-1));
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Languages" }).locator("s-clickable", { hasText: name });
const chip = (page: Page, name: string) => page.locator("s-clickable-chip", { hasText: name });
const primaryHost = (page: Page) => page.locator('s-button[commandfor="review-approve"][command="--show"]');
const languages = (page: Page) => page.getByRole("navigation", { name: "Languages" });
const areas = (page: Page) => page.getByRole("navigation", { name: "Areas" });
const primary = (page: Page) => page.getByRole("button", { name: /^Approve all \d+( on this page)?$/ });
const summary = (page: Page) => page.getByText(/^\d+ translations? on this page/);
/** Texts shown in cards. */
const texts = (page: Page) => page.locator("s-section[accessibilitylabel] li");

test.describe("Review", () => {
  test("approving one text shows the result in its place and lowers every count by one @responsive", async ({ page }) => {
    await open(page);
    const all = languages(page).locator('[aria-current="true"]');
    const german = languages(page).getByRole("link", { name: /^German \d+$/ });
    const products = areas(page).getByRole("link", { name: /^Products \d+$/ });
    const before = {
      all: await numberIn(all),
      german: await numberIn(tab(page, "German")),
      products: await numberIn(chip(page, "Products")),
      primary: await numberIn(primaryHost(page)),
      summary: await numberIn(summary(page)),
    };

    const product = card(page, "Product 2 jacket, German");
    // Product 2 waits in Spanish too: its controls name the language.
    await button(product, "Approve: Name – Product 2 jacket (German)").click();
    const done = product.getByText("Approved – customers see it now.");
    await expect(done).toBeVisible();
    await expect(product.getByText("“[de] Product 2 jacket”")).toBeVisible();
    await expect(all).toContainText(String(before.all - 1));
    await expect(german).toHaveAccessibleName(`German ${before.german - 1}`);
    await expect(products).toHaveAccessibleName(`Products ${before.products - 1}`);
    await expect(primary(page)).toHaveAccessibleName(new RegExp(`^Approve all ${before.primary - 1}`));
    await expect(summary(page)).toHaveText(new RegExp(`^${before.summary - 1} `));
    // Nothing else moved in: the page didn't reload.
    await expect(button(product, "Approve: Description – Product 2 jacket (German)")).toBeVisible();
  });

  test("approving a card folds it to one line; a card with one open text has no card button @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const three = card(page, "Product 3 jacket, German");
    await button(three, /^Approve all 3: Product 3 jacket/).click();
    await expect(three.getByText("3 approved")).toBeVisible();
    await expect(three.getByRole("button")).toHaveCount(0);

    const six = card(page, "Product 6 jacket, German");
    await expect(button(six, /^Approve all 2: Product 6 jacket/)).toBeVisible();
    await button(page, "Approve: Name – Product 6 jacket").click();
    await expect(six.getByText("Approved – customers see it now.")).toBeVisible();
    // One text left: its own Approve is the same action.
    await expect(six.getByRole("button", { name: /^Approve all/ })).toHaveCount(0);
    await expect(button(page, "Approve: Description – Product 6 jacket")).toBeVisible();
  });

  test("approving the page asks first, naming its languages and notes, then confirms with a toast @responsive", async ({ page }) => {
    await open(page, "/app/review?area=collections");
    await expect(summary(page)).toHaveText(/^4 translations on this page/);
    await primary(page).click();
    const dialog = page.getByRole("dialog", { name: "Approve 4 translations?" });
    await expect(dialog).toBeVisible();
    const modal = page.locator("s-modal#review-approve");
    await expect(modal.getByText("Customers see them right away – in German.")).toBeVisible();
    await expect(modal.getByText(/^Still hidden: Arabic\./)).toBeVisible();
    await expect(modal.getByText("1 of them has a note. You'll find it next to the text.")).toBeVisible();
    await expectAccessible(page);
    await modal.getByRole("button", { name: "Approve 4", exact: true }).click();
    await expectToast(page, "4 translations approved");
    await expect(page.locator("#review-done-heading")).toBeVisible();

    // The next page doesn't confirm this page's approval a second time.
    const toasts = () => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.length);
    const shown = await toasts();
    await page.locator("s-button[href]", { hasText: "Continue" }).click();
    await expect(page).not.toHaveURL(/area=/);
    await expect(page.locator("s-section[accessibilitylabel]").first()).toBeVisible();
    // (A result shown again would come back within the first frames of the new page.)
    await page.waitForTimeout(500);
    await expect(page.locator('div[role="status"]')).not.toContainText("approved");
    expect(await toasts()).toBe(shown);
  });

  test("rejecting one text asks in place, says it can't be undone, and Escape cancels @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const text = "Description – Product 4 jacket";
    await button(page, `Reject: ${text}`).click();
    const question = page.locator('s-banner[heading="Reject this translation?"]');
    await expect(question).toContainText("This can't be undone.");
    // Focus moves to the question's Reject; Escape answers Cancel and returns to ✕.
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Reject");
    await page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-review-reject"))).not.toBeNull();

    await button(page, `Reject: ${text}`).click();
    await question.getByRole("button", { name: `Reject: ${text}` }).click();
    await expect(card(page, "Product 4 jacket, German").getByText("Rejected – won't be published.")).toBeVisible();
  });

  test("an edited text is approved as written, and the editor shows it @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    await button(page, "Edit: Name – Product 5 jacket").click();
    const field = page.getByRole("textbox", { name: "Name in German" });
    // Focus moves into the text.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("S-TEXT-AREA");
    await field.fill("Produkt 5 Jacke");
    await expect(row(page, "Name – Product 5 jacket").locator("s-badge", { hasText: "Edited by you" })).toBeVisible();
    await button(page, "Approve: Name – Product 5 jacket").click();
    await expect(card(page, "Product 5 jacket, German").getByText("“Produkt 5 Jacke”")).toBeVisible();

    await open(page, "/app/products/5?lang=de");
    await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("Produkt 5 Jacke");
  });

  test("an emptied text holds its Approve, its card's and the page's, with the reason @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    await button(page, "Edit: Name – Product 4 jacket").click();
    await page.getByRole("textbox", { name: "Name in German" }).fill("");
    await expect(page.getByText("Empty – write a translation or reject it.")).toBeVisible();
    await expect(button(page, "Approve: Name – Product 4 jacket")).toBeDisabled();
    await expect(button(card(page, "Product 4 jacket, German"), /^Approve all \d+: Product 4 jacket/)).toBeDisabled();
    await expect(primary(page)).toBeDisabled();
    await expect(page.getByText("Fill in or reject the empty text first.")).toBeVisible();
    // Rejecting sends no edited text: it doesn't wait for the empty one.
    await expect(page.getByRole("button", { name: "Reject all", exact: true })).toBeEnabled();

    await button(page, "Cancel: Name – Product 4 jacket").click();
    await expect(button(page, "Approve: Name – Product 4 jacket")).toBeEnabled();
    await expect(primary(page)).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-review-edit"))).not.toBeNull();
  });

  test("a Google title edited to fit loses its note while typing; Cancel brings it back @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const google = row(page, "Google title – Product 1 jacket");
    const note = google.locator("s-badge", { hasText: /^Note: Too long for Google \(\d+ characters, max\. 60\)$/ });
    await expect(note).toBeVisible();
    await expect(card(page, "Product 1 jacket, German").locator("s-badge", { hasText: "1 note" }).filter({ visible: true })).toHaveCount(1);
    await button(page, "Edit: Google title – Product 1 jacket").click();
    await page.getByRole("textbox", { name: "Google title in German" }).fill("Produkt 1 Jacke – warm und leicht");
    await expect(note).toHaveCount(0);
    await expect(card(page, "Product 1 jacket, German").locator("s-badge", { hasText: "1 note" })).toHaveCount(0);
    await button(page, "Cancel: Google title – Product 1 jacket").click();
    await expect(note).toBeVisible();
  });

  test("HTML is shown rendered; Edit HTML opens the raw text with a live preview @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const preview = page.frameLocator('iframe[title="Product 2 jacket, Description, translation preview"]');
    await expect(preview.locator("body")).toHaveText("[de] Warm jacket number 2.");
    await expect(page.locator('iframe[title="Product 2 jacket, Description, original"]')).toHaveAttribute("sandbox", "");
    await button(page, "Edit HTML: Description – Product 2 jacket").click();
    const raw = page.getByRole("textbox", { name: "Description in German" });
    await expect(raw).toHaveValue("<p>[de] Warm <b>jacket</b> number 2.</p>");
    await raw.fill("<p>Sehr <b>warme</b> Jacke 2.</p>");
    await expect(preview.locator("b")).toHaveText("warme");
    await button(page, "Cancel: Description – Product 2 jacket").click();
    await expect(raw).toHaveCount(0);
    await expect(preview.locator("body")).toHaveText("[de] Warm jacket number 2.");
  });

  test("a new web address is approved on its own after a question, and an invalid one says why @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const product = card(page, "Product 1 jacket, German");
    const approvable = await product.getByRole("button", { name: /^Approve: / }).filter({ visible: true }).count();
    // The card's button leaves the web address out.
    await expect(button(product, new RegExp(`^Approve all ${approvable - 1}: Product 1 jacket`))).toBeVisible();
    await expect(row(page, "Web address – Product 1 jacket").getByText(/^New web address: old links to this page in German stop working afterwards\.$/)).toBeVisible();

    await button(page, "Edit: Web address – Product 1 jacket").click();
    await page.getByRole("textbox", { name: "Web address in German" }).fill("Neue Jacke");
    await expect(button(page, "Approve: Web address – Product 1 jacket")).toBeDisabled();
    await button(page, "Cancel: Web address – Product 1 jacket").click();

    await button(page, "Approve: Web address – Product 1 jacket").click();
    const question = page.locator('s-banner[heading="Approve the new web address? Old links in German stop working afterwards."]');
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Approve: Web address – Product 1 jacket" }).click();
    await expect(product.getByText("“produkt-1-jacke”")).toBeVisible();
  });

  test("the area chips add up, and Image descriptions shows only image texts in their products' cards @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    const chips = areas(page);
    const allAreas = await numberIn(chips.locator('[aria-current="true"]'));
    const others = await chips.locator("s-clickable-chip").allTextContents();
    expect(others.reduce((sum, text) => sum + Number(text.match(/\d+/g)!.at(-1)), 0)).toBe(allAreas);

    const count = await numberIn(chip(page, "Image descriptions"));
    await chips.getByRole("link", { name: /^Image descriptions \d+$/ }).click();
    await expect(page).toHaveURL(/area=images/);
    await expect(texts(page)).toHaveCount(count);
    for (const text of await texts(page).allTextContents()) expect(text.trim()).toMatch(/^Image text/);
    for (const name of await page.locator("s-section[accessibilitylabel]").evaluateAll((els) => els.map((el) => el.getAttribute("accessibilitylabel")))) {
      expect(name).toMatch(/^Product \d jacket, German$/);
    }
  });

  test("the language page's review link for image descriptions lands on exactly those texts @responsive", async ({ page }) => {
    await open(page, "/app/languages/de");
    await expect(page.getByRole("link", { name: /^Review \d+: Image descriptions$/ })).toBeVisible();
    const count = await numberIn(page.locator('s-link[href="/app/review?lang=de&area=images"]'));
    await open(page, "/app/review?lang=de&area=images");
    await expect(texts(page)).toHaveCount(count);
  });

  test("With notes shows only texts with a note @responsive", async ({ page }) => {
    await open(page);
    const count = await numberIn(chip(page, "With notes"));
    await page.getByRole("link", { name: /^With notes \d+$/ }).click();
    await expect(page).toHaveURL(/flagged=1/);
    await expect(texts(page)).toHaveCount(count);
    await expect(page.locator("s-section[accessibilitylabel] li s-badge", { hasText: /^Note: / }).filter({ visible: true })).toHaveCount(count);
    // The chosen chip removes the filter again.
    await expect(page.getByRole("link", { name: /^Remove filter: With notes/ })).toBeVisible();
  });

  test("search runs while typing and can be cleared @responsive", async ({ page }) => {
    await open(page);
    const search = page.getByRole("searchbox", { name: "Search" });
    await search.pressSequentially("Product 6", { delay: 30 });
    await expect(page).toHaveURL(/q=Product\+6/);
    await expect(page.getByText(/^\d+ match(es)? for “Product 6”$/)).toBeVisible();
    for (const name of await page.locator("s-section[accessibilitylabel]").evaluateAll((els) => els.map((el) => el.getAttribute("accessibilitylabel")))) {
      expect(name).toMatch(/^Product 6 jacket, /);
    }
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test("a page whose original changed meanwhile: what went live, what didn't and why @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=es");
    await primary(page).click();
    await page.locator("s-modal#review-approve").getByRole("button", { name: "Approve 2", exact: true }).click();
    await expect(page.locator('s-banner[heading="1 approved · 1 not published"]')).toBeVisible();
    await expect(page.getByText("The marked texts say why.")).toBeVisible();
    await expect(page.getByText("Outdated: the original changed in the meantime. Not published.")).toBeVisible();
    await expect(page.getByText("Approved – customers see it now.")).toBeVisible();

    // Another selection is drawn afresh: this page's banner and outcomes stay behind.
    await languages(page).getByRole("link", { name: /^German \d+$/ }).click();
    await expect(page).toHaveURL(/lang=de/);
    await expect(languages(page).locator('[aria-current="true"]')).toContainText("German");
    await page.waitForTimeout(500);
    await expect(page.locator('s-banner[heading="1 approved · 1 not published"]')).toHaveCount(0);
    await expect(page.getByText("The marked texts say why.")).toHaveCount(0);
  });

  test("a job's texts: the scope chip, and Show all @responsive", async ({ page }) => {
    await open(page, "/app/jobs");
    const job = await page.locator('s-link[href^="/app/jobs/"]').first().getAttribute("href");
    await open(page, job!);
    const review = await page.locator('s-button[href^="/app/review?job="]').getAttribute("href");
    await open(page, review!);
    await expect(page.getByText(/^Only from the job of /)).toBeVisible();
    const scoped = await numberIn(summary(page));
    await page.getByRole("link", { name: /^Remove filter: Only from the job of / }).click();
    await expect(page).not.toHaveURL(/job=/);
    await expect.poll(() => numberIn(summary(page))).toBeGreaterThan(scoped);
  });

  test("leaving with an edited text asks first, and staying keeps the edit @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    await button(page, "Edit HTML: Description – Product 5 jacket").click();
    const raw = page.getByRole("textbox", { name: "Description in German" });
    await raw.fill("<p>Warme Jacke 5.</p>");
    await languages(page).getByRole("link", { name: /^French \d+$/ }).click();
    const banner = page.locator('s-banner[heading="Discard your edits?"]');
    await expect(banner).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("review-stay");
    await banner.getByRole("button", { name: "Stay on this page" }).click();
    await expect(banner).toHaveCount(0);
    await expect(page).toHaveURL(/lang=de/);
    await expect(raw).toHaveValue("<p>Warme Jacke 5.</p>");
    await button(page, "Cancel: Description – Product 5 jacket").click();
  });

  test("a decided page says so and continues with what still waits @responsive", async ({ page }) => {
    await open(page, "/app/review?area=pages");
    await button(page, /^Approve all 2: About us 1/).click();
    const heading = page.locator("#review-done-heading");
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText(/^2 approved\. \d+ more (is|are) waiting\.$/)).toBeVisible();
    await page.locator("s-button[href]", { hasText: "Continue" }).click();
    await expect(page).not.toHaveURL(/area=/);
    await expect(page.locator("s-section[accessibilitylabel]").first()).toBeVisible();
  });

  test("Arabic, still hidden from customers: marked, right to left, and approved as hidden @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=ar");
    const tab = languages(page).locator('[aria-current="true"]');
    await expect(tab).toContainText("Arabic");
    await expect(tab).toContainText("hidden");
    const arabic = card(page, "Product 5 jacket, Arabic");
    await expect(arabic.getByText("hidden", { exact: true }).first()).toBeVisible();
    await expect(arabic.locator('[dir="rtl"]', { hasText: "سترة المنتج 5" })).toBeVisible();
    await button(page, "Approve: Name – Product 5 jacket").click();
    // Its only text: the card folds to one line, its meta line still saying "hidden"; the result is read out.
    await expect(arabic.getByText("1 approved")).toBeVisible();
    await expect(arabic.getByText("hidden", { exact: true }).first()).toBeVisible();
    await expect(page.locator('div[role="status"]')).toContainText("Name – Product 5 jacket: Approved – Arabic is still hidden from customers.");
  });

  test("is accessible and never scrolls sideways, also at 390 px @responsive", async ({ page }) => {
    await open(page);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
    if (test.info().project.name === "mobile") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalScroll(page);
    }
  });

  // The tests below change the store while the page is open (another tab, a job), so they come last.

  test("a text replaced meanwhile: Reload shows the newer one, and asks first while another text is edited @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    await button(page, "Edit: Name – Product 1 jacket").click();
    const name = page.getByRole("textbox", { name: "Name in German" });
    await name.fill("Meine Jacke");
    // A newer translation of the description is saved while the page is open.
    await inStore((shopId) =>
      owner.translationDraft.updateMany({
        where: { shopId, resourceGid: "gid://shopify/Product/1", locale: "de", key: "body_html" },
        data: { value: "<p>Neuere Jacke 1.</p>" },
      }),
    );
    await button(page, "Approve: Description – Product 1 jacket").click();
    const changed = page.getByText("Changed in the meantime: there is a newer version. Reload to see it.", { exact: true });
    await expect(changed).toBeVisible();

    // Reloading would lose the edited name: it asks first, and staying keeps it.
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    const leave = page.locator('s-banner[heading="Discard your edits?"]');
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "Stay on this page" }).click();
    await expect(leave).toHaveCount(0);
    await expect(name).toHaveValue("Meine Jacke");

    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await leave.getByRole("button", { name: "Leave and discard" }).click();
    // The newer text, waiting to be decided (not the earlier answer again).
    const preview = page.frameLocator('iframe[title="Product 1 jacket, Description, translation preview"]');
    await expect(preview.locator("body")).toHaveText("Neuere Jacke 1.");
    await expect(button(page, "Approve: Description – Product 1 jacket")).toBeVisible();
    await expect(changed).toHaveCount(0);
    await expect(name).toHaveCount(0);
  });

  test("while a card's request runs, the page's buttons wait for it @responsive", async ({ page }) => {
    await open(page, "/app/review?lang=de");
    // Shopify answers slowly.
    let first = true;
    await page.route("**/app/review.data**", async (route) => {
      if (route.request().method() !== "POST" || !first) return route.continue();
      first = false;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ response });
    });
    await button(page, "Approve: Name – Product 1 jacket").click();
    // The page's request would send the same text a second time (and report it as not published).
    await expect(primary(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reject all", exact: true })).toBeDisabled();
    await expect(card(page, "Product 1 jacket, German").getByText("Approved – customers see it now.")).toBeVisible();
    await expect(primary(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Reject all", exact: true })).toBeEnabled();
  });

  test("more than one page: Next page without deciding this one, and Back to the start @responsive", async ({ page }) => {
    // 60 more French texts: two pages of French.
    await inStore((shopId) =>
      owner.translationDraft.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          shopId,
          resourceGid: `gid://shopify/Product/${1000 + i}`,
          resourceTitle: `Product ${1000 + i} scarf`,
          locale: "fr",
          key: "title",
          sourceDigest: `scarf-${i}`,
          sourceValue: `Product ${1000 + i} scarf`,
          value: `Écharpe produit ${1000 + i}`,
          provider: "deepl",
        })),
      }),
    );
    await open(page, "/app/review?lang=fr");
    // The chosen tab's count: every French text waiting.
    const total = await numberIn(languages(page).locator('[aria-current="true"]'));
    expect(total).toBeGreaterThan(50);
    await expect(summary(page)).toHaveText(`50 translations on this page · 1–50 of ${total}`);
    await expect(page.getByText(`1–50 of ${total}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the start" })).toHaveCount(0);
    // A card's picture square (its first rounded box): a picture, the area's icon without one, empty while pictures load.
    const square = () => page.locator("s-section[accessibilitylabel]").first().locator('div[style*="border-radius"]').first();
    await expect(square().locator("img, s-icon")).toHaveCount(1);

    // The next page's pictures load after it: its cards wait for theirs, not for this page's answer.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/app/review/previews**", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/after=/);
    await expect(square().locator("img, s-icon")).toHaveCount(0);
    release();
    // These have no picture in the store: the area's icon once the answer is there.
    await expect(square().locator("s-icon")).toHaveCount(1);
    await expect(summary(page)).toHaveText(new RegExp(`^${total - 50} translations? on this page · 51–${total} of ${total}$`));
    await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: "Back to the start" }).click();
    await expect(page).not.toHaveURL(/after=/);
    await expect(summary(page)).toHaveText(`50 translations on this page · 1–50 of ${total}`);
  });

  test("rejecting the page doesn't say it is approving @responsive", async ({ page }) => {
    await inStore((shopId) =>
      owner.translationDraft.create({
        data: { shopId, resourceGid: "gid://shopify/Product/88", resourceTitle: "Product 88 gloves", locale: "fr", key: "title", sourceDigest: "gloves-88", sourceValue: "Product 88 gloves", value: "Gants produit 88", provider: "deepl" },
      }),
    );
    await open(page, "/app/review?lang=fr&q=Product%2088%20gloves");
    await expect(summary(page)).toHaveText(/^1 translation on this page/);
    // The answer comes slowly.
    await page.route("**/app/review.data**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ response });
    });
    await page.locator("s-button", { hasText: "Reject all" }).click();
    await page.locator("s-modal#review-reject").getByRole("button", { name: "Reject 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reject all", exact: true })).toBeDisabled();
    await expect(page.getByText("Approving – this can take a moment.")).toHaveCount(0);
    await expectToast(page, "1 translation rejected. It won't be published.");
  });
});
