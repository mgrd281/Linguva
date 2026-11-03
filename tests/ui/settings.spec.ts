/**
 * Settings in sections, one shown at a time (`?section=<key>`): the status
 * row (all set up, or the one thing that needs the merchant with its fix),
 * the sections as square tiles (icon, name, state in a few words, a dot
 * where one needs the merchant) in one row above the section on a wide page
 * (the current one marked) and as a grid of squares on a phone (a back row
 * above a chosen one), deep links and the cards' old `#settings-*`
 * addresses, switching without loading the page again with focus on the
 * section's heading, the choices as tiles with their icons and the chosen
 * way's details in a panel under them, and every state as it really is:
 * translating changes (off, on, paused, waiting for the permission,
 * stopped by the plan), publishing (with its dialog, and after a move to a
 * smaller plan), how AI writes under the admin's save bar, translation
 * memory, the permission (withdrawn in a dialog), the plan with its AI
 * characters and a trial's date, the empty store, the tools, the way back
 * to a stopped job and the German texts.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";
import { clickSaveBarButton, expectAccessible, expectNoHorizontalScroll, expectToast, openApp, saveBarShown, sessionToken } from "./helpers";
import { stoppedJob } from "./stopped-jobs";

/** The visible way between the sections: the tiles above the section on a wide page, the grid of tiles on a phone without a section. */
const nav = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const navEntry = (page: Page, name: string) => nav(page).locator("li").filter({ hasText: name });
/** The sections' names in the tiles' order. */
const navOrder = (page: Page) => tileNames(nav(page));
/** Each tile's name as it is read (a long word's tile shows it with a soft hyphen and is read by the plain word). */
const tileNames = (tiles: ReturnType<Page["locator"]>) =>
  tiles.locator(".lv-tile").evaluateAll((links) => links.map((a) => (a.querySelector(".lv-sr") ?? a.querySelector(".lv-tile__name"))!.textContent!.trim()));
const status = (page: Page) => page.locator("#settings-status");
const section = (page: Page, key: string) => page.locator(`#settings-${key}`);
const option = (page: Page, card: string, name: string) => page.locator(card).getByRole("group", { name, exact: true });
/** Chooses an option: the whole tile is one button. */
const choose = (page: Page, card: string, name: string) => option(page, card, name).getByRole("button").first().click();
const isCurrent = (page: Page, card: string, name: string) => expect(option(page, card, name).getByText("Current setting")).toBeVisible();
/** Shortly after saving's languages, in the panel under the choices. */
const languagesPanel = (page: Page) => page.locator("#settings-changes").getByRole("group", { name: "Languages for “Shortly after saving”", exact: true });
/** Primary buttons the merchant sees: not in a closed dialog, not in a section that isn't shown. */
const primaries = (page: Page) =>
  page.locator('[data-button][data-variant="primary"]').evaluateAll((buttons) =>
    buttons
      .filter((b) => {
        if (b.closest("s-modal")) return false;
        // Inside a Polaris box hidden for this width (its display is decided in its shadow root): not drawn.
        if (b.getClientRects().length === 0) return false;
        for (let el: Element | null = b; el; el = el.parentElement) if (getComputedStyle(el).display === "none") return false;
        return true;
      })
      .map((b) => (b as HTMLElement).innerText.trim()),
  );
const post = (page: Page, shop: UiShopKey, path: string, form: Record<string, string>) =>
  page.request.post(new URL(path, UI_ENV.appUrl).toString(), { headers: { Authorization: `Bearer ${sessionToken(UI_SHOPS[shop].domain)}` }, form });

