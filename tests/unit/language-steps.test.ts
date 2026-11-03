/**
 * The language pages' "Next" steps (app/components/LanguageSteps.tsx): how a
 * step names the image descriptions and extra details translated with it,
 * the step that lifts a translate gate, the title of the step for content
 * Linguva may not read, the icon squares in place of numbers (NumberedSteps'
 * optional icon), semibold figures in the hero (StateLines' optional
 * `strong`), the figures' words in every language and the translate
 * dialog's ticked box when it was opened for image descriptions and extra
 * details. Rendered on the server.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BulkEstimate } from "../../app/.server/languages/language-page";
import { StateLines } from "../../app/components/ItemStates";
import { NumberedSteps } from "../../app/components/LanguageLayout";
import { accessTitle, attachedTexts, STEP_LOOK, StepIcon, unlockStep } from "../../app/components/LanguageSteps";
import { TranslateConfirm } from "../../app/components/TranslateConfirm";
import { translator } from "../../app/i18n/i18n";
import { emptyCounts } from "../../app/lib/coverage-rules";
import { contentAccessPath, UNLOCK_GATES, unlockHref } from "../../app/lib/language-categories";

const de = translator("de");
const en = translator("en");
const html = (node: ReactNode) => renderToStaticMarkup(createElement("div", null, node));

describe("a step's image descriptions and extra details", () => {
  it("are named with their counts in the interface language, or not at all", () => {
    expect(attachedTexts(de, { images: 3, customFields: 2 })).toBe("3 Bildbeschreibungen und 2 Zusatzinfos");
    expect(attachedTexts(de, { images: 1, customFields: 0 })).toBe("1 Bildbeschreibung");
    expect(attachedTexts(en, { images: 0, customFields: 1 })).toBe("1 extra detail");
    expect(attachedTexts(en, { images: 2, customFields: 5 })).toBe("2 image descriptions and 5 extra details");
    expect(attachedTexts(de, { images: 0, customFields: 0 })).toBeNull();
  });
});

describe("the step that lifts a translate gate", () => {
  it("says what to do and leads to the place that does it, the page's primary button when it comes first", () => {
    const step = unlockStep(de, { gate: "PLAN_LANGUAGE", href: unlockHref("PLAN_LANGUAGE"), language: "Deutsch", variant: "primary" });
    expect(step.title).toBe("Dein Tarif enthält Deutsch nicht");
    expect(step.detail).toBe("Die KI übersetzt nur in die Sprachen deines Tarifs. Ein größerer Tarif enthält mehr davon.");
    const action = html(step.action);
    expect(action).toContain('href="/app/plan"');
    expect(action).toContain('data-variant="primary"');
    expect(action).toContain("Tarife ansehen");
    // The plan's lock in the plan's colour.
    expect(html(step.icon)).toContain('data-tint="rose"');
  });

  it("has words in every language for every gate, and a line never ends in \"KI-\"", () => {
    for (const gate of UNLOCK_GATES) {
      for (const i18n of [en, de, translator("fr"), translator("es")]) {
        const step = unlockStep(i18n, { gate, href: unlockHref(gate), language: "x", variant: "secondary" });
        expect(step.title, `${i18n.locale} ${gate}`).not.toBe("");
        expect(step.detail, `${i18n.locale} ${gate}`).not.toBe("");
        expect(html(step.action), `${i18n.locale} ${gate}`).toContain(`href="${unlockHref(gate)}"`);
      }
    }
    expect(unlockStep(de, { gate: "CONSENT_REQUIRED", href: unlockHref("CONSENT_REQUIRED"), language: "Deutsch", variant: "primary" }).title).toBe("KI‑Übersetzung erlauben");
  });
});

describe("the step for content Linguva may not read", () => {
  it("asks to allow access where the Content page can ask Shopify for it", () => {
    expect(accessTitle(de, { href: contentAccessPath("de"), categories: "Shop & Kasse", types: ["SHOP_POLICY"] })).toBe("Zugriff auf Shop & Kasse erlauben");
  });

  it("says which texts no app may read where there is nothing to allow, in the Content tile's words", () => {
    expect(accessTitle(de, { href: null, categories: "Shop & Kasse", types: ["PAYMENT_GATEWAY"] })).toBe("Für Apps nicht verfügbar: Zahlungsarten");
    expect(accessTitle(en, { href: null, categories: "Menus & filters, Sizes & colors", types: ["FILTER", "PRODUCT_OPTION", "PRODUCT_OPTION_VALUE"] })).toBe(
      "Not available to apps: Filters, Option names, and Option values",
    );
    expect(accessTitle(translator("fr"), { href: null, categories: "x", types: ["SHOP"] })).toBe("Non disponible pour les applications : Fiche de la boutique sur Google");
    expect(accessTitle(translator("es"), { href: null, categories: "x", types: ["SELLING_PLAN"] })).toBe("No disponible para aplicaciones: Opciones de suscripción");
  });
});

describe("a figure in words", () => {
  const [fr, es] = [translator("fr"), translator("es")];
  const figure = { complete: 1, total: 350, count: 350 };

  it("puts the label first in German, French and Spanish: the form follows the total, so 1 done text of 350 reads right", () => {
    expect(de.t("language.hero.figure", figure)).toBe("Fertig und live: 1 von 350 Texten");
    expect(de.t("language.hero.figure", { complete: 0, total: 1, count: 1 })).toBe("Fertig und live: 0 von 1 Text");
    expect(de.t("language.hero.ringLabel", { ...figure, percent: "0 %" })).toBe("0 % übersetzt. Fertig und live: 1 von 350 Texten");
    // French reads 0 as singular too: no verb has to agree with it.
    expect(fr.t("language.hero.figure", { ...figure, complete: 0 })).toBe("Terminés et en ligne : 0 sur 350 textes");
    expect(fr.t("language.hero.ringLabel", { ...figure, percent: "0 %" })).toBe("0 % traduit. Terminés et en ligne : 1 sur 350 textes");
    expect(es.t("language.hero.figure", figure)).toBe("Listos y publicados: 1 de 350 textos");
    expect(es.t("language.hero.ringLabel", { ...figure, percent: "0 %" })).toBe("0 % traducido. Listos y publicados: 1 de 350 textos");
  });

  it("names the texts after the total on an area's card", () => {
    expect(fr.t("language.card.figure", { complete: 1, total: 12, count: 12 })).toBe("1 sur 12 textes");
    expect(fr.t("language.card.figure", { complete: 0, total: 1, count: 1 })).toBe("0 sur 1 texte");
    expect(de.t("language.card.figure", { complete: 1, total: 12, count: 12 })).toBe("1 von 12 Texten");
    expect(es.t("language.card.figure", { complete: 1, total: 12, count: 12 })).toBe("1 de 12 textos");
  });
});

describe("steps with icons", () => {
  it("show each step's icon square in place of its number, in the list's order", () => {
    const markup = html(
      createElement(NumberedSteps, {
        steps: [
          { key: "review", icon: createElement(StepIcon, STEP_LOOK.review), title: "2 Übersetzungen freigeben" },
          { key: "count", icon: createElement(StepIcon, STEP_LOOK.count), title: "Texte zählen" },
        ],
      }),
    );
    expect(markup.match(/<li>/g)).toHaveLength(2);
    expect(markup).toContain('<span class="lv-icon-square" data-tint="violet" aria-hidden="true" style="width:36px;height:36px;border-radius:11px"><s-icon type="eye-check-mark"');
    expect(markup).toContain('data-tint="green"');
    // No number circles beside the icons.
    expect(markup).not.toContain('borderRadius="large-200"');
  });

  it("set the hero's figures in semibold when asked, the Overview's unchanged", () => {
    const counts = { ...emptyCounts(), complete: 4, missing: 2 };
    expect(html(createElement(StateLines, { counts, i18n: de, strong: true }))).toContain('<strong class="lv-strong">4</strong>');
    expect(html(createElement(StateLines, { counts, i18n: de }))).toContain('<s-text type="strong">4</s-text>');
  });
});

describe("the translate dialog", () => {
  const estimate: BulkEstimate = { types: ["PRODUCT"], texts: { missing: 12, outdated: 0, failed: 0 }, items: 6, chars: 1200, attached: true };
  const dialog = (attachedDefault?: boolean) =>
    html(
      createElement(TranslateConfirm, {
        id: "language-translate",
        target: { category: "products", estimate },
        languageName: "Deutsch",
        publishMode: "DRAFT",
        aiRemaining: 20_000,
        i18n: de,
        ...(attachedDefault === undefined ? {} : { attachedDefault }),
        onConfirm: () => undefined,
      }),
    );
  const checkbox = (markup: string) => markup.match(/<s-checkbox[^>]*>/)![0];

  it("starts with image descriptions and extra details ticked when it was opened for them, unticked otherwise", () => {
    // React 18 writes the attribute on a custom element ("true"); its presence is the box's first state.
    expect(checkbox(dialog(true))).toMatch(/\schecked="(true)?"/);
    expect(checkbox(dialog(false))).not.toMatch(/\schecked/);
    expect(checkbox(dialog())).not.toMatch(/\schecked/);
    expect(checkbox(dialog(true))).toContain('label="Auch Bildbeschreibungen und Zusatzinfos übersetzen"');
  });
});
