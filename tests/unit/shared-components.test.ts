/**
 * The shared components both Redesign 3 pages use (Jobs SPEC §8.3 and §10.2 "Unit, components"), rendered on the
 * server as plan-components.test.ts does. The snapshots in the first block were written from the code before
 * Redesign 3: what the Overview, the language and area pages, Review, Memory, Glossary and Settings render with
 * these components stays byte for byte the same.
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmModal } from "../../app/components/ConfirmModal";
import { KEPT_COLOUR, percentLabel, STATE_COLOURS, TRACK_COLOUR } from "../../app/components/Coverage";
import { CoverageRing, ringFigureSize, type RingSegment } from "../../app/components/CoverageRing";
import { Breadcrumbs, NumberedSteps } from "../../app/components/LanguageLayout";
import { InlineNotice } from "../../app/components/SettingsParts";
import { APP_LOCALES, translator, type AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";
import type { StateCounts } from "../../app/lib/coverage-rules";

const COUNTS: StateCounts = { complete: 34, review: 1, draft: 17, failed: 2, outdated: 6, missing: 40 };
const EMPTY: StateCounts = { complete: 0, review: 0, draft: 0, failed: 0, outdated: 0, missing: 0 };

/** Server markup of a component, inside the interface language's provider (ConfirmModal reads it). */
function html(node: ReactNode, locale: AppLocale = "en"): string {
  return renderToStaticMarkup(createElement(I18nProvider, { locale, timeZone: "Europe/Berlin" } as ComponentProps<typeof I18nProvider>, node));
}

