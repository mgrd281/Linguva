/**
 * Settings' pieces (app/components/SettingsParts.tsx) and the flush button
 * the smart page's lines use, as the browser first receives them: a state
 * line's link outside its sentence's s-text (which would draw it in the
 * text's colour), after a middle dot or, after a full sentence, a space; the
 * one lock without a line where its badge says it all; a section's heading
 * with its tile's icon at every width; an option card whose name says it
 * all, without a line under it; and a tertiary button without its side room. (tests/ui/settings.spec.ts checks them with Polaris drawn.)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../../app/components/Button";
import { LockLine, OptionCard, SettingSection, StateLine } from "../../app/components/SettingsParts";

const link = (label: string, href = "/app/glossary") => createElement("s-link", { href }, label);

describe("a state line with its way on", () => {
  it("draws the link outside the sentence's s-text, after a middle dot when the line is a fact", () => {
    const markup = renderToStaticMarkup(createElement(StateLine, { icon: "book-open", action: link("Edit glossary") }, "Fixed terms in the glossary: 0"));
    expect(markup).toContain('<span><s-text>Fixed terms in the glossary: 0</s-text> · <s-link href="/app/glossary">Edit glossary</s-link></span>');
  });

  it("follows a full sentence with a space, keeps the sentence's tone, and can be the link alone", () => {
    const sentence = renderToStaticMarkup(createElement(StateLine, { icon: "lock", tone: "caution", action: link("See plans", "/app/plan") }, "Spanish isn't among your plan's languages."));
    expect(sentence).toContain('<s-text tone="caution">Spanish isn&#x27;t among your plan&#x27;s languages.</s-text> <s-link href="/app/plan">See plans</s-link>');
    const alone = renderToStaticMarkup(createElement(StateLine, { icon: "key", action: link("Add your translation key first.", "/app/settings?section=keys") }));
    expect(alone).toContain('<span><s-link href="/app/settings?section=keys">Add your translation key first.</s-link></span>');
    expect(alone).not.toContain("<s-text");
  });

  it("stays as it was without one: the sentence beside its icon", () => {
    const markup = renderToStaticMarkup(createElement(StateLine, { icon: "clock" }, "Next check: today, 11:00 PM"));
    expect(markup).toBe(
      '<s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start"><s-icon type="clock" color="subdued"></s-icon><s-text>Next check: today, 11:00 PM</s-text></s-grid>',
    );
  });
});

describe("the one lock", () => {
  it("is the plan's badge and the plans link where a line would only repeat the badge", () => {
    const markup = renderToStaticMarkup(createElement(LockLine, { plan: "Business", link: { href: "/app/plan", label: "See plans" } }));
    expect(markup).toContain('<s-badge icon="lock">Business</s-badge><s-link href="/app/plan">See plans</s-link>');
    expect(markup).not.toContain("<s-text");
    // A lock that names more plans keeps its line.
    expect(renderToStaticMarkup(createElement(LockLine, { plan: "Starter", text: "In the Starter, Pro and Business plans." }))).toContain(
      '<s-text color="subdued">In the Starter, Pro and Business plans.</s-text>',
    );
  });
});

describe("a Settings section's heading", () => {
  it("carries its tile's icon at every width (no box hiding it on a phone) and takes its size from the app's styles", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingSection, { id: "settings-memory", icon: "database", tint: "amber", heading: "Translation memory", lead: "Approved translations are always reused for identical text, for free." }),
    );
    expect(markup).toContain('<div class="lv-section-head lv-page-head"><s-grid gridTemplateColumns="auto minmax(0, 1fr)"');
    expect(markup).toMatch(/<span class="lv-icon-square" data-tint="amber" aria-hidden="true"><s-icon type="database"[^>]*><\/s-icon><\/span>/);
    expect(markup).not.toContain("@container (inline-size &gt; 520px)");
    expect(markup).toContain('<h2 id="settings-memory-heading" tabindex="-1" class="lv-section-heading" style="outline:none">Translation memory</h2>');
    // Without a lead (How AI writes, Plan & usage, Tools): the heading row alone, centred on its sign.
    const bare = renderToStaticMarkup(createElement(SettingSection, { id: "settings-style", icon: "text-quote", tint: "violet", heading: "How AI writes" }));
    expect(bare).toContain('<div class="lv-section-head"><s-grid');
    expect(bare).not.toContain('<s-text color="subdued">');
    // Without an icon, the heading alone.
    expect(renderToStaticMarkup(createElement(SettingSection, { id: "settings-x", heading: "X" }))).toContain('gridTemplateColumns="1fr"');
  });
});

describe("an option card", () => {
  it("leaves out the line under its name where the name says it all (the smart page's texts: all, or only certain ones)", () => {
    const card = (body?: string) =>
      renderToStaticMarkup(
        createElement(OptionCard, { id: "smart-fields-all", icon: "text-block", tint: "blue", title: "All texts (except web addresses)", current: false, currentLabel: "Current setting", select: { onClick: () => undefined }, ...(body ? { body } : {}) }),
      );
    expect(card()).not.toContain("lv-option__body");
    expect(card()).toContain('<span id="smart-fields-all" class="lv-option__title">All texts (except web addresses)</span>');
    // Can be chosen: one button as a whole, with its empty radio mark.
    expect(card()).toContain('<button type="button" class="lv-option__choose">');
    expect(card()).toContain('<span class="lv-option__radio"></span>');
    expect(card("Only Linguva's unreviewed AI translations.")).toContain('<span class="lv-option__body">Only Linguva&#x27;s unreviewed AI translations.</span>');
  });
});

describe("a flush button", () => {
  it("is a tertiary button with the flush class (ui.css: no side room, an underline under the pointer); others are not", () => {
    const flush = renderToStaticMarkup(createElement(Button, { variant: "tertiary", flush: true }, "Change"));
    expect(flush).toMatch(/^<button type="button" class="lv-btn lv-btn--tertiary lv-btn--flush"/);
    expect(renderToStaticMarkup(createElement(Button, { variant: "tertiary" }, "Change"))).not.toContain("lv-btn--flush");
  });
});
