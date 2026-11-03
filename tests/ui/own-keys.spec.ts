/**
 * The Own key plan in the browser (mock mode: the server accepts only
 * "mock-…" test keys and never calls an engine): the welcome and the Plan
 * page's hero ask for the key first, the Overview's next step and footer
 * say a key is needed, Settings' keys section (right before the AI
 * permission's) adds, refuses, replaces, checks and removes keys (through
 * its dialog) with the page's one primary button where it belongs, the
 * status row then leads to the permission, which covers the keys' services, and no
 * response body, page or request address ever contains a typed key. A
 * store on the plan translates in the editor with its own key; a refused
 * key warns on the Overview and holds the language page; a pending change
 * prepares keys while Pro still applies; other plans see nothing new.
 */
import { expect, test, type Page } from "@playwright/test";
import { translator } from "../../app/i18n/i18n";
import { UI_ENV, UI_SHOPS, type UiShopKey } from "./fixtures/shops";
import { expectAccessible, expectNoHorizontalScroll, expectToast, openApp, sessionToken } from "./helpers";

const en = translator("en");
const ENGLISH = /\b(the|your|and|Translate|Translated|Settings|Review|Save|Search|Language|Products|Overview|Status|Show|Jobs|allowance)\b/;

/** Settings' sections: the nav beside the section on a wide page, the list on a phone without one. */
const nav = (page: Page) => page.getByRole("navigation", { name: "Settings sections" });
const navEntry = (page: Page, name: string) => nav(page).locator("li").filter({ hasText: name });
const navOrder = (page: Page) => nav(page).locator("li").evaluateAll((items) => items.map((li) => (li as HTMLElement).innerText.split("\n").map((line) => line.trim()).filter(Boolean)[0]));
const status = (page: Page) => page.locator("#settings-status");
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
/** An engine's row of the keys card. */
const row = (page: Page, engine: "deepl" | "azure" | "google") => page.locator("#settings-keys li").filter({ has: page.locator(`#settings-keys-${engine}`) });
const keyField = (scope: ReturnType<typeof row>) => scope.locator('s-password-field[name="apiKey"] input').first();

/** The editing store starts every test without keys and without a permission (whatever ran before). */
async function resetEditStore(page: Page) {
  for (const engine of ["deepl", "azure", "google"]) expect((await post(page, "ownkeyEdit", "/app/settings.data", { intent: "remove-key", engine })).ok()).toBe(true);
  expect((await post(page, "ownkeyEdit", "/app/settings.data", { intent: "revoke-consent" })).ok()).toBe(true);
}

/** Every body the app answers, and every address the page asks for: none may carry a typed key. */
function recordTraffic(page: Page) {
  const bodies: Array<Promise<string>> = [];
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("response", (response) => {
    if (response.url().startsWith(UI_ENV.appUrl)) bodies.push(response.text().catch(() => ""));
  });
  return {
    async expectNever(secret: string) {
      for (const url of urls) expect(url, url).not.toContain(secret);
      for (const body of await Promise.all(bodies)) expect(body).not.toContain(secret);
      expect(await page.content()).not.toContain(secret);
    },
  };
}

