/**
 * What the translation editor keeps of the merchant's own input (app/components/ResourceTranslationEditor.tsx):
 * a typed text stays while its field stays on screen, also when a new AI or memory result fills other
 * texts, so it counts as unpublished (its state, the save bar, the question on leaving); and a ticked
 * "still correct" box is something to publish, for the item's texts and its image descriptions alike.
 */
import { describe, expect, it } from "vitest";
import { carryTyped, hasConfirmation, topError } from "../../app/components/ResourceTranslationEditor";

describe("carryTyped", () => {
  const draft = { drafts: { body_html: "<p>[de] Warm</p>" } };

  it("keeps what was typed while the result it was typed over is the one shown", () => {
    const typed = { base: draft, values: { body_html: "<p>Warm, von Hand</p>" } };
    expect(carryTyped(typed, draft)).toBe(typed.values);
  });

  it("keeps a typed text whose field gets no new draft: an edit to a translated name survives the memory finding nothing", () => {
    const typed = { base: null, values: { title: "Warme Jacke" } };
    expect(carryTyped(typed, { drafts: {} })).toEqual({ title: "Warme Jacke" });
    // AI drafts only the open texts: the name's field stays as it is.
    expect(carryTyped(typed, draft)).toEqual({ title: "Warme Jacke" });
    // The same draft again (asked twice): its field stays too.
    expect(carryTyped({ base: draft, values: { body_html: "<p>Warm, von Hand</p>" } }, { drafts: { body_html: "<p>[de] Warm</p>" } })).toEqual({
      body_html: "<p>Warm, von Hand</p>",
    });
  });

  it("drops a typed text whose draft changed: its field starts again with the new draft, or with what is published", () => {
    const typed = { base: draft, values: { body_html: "<p>Warm, von Hand</p>", title: "Jacke" } };
    expect(carryTyped(typed, { drafts: { body_html: "<p>[de] Sehr warm</p>" } })).toEqual({ title: "Jacke" });
    // The draft it was typed over isn't in the new result, or the drafts were discarded.
    expect(carryTyped(typed, { drafts: {} })).toEqual({ title: "Jacke" });
    expect(carryTyped(typed, null)).toEqual({ title: "Jacke" });
  });

  it("stays dropped once its field started again with a draft, also when a later result has none for it", () => {
    // Typed before AI; AI's draft starts the field again, and the page re-bases on that result.
    const ai = { drafts: { title: "[de] Jacke" } };
    const rebased = { base: ai, values: carryTyped({ base: null, values: { title: "Warme Jacke" } }, ai) };
    expect(rebased.values).toEqual({});
    // The Google texts' or the memory's result has no draft for it: the field starts again with what is published.
    expect(carryTyped(rebased, { drafts: { meta_title: "[de] Warme Jacke" } })).toEqual({});
  });
});

describe("hasConfirmation", () => {
  const form = (entries: Array<[string, string]>) => {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return data;
  };

  it("finds a ticked “still correct” box of the item's texts or of an image description, as the server reads it", () => {
    expect(hasConfirmation(form([["intent", "save"], ["value:title", "Jacke"]]))).toBe(false);
    expect(hasConfirmation(form([["value:body_html", "<p>Warm</p>"], ["confirm:body_html", "on"]]))).toBe(true);
    expect(hasConfirmation(form([["confirm:gid://shopify/MediaImage/1:alt", "on"]]))).toBe(true);
  });

  it("leaves the web address's confirmation to its changed text, and takes no other value for a tick", () => {
    expect(hasConfirmation(form([["confirm-handle", "on"]]))).toBe(false);
    expect(hasConfirmation(form([["confirm:body_html", ""]]))).toBe(false);
  });
});

describe("topError", () => {
  const quota = { code: "QUOTA_EXCEEDED" };
  const rate = { code: "RATE_LIMITED_USER" };

  it("says the last AI run's errors, of the requests it sent: the item's texts first, then its image descriptions' stop", () => {
    expect(topError({ from: "ai", main: true, attached: true }, { memory: null, main: rate, attached: quota })).toBe(rate);
    expect(topError({ from: "ai", main: true, attached: true }, { memory: null, main: null, attached: quota })).toBe(quota);
    // Only the image descriptions were open: an older error of the item's texts isn't this run's.
    expect(topError({ from: "ai", main: false, attached: true }, { memory: null, main: rate, attached: quota })).toBe(quota);
    expect(topError({ from: "ai", main: true, attached: false }, { memory: null, main: null, attached: quota })).toBeNull();
  });

  it("says the memory's error after the memory was asked, and nothing of AI's", () => {
    expect(topError({ from: "memory", main: true, attached: true }, { memory: rate, main: quota, attached: quota })).toBe(rate);
    expect(topError({ from: "memory", main: true, attached: true }, { memory: null, main: quota, attached: quota })).toBeNull();
  });
});
