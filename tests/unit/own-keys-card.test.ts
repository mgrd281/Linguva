/**
 * Settings › "Your translation keys" (app/components/OwnKeysCard.tsx),
 * rendered on the server like the Plan page's parts: every key form posts
 * (a GET would put the key into the address), the key field never has a
 * value, only the last four characters show, each state is in words, the
 * notices off the plan and with a pending change, the cost note, Azure's
 * and Google's data locations and where their usage shows, in all four
 * interface languages.
 */
import { createElement, forwardRef, type FormHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keyErrorText, keyResult, keysState, OwnKeysCard, ownKeyCostNote, type KeyFetcher, type OwnKeysCardData } from "../../app/components/OwnKeysCard";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { ENGINE_IDS, type EngineId } from "../../app/lib/engines";
import type { OwnKeyStatus, OwnKeySummary } from "../../app/lib/own-keys";

const VERIFIED = "2026-10-30T09:00:00.000Z";

/** A fetcher as the card uses it: its Form renders a plain form with what the card passes. */
const Form = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(function Form(props, ref) {
  return createElement("form", { ...props, ref });
});
function fetcher(data?: unknown): KeyFetcher {
  return { state: "idle", data, formData: undefined, Form, submit: () => Promise.resolve(), load: () => Promise.resolve() } as unknown as KeyFetcher;
}
const fetchers = (data: Partial<Record<EngineId, unknown>> = {}) =>
  Object.fromEntries(ENGINE_IDS.map((engine) => [engine, fetcher(data[engine])])) as Record<EngineId, KeyFetcher>;

const key = (engine: EngineId, extra: Partial<OwnKeySummary> = {}): OwnKeySummary => ({
  engine,
  hint: engine === "deepl" ? "1a2b" : engine === "azure" ? "3c4d" : "5e6f",
  status: "OK",
  dataLocation: engine === "google" ? "global" : "eu",
  region: engine === "azure" ? "westeurope" : null,
  deeplPlan: engine === "deepl" ? "free" : null,
  verifiedAt: VERIFIED,
  lastErrorCode: null,
  lastErrorAt: null,
  ...extra,
});

const view = (extra: Partial<OwnKeysCardData> = {}): OwnKeysCardData => ({
  access: "plan",
  plan: true,
  startsOn: null,
  keys: [],
  usage: { total: 0, byEngine: {} },
  deepl: null,
  ...extra,
});

const render = (data: OwnKeysCardData, locale: AppLocale = "en", options: { primary?: boolean; results?: Partial<Record<EngineId, unknown>> } = {}) =>
  renderToStaticMarkup(createElement(OwnKeysCard, { data, i18n: translator(locale), fetchers: fetchers(options.results), primary: options.primary ?? false }));