test("the status row and the tiles: every section with its icon and state; a section opens without loading the page again, with focus on its heading @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/settings");
  await expect(status(page)).toHaveText(/^Everything is set up$/, { useInnerText: true });
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const desktop = info.project.name === "desktop";
  // One list of tiles; the second group (what Linguva may use; no keys on this plan) starts after a fine line.
  await expect(nav(page).locator("ul")).toHaveCount(1);
  expect(await navOrder(page)).toEqual(["Translating changes", "Publishing", "How AI writes", "Translation memory", "AI permission", "Plan & usage", "Tools"]);
  await expect(nav(page).locator("li[data-group-start]")).toHaveText(/^AI permission/);
  // Each with its icon and its state in a few words, the same on every width; nothing needs the merchant: no dot.
  const expected: Array<[string, string, RegExp]> = [
    ["Translating changes", "automation", /^Translating changes\s*Start it yourself$/],
    ["Publishing", "send", /^Publishing\s*Review first$/],
    ["How AI writes", "text-quote", /^How AI writes\s*DeepL decides$/],
    ["Translation memory", "database", /^Translation memory\s*Also AI translations$/],
    ["AI permission", "shield-check-mark", /^AI permission\s*Allowed$/],
    ["Plan & usage", "gauge", /^Plan & usage\s*Pro · (<1%|\d+%) used$/],
    ["Tools", "wrench", /^Tools\s*Glossary & more$/],
  ];
  for (const [name, icon, text] of expected) {
    await expect(navEntry(page, name)).toHaveText(text, { useInnerText: true });
    await expect(navEntry(page, name).locator(`s-icon[type='${icon}']`)).toHaveCount(1);
  }
  await expect(nav(page).locator(".lv-tile__dot")).toHaveCount(0);
  // Square buttons: as high as wide (a little higher where a name and its state both take two lines), well above the touch size.
  for (const box of await nav(page).getByRole("link").evaluateAll((links) => links.map((l) => l.getBoundingClientRect()))) {
    expect(box.height - box.width).toBeGreaterThanOrEqual(-1);
    expect(box.height - box.width).toBeLessThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(96);
  }
  if (desktop) {
    // One row above the section.
    const tops = await nav(page).getByRole("link").evaluateAll((links) => links.map((l) => Math.round(l.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  }
  // The last line: when the running version went live (the build's time, in the store's zone); the tests' build has no commit.
  await expect(page.locator("#settings-version")).toHaveText(/^Linguva last updated (today|yesterday|on .+) at \d{1,2}:\d{2}\s?[AP]M$/);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Choosing a section changes only the address: the page's data isn't loaded again.
  const loads: Array<Promise<string>> = [];
  page.on("response", (response) => {
    if (response.url().includes("/app/settings.data")) loads.push(response.text().catch(() => ""));
  });
  if (desktop) {
    // Under the tiles: the first section (nothing needs the merchant), its tile marked as the current one.
    await expect(nav(page).locator('[aria-current="page"]')).toHaveText(/^Translating changes/);
    await expect(section(page, "changes")).toBeVisible();
    await expect(section(page, "publish")).toBeHidden();
    await nav(page).getByRole("link", { name: /^Publishing/ }).click();
    await expect(page).toHaveURL(/[?&]section=publish(&|$)/);
    await expect(nav(page).locator('[aria-current="page"]')).toHaveText(/^Publishing/);
    await expect(section(page, "changes")).toBeHidden();
  } else {
    // A phone: the tiles only, three in a row, every tile a link to its section.
    await expect(section(page, "changes")).toBeHidden();
    await expect(nav(page).getByRole("link")).toHaveCount(7);
    await nav(page).getByRole("link", { name: /^Publishing/ }).click();
    await expect(page).toHaveURL(/[?&]section=publish(&|$)/);
    // The section alone under a back row: no page heading, status or tiles.
    await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
    await expect(status(page)).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  }
  await expect(section(page, "publish")).toBeVisible();
  await expect(page.locator("#settings-publish-heading")).toBeFocused();
  await expect(page.locator("#settings-publish-heading")).toBeInViewport();
  expect((await Promise.all(loads)).some((body) => body.includes("smartCheckKey"))).toBe(false);
  await expectAccessible(page);
});

test("a phone: the sections as a grid of squares, three in a row; a chosen one opens alone under a 44 px back row @responsive", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  await openApp(page, "full", "/app/settings");
  const tiles = nav(page).getByRole("link");
  await expect(tiles).toHaveCount(7);
  // Three in a row: the first three on one line, the fourth below them.
  const boxes = await tiles.evaluateAll((links) => links.map((l) => l.getBoundingClientRect()));
  expect(Math.round(boxes[0]!.top)).toBe(Math.round(boxes[2]!.top));
  expect(boxes[3]!.top).toBeGreaterThan(boxes[0]!.bottom);
  // Each tile: its icon, name and state, the whole square one tap target; none is the current one (no section is shown).
  await expect(nav(page).locator("li").first().locator("s-icon[type='automation']")).toHaveCount(1);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(0);

  await nav(page).getByRole("link", { name: /^How AI writes/ }).click();
  const back = page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Settings" });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#settings-style-heading")).toBeFocused();
  await expect(page.locator("#settings-style-heading")).toHaveText("How AI writes");
  await expectNoHorizontalScroll(page);
  await back.click();
  await expect(page).not.toHaveURL(/section=/);
  await expect(nav(page).getByRole("link")).toHaveCount(7);
  await expect(section(page, "style")).toBeHidden();
});

test("the tiles say where a section needs the merchant: its state in the tone, with a dot @responsive", async ({ page }) => {
  await openApp(page, "measure", "/app/settings");
  // No permission yet: the permission's tile says so, the others don't.
  await expect(navEntry(page, "AI permission")).toHaveText(/^AI permission\s*Not allowed$/, { useInnerText: true });
  await expect(navEntry(page, "AI permission").locator('[data-tone="warning"] .lv-tile__dot')).toHaveCount(1);
  await expect(nav(page).locator(".lv-tile__dot")).toHaveCount(1);
  await expectAccessible(page);
});