test.describe("subscribed, no key yet", () => {
  test("the welcome and the hero ask for the key first, linking to Settings", async ({ page }) => {
    await openApp(page, "ownkey", "/app/plan?welcome=1");
    await expect(page.getByText(en.t("plan.welcome.body.ownKey"))).toBeVisible();
    await expect(page.locator("s-banner s-link", { hasText: "Add your key" })).toHaveAttribute("href", "/app/settings?section=keys");
    await expect(page.getByRole("heading", { name: "Your plan: Own key" })).toBeVisible();
    await expect(page.getByText(en.t("plan.hero.line.ownKey.missing"))).toBeVisible();
    const addKey = page.locator('[data-button][data-variant="primary"][href="/app/settings?section=keys"]');
    await expect(addKey).toHaveText("Add your key");
    expect(await primaries(page)).toEqual(["Add your key"]);
    // Its card is shown although OWN_KEY_PLAN_VISIBLE is off: it is the store's plan.
    const card = page.getByRole("group", { name: "Own key", exact: true });
    await expect(card).toContainText("Your plan");
    await expect(card).toContainText("Monthly only");
    await expect(page.getByRole("group", { name: "Pro", exact: true })).not.toContainText("Your plan");
    await expectAccessible(page);
  });

  test("the Overview's next step is the key, and its footer says a key is needed", async ({ page }) => {
    await openApp(page, "ownkey", "/app");
    await expect(page.getByText(en.t("overview.checklist.ownKey.label"), { exact: true })).toBeVisible();
    await expect(page.locator('[data-button][href="/app/settings?section=keys"]', { hasText: "Add key" })).toBeVisible();
    await expect(page.getByText(en.t("overview.usage.ownKeyMissing"))).toBeVisible();
    await expect(page.getByText(en.t("overview.usage.notConfigured"))).toHaveCount(0);
    await expect(page.locator(`s-banner[heading="${en.t("overview.banner.exhausted.heading")}"]`)).toHaveCount(0);
  });

  test("Settings: the keys right before the permission and opened first, DeepL's form the one primary button, the status row and the changes say a key is needed @responsive", async ({ page }, info) => {
    await openApp(page, "ownkey", "/app/settings");
    await expect(status(page)).toHaveText(/^Add your translation key\s*Without a key, Linguva can't translate with AI\./, { useInnerText: true });
    expect(await navOrder(page)).toEqual(["Translating changes", "Publishing", "How AI writes", "Translation memory", "Your keys", "AI permission", "Plan & usage", "Tools"]);
    if (info.project.name === "desktop") {
      // Without a section, the keys open first, beside the nav.
      await expect(nav(page).locator('[aria-current="page"]')).toHaveText(/^Your keys\s*No key yet$/);
    } else {
      // A phone: the status row leads to the keys, as the list's one primary button.
      await expect(navEntry(page, "Your keys")).toHaveText(/^Your keys\s*No key yet$/, { useInnerText: true });
      expect(await primaries(page)).toEqual(["Add key"]);
      await status(page).locator('[data-button][href="/app/settings?section=keys"]').click();
      await expect(page.locator("#settings-keys-heading")).toBeFocused();
    }
    expect(await primaries(page)).toEqual(["Check and save"]);
    await expect(page.locator("#settings-keys-heading")).toHaveText("Your keys");
    await expect(row(page, "deepl").getByText("Check and save")).toBeVisible();
    await expect(page.locator("#settings-changes")).toContainText("Add your translation key first.");
    await expect(page.locator("#settings-changes")).not.toContainText(en.t("settings.changes.line.unavailable"));
    // Nothing to allow before a key; no "not configured" warning about Linguva's engines.
    await expect(page.locator("#settings-ai")).toContainText(en.t("settings.ai.noKey"));
    await expect(page.locator("#settings-ai")).not.toContainText(en.t("settings.ai.notConfigured.heading"));
    await expect(page.locator("#settings-keys")).toContainText("bill you for every character");
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  });

  test("German: Settings and the Plan page have no English words", async ({ page }) => {
    for (const path of ["/app/settings", "/app/plan"]) {
      await openApp(page, "ownkey", path, { locale: "de" });
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
      const words = await page.locator("s-page").evaluate((el) => (el as HTMLElement).innerText);
      expect(words.match(ENGLISH), path).toBeNull();
    }
    await expect(page.getByRole("heading", { name: "Dein Tarif: Own key" })).toBeVisible();
  });
});

test.describe("adding and managing keys", () => {
  test("a refused and a real-looking key are refused inline; a test key is saved, never echoed, and the permission comes next", async ({ page }) => {
    await resetEditStore(page);
    const traffic = recordTraffic(page);
    await openApp(page, "ownkeyEdit", "/app/settings");
    const deepl = row(page, "deepl");

    await keyField(deepl).fill("mock-deepl-refused");
    await deepl.getByRole("button", { name: "Check and save" }).click();
    await expect(deepl).toContainText("DeepL refused this key, or the service isn't set up for it yet");
    await expect(deepl).toContainText("Add a DeepL key");
    // The refusal is announced and focus stays in the row (the rebuilt form dropped the button).
    await expect(deepl.getByRole("alert")).toContainText("DeepL refused this key");
    await expect(page.locator("#settings-keys-deepl")).toBeFocused();
    const realLooking = ["sk", "real", "looking", "key", "1234567890"].join("-");
    await keyField(deepl).fill(realLooking);
    await deepl.getByRole("button", { name: "Check and save" }).click();
    await expect(deepl).toContainText(en.t("settings.keys.error.KEY_MOCK_ONLY"));

    const typed = "mock-deepl-1234:fx";
    await keyField(deepl).fill(typed);
    await deepl.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "DeepL key saved");
    await expect(deepl).toContainText("Ends in …1234");
    await expect(deepl).toContainText("DeepL API Free");
    await expect(deepl).toContainText("Key accepted");
    // The form was rebuilt: no typed key stays on the page.
    await expect(keyField(deepl)).toHaveValue("");
    await expect(page.locator("#settings-keys")).toContainText("DeepL bills you for every character");

    // Now the permission is the next step: the status row leads there (the page stays with the keys).
    await expect(page.locator("#settings-keys")).toBeVisible();
    await expect(status(page)).toHaveText(/^AI translation isn't allowed yet\s*Without permission, AI translates nothing/, { useInnerText: true });
    expect(await primaries(page)).toEqual(["Read and allow"]);
    await status(page).locator('[data-button][href="/app/settings?section=ai"]').click();
    await expect(page.locator("#settings-ai-heading")).toBeFocused();
    // There, with the own-key notice, the permission is the page's one primary button.
    expect(await primaries(page)).toEqual(["Allow AI translation"]);
    await expect(page.locator("#settings-ai")).toContainText("with the key you added, under your own contract with them");
    await traffic.expectNever(typed);
    await traffic.expectNever(realLooking);
  });

  test("Azure in the EU with its region, then globally after the permission: 'Allow these too'", async ({ page }) => {
    await resetEditStore(page);
    await openApp(page, "ownkeyEdit", "/app/settings");
    // A DeepL key too, so the permission still covers one service after Azure moves.
    await keyField(row(page, "deepl")).fill("mock-deepl-5555:fx");
    await row(page, "deepl").getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "DeepL key saved");

    const azure = row(page, "azure");
    await azure.getByText("Add a Microsoft Azure key").click();
    await keyField(azure).fill("mock-azure-1234");
    await expect(azure.getByRole("radio", { name: "Only in EU data centres (recommended)" })).toBeChecked();
    await azure.locator('s-text-field[name="region"] input').fill("West Europe");
    await azure.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "Microsoft Azure key saved");
    await expect(azure).toContainText("Region westeurope · EU data centres");

    await nav(page).getByRole("link", { name: /^AI permission/ }).click();
    await page.locator("#settings-ai").getByRole("button", { name: "Allow AI translation" }).click();
    await expectToast(page, "AI translation is allowed.");
    // On to the next step; the keys are one tap away in the nav.
    await expect(page).toHaveURL(/[?&]section=changes(&|$)/);
    await nav(page).getByRole("link", { name: /^Your keys/ }).click();

    await azure.getByText("Replace key").click();
    await keyField(azure).fill("mock-azure-5678");
    await azure.getByRole("radio", { name: "In the closest data centre, possibly outside the EU" }).check();
    await azure.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "Microsoft Azure key saved");
    await expect(azure).toContainText("Data centres worldwide");
    await nav(page).getByRole("link", { name: /^AI permission/ }).click();
    const extra = page.locator("#settings-ai");
    await expect(extra).toContainText("You added a key for Microsoft Ireland Operations Ltd. (Azure AI Translator, data centres worldwide).");
    await expect(extra.getByRole("button", { name: "Allow these too" })).toBeVisible();
  });

  test("Google: its global data location is said before saving", async ({ page }) => {
    await resetEditStore(page);
    await openApp(page, "ownkeyEdit", "/app/settings");
    const google = row(page, "google");
    await google.getByText("Add a Google Cloud key").click();
    await expect(google).toContainText(en.t("settings.keys.google.global"));
    await expect(google).toContainText(en.t("settings.keys.usage.elsewhere.google"));
  });

  test("check again, replace, and remove through the dialog; focus stays on the key's row", async ({ page }) => {
    await resetEditStore(page);
    await openApp(page, "ownkeyEdit", "/app/settings");
    const deepl = row(page, "deepl");
    await keyField(deepl).fill("mock-deepl-2222:fx");
    await deepl.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "DeepL key saved");
    await expect(page.locator("#settings-keys-deepl")).toBeFocused();

    await deepl.getByRole("button", { name: "Check again" }).click();
    await expectToast(page, "DeepL key checked");

    await deepl.getByText("Replace key").click();
    await keyField(deepl).fill("mock-deepl-3333");
    await deepl.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "DeepL key saved");
    await expect(deepl).toContainText("Ends in …3333");
    await expect(deepl).toContainText("DeepL API Pro");

    await deepl.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove the DeepL key?" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("s-modal#settings-key-remove-deepl")).toContainText("Linguva deletes the key right away and sends no more texts to DeepL with it.");
    await page.locator("s-modal#settings-key-remove-deepl").getByRole("button", { name: "Remove key", exact: true }).click();
    await expectToast(page, "DeepL key removed");
    await expect(deepl).toContainText("Add a DeepL key");
    await expect(page.locator("#settings-keys-deepl")).toBeFocused();
  });
});

