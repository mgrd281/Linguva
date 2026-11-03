/**
 * A language's own page (/app/languages/:locale): how far it is and what to
 * do next (the page's only primary button), the three steps to live, each
 * area in the order customers meet it with real pictures from the store,
 * what the percentage leaves out, and the question before translating an
 * area. Also its not-counted, hidden, no-access and not-found states.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, openApp } from "./helpers";

/** A card or section by its accessibility label (Polaris sets it as an attribute). */
const labelled = (label: string) => `s-section[accessibilitylabel="${label}"]`;

/** Primary buttons outside dialogs (a dialog has its own primary action). */
const primaryButtons = (page: Page) =>
  page.locator('[data-button][data-variant="primary"]').evaluateAll((buttons) => buttons.filter((b) => !b.closest("s-modal")).map((b) => (b as HTMLElement).innerText.trim()));

/** The area cards' names, top to bottom. */
const AREAS = ["Products", "Collections", "Menus & filters", "Sizes & colors", "Store & checkout", "Extra details", "Size charts & more", "Pages", "Blog", "Image descriptions"];
const areaOrder = (page: Page) =>
  page.locator("s-section[accessibilitylabel]").evaluateAll((sections, names) => sections.map((s) => s.getAttribute("accessibilitylabel")!).filter((n) => names.includes(n)), AREAS);

/** Every picture shown in a card has loaded and has an alt attribute (Shopify's alt text, or empty beside the written name). */
async function expectPictures(card: Locator, minimum: number) {
  await card.scrollIntoViewIfNeeded();
  // On a phone, pictures beyond the first row are hidden.
  const images = card.locator("img:visible");
  await expect.poll(() => images.count()).toBeGreaterThanOrEqual(minimum);
  const pictures = await images.evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((img) => ({ alt: img.getAttribute("alt"), src: img.getAttribute("src") ?? "", complete: img.complete, width: img.naturalWidth })),
  );
  for (const picture of pictures) {
    expect(picture.alt, picture.src).not.toBeNull();
    // Shopify's CDN width for 96 px tiles; served by the simulated store.
    expect(picture.src).toMatch(/\/__fixtures\/img\/[a-z]+\.svg\?width=192$/);
  }
  await expect.poll(() => images.evaluateAll((imgs) => (imgs as HTMLImageElement[]).every((img) => img.complete && img.naturalWidth > 0))).toBe(true);
}