test("deep links open their section; an unknown one or a section the store hasn't opens the first; the cards' old addresses open theirs @responsive", async ({ page }, info) => {
  const desktop = info.project.name === "desktop";
  for (const key of ["publish", "plan", "tools", "ai"]) {
    await openApp(page, "full", `/app/settings?section=${key}`);
    await expect(section(page, key)).toBeVisible();
    await expect(page.locator("section[id^='settings-']:visible")).toHaveCount(1);
    if (desktop) await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    else await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Settings" })).toBeVisible();
  }
  for (const path of ["/app/settings?section=nonsense", "/app/settings?section=keys"]) {
    await openApp(page, "full", path);
    // No keys on this plan: there is no such section at all.
    await expect(page.locator("#settings-keys")).toHaveCount(0);
    if (desktop) await expect(section(page, "changes")).toBeVisible();
    else await expect(nav(page).getByRole("link")).toHaveCount(7);
  }
  // The cards' old addresses, still linked from older pages and bookmarks.
  for (const [hash, key] of [
    ["#settings-ai", "ai"],
    ["#settings-changes", "changes"],
    ["#settings-tools", "tools"],
  ]) {
    await openApp(page, "full", `/app/settings${hash}`);
    await expect(page).toHaveURL(new RegExp(`[?&]section=${key}(&|#|$)`));
    await expect(section(page, key!)).toBeVisible();
  }
});