test("with a key and its permission: the editor translates with it, the hero names it, no 'used up' banner", async ({ page }) => {
  await openApp(page, "ownkeyReady", "/app/products/1?lang=de");
  await expect(page.getByText(/^Your own key · [\d,]+ characters this calendar month \(UTC\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Translate with AI" }).click();
  await expect(page.getByText(/AI drafts are filled in below/)).toBeVisible();
  await expect(page.locator('s-text-field[name="value:title"] input')).toHaveValue("[de] Product 1 jacket");

  await openApp(page, "ownkeyReady", "/app/plan");
  await expect(page.getByRole("heading", { name: "Your plan: Own key" })).toBeVisible();
  await expect(page.getByText("Translates with your keys: DeepL")).toBeVisible();
  await expect(page.getByText(/^Through your keys this calendar month \(UTC\), as counted by Linguva: [\d,]+ characters\./)).toBeVisible();
  await expect(page.getByRole("group", { name: "Own key", exact: true })).toContainText("Your plan");

  await openApp(page, "ownkeyReady", "/app");
  await expect(page.locator(`s-banner[heading="${en.t("overview.banner.exhausted.heading")}"]`)).toHaveCount(0);
  await expect(page.getByText(/^AI translation this calendar month \(UTC\) with your keys: [\d,]+ characters$/)).toBeVisible();
});

test("a refused key: the Overview warns and the language page waits for a key that works", async ({ page }) => {
  await openApp(page, "ownkeyRefused", "/app");
  const banner = page.locator(`s-banner[heading="${en.t("overview.banner.ownKey.heading")}"]`);
  await expect(banner).toContainText("Microsoft Azure refused your key");
  await expect(banner.locator("s-link")).toHaveAttribute("href", "/app/settings?section=keys");

  await openApp(page, "ownkeyRefused", "/app/languages/de");
  await expect(page.getByText(en.t("language.error.OWN_KEY_REFUSED"))).toBeVisible();
  await expect(page.locator('s-link[href="/app/settings?section=keys"]').first()).toBeVisible();

  // Settings says so in its status row, and opens the keys first.
  await openApp(page, "ownkeyRefused", "/app/settings");
  await expect(status(page)).toHaveText(/^A key needs your attention\s*Refused by Microsoft Azure$/, { useInnerText: true });
  await expect(status(page).locator("s-icon[type='alert-circle']")).toHaveCount(1);
  await expect(navEntry(page, "Your keys")).toHaveText(/^Your keys\s*A key needs your attention$/, { useInnerText: true });
  await expect(page.locator("#settings-keys")).toBeVisible();
});

test("a pending change to Own key: add your key before the date; keys can be added now; Pro still applies", async ({ page }) => {
  for (const engine of ["deepl", "azure", "google"]) await post(page, "ownkeyPending", "/app/settings.data", { intent: "remove-key", engine });
  await openApp(page, "ownkeyPending", "/app");
  await expect(page.getByText(/^Your plan changes to Own key on .+\. Add your translation key before then/)).toBeVisible();

  await openApp(page, "ownkeyPending", "/app/settings?section=keys");
  await expect(page.locator("#settings-keys")).toContainText(/Your plan changes to Own key on .+\. You can add and check your keys now/);
  // Still Pro: the plan section counts Pro's AI characters.
  await expect(navEntry(page, "Plan & usage")).toHaveText(/^Plan & usage\s*Pro · (<1%|\d+%) used$/, { useInnerText: true });
  const deepl = row(page, "deepl");
  await keyField(deepl).fill("mock-deepl-4444:fx");
  await deepl.getByRole("button", { name: "Check and save" }).click();
  await expectToast(page, "DeepL key saved");
  await expect(deepl).toContainText("Ends in …4444");

  await openApp(page, "ownkeyPending", "/app/products/1?lang=de");
  await expect(page.getByText(/AI characters left this month/)).toBeVisible();
  await expect(page.getByText(/Your own key/)).toHaveCount(0);
});

test("other plans: a forged save is refused, and Settings has no keys section", async ({ page }) => {
  const answer = await post(page, "full", "/app/settings.data", { intent: "save-key", engine: "deepl", apiKey: "mock-deepl-9999:fx" });
  expect(answer.ok()).toBe(true);
  const body = await answer.text();
  expect(body).toContain("PLAN_OWN_KEY");
  expect(body).not.toContain("mock-deepl-9999");
  await openApp(page, "full", "/app/settings");
  await expect(page.locator("#settings-keys")).toHaveCount(0);
  expect(await navOrder(page)).toEqual(["Translating changes", "Publishing", "How AI writes", "Translation memory", "AI permission", "Plan & usage", "Tools"]);
  // Asked for anyway: the first section opens.
  await openApp(page, "full", "/app/settings?section=keys");
  await expect(page.locator("#settings-keys")).toHaveCount(0);
  await expect(page.locator("#settings-changes")).toBeVisible();
});