/** The opening tags of one element, in document order. */
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
/** An attribute's value in a tag. */
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
/** The figure's font size in a ring's markup. */
const figureSize = (markup: string) => Number(markup.match(/<span style="font-size:(\d+)px/)?.[1]);

describe("unchanged for the pages that already use them", () => {
  it("CoverageRing: counts and a figure of up to 3 characters (Overview, language and area pages)", () => {
    expect(html(createElement(CoverageRing, { counts: COUNTS, figure: "34%", caption: "translated", label: "34% translated", size: 112 }))).toMatchInlineSnapshot(`"<div style="position:relative;width:112px;height:112px;flex:none"><svg width="112" height="112" viewBox="0 0 120 120" role="img" aria-label="34% translated"><circle cx="60" cy="60" r="48" fill="none" stroke="#ebebeb" stroke-width="12"></circle><g transform="rotate(-90 60 60)" fill="none" stroke-width="12"><circle cx="60" cy="60" r="48" stroke="#29845a" stroke-dasharray="102.54158421317085 199.0513105314493" stroke-dashoffset="0"></circle><circle cx="60" cy="60" r="48" stroke="#0094d5" stroke-dasharray="54.286721054031624 247.3061736905885" stroke-dashoffset="-102.54158421317085"></circle><circle cx="60" cy="60" r="48" stroke="#b98900" stroke-dasharray="18.09557368467721 283.4973210599429" stroke-dashoffset="-156.82830526720247"></circle><circle cx="60" cy="60" r="48" stroke="#c70a24" stroke-dasharray="6.031857894892403 295.5610368497277" stroke-dashoffset="-174.9238789518797"></circle></g></svg><div aria-hidden="true" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:28px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em">34%</span><s-text color="subdued">translated</s-text></div></div>"`);
    expect(html(createElement(CoverageRing, { counts: EMPTY, figure: "—", caption: "translated", label: "Not counted yet", size: 112 }))).toMatchInlineSnapshot(`"<div style="position:relative;width:112px;height:112px;flex:none"><svg width="112" height="112" viewBox="0 0 120 120" role="img" aria-label="Not counted yet"><circle cx="60" cy="60" r="48" fill="none" stroke="#ebebeb" stroke-width="12"></circle><g transform="rotate(-90 60 60)" fill="none" stroke-width="12"></g></svg><div aria-hidden="true" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:28px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em">—</span><s-text color="subdued">translated</s-text></div></div>"`);
    expect(html(createElement(CoverageRing, { counts: { ...EMPTY, complete: 1, missing: 400 }, figure: "<1%", caption: "translated", label: "Under 1%" }))).toMatchInlineSnapshot(`"<div style="position:relative;width:120px;height:120px;flex:none"><svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Under 1%"><circle cx="60" cy="60" r="48" fill="none" stroke="#ebebeb" stroke-width="12"></circle><g transform="rotate(-90 60 60)" fill="none" stroke-width="12"><circle cx="60" cy="60" r="48" stroke="#29845a" stroke-dasharray="2 299.59289474462014" stroke-dashoffset="0"></circle></g></svg><div aria-hidden="true" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:28px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em">&lt;1%</span><s-text color="subdued">translated</s-text></div></div>"`);
    expect(html(createElement(CoverageRing, { counts: COUNTS, figure: "34%", caption: "translated", label: "34% translated", size: 96 }))).toMatchInlineSnapshot(`"<div style="position:relative;width:96px;height:96px;flex:none"><svg width="96" height="96" viewBox="0 0 120 120" role="img" aria-label="34% translated"><circle cx="60" cy="60" r="48" fill="none" stroke="#ebebeb" stroke-width="12"></circle><g transform="rotate(-90 60 60)" fill="none" stroke-width="12"><circle cx="60" cy="60" r="48" stroke="#29845a" stroke-dasharray="102.54158421317085 199.0513105314493" stroke-dashoffset="0"></circle><circle cx="60" cy="60" r="48" stroke="#0094d5" stroke-dasharray="54.286721054031624 247.3061736905885" stroke-dashoffset="-102.54158421317085"></circle><circle cx="60" cy="60" r="48" stroke="#b98900" stroke-dasharray="18.09557368467721 283.4973210599429" stroke-dashoffset="-156.82830526720247"></circle><circle cx="60" cy="60" r="48" stroke="#c70a24" stroke-dasharray="6.031857894892403 295.5610368497277" stroke-dashoffset="-174.9238789518797"></circle></g></svg><div aria-hidden="true" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:22px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.01em">34%</span><s-text color="subdued">translated</s-text></div></div>"`);
  });

  it("Breadcrumbs without touch (language, area, Review, Plan, smart schedule, content lists)", () => {
    const i18n = translator("de");
    const flag = createElement("span", { "aria-hidden": "true" }, "DE");
    expect(
      html(createElement(Breadcrumbs, { i18n, trail: [{ href: "/app", label: "Übersicht" }, { href: "/app/languages/de", label: "Deutsch", before: flag }], current: "Produkte" }), "de"),
    ).toMatchInlineSnapshot(`"<nav aria-label="Brotkrumen"><s-stack direction="inline" gap="small-200" alignItems="center"><s-stack direction="inline" gap="small-200" alignItems="center"><s-link href="/app">Übersicht</s-link><span aria-hidden="true"><s-text color="subdued">›</s-text></span></s-stack><s-stack direction="inline" gap="small-200" alignItems="center"><span aria-hidden="true">DE</span><s-link href="/app/languages/de">Deutsch</s-link><span aria-hidden="true"><s-text color="subdued">›</s-text></span></s-stack><span aria-current="page"><s-text color="subdued">Produkte</s-text></span></s-stack></nav>"`);
  });

  it("NumberedSteps with a title of its own (a node) and the step numbers", () => {
    const title = createElement("span", { style: { fontWeight: 650 } }, "12 texts to approve");
    expect(
      html(
        createElement(NumberedSteps, {
          steps: [
            { key: "review", title, detail: "Customers see them once you approve them.", action: createElement("s-button", { href: "/app/review" }, "Review now") },
            { key: "count", title: createElement("strong", null, "Count again") },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`"<ol style="list-style:none;margin:0;padding:0;display:grid;gap:16px"><li><s-stack direction="block" gap="base"><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start"><s-stack background="strong" borderRadius="large-200" inlineSize="24px" blockSize="24px" alignItems="center" justifyContent="center"><s-text type="strong">1</s-text></s-stack><s-stack direction="block" gap="small-200"><s-stack direction="block" gap="small-500"><span style="font-weight:650">12 texts to approve</span><s-text color="subdued">Customers see them once you approve them.</s-text></s-stack><s-stack direction="inline"><s-button href="/app/review">Review now</s-button></s-stack></s-stack></s-grid></s-stack></li><li><s-stack direction="block" gap="base"><s-divider></s-divider><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start"><s-stack background="base" border="base" borderRadius="large-200" inlineSize="24px" blockSize="24px" alignItems="center" justifyContent="center"><s-text type="strong">2</s-text></s-stack><s-stack direction="block" gap="small-200"><s-stack direction="block" gap="small-500"><strong>Count again</strong></s-stack></s-stack></s-grid></s-stack></li></ol>"`);
  });

  it("ConfirmModal with a text body and the default dismiss button (Review, Memory, Glossary, the job page)", () => {
    const modal = createElement(ConfirmModal, { id: "memory-delete", heading: "Delete this entry?", body: "It is gone for good.", confirmLabel: "Delete", onConfirm: () => undefined });
    expect(html(modal)).toMatchInlineSnapshot(`"<s-modal id="memory-delete" heading="Delete this entry?" accessibilityLabel="Delete this entry?"><s-paragraph>It is gone for good.</s-paragraph><s-button slot="primary-action" variant="primary" tone="critical" commandFor="memory-delete" command="--hide">Delete</s-button><s-button slot="secondary-actions" commandFor="memory-delete" command="--hide">Cancel</s-button></s-modal>"`);
    expect(html(modal, "de")).toMatchInlineSnapshot(`"<s-modal id="memory-delete" heading="Delete this entry?" accessibilityLabel="Delete this entry?"><s-paragraph>It is gone for good.</s-paragraph><s-button slot="primary-action" variant="primary" tone="critical" commandFor="memory-delete" command="--hide">Delete</s-button><s-button slot="secondary-actions" commandFor="memory-delete" command="--hide">Abbrechen</s-button></s-modal>"`);
  });

  it("InlineNotice without a tone (Settings, the smart schedule, the keys card)", () => {
    expect(
      html(createElement(InlineNotice, { icon: "lock", heading: "Not in your plan", actions: createElement("s-button", { href: "/app/plan" }, "See plans") }, "Your plan no longer includes it.")),
    ).toMatchInlineSnapshot(`"<s-box background="subdued" borderRadius="large-100" padding="base"><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start"><s-icon type="lock"></s-icon><s-stack direction="block" gap="small-300"><s-stack direction="block" gap="small-500"><span style="margin:0;font-size:13px;line-height:20px;font-weight:600;display:block">Not in your plan</span><s-text color="subdued">Your plan no longer includes it.</s-text></s-stack><s-query-container><s-grid gridTemplateColumns="@container (inline-size &gt; 360px) auto 1fr, 1fr" gap="small-200" alignItems="center"><s-button href="/app/plan">See plans</s-button></s-grid></s-query-container></s-stack></s-grid></s-box>"`);
  });
});

describe("CoverageRing (Jobs SPEC §3.4)", () => {
  const C = 2 * Math.PI * 48;
  // …01 French · Products while running: 176 wait, 30 were already up to date, 2 incomplete, 4 failed, 128 open.
  const JOB: RingSegment[] = [
    { colour: STATE_COLOURS.draft, count: 176 },
    { colour: KEPT_COLOUR, count: 30 },
    { colour: STATE_COLOURS.outdated, count: 2 },
    { colour: STATE_COLOURS.failed, count: 4 },
    { colour: TRACK_COLOUR, count: 128 },
  ];
  const ring = (props: Partial<Parameters<typeof CoverageRing>[0]>) => html(createElement(CoverageRing, { figure: "60%", caption: "done", label: "60% done.", size: 112, ...props }));

  it("sizes the figure by its length in characters and the ring's size", () => {
    expect(ringFigureSize("62%", 112)).toBe(28);
    expect(ringFigureSize("62%", 96)).toBe(22);
    expect(ringFigureSize("62 %", 112)).toBe(24);
    expect(ringFigureSize("62 %", 96)).toBe(20);
    expect(ringFigureSize("100 %", 112)).toBe(22);
    expect(ringFigureSize("100 %", 96)).toBe(18);
    expect(ringFigureSize("100%", 120)).toBe(24);
    expect(ringFigureSize("—", 112)).toBe(28);
    expect(ringFigureSize("18", 96)).toBe(22);
    // The figures the app really writes, through percentLabel, in every interface language.
    for (const locale of APP_LOCALES) {
      const i18n = translator(locale);
      const sixtyTwo = percentLabel(i18n, 62, 100);
      const hundred = percentLabel(i18n, 100, 100);
      expect([figureSize(ring({ figure: sixtyTwo })), figureSize(ring({ figure: sixtyTwo, size: 96 }))], `${locale} ${sixtyTwo}`).toEqual(locale === "en" ? [28, 22] : [24, 20]);
      expect([figureSize(ring({ figure: hundred })), figureSize(ring({ figure: hundred, size: 96 }))], `${locale} ${hundred}`).toEqual(locale === "en" ? [24, 20] : [22, 18]);
    }
  });

  it("keeps 28 px for a figure of up to 3 characters, as on the Overview and the language page ('34%')", () => {
    for (const figure of ["34%", "0%", "<1%", "—"]) {
      expect(figureSize(ring({ counts: COUNTS, figure })), figure).toBe(28);
      expect(figureSize(ring({ counts: COUNTS, figure, size: 120 })), figure).toBe(28);
    }
  });

  it("draws the segments it is given, in their order clockwise from 12 o'clock, each starting where the last ended", () => {
    const markup = ring({ segments: JOB });
    const circles = tags(markup, "circle");
    // The track, then one circle per coloured segment; what is left (the track's colour) isn't drawn.
    expect(circles).toHaveLength(5);
    expect(attr(circles[0]!, "stroke")).toBe(TRACK_COLOUR);
    expect(attr(circles[0]!, "stroke-dasharray")).toBeUndefined();
    // The dash offset is negative: how far along the ring the segment starts.
    const drawn = circles.slice(1).map((c) => ({ colour: attr(c, "stroke"), length: Number(attr(c, "stroke-dasharray")!.split(" ")[0]), offset: Math.abs(Number(attr(c, "stroke-dashoffset"))) }));
    expect(drawn.map((d) => d.colour)).toEqual([STATE_COLOURS.draft, KEPT_COLOUR, STATE_COLOURS.outdated, STATE_COLOURS.failed]);
    expect(drawn[0]!.offset).toBe(0);
    expect(drawn[0]!.length).toBeCloseTo((176 / 340) * C, 6);
    expect(drawn[1]!.length).toBeCloseTo((30 / 340) * C, 6);
    // 2 of 340 is shorter than the shortest visible segment.
    expect(drawn[2]!.length).toBe(2);
    expect(drawn[3]!.length).toBeCloseTo((4 / 340) * C, 6);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]!.offset).toBeCloseTo(drawn[i - 1]!.offset + drawn[i - 1]!.length, 9);
    // The segments are inside the group turned to 12 o'clock.
    expect(markup).toMatch(/<g transform="rotate\(-90 60 60\)"[^>]*><circle/);
    expect(markup).toContain('role="img" aria-label="60% done."');
  });

  it("uses the segments instead of the counts when both are given, and draws a full ring for all done", () => {
    const both = ring({ counts: COUNTS, segments: [{ colour: STATE_COLOURS.complete, count: 10 }] });
    const circles = tags(both, "circle");
    expect(circles).toHaveLength(2);
    expect(attr(circles[1]!, "stroke")).toBe(STATE_COLOURS.complete);
    expect(Number(attr(circles[1]!, "stroke-dasharray")!.split(" ")[0])).toBeCloseTo(C, 9);
    expect(tags(ring({ segments: [{ colour: KEPT_COLOUR, count: 23 }], figure: "100%", caption: "up to date" }), "circle").map((c) => attr(c, "stroke"))).toEqual([TRACK_COLOUR, KEPT_COLOUR]);
  });

  it("draws a dashed track and no segments while the job is still finding its items", () => {
    const markup = ring({ dashed: true, segments: JOB, figure: "18", caption: "found", label: "18 found so far" });
    const circles = tags(markup, "circle");
    expect(circles).toHaveLength(1);
    expect(attr(circles[0]!, "stroke")).toBe(TRACK_COLOUR);
    expect(attr(circles[0]!, "stroke-dasharray")).toBe("6 5");
    expect(figureSize(markup)).toBe(28);
    // Without counts or segments: the empty track alone.
    expect(tags(ring({ dashed: true }), "circle")).toHaveLength(1);
    expect(tags(ring({}), "circle")).toHaveLength(1);
  });
});

describe("ConfirmModal (Jobs SPEC §5.7)", () => {
  const modal = (extra: Partial<Parameters<typeof ConfirmModal>[0]> = {}) =>
    createElement(ConfirmModal, { id: "job-cancel", heading: "Cancel this job?", body: "206 products are done and stay.", confirmLabel: "Cancel job", onConfirm: () => undefined, ...extra });
  const dismiss = (markup: string) => markup.match(/<s-button slot="secondary-actions"[^>]*>([^<]*)<\/s-button>/)?.[1];

  it("shows its own dismiss label: 'Keep translating' beside 'Cancel job'", () => {
    const markup = html(modal({ dismissLabel: "Keep translating" }));
    expect(dismiss(markup)).toBe("Keep translating");
    expect(markup).toMatch(/<s-button slot="primary-action" variant="primary" tone="critical" commandFor="job-cancel" command="--hide">Cancel job<\/s-button>/);
    expect(markup).not.toMatch(/>Cancel</);
  });

  it("says 'Cancel' in the interface language without one", () => {
    for (const locale of APP_LOCALES) expect(dismiss(html(modal(), locale)), locale).toBe(translator(locale).t("common.action.cancel"));
  });

  it("is named by its heading", () => {
    expect(tags(html(modal()), "s-modal")[0]).toBe('<s-modal id="job-cancel" heading="Cancel this job?" accessibilityLabel="Cancel this job?">');
  });

  it("shows a body of its own as given, a text body as one paragraph", () => {
    const body = createElement("s-stack", { direction: "block", gap: "base" }, createElement("s-paragraph", null, "First."), createElement("s-paragraph", null, "Second."));
    const markup = html(modal({ body }));
    expect(markup).toContain('<s-stack direction="block" gap="base"><s-paragraph>First.</s-paragraph><s-paragraph>Second.</s-paragraph></s-stack>');
    expect(tags(markup, "s-paragraph")).toHaveLength(2);
    expect(html(modal())).toContain("<s-paragraph>206 products are done and stay.</s-paragraph>");
  });
});

describe("Breadcrumbs touch (Jobs SPEC §5.2)", () => {
  const i18n = translator("en");
  const crumbs = (touch?: boolean) => html(createElement(Breadcrumbs, { i18n, trail: [{ href: "/app/jobs", label: "Jobs" }], current: "French · Products", touch }));

  it("renders the trail for a wide container and one 44 px back row for a narrow one, each in its container display", () => {
    const markup = crumbs(true);
    const boxes = tags(markup, "s-box");
    expect(boxes.map((b) => attr(b, "display"))).toEqual(["@container (inline-size &gt; 640px) auto, none", "@container (inline-size &gt; 640px) none, auto"]);
    const [wide, narrow] = markup.split(/<s-box display="@container \(inline-size &gt; 640px\) none, auto">/);
    // Wide: today's trail, the page itself marked as current.
    expect(wide).toContain('<s-link href="/app/jobs">Jobs</s-link>');
    expect(wide).toContain('<span aria-current="page"><s-text color="subdued">French · Products</s-text></span>');
    expect(wide).not.toContain("s-clickable");
    // Narrow: the whole row is the link back, at least 44 px tall, chevron and the parent's name.
    expect(narrow).toBe(
      '<s-clickable href="/app/jobs" padding="small-200 none" minBlockSize="44px" borderRadius="base"><s-stack direction="inline" gap="small-300" alignItems="center"><s-icon type="chevron-left" color="subdued" size="small"></s-icon><s-text>Jobs</s-text></s-stack></s-clickable></s-box></nav>',
    );
    // One landmark around both.
    expect(tags(markup, "nav")).toEqual(['<nav aria-label="Breadcrumb">']);
  });

  it("leads back to the last link of a longer trail and stays the plain trail without touch", () => {
    const longer = html(createElement(Breadcrumbs, { i18n, trail: [{ href: "/app", label: "Overview" }, { href: "/app/languages/de", label: "German" }], current: "Products", touch: true }));
    expect(tags(longer, "s-clickable").map((c) => attr(c, "href"))).toEqual(["/app/languages/de"]);
    expect(crumbs(false)).toBe(crumbs(undefined));
    expect(crumbs(false)).not.toMatch(/s-box|s-clickable/);
  });
});

describe("NumberedSteps titles (Jobs SPEC §5.2)", () => {
  it("sets a title given as text in semibold, since s-text type=\"strong\" draws at the body weight", () => {
    const markup = html(createElement(NumberedSteps, { steps: [{ key: "review", title: "Approve 452 translations", detail: "For 176 products." }, { key: "retry", title: "Try 1 product again" }] }));
    expect(markup).toContain('<strong style="font-weight:600">Approve 452 translations</strong>');
    expect(markup).toContain('<strong style="font-weight:600">Try 1 product again</strong>');
    // Only the step numbers still use s-text type="strong".
    expect(markup.match(/<s-text type="strong">([^<]*)<\/s-text>/g)).toEqual(['<s-text type="strong">1</s-text>', '<s-text type="strong">2</s-text>']);
  });
});

describe("InlineNotice tone and KEPT_COLOUR (Jobs SPEC §8.3)", () => {
  it("draws the notice's icon in its tone (the busy notice: info)", () => {
    const markup = html(createElement(InlineNotice, { icon: "info", tone: "info", heading: "Another French · Products job is running (since 2:20 PM)" }, "It translates them too."));
    expect(tags(markup, "s-icon")).toEqual(['<s-icon type="info" tone="info">']);
  });

  it("is STATE_COLOURS.complete tinted 55 % toward white: 'already up to date' in the green family", () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(KEPT_COLOUR).toBe(`#${channels(STATE_COLOURS.complete).map((c) => Math.round(c + 0.55 * (255 - c)).toString(16).padStart(2, "0")).join("")}`);
    expect(KEPT_COLOUR).not.toBe(TRACK_COLOUR);
  });
});