test("how far a language is, one next step, and each area with pictures @responsive", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page, "demo", "/app/languages/de");

  // Where it sits, its name and who reads it.
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/app");
  await expect(page.getByRole("heading", { level: 1, name: "German" })).toBeVisible();
  await expect(page.locator("s-badge", { hasText: "Visible to customers" })).toBeVisible();
  await expect(page.getByText(/^For customers in these countries: .*Germany/)).toBeVisible();
  await expect(page.getByText(/Last counted /)).toBeVisible();

  // The figure with its ring, in words, and what customers see where nothing is translated.
  const hero = page.locator(labelled("How far German is"));
  await expect(hero.getByRole("img", { name: /^\d+% translated: \d+ of \d+ texts are done and live$/ })).toBeVisible();
  await expect(hero.getByText(/^\d+ of \d+ texts are done and live$/)).toBeVisible();
  await expect(hero.getByText("Where nothing is translated yet, customers see English.")).toBeVisible();
  // Up to three steps, each with its icon square (no numbers: those are the steps to live); the first one's button is the page's only primary button.
  await expect(hero.getByText("Next", { exact: true })).toBeVisible();
  await expect(hero.locator("ol > li")).not.toHaveCount(0);
  expect((await hero.locator("ol > li").count()) <= 3).toBe(true);
  for (const step of await hero.locator("ol > li").all()) await expect(step.locator(".lv-icon-square")).toHaveCount(1);
  expect(await primaryButtons(page)).toHaveLength(1);
  const primary = hero.locator("ol > li").first().locator('[data-button][data-variant="primary"]');
  await expect(primary).toHaveCount(1);
  // Easy to hit with a thumb.
  if (info.project.name === "mobile") expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Image descriptions go with their products' step, never a step of their own.
  await expect(hero.locator("ol > li").first()).toContainText("Translate products");
  await expect(hero.locator("ol > li").first()).toContainText(/plus \d+ image descriptions?/);
  await expect(hero.getByText("Translate image descriptions")).toHaveCount(0);

  // Nothing waits for approval in German: the steps to live aren't shown (they explain waiting texts).
  await expect(page.getByRole("region", { name: "How English becomes German" })).toHaveCount(0);

  // The areas in the order customers meet them.
  expect(await areaOrder(page)).toEqual(["Products", "Collections", "Extra details", "Image descriptions"]);
  const products = page.locator(labelled("Products"));
  // One heading per card (the section's label); the visible name is drawn as one, and its one link is "View all".
  await expect(products.getByRole("heading", { name: "Products", exact: true })).toHaveCount(1);
  await expect(products.locator(".lv-h3")).toHaveText("Products");
  await expect(products.getByRole("link", { name: "Products", exact: true })).toHaveCount(0);
  await expect(products.locator('.lv-icon-square[data-tint="blue"] s-icon[type="product"]')).toHaveCount(1);
  await expect(products.getByText(/^\d+% ?$|^<1%$/).first()).toBeVisible();
  await expect(products.getByText(/^\d+ of \d+ texts$/)).toBeVisible();
  // The way to every item stays visible on a phone too.
  const all = products.getByRole("link", { name: "View all 8: Products" });
  await expect(all).toBeVisible();
  await expect(all).toHaveAttribute("href", "/app/languages/de/products");
  // Real pictures, loaded after the page.
  await expectPictures(products, info.project.name === "mobile" ? 3 : 6);
  await expectPictures(page.locator(labelled("Collections")), info.project.name === "mobile" ? 0 : 2);

  // What the percentage leaves out comes last, as "More texts" (Content's name for them too).
  await expect(page.getByRole("heading", { name: "More texts" })).toBeVisible();
  await expect(page.getByText(/^They don't count toward the \d+%: /)).toBeVisible();
  await expect(page.getByRole("link", { name: /^Web addresses/ })).toHaveAttribute("href", /^\/app\/coverage\/items\?/);

  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("the words, folded until asked for, with the app's one fold", async ({ page }) => {
  await openApp(page, "demo", "/app/languages/de");
  const words = page.locator("details", { hasText: "What do these words mean?" });
  await expect(words).not.toHaveAttribute("open");
  // A chevron at the summary's end, no browser triangle.
  await expect(words).toHaveClass(/lv-more/);
  await expect(words.locator("summary s-icon[type='chevron-down']")).toHaveCount(1);
  await words.locator("summary").click();
  await expect(words.getByText("You changed the original. Customers still see the old translation.")).toBeVisible();
  await expect(words.getByText("Customers still see English here.")).toBeVisible();
});

test("why the percentage rises only after approving: the steps to live, while texts wait for it", async ({ page }) => {
  // French in the demo store has AI drafts waiting.
  await openApp(page, "demo", "/app/languages/fr");
  const strip = page.getByRole("region", { name: "How English becomes French" });
  for (const step of ["to translate", "you approve", "customers see it"]) await expect(strip.getByText(step, { exact: true }).or(strip.getByText(new RegExp(`^\\d · ${step}`, "i")))).not.toHaveCount(0);
  // Approving comes first, with its icon square.
  const first = page.locator(labelled("How far French is")).locator("ol > li").first();
  await expect(first).toContainText(/^Approve \d+ translations?/);
  await expect(first.locator('s-icon[type="eye-check-mark"]')).toHaveCount(1);
});

test("a step's Translate ticks the image descriptions and extra details it names; a card's starts without them", async ({ page }) => {
  await openApp(page, "demo", "/app/languages/de");
  const dialog = page.locator("s-modal#language-translate");
  const attached = dialog.getByRole("checkbox", { name: "Also translate image descriptions and extra details" });
  await page.locator(labelled("How far German is")).locator("ol > li").first().getByRole("button", { name: "Translate: Products" }).click();
  await expect(page.getByRole("dialog", { name: /^Translate \d+ products? into German\?$/ })).toBeVisible();
  await expect(attached).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.locator(labelled("Products")).getByRole("button", { name: "Translate: Products" }).click();
  await expect(attached).not.toBeChecked();
});

test("translating an area asks first, says what happens, and Cancel starts nothing @responsive", async ({ page }) => {
  await openApp(page, "demo", "/app/languages/de");
  const products = page.locator(labelled("Products"));
  await products.getByRole("button", { name: "Translate: Products" }).click();
  await expect(page.getByRole("dialog", { name: /^Translate \d+ products? into German\?$/ })).toBeVisible();
  // The dialog's content is the modal's own (Polaris slots it into the dialog).
  const dialog = page.locator("s-modal#language-translate");
  await expect(dialog.getByText("What gets translated", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^\d+ products?: up to \d+ texts? – /)).toBeVisible();
  await expect(dialog.getByText("You approve them", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Your own translations stay", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Up to [\d,]+ characters\. [\d,]+ are still free this month\.$/)).toBeVisible();
  // Image descriptions and extra details only when asked for.
  await expect(dialog.getByRole("checkbox", { name: "Also translate image descriptions and extra details" })).not.toBeChecked();
  await expectAccessible(page);

  const jobs: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") jobs.push(request.url());
  });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(jobs).toEqual([]);
});

test("confirming starts the area's translation and opens its job", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Starts a job: once");
  // French in the catalog store is only translated by this test.
  await openApp(page, "catalog", "/app/languages/fr");
  await page.locator(labelled("Products")).getByRole("button", { name: "Translate: Products" }).click();
  await expect(page.getByRole("dialog", { name: "Translate 55 products into French?" })).toBeVisible();
  await page.locator("s-modal#language-translate").getByRole("button", { name: "Translate 55 products" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}(\?|$)/);
  // Queued: no worker runs in these tests, so it starts with a delay (or shortly).
  await expect(page.getByRole("heading", { level: 2, name: /^(Starts with a delay|Starts shortly)$/ })).toBeVisible();

  // Back on the language page, the area shows its job instead of the button.
  await openApp(page, "catalog", "/app/languages/fr");
  const products = page.locator(labelled("Products"));
  await expect(products.getByText(/^Translating now/)).toBeVisible();
  await expect(products.getByRole("link", { name: "View job" })).toHaveAttribute("href", /^\/app\/jobs\/[0-9a-f-]{36}$/);
  await expect(products.getByRole("button", { name: "Translate: Products" })).toHaveCount(0);
});

test("a language not counted yet offers counting and shows no areas @responsive", async ({ page }) => {
  await openApp(page, "owner", "/app/languages/de");
  const hero = page.locator(labelled("How far German is"));
  await expect(hero.getByText("Not counted yet", { exact: true }).first()).toBeVisible();
  await expect(hero.getByRole("img", { name: "Not counted yet" })).toBeVisible();
  expect(await primaryButtons(page)).toEqual(["Count now"]);
  expect(await areaOrder(page)).toEqual([]);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a hidden language says so, with the way to publish it, and reads right to left where it is Arabic", async ({ page }) => {
  await openApp(page, "full", "/app/languages/ar");
  await expect(page.getByRole("heading", { level: 1, name: "Arabic" })).toBeVisible();
  await expect(page.locator("s-badge", { hasText: "Hidden" })).toBeVisible();
  await expect(page.getByText("Customers can't choose this language yet.")).toBeVisible();
  await expect(page.locator('s-link[href="shopify://admin/settings/languages"][target="_top"]', { hasText: "Publish in Shopify" })).toHaveCount(1);
  await expectAccessible(page);
});

test("an area Linguva can't read shows no figure, and the way to allow it: Content's card, which asks for every permission at once", async ({ page }) => {
  // Policies need read_legal_policies, which this store didn't grant.
  await openApp(page, "full", "/app/languages/de");
  const checkout = page.locator(labelled("Store & checkout"));
  await expect(checkout.getByText("No access")).toBeVisible();
  await expect(checkout.getByText("—")).toBeVisible();
  const allow = checkout.getByRole("link", { name: "Allow access" });
  await expect(allow).toHaveAttribute("href", "/app/content?lang=de#content-access");
  // Nothing is called done while it can't be read.
  await expect(page.getByText("Everything is translated")).toHaveCount(0);
  await allow.click();
  await expect(page).toHaveURL(/\/app\/content\?lang=de.*#content-access$/);
  await expect(page.getByRole("heading", { name: "Linguva can't read everything yet" })).toBeVisible();
});

test("the theme's texts open their group on the Content page, in this language", async ({ page }) => {
  await openApp(page, "full", "/app/languages/de");
  const theme = page.getByRole("link", { name: /^Texts of your theme/ });
  await expect(theme).toHaveAttribute("href", "/app/content?lang=de&open=theme");
  await theme.click();
  await expect(page).toHaveURL(/\/app\/content\?lang=de&open=theme/);
  await expect(page.locator("details#theme")).toHaveAttribute("open", "");
  await expect(page.locator("details#theme > summary")).toContainText("Texts of your theme");
  await expect(page.getByRole("navigation", { name: "Choose a language" }).locator('[aria-current="page"]')).toHaveText(/German/);
});

test("an unknown language is not found; the store's own language leads to the Overview", async ({ page }) => {
  const response = await openApp(page, "full", "/app/languages/xx");
  expect(response?.status()).toBe(404);
  await expect(page.locator(`s-banner[heading="We couldn't find this page"]`)).toBeVisible();

  await openApp(page, "full", "/app/languages/en");
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
});
