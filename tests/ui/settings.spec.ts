/**
 * Settings: six tiles at a glance (each state with its reason, moving to its
 * card without loading the page again), the cards in the order a merchant
 * needs them, and every state as it really is: translating changes (off,
 * on, paused, waiting for the permission, stopped by the plan), publishing
 * (with its dialog, and after a move to a smaller plan), the form of
 * address under the admin's save bar, translation memory, the permission
 * (withdrawn in a dialog), the AI characters with a trial's date, the
 * empty store, the tools and the German texts.
 */
import { expect, test, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";
import { clickSaveBarButton, expectAccessible, expectNoHorizontalScroll, expectToast, openApp, saveBarShown, sessionToken } from "./helpers";

const glance = (page: Page) => page.getByRole("region", { name: "At a glance" });
const option = (page: Page, card: string, name: string) => page.locator(card).getByRole("group", { name, exact: true });
/** Chooses an option: its whole header is one button. */
const choose = (page: Page, card: string, name: string) => option(page, card, name).getByRole("button").first().click();
const isCurrent = (page: Page, card: string, name: string) => expect(option(page, card, name).getByText("Current setting")).toBeVisible();
const cardOrder = (page: Page) => page.locator("section[id^='settings-']").evaluateAll((sections) => sections.map((s) => s.id));
/** Primary buttons on the page (not the ones inside a closed dialog). */
const primaries = (page: Page) =>
  page.locator('s-button[variant="primary"]').evaluateAll((buttons) => buttons.filter((b) => !b.closest("s-modal")).map((b) => (b as HTMLElement).innerText.trim()));
const post = (page: Page, shop: UiShopKey, path: string, form: Record<string, string>) =>
  page.request.post(new URL(path, UI_ENV.appUrl).toString(), { headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS[shop].domain)}` }, form });

test("at a glance: six tiles with each state and its reason; a tile moves to its card without loading the page again @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const tiles = glance(page).locator("li");
  await expect(tiles).toHaveCount(6);
  // In this order, each with its reason or value (a phone shows the shorter names).
  const expected = [
    /^AI permission\s*Allowed\s*since /,
    /^(Translating changes|Changes)\s*Off\s*Nothing runs by itself$/,
    /^Publishing\s*With review\s*Wait in Review for your approval$/,
    /^Form of address\s*DeepL decides\s*Without a description of your store$/,
    /^(Translation memory|Memory)\s*(Also AI translations|Also AI)\s*Saves AI characters; a mistake repeats$/,
    /^AI characters\s*(<1%|\d+%)\s*[\d,]+ of 1,200,000 · new on [A-Z][a-z]+ \d{1,2}$/,
  ];
  for (const [index, text] of expected.entries()) await expect(tiles.nth(index)).toHaveText(text, { useInnerText: true });
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // A tile moves focus to its card's heading: no navigation, no loader called again.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/app/settings")) requests.push(request.url());
  });
  const url = page.url();
  await glance(page).getByRole("button", { name: /^Publishing/ }).click();
  await expect(page.locator("#settings-publish-heading")).toBeFocused();
  await expect(page.locator("#settings-publish")).toBeInViewport();
  expect(page.url()).toBe(url);
  expect(requests).toEqual([]);
  // The AI characters open the Plan page.
  await expect(glance(page).getByRole("link", { name: /^AI characters/ })).toHaveAttribute("href", "/app/plan");
});

test("the cards come in the order a merchant needs them; the permission comes first only while it is missing, with the page's one primary button", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  expect(await cardOrder(page)).toEqual(["settings-changes", "settings-publish", "settings-style", "settings-memory", "settings-ai", "settings-tools"]);
  // Nothing is required: no primary button (the save bar's comes from the admin).
  expect(await primaries(page)).toEqual([]);
  // Granted: the permission's card says so without a date in its header (the tile has it).
  await expect(page.locator("#settings-ai s-badge").first()).toHaveText("Allowed");

  await openApp(page, "measure", "/app/settings");
  expect(await cardOrder(page)).toEqual(["settings-ai", "settings-changes", "settings-publish", "settings-style", "settings-memory", "settings-tools"]);
  expect(await primaries(page)).toEqual(["Allow AI translation"]);
  await expect(glance(page).locator("li").first()).toHaveText(/^AI permission\s*Not allowed\s*Without permission, AI translates nothing$/, { useInnerText: true });
  // What needs the permission says so, with the way to give it where it is.
  const basic = option(page, "#settings-changes", "Shortly after saving");
  await expect(basic.getByText("Allow AI translation first.")).toBeVisible();
  await expect(basic.getByRole("button", { name: "Allow AI translation" })).toBeVisible();
  // What is sent and when, behind its disclosure.
  const ai = page.locator("#settings-ai");
  await expect(ai.getByText("Linguva sends only your store's texts (such as products, pages and menus) to DeepL SE in Germany, no customer or order data.")).toBeVisible();
  await ai.getByText("What is sent and when").click();
  await expect(ai.getByText(/^Metaobjects and payment methods may contain personal data/)).toBeVisible();
  await expectAccessible(page);
});

test("the form of address is chosen per language and saved under the admin's save bar @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const section = page.locator("#settings-style");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Form of address");
  // The pronouns of each language; no choice where DeepL has none (Arabic).
  await expect(section.locator('s-select[name="formality:de"] s-option')).toHaveText(["DeepL decides", "Formal (Sie)", "Informal (du)"]);
  await expect(section.locator('s-select[name="formality:fr"] s-option')).toHaveText(["DeepL decides", "Formal (vous)", "Informal (tu)"]);
  await expect(section.getByRole("combobox", { name: "Arabic", exact: true })).toHaveCount(0);
  await expect(section.getByText("No choice needed")).toBeVisible();
  const context = section.getByRole("textbox", { name: "About your store" });
  await expect(context).toHaveAttribute("placeholder", "Outdoor clothing for families, friendly and simple");
  await expect(section.getByText("What you sell and how you speak. Helps AI choose its words; not translated.")).toBeVisible();
  await expect(section.getByText("Fixed terms: 0 in the glossary")).toBeVisible();
  await expect(section.getByRole("link", { name: "Edit glossary" })).toHaveAttribute("href", "/app/glossary");
  // Saved by the admin's save bar only.
  await expect(section.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  await section.getByRole("combobox", { name: "German", exact: true }).selectOption("less");
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(true);
  await context.fill("Outdoor clothing for families, friendly and simple.");
  await clickSaveBarButton(page, "settings-style-save-bar", 0);
  await expectToast(page, "Saved. New AI translations use this form of address.");
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(false);
  await page.reload();
  await expect(section.getByRole("combobox", { name: "German", exact: true })).toHaveValue("less");
  await expect(context).toHaveValue("Outdoor clothing for families, friendly and simple.");
  // German informal, French as DeepL decides: chosen per language.
  await expect(glance(page).locator("li").nth(3)).toHaveText(/^Form of address\s*Per language\s*With a description of your store$/, { useInnerText: true });

  // Discard: back to what is saved, nothing written.
  await section.getByRole("combobox", { name: "French", exact: true }).selectOption("more");
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(true);
  await clickSaveBarButton(page, "settings-style-save-bar", 1);
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(false);
  await expect(section.getByRole("combobox", { name: "French", exact: true })).toHaveValue("default");
  await page.reload();
  await expect(section.getByRole("combobox", { name: "French", exact: true })).toHaveValue("default");

  // As it was (other tests use this store).
  await section.getByRole("combobox", { name: "German", exact: true }).selectOption("default");
  await context.fill("");
  await clickSaveBarButton(page, "settings-style-save-bar", 0);
  await expectToast(page, "Saved. New AI translations use this form of address.");
});

test("publishing: choosing automatic asks first in a dialog; Cancel changes nothing; the server still needs the confirmation", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const card = "#settings-publish";
  await isCurrent(page, card, "Review first");
  await expect(option(page, card, "Review first").getByText("Recommended")).toBeVisible();
  await expect(page.locator(`${card} s-badge`).first()).toHaveText("With review");
  await expect(page.locator(card).getByText("Applies to whole areas and automatic translation. The smart schedule has its own setting.")).toBeVisible();
  await expect(page.locator(card).getByRole("link", { name: "Go to Review" })).toHaveAttribute("href", "/app/review");

  const dialog = page.getByRole("dialog", { name: "Publish automatically?" });
  await choose(page, card, "Publish automatically");
  await expect(dialog).toBeVisible();
  await expect(page.locator("s-modal#settings-publish-confirm")).toContainText("I understand that AI translations will be published in my store without my review.");
  await expectAccessible(page);
  await page.locator("s-modal#settings-publish-confirm").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await isCurrent(page, card, "Review first");

  await choose(page, card, "Publish automatically");
  await page.locator("s-modal#settings-publish-confirm").getByRole("button", { name: "Publish automatically", exact: true }).click();
  await expectToast(page, "Saved. Translations without warnings are published automatically.");
  await isCurrent(page, card, "Publish automatically");
  await expect(page.locator("#settings-publish-auto")).toBeFocused();
  await expect(page.locator(`${card} s-badge`).first()).toHaveText("Automatic");
  await expect(glance(page).locator("li").nth(2)).toHaveText(/^Publishing\s*Automatic\s*Without warnings: published right away$/, { useInnerText: true });

  // Back to review first (no dialog for the safer choice).
  await choose(page, card, "Review first");
  await expectToast(page, "Saved. New translations wait in Review.");
  await isCurrent(page, card, "Review first");
  await expect(page.locator("#settings-publish-review")).toBeFocused();

  // A request without the confirmation is refused, whatever the page sends.
  expect(await (await post(page, "full", "/app/settings.data", { intent: "publish-mode", mode: "AUTO_PUBLISH" })).text()).toContain("CONFIRMATION_REQUIRED");
  await page.reload();
  await isCurrent(page, card, "Review first");
});

test("automatic publishing left on from a bigger plan: shows what really happens, and \"Review first\" can still be chosen", async ({ page }) => {
  await openApp(page, "planAutoPublish", "/app/settings");
  const card = page.locator("#settings-publish");
  await expect(card.locator("s-badge").first()).toHaveText("With review");
  await expect(card.getByText("Automatic publishing isn't in your plan. New translations therefore wait in Review.")).toBeVisible();
  await expect(card.getByText("publishing becomes automatic again unless you choose", { exact: false })).toBeVisible();
  // The saved setting stays marked; leaving it is one tap on "Review first" (not clicked here: the store is shared).
  await isCurrent(page, "#settings-publish", "Publish automatically");
  await expect(option(page, "#settings-publish", "Review first").getByRole("button").first()).toBeVisible();
  // The one lock: the plan's name, one line, the way to the plans; nothing to choose.
  const auto = option(page, "#settings-publish", "Publish automatically");
  await expect(auto.getByText("Pro", { exact: true })).toBeVisible();
  await expect(auto.getByText("In the Pro and Business plans.")).toBeVisible();
  await expect(auto.getByRole("link", { name: "See plans" })).toBeVisible();
  await expect(auto.getByRole("button")).toHaveCount(0);
  await expect(glance(page).locator("li").nth(2)).toHaveText(/^Publishing\s*With review\s*Automatic isn't in your plan$/, { useInnerText: true });
});

test("translation memory: the whole option chooses it, with a toast and focus on the choice that is now current", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const card = "#settings-memory";
  const approvedNow = (await option(page, card, "Approved only").getByText("Current setting").count()) > 0;
  const [other, back] = approvedNow ? ["Also AI translations", "Approved only"] : ["Approved only", "Also AI translations"];
  await choose(page, card, other);
  await expectToast(page, "Saved. Translation memory follows this choice.");
  await isCurrent(page, card, other);
  await expect(page.locator(approvedNow ? "#settings-memory-machine" : "#settings-memory-approved")).toBeFocused();
  await expect(page.locator(`${card} s-badge`).first()).toHaveText(other);
  await page.reload();
  await isCurrent(page, card, other);
  await expect(page.locator(card).getByRole("link", { name: "Open translation memory" })).toHaveAttribute("href", "/app/memory");
  // As it was (other tests use this store).
  await choose(page, card, back);
  await isCurrent(page, card, back);
});

test("the permission: withdrawing asks first in a dialog and moves the card to the top; allowing again where the changes wait", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const ai = page.locator("#settings-ai");
  const dialog = page.getByRole("dialog", { name: "Stop allowing AI translation?" });
  await ai.getByRole("button", { name: "Withdraw permission" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("s-modal#settings-revoke")).toContainText(
    "Linguva then sends no more texts to DeepL. Automatic translation and the smart schedule wait until you allow it again. Existing translations stay.",
  );
  await page.locator("s-modal#settings-revoke").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(ai.locator("s-badge").first()).toHaveText("Allowed");

  await ai.getByRole("button", { name: "Withdraw permission" }).click();
  await page.locator("s-modal#settings-revoke").getByRole("button", { name: "Withdraw permission", exact: true }).click();
  await expectToast(page, "AI translation is no longer allowed.");
  await expect(ai.locator("s-badge").first()).toHaveText("Not allowed");
  expect((await cardOrder(page))[0]).toBe("settings-ai");
  await expect(page.locator("#settings-ai-heading")).toBeFocused();

  // Automatic translation waits for it, and the permission can be given right there.
  const changes = page.locator("#settings-changes");
  await expect(changes.locator("s-badge").first()).toHaveText("Waiting");
  const waiting = changes.locator('s-banner[heading="Automatic translation is waiting for your permission"]');
  await expect(waiting).toContainText("As soon as you allow AI translation, Linguva translates everything that changed meanwhile.");
  await expect(glance(page).locator("li").nth(1)).toHaveText(/Waiting\s*Waiting for your permission$/, { useInnerText: true });
  await waiting.getByRole("button", { name: "Allow AI translation" }).click();
  await expectToast(page, "AI translation is allowed.");
  await expect(waiting).toHaveCount(0);
  await expect(page.locator("#settings-changes-heading")).toBeFocused();
  await expect(ai.locator("s-badge").first()).toHaveText("Allowed");
});

test("translating shortly after saving: chosen with the plan's languages ticked, saved by its own button, off again @responsive", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("Off");
  await expect(card.getByText("Changes are translated when you start a translation.")).toBeVisible();
  await isCurrent(page, "#settings-changes", "Start it yourself");
  // How it works, closed at first.
  await expect(card.locator("details")).not.toHaveAttribute("open", "");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Chosen for the first time: every language of the plan is ticked.
  await choose(page, "#settings-changes", "Shortly after saving");
  const basic = option(page, "#settings-changes", "Shortly after saving");
  for (const name of ["German", "French", "Arabic"]) await expect(basic.getByRole("checkbox", { name, exact: true })).toBeChecked();
  // Without a language it is refused, where the choice is made.
  for (const name of ["German", "French", "Arabic"]) await basic.getByRole("checkbox", { name, exact: true }).uncheck();
  await basic.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(basic.locator('s-banner[heading="Choose at least one language"]')).toBeVisible();
  for (const name of ["German", "French"]) await basic.getByRole("checkbox", { name, exact: true }).check();
  await basic.getByRole("button", { name: "Turn on", exact: true }).click();
  await expectToast(page, /translated about a minute later/);
  await isCurrent(page, "#settings-changes", "Shortly after saving");
  await expect(page.locator("#settings-changes-basic")).toBeFocused();
  await expect(card.locator("s-badge").first()).toHaveText("On");
  await expect(glance(page).locator("li").nth(1)).toHaveText(/On\s*Shortly after saving · (German and French|French and German)$/, { useInnerText: true });

  await page.reload();
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("checkbox", { name: "Arabic", exact: true })).not.toBeChecked();
  await expect(basic.getByRole("button", { name: "Save languages" })).toBeVisible();

  // Off again (other tests use this store).
  await choose(page, "#settings-changes", "Start it yourself");
  await expectToast(page, "Automatic translation is off.");
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await expect(page.locator("#settings-changes-manual")).toBeFocused();
});

test("translating shortly after saving says why it waits, and names a chosen language outside the plan @responsive", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("Paused");
  await expect(glance(page).locator("li").nth(1)).toHaveText(/Paused\s*Continues from .+ UTC · Daily limit reached$/, { useInnerText: true });
  const paused = card.locator('s-banner[heading="Automatic translation is paused"]');
  await expect(paused).toContainText(/Today's AI characters are used up\. From .+ UTC, Linguva continues by itself, including everything that changes until then\./);
  // The Starter plan's three languages; Spanish was chosen and is named, not offered.
  const basic = option(page, "#settings-changes", "Shortly after saving");
  for (const name of ["French", "German", "Italian"]) await expect(basic.getByRole("checkbox", { name, exact: true })).toBeVisible();
  await expect(basic.getByRole("checkbox", { name: "Spanish", exact: true })).toHaveCount(0);
  await expect(basic.getByText("Spanish is chosen but isn't translated: not in your plan.")).toBeVisible();
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("button", { name: "Save languages" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a forged request can't add a language outside the plan or lift a pause", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings");
  expect((await post(page, "autoLimits", "/app/settings.data", { intent: "auto", enabled: "true", locale: "de,es" })).ok()).toBe(true);
  await page.reload();
  // Nothing was written: still German only, and still paused.
  const basic = option(page, "#settings-changes", "Shortly after saving");
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("checkbox", { name: "French", exact: true })).not.toBeChecked();
  await expect(page.locator("#settings-changes s-badge").first()).toHaveText("Paused");
});

test("after a move to Free, translating shortly after saving is stopped, says why, and can be turned off", async ({ page }) => {
  await openApp(page, "downgraded", "/app/settings");
  const card = page.locator("#settings-changes");
  await expect(card.locator("s-badge").first()).toHaveText("Stopped");
  await expect(glance(page).locator("li").nth(1)).toHaveText(/Stopped\s*Not in your plan$/, { useInnerText: true });
  await expect(card.getByText("Your plan no longer includes automatic translation. Since the change, changes aren't translated. Your language choice stays saved.")).toBeVisible();
  await expect(card.getByRole("link", { name: "See plans" }).or(card.getByRole("button", { name: "See plans" })).first()).toBeVisible();
  // Locked features show the one lock, and nothing explains how a locked feature works.
  await expect(option(page, "#settings-changes", "On a schedule").getByText("In the Business plan.")).toBeVisible();
  await expect(card.getByText("How it works")).toHaveCount(0);
  await expect(option(page, "#settings-publish", "Publish automatically").getByText("In the Pro and Business plans.")).toBeVisible();

  await card.getByRole("button", { name: "Turn off" }).click();
  await expectToast(page, "Automatic translation is off.");
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await expect(card.getByText("Your plan no longer includes automatic translation.", { exact: false })).toHaveCount(0);
});

test("the AI characters tile names the date new ones arrive: a running trial's end, as on the Plan page", async ({ page }) => {
  await openApp(page, "planTrial", "/app/plan");
  const resets = (await page.getByText(/^New AI characters on /).first().innerText()).replace("New AI characters on ", "").trim();
  await openApp(page, "planTrial", "/app/settings");
  // 31,000 of the trial's 100,000.
  await expect(glance(page).locator("li").nth(5)).toHaveText(new RegExp(`^AI characters\\s*31%\\s*31,000 of 100,000 · new on ${resets}$`), { useInnerText: true });
});

test("an empty store: the language card first with the page's only primary button, no rows per language, and plain locks", async ({ page }) => {
  await openApp(page, "empty", "/app/settings");
  const first = page.locator("s-page").getByRole("heading", { level: 2 }).first();
  await expect(first).toHaveText("No language to translate into yet");
  await expect(page.getByText("Add a language in Shopify. Then you choose here how Linguva translates.")).toBeVisible();
  expect(await primaries(page)).toEqual(["Open language settings"]);
  await expect(page.locator("#settings-style").getByRole("combobox")).toHaveCount(0);
  await expect(page.locator("#settings-style").getByText("Once you add a language, you choose the form of address here.")).toBeVisible();
  // One lock per locked option, without a plans link each (the next step is a language).
  await expect(option(page, "#settings-changes", "Shortly after saving").getByText("In the Starter, Pro and Business plans.")).toBeVisible();
  await expect(option(page, "#settings-changes", "On a schedule").getByText("In the Business plan.")).toBeVisible();
  await expect(option(page, "#settings-publish", "Publish automatically").getByText("In the Pro and Business plans.")).toBeVisible();
  await expect(page.locator("#settings-changes, #settings-publish").getByRole("link", { name: "See plans" })).toHaveCount(0);
  await expectAccessible(page);
});

test("the tools outside the navigation: four links, with the glossary and translation memory in their cards @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/settings");
  const tools = page.locator("#settings-tools");
  const links: Array<[RegExp, string]> = [
    [/^Languages/, "/app/languages"],
    [/^Countries & markets/, "/app/markets"],
    [/^Coverage in detail/, "/app/coverage"],
    [/^Import & export/, "/app/translations"],
  ];
  await expect(tools.getByRole("link")).toHaveCount(4);
  for (const [name, href] of links) await expect(tools.getByRole("link", { name })).toHaveAttribute("href", href);
  await expect(tools.getByRole("link", { name: /^Countries & markets\s*Which language customers read in each country/ })).toBeVisible();
  if (info.project.name === "desktop") {
    // Two by two.
    const [a, b] = await Promise.all([tools.getByRole("link", { name: /^Languages/ }).boundingBox(), tools.getByRole("link", { name: /^Countries/ }).boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  }
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await tools.getByRole("link", { name: /^Coverage in detail/ }).click();
  await expect(page).toHaveURL(/\/app\/coverage(\?|$)/);
});

test("Settings is German for a German admin user, with one word for each thing", async ({ page }) => {
  await openApp(page, "full", "/app/settings", { locale: "de" });
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Einstellungen");
  await expect(page.getByRole("region", { name: "Auf einen Blick" })).toBeVisible();
  const text = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
  // Interface words only (language and store names are data).
  expect(text).not.toMatch(/\b(the|your|and|Settings|Save|Publishing|Current setting|Recommended|Turn on|Tools)\b/);
  // The review's terms: no second word for the same thing.
  expect(text).not.toMatch(/Einwilligung|KI-Verarbeitung|maschinell|Maschinenübersetz|Kontingent|Ausgenommen|aktivieren|Deaktivieren|live gehen|Qualitätsprüfung/);
  await expectAccessible(page);
});