test("without a section, the first that needs the merchant opens; the permission's step is the page's one primary button", async ({ page }) => {
  await openApp(page, "full", "/app/settings");
  // Nothing is required: no primary button (the save bar's comes from the admin).
  expect(await primaries(page)).toEqual([]);
  await openApp(page, "full", "/app/settings?section=ai");
  // Granted: since when, beside its state.
  await expect(page.locator("#settings-ai s-badge").first()).toHaveText("Allowed");
  await expect(section(page, "ai").getByText(/^since [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();

  await openApp(page, "measure", "/app/settings");
  await expect(status(page)).toHaveText(/^AI translation isn't allowed yet\s*Without permission, AI translates nothing$/, { useInnerText: true });
  await expect(nav(page).locator('[aria-current="page"]')).toHaveText(/^AI permission\s*Not allowed$/);
  await expect(page.locator("#settings-status")).toHaveAttribute("data-tone", "warning");
  // The section beside the status row has the step itself; the status row needs no second button.
  await expect(status(page).locator('[data-button][href="/app/settings?section=ai"]')).toBeHidden();
  expect(await primaries(page)).toEqual(["Allow AI translation"]);
  // What is sent and when, behind its disclosure.
  const ai = section(page, "ai");
  await expect(ai.getByText("Linguva sends only your store's texts (such as products, pages and menus) to DeepL SE in Germany, no customer or order data.")).toBeVisible();
  await ai.getByText("What is sent and when").click();
  await expect(ai.getByText(/^Metaobjects and payment methods may contain personal data/)).toBeVisible();
  await expectAccessible(page);

  // Another section: the status row leads to the permission, as the page's one primary button.
  await nav(page).getByRole("link", { name: /^Translating changes/ }).click();
  await expect(page.locator("#settings-changes-heading")).toBeFocused();
  expect(await primaries(page)).toEqual(["Read and allow"]);
  await expect(status(page).locator('[data-button][href="/app/settings?section=ai"]')).toHaveText("Read and allow");
  // What needs the permission says so, with the permission's shield and the way to give it where it is.
  const basic = option(page, "#settings-changes", "Shortly after saving");
  await expect(basic.getByText("Allow AI translation first.")).toBeVisible();
  await expect(basic.locator("s-icon[type='shield-check-mark']")).toHaveCount(1);
  await expect(basic.getByRole("button", { name: "Allow AI translation" })).toBeVisible();
  await status(page).locator('[data-button][href="/app/settings?section=ai"]').click();
  await expect(section(page, "ai")).toBeVisible();
  await expect(page.locator("#settings-ai-heading")).toBeFocused();
});

test("how AI writes: the form of address per language, saved under the admin's save bar, and kept while another section is open @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/settings?section=style");
  const style = section(page, "style");
  await expect(style.getByRole("heading", { level: 2 })).toHaveText("How AI writes");
  await expect(style.getByRole("heading", { level: 3 })).toHaveText("Form of address");
  await expect(style.getByText("How AI addresses your customers and what it knows about your store.")).toBeVisible();
  // One row per language with a choice: the pronouns as the options' words, read with what they mean;
  // no choice where DeepL has none (Arabic): named in one line instead.
  const address = (language: string) => style.getByRole("group", { name: language, exact: true });
  await expect(address("German").locator(".lv-seg__text")).toHaveText(["DeepL decides", "Sie", "Du"]);
  await expect(address("German").getByRole("radio")).toHaveCount(3);
  await expect(address("German").getByRole("radio", { name: "Formal (Sie)" })).toBeAttached();
  await expect(address("German").getByRole("radio", { name: "Informal (du)" })).toBeAttached();
  await expect(address("French").locator(".lv-seg__text")).toHaveText(["DeepL decides", "Vous", "Tu"]);
  await expect(address("Arabic")).toHaveCount(0);
  // Its flag is the code box "AR" (no single country): part of the line's text.
  await expect(style.getByText(/^No choice needed for/)).toBeVisible();
  await expect(style.getByText(/^No choice needed for/)).toContainText("Arabic");
  const context = style.getByRole("textbox", { name: "About your store" });
  await expect(context).toHaveAttribute("placeholder", "Outdoor clothing for families, friendly and simple");
  await expect(style.getByText("What you sell and how you speak. Helps AI choose its words; not translated.")).toBeVisible();
  await expect(style.getByText("Fixed terms in the glossary: 0")).toBeVisible();
  await expect(style.getByRole("link", { name: "Edit glossary" })).toHaveAttribute("href", "/app/glossary");
  // Saved by the admin's save bar only.
  await expect(style.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  await address("German").getByRole("radio", { name: "Informal (du)" }).check();
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(true);
  await context.fill("Outdoor clothing for families, friendly and simple.");
  if (info.project.name === "desktop") {
    // Another section and back: the unsaved text stays, and so does the save bar.
    await nav(page).getByRole("link", { name: /^Publishing/ }).click();
    await expect(section(page, "publish")).toBeVisible();
    expect(await saveBarShown(page, "settings-style-save-bar")).toBe(true);
    await nav(page).getByRole("link", { name: /^How AI writes/ }).click();
    await expect(context).toHaveValue("Outdoor clothing for families, friendly and simple.");
  }
  await clickSaveBarButton(page, "settings-style-save-bar", 0);
  await expectToast(page, "Saved. New AI translations use this form of address.");
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(false);
  // Opened again from the admin (a reload after a switch inside the app would lose its launch parameters).
  await openApp(page, "full", "/app/settings?section=style");
  await expect(address("German").getByRole("radio", { name: "Informal (du)" })).toBeChecked();
  await expect(context).toHaveValue("Outdoor clothing for families, friendly and simple.");
  // German informal, French as DeepL decides: chosen per language.
  if (info.project.name === "desktop") await expect(navEntry(page, "How AI writes")).toHaveText(/^How AI writes\s*Per language$/, { useInnerText: true });

  // Discard: back to what is saved, nothing written.
  await address("French").getByRole("radio", { name: "Formal (vous)" }).check();
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(true);
  await clickSaveBarButton(page, "settings-style-save-bar", 1);
  await expect.poll(() => saveBarShown(page, "settings-style-save-bar")).toBe(false);
  await expect(address("French").getByRole("radio", { name: "DeepL decides" })).toBeChecked();
  // Opened again from the admin (a reload after a switch inside the app would lose its launch parameters).
  await openApp(page, "full", "/app/settings?section=style");
  await expect(address("French").getByRole("radio", { name: "DeepL decides" })).toBeChecked();

  // As it was (other tests use this store).
  await address("German").getByRole("radio", { name: "DeepL decides" }).check();
  await context.fill("");
  await clickSaveBarButton(page, "settings-style-save-bar", 0);
  await expectToast(page, "Saved. New AI translations use this form of address.");
});

test("publishing: choosing automatic asks first in a dialog; Cancel changes nothing; the server still needs the confirmation", async ({ page }) => {
  await openApp(page, "full", "/app/settings?section=publish");
  const card = "#settings-publish";
  await isCurrent(page, card, "Review first");
  await expect(option(page, card, "Review first").getByText("Recommended")).toBeVisible();
  // Each choice with its icon; the one that can be chosen shows its radio mark.
  await expect(option(page, card, "Review first").locator("s-icon[type='eye-check-mark']")).toHaveCount(1);
  await expect(option(page, card, "Publish automatically").locator("s-icon[type='send']")).toHaveCount(1);
  await expect(option(page, card, "Publish automatically").locator(".lv-option__radio")).toHaveCount(1);
  await expect(option(page, card, "Review first").locator(".lv-option__radio")).toHaveCount(0);
  await expect(page.locator(card).getByText("Applies when Linguva translates many texts at once (for example all products) and to automatic translation. The smart schedule has its own setting.")).toBeVisible();
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
  await expect(navEntry(page, "Publishing")).toHaveText(/^Publishing\s*Publish automatically$/, { useInnerText: true });

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
  await openApp(page, "planAutoPublish", "/app/settings?section=publish");
  const card = section(page, "publish");
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
  // The tile says what really happens.
  await expect(navEntry(page, "Publishing")).toHaveText(/^Publishing\s*Review first$/, { useInnerText: true });
});

test("translation memory: the whole option chooses it, with a toast and focus on the choice that is now current", async ({ page }) => {
  await openApp(page, "full", "/app/settings?section=memory");
  const card = "#settings-memory";
  const approvedNow = (await option(page, card, "Approved only").getByText("Current setting").count()) > 0;
  const [other, back] = approvedNow ? ["Also AI translations", "Approved only"] : ["Approved only", "Also AI translations"];
  await choose(page, card, other);
  await expectToast(page, "Saved. Translation memory follows this choice.");
  await isCurrent(page, card, other);
  await expect(page.locator(approvedNow ? "#settings-memory-machine" : "#settings-memory-approved")).toBeFocused();
  await expect(navEntry(page, "Translation memory")).toHaveText(new RegExp(`^Translation memory\\s*${other}$`), { useInnerText: true });
  await page.reload();
  await isCurrent(page, card, other);
  await expect(page.locator(card).getByRole("link", { name: "Open translation memory" })).toHaveAttribute("href", "/app/memory");
  // As it was (other tests use this store).
  await choose(page, card, back);
  await isCurrent(page, card, back);
});

test("the permission: withdrawing asks first in a dialog and the status row says so; allowing again where the changes wait", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings?section=ai");
  const ai = section(page, "ai");
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
  await expect(page.locator("#settings-ai-heading")).toBeFocused();
  await expect(status(page)).toHaveText(/^AI translation isn't allowed yet\s*Without permission, AI translates nothing$/, { useInnerText: true });
  await expect(navEntry(page, "AI permission")).toHaveText(/^AI permission\s*Not allowed$/, { useInnerText: true });

  // Automatic translation waits for it, and the permission can be given right there.
  await nav(page).getByRole("link", { name: /^Translating changes/ }).click();
  const changes = section(page, "changes");
  await expect(changes.locator("s-badge").first()).toHaveText("Waiting");
  const waiting = changes.locator('s-banner[heading="Automatic translation is waiting for your permission"]');
  await expect(waiting).toContainText("As soon as you allow AI translation, Linguva translates everything that changed meanwhile.");
  await expect(navEntry(page, "Translating changes")).toHaveText(/^Translating changes\s*Waiting$/, { useInnerText: true });
  await waiting.getByRole("button", { name: "Allow AI translation" }).click();
  await expectToast(page, "AI translation is allowed.");
  await expect(waiting).toHaveCount(0);
  await expect(page.locator("#settings-changes-heading")).toBeFocused();
  await expect(navEntry(page, "AI permission")).toHaveText(/^AI permission\s*Allowed$/, { useInnerText: true });
  await expect(page.locator("#settings-ai s-badge").first()).toHaveText("Allowed");
});

test("the permission given in its section moves on to translating changes", async ({ page }) => {
  await openApp(page, "measure", "/app/settings?section=ai");
  try {
    await section(page, "ai").getByRole("button", { name: "Allow AI translation" }).click();
    await expectToast(page, "AI translation is allowed.");
    await expect(page).toHaveURL(/[?&]section=changes(&|$)/);
    await expect(section(page, "changes")).toBeVisible();
    await expect(page.locator("#settings-changes-heading")).toBeFocused();
    await expect(status(page)).toHaveText(/^Everything is set up$/, { useInnerText: true });
  } finally {
    // As it was (other tests use this store without the permission).
    expect((await post(page, "measure", "/app/settings.data", { intent: "revoke-consent" })).ok()).toBe(true);
  }
});

test("translating shortly after saving: chosen with the plan's languages ticked, saved by its own button, off again @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/settings?section=changes");
  const card = section(page, "changes");
  // Off: the current choice says it; no badge or line repeats it.
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await expect(card.locator("h2 ~ s-badge")).toHaveCount(0);
  // Three equally high choices in one row on a wide page (one under the other on a phone), each with its icon.
  if (info.project.name === "desktop") {
    const boxes = await card.locator(".lv-option").evaluateAll((tiles) => tiles.map((t) => t.getBoundingClientRect()));
    expect(new Set(boxes.map((b) => Math.round(b.height))).size).toBe(1);
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
  }
  for (const [name, icon] of [
    ["Start it yourself", "play-circle"],
    ["Shortly after saving", "automation"],
    ["On a schedule", "calendar-time"],
  ]) await expect(option(page, "#settings-changes", name!).locator(`s-icon[type='${icon}']`)).toHaveCount(1);
  // How it works, closed at first.
  await expect(card.locator("details")).not.toHaveAttribute("open", "");
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);

  // Chosen for the first time: its languages open in the panel under the choices, every language of the plan ticked.
  await expect(languagesPanel(page)).toHaveCount(0);
  await choose(page, "#settings-changes", "Shortly after saving");
  const basic = languagesPanel(page);
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
  if (info.project.name === "desktop") await expect(navEntry(page, "Translating changes")).toHaveText(/^Translating changes\s*Shortly after saving$/, { useInnerText: true });

  await page.reload();
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("checkbox", { name: "Arabic", exact: true })).not.toBeChecked();
  await expect(basic.getByRole("button", { name: "Save languages" })).toBeVisible();
  if (info.project.name === "mobile") {
    // The phone's tile says the way.
    await openApp(page, "full", "/app/settings");
    await expect(navEntry(page, "Translating changes")).toHaveText(/^Translating changes\s*Shortly after saving$/, { useInnerText: true });
    await openApp(page, "full", "/app/settings?section=changes");
  }

  // Off again (other tests use this store): the panel goes with it.
  await choose(page, "#settings-changes", "Start it yourself");
  await expect(languagesPanel(page)).toHaveCount(0);
  await expectToast(page, "Automatic translation is off.");
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await expect(page.locator("#settings-changes-manual")).toBeFocused();
});