/** Markup as text: tags dropped, entities read. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Your translation keys", () => {
  it("posts every key form (save, check, remove) and never gives the key field a value", () => {
    const html = render(view({ keys: [key("deepl"), key("azure")] }));
    const forms = html.match(/<form[^>]*>/g) ?? [];
    // DeepL and Azure: replace, check, remove; Google: add.
    expect(forms).toHaveLength(7);
    for (const form of forms) expect(form).toMatch(/method="post"/);
    for (const intent of ["save-key", "check-key", "remove-key"]) expect(html).toContain(`name="intent" value="${intent}"`);
    const fields = html.match(/<s-password-field[^>]*>/g) ?? [];
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field).not.toMatch(/\svalue=/);
      expect(field).toMatch(/name="apiKey"/);
      expect(field).toMatch(/autocomplete="off"/);
    }
  });

  it("shows only the last four characters, the DeepL plan, Azure's region and data location, Google's", () => {
    const html = text(render(view({ keys: [key("deepl"), key("azure"), key("google")] })));
    expect(html).toContain("Ends in …1a2b");
    expect(html).toContain("Ends in …3c4d");
    expect(html).toContain("Ends in …5e6f");
    expect(html).toContain("DeepL API Free");
    expect(html).toContain("Region westeurope · EU data centres");
    expect(html).toContain("Data centres worldwide");
    expect(html).toContain("Checked on October 30, 2026");
    // Where Microsoft and Google show usage and costs (their keys have no usage API).
    expect(html).toContain("Microsoft shows your usage and costs in the Azure portal (Cost Management).");
    expect(html).toContain("Google shows your usage and costs in the Google Cloud console (Billing).");
    expect(html).toContain("With an API key, Google may process texts in data centres outside the EU.");
    // Several usable keys: their order.
    expect(html).toContain("With several keys, Linguva tries DeepL first, then Microsoft Azure, then Google Cloud.");
  });

  it("says each state in words, with the job message and its date for the last error", () => {
    const states: Array<[OwnKeyStatus, string]> = [
      ["OK", "Key accepted"],
      ["QUOTA", "Quota used up for now"],
      ["REFUSED", "Refused by DeepL"],
      ["UNREADABLE", "Couldn't be read: please enter it again"],
      ["RECHECK", "Not used until you check it again"],
    ];
    for (const [status, words] of states) expect(text(render(view({ keys: [key("deepl", { status })] }))), status).toContain(words);
    const refused = text(render(view({ keys: [key("azure", { status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_AZURE", lastErrorAt: VERIFIED })] })));
    expect(refused).toContain("Microsoft Azure refused your key, or the service isn't set up for it");
    expect(refused).toContain("Microsoft Azure reported this on October 30, 2026.");
  });

  it("on the plan: the lead, the cost note (all three services before any key), DeepL's form open and the page's primary button", () => {
    const html = render(view(), "en", { primary: true });
    const words = text(html);
    expect(words).toContain("On the Own key plan, Linguva translates only with your own keys.");
    expect(words).toContain("No key yet. Add at least one to translate with AI.");
    expect(words).toContain("DeepL, Microsoft Azure, and Google Cloud bill you for every character");
    expect(html).toMatch(/<details open="">/);
    expect(html.match(/<details open/g)).toHaveLength(1);
    expect(html.match(/variant="primary"/g)).toHaveLength(1);
    expect(words).toContain("Nothing translated through your keys this calendar month (UTC) yet.");
    // A saved key: the cost note names its service; usage and DeepL's own figure.
    const saved = text(
      render(view({ keys: [key("deepl")], usage: { total: 4_200, byEngine: { deepl: 4_200 } }, deepl: { plan: "free", used: 1_234, limit: 500_000 } })),
    );
    expect(saved).toContain("DeepL bill you for every character");
    expect(saved).toContain("Through your keys this calendar month (UTC), as counted by Linguva: 4,200 characters.");
    expect(saved).toContain("DeepL: 4,200 characters");
    expect(saved).toContain("DeepL: 1,234 of 500,000 characters used in this billing period");
  });

  it("with a pending change: the date, the cost note and working add and check forms", () => {
    const html = render(view({ access: "pending", plan: false, startsOn: "2026-11-28T00:00:00.000Z", keys: [key("deepl")] }));
    const words = text(html);
    expect(words).toContain("Your plan changes to Own key on November 28, 2026.");
    expect(words).toContain("bill you for every character");
    expect(html).toContain('value="check-key"');
    expect(html.match(/<s-password-field/g)).toHaveLength(3);
    expect(text(render(view({ access: "pending", plan: false })))).toContain("Your plan changes to Own key at the end of the billing cycle.");
  });

  it("off the plan: only Remove for the saved keys, and that texts now go to Linguva's services", () => {
    const html = render(view({ access: "off", plan: false, keys: [key("google")] }));
    const words = text(html);
    expect(html.replace(/&#x27;/g, "'")).toContain(`heading="Your plan doesn't use these keys"`);
    expect(words).toContain("They stay saved, unused, until you remove them or uninstall Linguva.");
    expect(words).toContain("On your current plan, Linguva translates with its own services and counts the plan's AI characters.");
    expect(words).toContain("Remove");
    expect(words).not.toContain("Check again");
    expect(words).not.toContain("Check and save");
    expect(words).not.toContain("bill you for every character");
    expect(html).not.toContain("<s-password-field");
    expect(html).not.toContain('value="check-key"');
    expect(html).toContain('value="remove-key"');
    // Only the saved key's row: no DeepL or Azure row to add one.
    expect(words).not.toContain("Add a DeepL key");
    expect(html).toContain('id="settings-key-remove-google"');
  });

  it("shows a refused key's error inline, by its code, never anything typed", () => {
    const html = text(render(view(), "en", { results: { deepl: { ok: false, error: "KEY_REFUSED", engine: "deepl" } } }));
    expect(html).toContain("DeepL refused this key, or the service isn't set up for it yet");
    expect(html).toContain("Nothing was saved.");
    const i18n = translator("en");
    expect(keyErrorText(i18n, { error: "RATE_LIMITED", retryAfterSeconds: 42 }, "azure")).toBe("Too many key checks. Please try again in 42 seconds.");
    expect(keyErrorText(i18n, { error: "KEY_MOCK_ONLY" }, "deepl")).toBe("This test installation accepts only test keys that start with mock-.");
    expect(keyResult({ ok: true, saved: "style" })).toBeNull();
    expect(keyResult({ ok: true, saved: "key", engine: "deepl", replaced: false, status: "OK" })).toMatchObject({ saved: "key" });
  });

  it("is complete in every interface language", () => {
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const html = text(render(view({ keys: [key("azure", { status: "REFUSED" })] }), locale));
      for (const message of [
        i18n.t("settings.keys.heading"),
        i18n.t("settings.keys.lead"),
        i18n.t("settings.keys.hint", { hint: "3c4d" }),
        i18n.t("settings.keys.state.REFUSED", { engine: "Microsoft Azure" }),
        i18n.t("settings.keys.add", { engine: "DeepL" }),
        i18n.t("settings.keys.checkAgain"),
        i18n.t("settings.keys.remove.confirm"),
        ownKeyCostNote(i18n, [{ engine: "azure" }]),
      ]) {
        expect(html, `${locale}: ${message}`).toContain(text(message).trim());
      }
      expect(keysState(i18n, []).label).toBe(i18n.t("settings.changes.badge.noKey"));
    }
  });
});
