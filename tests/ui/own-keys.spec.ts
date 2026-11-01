/**
 * The Own key plan in the browser (mock mode: the server accepts only
 * "mock-…" test keys and never calls an engine): the welcome and the Plan
 * page's hero ask for the key first, the Overview's next step and footer
 * say a key is needed, Settings' keys card adds, refuses, replaces, checks
 * and removes keys (through its dialog) with the page's one primary button
 * where it belongs, the permission then covers the keys' services, and no
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

const glance = (page: Page) => page.getByRole("region", { name: "At a glance" });
const cardOrder = (page: Page) => page.locator("section[id^='settings-']").evaluateAll((sections) => sections.map((s) => s.id));
/** Primary buttons on the page (not the ones inside a closed dialog). */
const primaries = (page: Page) =>
  page.locator('s-button[variant="primary"]').evaluateAll((buttons) => buttons.filter((b) => !b.closest("s-modal")).map((b) => (b as HTMLElement).innerText.trim()));
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
    await expect(page.locator("s-banner s-link", { hasText: "Add your key" })).toHaveAttribute("href", "/app/settings#settings-keys");
    await expect(page.getByRole("heading", { name: "Your plan: Own key" })).toBeVisible();
    await expect(page.getByText(en.t("plan.hero.line.ownKey.missing"))).toBeVisible();
    const addKey = page.locator('s-button[variant="primary"][href="/app/settings#settings-keys"]');
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
    await expect(page.locator('s-button[href="/app/settings#settings-keys"]', { hasText: "Add key" })).toBeVisible();
    await expect(page.getByText(en.t("overview.usage.ownKeyMissing"))).toBeVisible();
    await expect(page.getByText(en.t("overview.usage.notConfigured"))).toHaveCount(0);
    await expect(page.locator(`s-banner[heading="${en.t("overview.banner.exhausted.heading")}"]`)).toHaveCount(0);
  });

  test("Settings: the keys card first, DeepL's form the one primary button, the tile and the changes say a key is needed @responsive", async ({ page }) => {
    await openApp(page, "ownkey", "/app/settings");
    expect((await cardOrder(page)).slice(0, 2)).toEqual(["settings-keys", "settings-ai"]);
    expect(await primaries(page)).toEqual(["Check and save"]);
    await expect(row(page, "deepl").getByText("Check and save")).toBeVisible();
    // Six tiles still: the keys take the AI characters' place.
    const tiles = glance(page).locator("li");
    await expect(tiles).toHaveCount(6);
    await expect(tiles.nth(5)).toHaveText(/^(Your keys|Keys)\s*Needs your key\s*No key yet$/, { useInnerText: true });
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
    await expect(page.locator("#settings-keys")).toContainText("DeepL bill you for every character");

    // Now the permission is the next step, with the own-key notice.
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

    await page.locator("#settings-ai").getByRole("button", { name: "Allow AI translation" }).click();
    await expectToast(page, "AI translation is allowed.");

    await azure.getByText("Replace key").click();
    await keyField(azure).fill("mock-azure-5678");
    await azure.getByRole("radio", { name: "In the closest data centre, possibly outside the EU" }).check();
    await azure.getByRole("button", { name: "Check and save" }).click();
    await expectToast(page, "Microsoft Azure key saved");
    await expect(azure).toContainText("Data centres worldwide");
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
  await expect(banner.locator("s-link")).toHaveAttribute("href", "/app/settings#settings-keys");

  await openApp(page, "ownkeyRefused", "/app/languages/de");
  await expect(page.getByText(en.t("language.error.OWN_KEY_REFUSED"))).toBeVisible();
  await expect(page.locator('s-link[href="/app/settings#settings-keys"]').first()).toBeVisible();
});

test("a pending change to Own key: add your key before the date; keys can be added now; Pro still applies", async ({ page }) => {
  for (const engine of ["deepl", "azure", "google"]) await post(page, "ownkeyPending", "/app/settings.data", { intent: "remove-key", engine });
  await openApp(page, "ownkeyPending", "/app");
  await expect(page.getByText(/^Your plan changes to Own key on .+\. Add your translation key before then/)).toBeVisible();

  await openApp(page, "ownkeyPending", "/app/settings");
  await expect(page.locator("#settings-keys")).toContainText(/Your plan changes to Own key on .+\. You can add and check your keys now/);
  // Still Pro: the AI characters tile, no keys tile.
  await expect(glance(page).locator("li").nth(5)).toHaveText(/^AI characters/, { useInnerText: true });
  const deepl = row(page, "deepl");
  await keyField(deepl).fill("mock-deepl-4444:fx");
  await deepl.getByRole("button", { name: "Check and save" }).click();
  await expectToast(page, "DeepL key saved");
  await expect(deepl).toContainText("Ends in …4444");

  await openApp(page, "ownkeyPending", "/app/products/1?lang=de");
  await expect(page.getByText(/AI characters left this month/)).toBeVisible();
  await expect(page.getByText(/Your own key/)).toHaveCount(0);
});

test("other plans: a forged save is refused, and Settings has no keys card", async ({ page }) => {
  const answer = await post(page, "full", "/app/settings.data", { intent: "save-key", engine: "deepl", apiKey: "mock-deepl-9999:fx" });
  expect(answer.ok()).toBe(true);
  const body = await answer.text();
  expect(body).toContain("PLAN_OWN_KEY");
  expect(body).not.toContain("mock-deepl-9999");
  await openApp(page, "full", "/app/settings");
  await expect(page.locator("#settings-keys")).toHaveCount(0);
  await expect(glance(page).locator("li")).toHaveCount(6);
  expect(await cardOrder(page)).toEqual(["settings-changes", "settings-publish", "settings-style", "settings-memory", "settings-ai", "settings-tools"]);
});