test("translating shortly after saving says why it waits in the status row, and names a chosen language outside the plan @responsive", async ({ page }, info) => {
  await openApp(page, "autoLimits", "/app/settings");
  // Times in the store's zone (Europe/Berlin in the fixtures), so without "UTC".
  const row = status(page);
  await expect(row).toHaveText(/^Automatic translation is paused\s*Continues from .+\d{1,2}:\d{2}\s?[AP]M · Daily limit reached/, { useInnerText: true });
  await expect(row).toHaveAttribute("data-tone", "warning");
  await expect(row).not.toContainText("UTC");
  if (info.project.name === "mobile") {
    // On a phone the status row leads to its section.
    await expect(row.locator('[data-button][href="/app/settings?section=changes"]')).toHaveText("Open setting");
    await row.locator('[data-button][href="/app/settings?section=changes"]').click();
    await expect(page).toHaveURL(/[?&]section=changes(&|$)/);
  } else {
    // Beside it, the section is already open: no second way to it.
    await expect(row.locator('[data-button][href="/app/settings?section=changes"]')).toBeHidden();
  }
  const card = section(page, "changes");
  await expect(card).toBeVisible();
  await expect(card.locator("s-badge").first()).toHaveText("Paused");
  const paused = card.locator('s-banner[heading="Automatic translation is paused"]');
  await expect(paused).toContainText(/Today's AI characters are used up\. From .+\d{1,2}:\d{2}\s?[AP]M, Linguva continues by itself, including everything that changes until then\./);
  await expect(paused).not.toContainText("UTC");
  // The Starter plan's three languages; Spanish was chosen and is named, not offered.
  const basic = languagesPanel(page);
  for (const name of ["French", "German", "Italian"]) await expect(basic.getByRole("checkbox", { name, exact: true })).toBeVisible();
  await expect(basic.getByRole("checkbox", { name: "Spanish", exact: true })).toHaveCount(0);
  await expect(basic.getByText("Spanish is chosen but isn't translated: not in your plan.")).toBeVisible();
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("button", { name: "Save languages" })).toBeVisible();
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
});

