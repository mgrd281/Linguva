/**
 * Review's words and order that the browser decides (app/lib/review-view.ts and the page's pieces): the language
 * tabs' order, where to go on once nothing waits, the strip's count as the merchant decides, the approve dialog's
 * answers when some texts have a note, and a web address's problem in the row's own word.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReviewPageData } from "../../app/.server/review/page";
import { ReviewApproveConfirm, type ApproveSummary } from "../../app/components/ReviewApproveConfirm";
import { handleProblemText, outcomeText } from "../../app/components/ReviewCard";
import { stripSummary, type PageActions } from "../../app/components/ReviewControls";
import { translator } from "../../app/i18n/i18n";
import { languageOrder, nextToTranslate, pageProgress } from "../../app/lib/review-view";

const en = translator("en");
const de = translator("de");

describe("the language tabs' order", () => {
  it("is Content's: visible languages first, then hidden ones, each group by its name in the interface language", () => {
    const languages = [
      { name: "Spanisch", hidden: false },
      { name: "Arabisch", hidden: true },
      { name: "Französisch", hidden: false },
      { name: "Dänisch", hidden: true },
      { name: "Deutsch", hidden: false },
    ];
    expect(languageOrder(languages, "de").map((l) => l.name)).toEqual(["Deutsch", "Französisch", "Spanisch", "Arabisch", "Dänisch"]);
    // A copy: the page's own list keeps its order.
    expect(languages[0]!.name).toBe("Spanisch");
  });

  it("sorts names by the interface language's rules", () => {
    expect(languageOrder([{ name: "Zulu", hidden: false }, { name: "Ägyptisch", hidden: false }, { name: "Bengalisch", hidden: false }], "de").map((l) => l.name)).toEqual([
      "Ägyptisch",
      "Bengalisch",
      "Zulu",
    ]);
  });
});

describe("where to go on once nothing waits", () => {
  const german = { locale: "de", percent: 80, hidden: false };
  const fr = { locale: "fr", percent: 12, hidden: false };
  const ar = { locale: "ar", percent: 0, hidden: true };
  const es = { locale: "es", percent: 100, hidden: false };

  it("is the least translated visible language under 100 %", () => {
    expect(nextToTranslate([german, fr, ar, es])?.locale).toBe("fr");
  });

  it("is a hidden language only when every visible one is done", () => {
    expect(nextToTranslate([{ ...german, percent: 100 }, ar, es])?.locale).toBe("ar");
  });

  it("is nowhere when every language is done, or none has a figure here", () => {
    expect(nextToTranslate([es, { ...german, percent: 100 }])).toBeNull();
    // Not counted (null), or reached by deciding, when the page has names only (undefined).
    expect(nextToTranslate([{ locale: "de", percent: null, hidden: false }, { locale: "fr", percent: undefined, hidden: false }])).toBeNull();
    expect(nextToTranslate([])).toBeNull();
  });

  it("takes the first of the tabs' order on a tie", () => {
    expect(nextToTranslate([{ ...german, percent: 30 }, { ...fr, percent: 30 }])?.locale).toBe("de");
  });
});

describe("the strip's count", () => {
  const data = (page: Partial<ReviewPageData["page"]> = {}) =>
    ({ page: { cards: [], size: 6, matching: 6, from: 1, to: 6, nextCursor: null, isFirstPage: true, ...page } }) as unknown as ReviewPageData;
  const actions = (total: number, undecided: number): PageActions => ({
    total,
    undecided,
    approvable: undecided,
    allOnPage: true,
    busy: false,
    approving: false,
    waiting: false,
    blocked: null,
  });

  it("is fresh until the first decision, then counts what is still open with the share decided", () => {
    expect(pageProgress(6, 6)).toEqual({ kind: "fresh", decided: 0, percent: 0 });
    expect(pageProgress(6, 4)).toEqual({ kind: "open", decided: 2, percent: 33 });
    expect(pageProgress(6, 0)).toEqual({ kind: "done", decided: 6, percent: 100 });
    expect(pageProgress(0, 0)).toEqual({ kind: "done", decided: 0, percent: 0 });
  });

  it("says how many texts the page holds, then how many of them are still open", () => {
    expect(stripSummary(data(), actions(6, 6), en)).toBe("6 translations on this page");
    expect(stripSummary(data(), actions(6, 4), en)).toBe("4 of 6 still open");
    expect(stripSummary(data(), actions(6, 4), de)).toBe("Noch 4 von 6 offen");
    expect(stripSummary(data(), actions(6, 0), de)).toBe("Alles auf dieser Seite ist entschieden.");
  });

  it("says where the page is when there is more than one", () => {
    const first = data({ size: 50, matching: 60, to: 50, nextCursor: "after-50" });
    expect(stripSummary(first, actions(50, 50), en)).toBe("50 translations on this page · 1–50 of 60");
    expect(stripSummary(first, actions(50, 49), de)).toBe("Noch 49 von 50 offen · 1–50 von 60");
  });
});

describe("the question before approving a page", () => {
  const summary: ApproveSummary = { count: 4, live: ["German"], hidden: ["Arabic"], hints: 1, edited: 0, handles: 0, elsewhere: 0 };
  const markup = (i18n: typeof en, values: ApproveSummary, clean: number | null) =>
    renderToStaticMarkup(
      createElement(ReviewApproveConfirm, { id: "review-approve", summary: values, i18n, onConfirm: () => undefined, clean: clean === null ? null : { count: clean, onConfirm: () => undefined } }),
    );

  it("offers the texts without a note on their own when some have one, and names the first answer 'all'", () => {
    const html = markup(en, summary, 3);
    expect(html).toContain('slot="primary-action" variant="primary" commandFor="review-approve" command="--hide">Approve all 4</s-button>');
    expect(html).toContain('slot="secondary-actions" commandFor="review-approve" command="--hide">Approve only the 3 without notes</s-button>');
    // Cancel first, then the two ways to approve side by side.
    expect(html.indexOf(">Cancel<")).toBeLessThan(html.indexOf(">Approve only the 3 without notes<"));
    expect(markup(de, summary, 3)).toContain(">Nur die 3 ohne Hinweis freigeben</s-button>");
    expect(markup(de, { ...summary, count: 2 }, 1)).toContain(">Nur die eine ohne Hinweis freigeben</s-button>");
  });

  it("has one way to approve when no text has a note", () => {
    const html = markup(en, { ...summary, hints: 0 }, null);
    expect(html).toContain(">Approve 4</s-button>");
    expect(html).not.toContain("without");
  });

  it("pairs who sees the texts (an open eye) with who doesn't yet (crossed out)", () => {
    const html = markup(en, summary, 3);
    expect(html).toMatch(/<s-icon type="view"[^>]*><\/s-icon>.*Customers see them right away – in German\./);
    expect(html).toMatch(/<s-icon type="hide"[^>]*><\/s-icon>.*Still hidden: Arabic\./);
  });
});

describe("a new web address's problem", () => {
  it("names an empty one by the row's own word, not the editor's URL handle", () => {
    expect(handleProblemText(de, "EMPTY")).toBe("Gib eine Webadresse ein.");
    expect(handleProblemText(en, "EMPTY")).toBe("Enter a web address.");
    expect(handleProblemText(de, "TOO_LONG")).toBe("Verwende höchstens 255 Zeichen.");
    expect(handleProblemText(de, "SOMETHING_NEW")).toBeNull();
  });

  it("says the same when the server refused it", () => {
    expect(outcomeText(de, { id: "d1", status: "failed", reason: "HANDLE_INVALID", detail: "EMPTY" }, "Französisch", false)).toBe("Fehlgeschlagen: Gib eine Webadresse ein.");
    expect(outcomeText(de, { id: "d1", status: "failed", reason: "HANDLE_INVALID" }, "Französisch", false)).toBe("Fehlgeschlagen. Versuch es noch einmal.");
  });
});