test("a forged request can't add a language outside the plan or lift a pause", async ({ page }) => {
  await openApp(page, "autoLimits", "/app/settings?section=changes");
  expect((await post(page, "autoLimits", "/app/settings.data", { intent: "auto", enabled: "true", locale: "de,es" })).ok()).toBe(true);
  await page.reload();
  // Nothing was written: still German only, and still paused.
  const basic = languagesPanel(page);
  await expect(basic.getByRole("checkbox", { name: "German", exact: true })).toBeChecked();
  await expect(basic.getByRole("checkbox", { name: "French", exact: true })).not.toBeChecked();
  await expect(page.locator("#settings-changes s-badge").first()).toHaveText("Paused");
});

test("after a move to Free, translating shortly after saving is stopped, says why, and can be turned off", async ({ page }) => {
  await openApp(page, "downgraded", "/app/settings");
  await expect(status(page)).toHaveText(/^Automatic translation is stopped\s*Not in your plan$/, { useInnerText: true });
  await expect(status(page)).toHaveAttribute("data-tone", "critical");
  const card = section(page, "changes");
  await expect(card.locator("s-badge").first()).toHaveText("Stopped");
  await expect(navEntry(page, "Translating changes")).toHaveText(/^Translating changes\s*Stopped$/, { useInnerText: true });
  await expect(navEntry(page, "Translating changes").locator('[data-tone="critical"] .lv-tile__dot')).toHaveCount(1);
  await expect(card.getByText("Your plan no longer includes automatic translation. Since the change, changes aren't translated. Your language choice stays saved.")).toBeVisible();
  await expect(card.getByRole("link", { name: "See plans" }).or(card.getByRole("button", { name: "See plans" })).first()).toBeVisible();
  // Locked features show the one lock, and nothing explains how a locked feature works.
  await expect(option(page, "#settings-changes", "On a schedule").getByText("In the Business plan.")).toBeVisible();
  await expect(card.getByText("How it works")).toHaveCount(0);

  await card.getByRole("button", { name: "Turn off" }).click();
  await expectToast(page, "Automatic translation is off.");
  await isCurrent(page, "#settings-changes", "Start it yourself");
  await expect(card.getByText("Your plan no longer includes automatic translation.", { exact: false })).toHaveCount(0);
  await expect(status(page)).toHaveText(/^Everything is set up$/, { useInnerText: true });
  await nav(page).getByRole("link", { name: /^Publishing/ }).click();
  await expect(option(page, "#settings-publish", "Publish automatically").getByText("In the Pro and Business plans.")).toBeVisible();
});

test("plan & usage: the plan, this month's AI characters and the date new ones arrive (a running trial's end, as on the Plan page)", async ({ page }) => {
  await openApp(page, "planTrial", "/app/plan");
  const resets = (await page.getByText(/^New AI characters on /).first().innerText()).replace("New AI characters on ", "").trim();
  await openApp(page, "planTrial", "/app/settings?section=plan");
  const plan = section(page, "plan");
  await expect(plan.getByRole("heading", { level: 2 })).toHaveText("Plan & usage");
  await expect(plan.getByText("Business", { exact: true })).toBeVisible();
  // 31,000 of the trial's 100,000.
  await expect(plan.getByText("31%", { exact: true })).toBeVisible();
  await expect(plan.getByRole("progressbar", { name: "AI characters used this month" })).toHaveAttribute("aria-valuenow", "31");
  await expect(plan.getByText(`31,000 of 100,000 · new AI characters on ${resets}`)).toBeVisible();
  await expect(navEntry(page, "Plan & usage")).toHaveText(/^Plan & usage\s*Business · 31% used$/, { useInnerText: true });
  await expect(plan.locator('[data-button][href="/app/plan"]')).toHaveText("See plans");
  await expectAccessible(page);
});

test("an empty store: the status row asks for a language with the page's only primary button, no rows per language, and plain locks", async ({ page }) => {
  await openApp(page, "empty", "/app/settings");
  await expect(status(page)).toHaveText(/^No language to translate into yet\s*Add a language in Shopify\. Then you choose here how Linguva translates\./, { useInnerText: true });
  await expect(status(page).locator('[data-button][data-variant="primary"]')).toHaveAttribute("href", "shopify://admin/settings/languages");
  expect(await primaries(page)).toEqual(["Open language settings"]);
  // One lock per locked option, without a plans link each (the next step is a language).
  await expect(option(page, "#settings-changes", "Shortly after saving").getByText("In the Starter, Pro and Business plans.")).toBeVisible();
  await expect(option(page, "#settings-changes", "On a schedule").getByText("In the Business plan.")).toBeVisible();
  await expect(page.locator("#settings-changes, #settings-publish").getByRole("link", { name: "See plans", includeHidden: true })).toHaveCount(0);
  await nav(page).getByRole("link", { name: /^Publishing/ }).click();
  await expect(option(page, "#settings-publish", "Publish automatically").getByText("In the Pro and Business plans.")).toBeVisible();
  await nav(page).getByRole("link", { name: /^How AI writes/ }).click();
  await expect(section(page, "style").getByRole("radio")).toHaveCount(0);
  await expect(section(page, "style").getByText("Once you add a language, you choose the form of address here.")).toBeVisible();
  await expect(navEntry(page, "How AI writes")).toHaveText(/^How AI writes\s*No language yet$/, { useInnerText: true });
  expect(await primaries(page)).toEqual(["Open language settings"]);
  await expectAccessible(page);
});

test("the tools outside the navigation: six link tiles with their icons, the glossary and translation memory among them @responsive", async ({ page }, info) => {
  await openApp(page, "full", "/app/settings?section=tools");
  const tools = section(page, "tools");
  const links: Array<[RegExp, string]> = [
    [/^Glossary/, "/app/glossary"],
    [/^Languages/, "/app/languages"],
    [/^Countries & markets/, "/app/markets"],
    [/^Translation memory/, "/app/memory"],
    [/^Coverage in detail/, "/app/coverage"],
    [/^Import & export/, "/app/translations"],
  ];
  await expect(tools.getByRole("link")).toHaveCount(6);
  await expect(tools.getByRole("link", { name: /^Glossary/ }).locator("s-icon[type='book-open']")).toHaveCount(1);
  for (const [name, href] of links) await expect(tools.getByRole("link", { name })).toHaveAttribute("href", href);
  await expect(tools.getByRole("link", { name: /^Countries & markets\s*Which language customers read in each country/ })).toBeVisible();
  if (info.project.name === "desktop") {
    // Side by side.
    const [a, b] = await Promise.all([tools.getByRole("link", { name: /^Glossary/ }).boundingBox(), tools.getByRole("link", { name: /^Languages/ }).boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  }
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
  await tools.getByRole("link", { name: /^Coverage in detail/ }).click();
  await expect(page).toHaveURL(/\/app\/coverage(\?|$)/);
});

test("Settings is German for a German admin user, with one word for each thing, in every section", async ({ page }) => {
  await openApp(page, "full", "/app/settings", { locale: "de" });
  await expect(page.locator("s-page")).toHaveAttribute("heading", "Einstellungen");
  const sections = page.getByRole("navigation", { name: "Bereiche der Einstellungen" });
  await expect(sections).toBeVisible();
  await expect(status(page)).toHaveText(/^Alles ist eingerichtet$/, { useInnerText: true });
  await expect(sections.locator("li").first()).toHaveText(/^Änderungen übersetzen\s*Selbst starten$/, { useInnerText: true });
  const names = await tileNames(sections);
  expect(names).toEqual(["Änderungen übersetzen", "Veröffentlichen", "So schreibt die KI", "Übersetzungsspeicher", "KI-Erlaubnis", "Tarif & Nutzung", "Werkzeuge"]);
  // A long word breaks with a hyphen where it must, and no line ends in "KI-"; the tile is read by its plain name.
  await expect(sections.getByRole("link", { name: /^Übersetzungsspeicher/ }).locator(".lv-tile__name")).toHaveText("Übersetzungs\u00ADspeicher");
  await expect(sections.getByRole("link", { name: /^KI-Erlaubnis/ }).locator(".lv-tile__name")).toHaveText("KI\u2011Erlaubnis");
  for (const name of names) {
    if (name !== names[0]) await sections.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    // The section's own heading (a dialog in it has its heading too).
    await expect(page.locator("section[id^='settings-']:visible h2[id$='-heading']")).toHaveText(name);
    const text = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
    // Interface words only (language and store names are data).
    expect(text, name).not.toMatch(/\b(the|your|and|Settings|Save|Publishing|Current setting|Recommended|Turn on|Tools)\b/);
    // The review's terms: no second word for the same thing.
    expect(text, name).not.toMatch(/Einwilligung|KI-Verarbeitung|maschinell|Maschinenübersetz|Kontingent|Ausgenommen|aktivieren|Deaktivieren|live gehen|Qualitätsprüfung/);
  }
  await expectAccessible(page);
});

// ─── The way back to a stopped job ────────────────────────────────────────────

test.describe("the way back to a stopped job", () => {
  test("the permission's section leads back once the permission is given, as the page's one primary button", async ({ page }) => {
    const job = await stoppedJob("measure", "CONSENT_REQUIRED");
    try {
      await openApp(page, "measure", `/app/settings?section=ai&job=${job.id}`);
      // Not fixed yet: no way back, the permission is the step.
      await expect(page.locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
      expect(await primaries(page)).toEqual(["Allow AI translation"]);
      await section(page, "ai").getByRole("button", { name: "Allow AI translation" }).click();
      await expectToast(page, "AI translation is allowed.");
      // From a job, the page stays here and shows the way back above the section's card.
      await expect(page).toHaveURL(new RegExp(`[?&]job=${job.id}`));
      const back = section(page, "ai").locator(`[data-button][href="/app/jobs/${job.id}"]`);
      await expect(back).toBeVisible();
      await expect(back).toHaveText("Back to the job");
      await expect(section(page, "ai").getByText("German · Products can go on")).toBeVisible();
      await expect(page.locator("#settings-ai-heading")).toBeFocused();
      expect(await primaries(page)).toEqual(["Back to the job"]);
      await expectAccessible(page);
      // Another section: the address drops the job, and so does the page.
      await nav(page).getByRole("link", { name: /^Publishing/ }).click();
      await expect(page).not.toHaveURL(/job=/);
      await nav(page).getByRole("link", { name: /^AI permission/ }).click();
      await expect(section(page, "ai")).toBeVisible();
      await expect(page.locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
    } finally {
      await job.remove();
      expect((await post(page, "measure", "/app/settings.data", { intent: "revoke-consent" })).ok()).toBe(true);
    }
  });

  test("only on the section that fixes the stop, and never for an id from elsewhere", async ({ page }) => {
    const job = await stoppedJob("full", "CONSENT_REQUIRED");
    try {
      await openApp(page, "full", `/app/settings?section=publish&job=${job.id}`);
      await expect(page.locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
      await openApp(page, "full", `/app/settings?section=ai&job=${randomUUID()}`);
      await expect(page.locator('[data-button][href^="/app/jobs/"]')).toHaveCount(0);
      await openApp(page, "full", `/app/settings?section=ai&job=${job.id}`);
      await expect(section(page, "ai").locator(`[data-button][href="/app/jobs/${job.id}"]`)).toBeVisible();
      await expect(section(page, "ai").getByText("German · Products can go on")).toBeVisible();
    } finally {
      await job.remove();
    }
  });

  test("the Plan page leads back to a job its plan now allows, and its own button steps back", async ({ page }) => {
    const job = await stoppedJob("full", "PLAN_REQUIRED");
    try {
      await openApp(page, "full", `/app/plan?job=${job.id}`);
      const back = page.locator(`[data-button][href="/app/jobs/${job.id}"]`);
      await expect(back).toBeVisible();
      await expect(back).toHaveText("Back to the job");
      await expect(page.getByText("German · Products can go on")).toBeVisible();
      expect(await primaries(page)).toEqual(["Back to the job"]);
      await expectAccessible(page);
    } finally {
      await job.remove();
    }
  });
});
