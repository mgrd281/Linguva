/**
 * The type the last coverage scan didn't finish reading (unreadSegment in
 * app/lib/coverage-view.ts), named by the Coverage page instead of "all done",
 * and what the page says about it (unreadMessage).
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { COVERAGE_TYPES } from "../../app/.server/coverage/coverage";
import { coverageNextStep, measuredLocales, storeWide, unreadableTypes, unreadMessage, unreadSegment, type CountInput } from "../../app/lib/coverage-view";

const seg = (locale: string, resourceType: string, status: string) => ({ locale, resourceType, status });
const options = { locales: ["de", "fr", "ar"], types: ["PRODUCT", "COLLECTION", "ONLINE_STORE_THEME"], selected: null, scanning: false };

describe("unread segment", () => {
  it("finds content skipped after errors, or left half read when no scan is under way", () => {
    expect(unreadSegment([seg("de", "PRODUCT", "SCANNED")], options)).toBeNull();
    expect(unreadSegment([seg("de", "PRODUCT", "FAILED")], options)).toMatchObject({ locale: "de", resourceType: "PRODUCT" });
    expect(unreadSegment([seg("de", "PRODUCT", "SCANNING")], options)).toMatchObject({ locale: "de" });
    // A scan under way reads it: not unread, but content it skipped is.
    expect(unreadSegment([seg("de", "PRODUCT", "SCANNING")], { ...options, scanning: true })).toBeNull();
    expect(unreadSegment([seg("de", "PRODUCT", "FAILED")], { ...options, scanning: true })).toMatchObject({ locale: "de" });
  });

  it("ignores types the figures don't count and languages not shown", () => {
    expect(unreadSegment([seg("de", "ONLINE_STORE_THEME", "FAILED"), seg("ja", "PRODUCT", "FAILED")], options)).toBeNull();
  });

  it("names the selected language first, then the languages' and types' order", () => {
    const rows = [seg("ar", "PRODUCT", "FAILED"), seg("fr", "COLLECTION", "FAILED"), seg("fr", "PRODUCT", "FAILED")];
    expect(unreadSegment(rows, options)).toMatchObject({ locale: "fr", resourceType: "PRODUCT" });
    expect(unreadSegment(rows, { ...options, selected: "ar" })).toMatchObject({ locale: "ar" });
  });

  it("while a scan runs, names what needs another scan before what it reads again by itself", () => {
    const rows = [{ ...seg("de", "PRODUCT", "FAILED"), ahead: true }, { ...seg("ar", "COLLECTION", "FAILED"), ahead: false }];
    expect(unreadSegment(rows, { ...options, selected: "de", scanning: true })).toMatchObject({ locale: "ar" });
    // Without a scan under way, nothing reads it by itself: the usual order.
    expect(unreadSegment(rows, { ...options, selected: "de" })).toMatchObject({ locale: "de" });
  });
});

describe("what the page says about it", () => {
  const de = translator("de");
  const vars = { type: "Seiten", language: "Französisch" };

  it("asks for a scan, or, while one is under way, says whether it reads the type again", () => {
    expect(unreadMessage({ ahead: false }, false)).toBe("coverage.next.unread");
    // A stalled scan is no longer under way: a type ahead of it needs a new scan too.
    expect(unreadMessage({ ahead: true }, false)).toBe("coverage.next.unread");
    expect(unreadMessage({ ahead: true }, true)).toBe("coverage.next.unreadScanning");
    // Skipped by the scan under way itself, or a language it doesn't cover: it won't come back to it.
    expect(unreadMessage({ ahead: false }, true)).toBe("coverage.next.unreadAfterScan");
  });

  it("names the content types Linguva can't read, in the singular and the plural", () => {
    expect(de.t("coverage.next.denied", { count: 1, types: "Menüs" })).toBe(
      "Linguva kann 1 Inhaltstyp noch nicht lesen (Menüs), daher fehlt er in den Zahlen. Erlaube den Zugriff, um ihn zu zählen und zu übersetzen.",
    );
    expect(translator("en").t("coverage.next.denied", { count: 3, types: "Menus, Menu links and Policies" })).toMatch(/^Linguva can't read 3 content types yet \(Menus, Menu links and Policies\), so they aren't/);
    expect(translator("fr").t("coverage.store.denied", { count: 2 })).toBe("Hors de ce chiffre : 2 types de contenu que Linguva ne peut pas encore lire.");
    expect(translator("es").t("coverage.store.denied", { count: 1 })).toBe("Fuera de esta cifra: 1 tipo de contenido que Linguva aún no puede leer.");
  });

  it("reads correctly with the plural type names", () => {
    expect(de.t(unreadMessage({ ahead: true }, true), vars)).toBe(
      "Bei der letzten Prüfung nicht vollständig gelesen: Seiten (Französisch). Die Zahlen sind vielleicht älter oder unvollständig, bis die laufende Prüfung diese Inhalte erneut gelesen hat.",
    );
    expect(de.t(unreadMessage({ ahead: false }, true), vars)).toBe(
      "Nicht vollständig gelesen: Seiten (Französisch). Die Zahlen sind vielleicht älter oder unvollständig; prüfe den Shop erneut, sobald die laufende Prüfung fertig ist.",
    );
    expect(translator("fr").t("coverage.next.unreadScanning", { type: "Pages", language: "allemand" })).toMatch(/ait relu ces contenus\.$/);
    expect(translator("en").t("coverage.next.unreadScanning", { type: "Pages", language: "German" })).toMatch(/The figures may .* has read this content again\.$/);
    expect(translator("es").t("coverage.next.unreadScanning", { type: "Páginas", language: "alemán" })).toMatch(/vuelva a leer este contenido\.$/);
  });
});

/** The Coverage page's figures and next step: never 100 % or "all done" over what wasn't read. */
describe("languages read in full, and the Coverage page's next step", () => {
  const full = (locale: string, status = "SCANNED") => COVERAGE_TYPES.map((resourceType) => ({ locale, resourceType, status, ahead: false }));
  const complete = (locale: string, resourceType = "PRODUCT", count = 10): CountInput[] => [
    { locale, resourceType, fieldGroup: "title", state: "complete", count },
    { locale, resourceType, fieldGroup: "description", state: "complete", count },
  ];
  const fr = { locale: "fr", published: true };
  const it_ = { locale: "it", published: true };
  const idle = { scanning: false, locales: [] };
  type Input = Parameters<typeof coverageNextStep>[0];
  const next = (input: Partial<Input> & Pick<Input, "segments" | "measured">) =>
    coverageNextStep({ counts: complete("fr"), targets: [fr], types: COVERAGE_TYPES, selected: "fr", scan: idle, ...input });

  it("leaves out a published language added after the last scan, and asks to scan it (no false 100 %)", () => {
    const segments = full("fr");
    const measured = measuredLocales({ locales: ["fr"] }, segments, COVERAGE_TYPES);
    expect([...measured]).toEqual(["fr"]);
    // Counted over the measured published languages only: French alone ("1 of 2 published languages").
    expect(storeWide(complete("fr"), [...measured])).toMatchObject({ complete: 20, total: 20 });
    expect(next({ segments, measured, targets: [fr, it_] })).toEqual({ kind: "unmeasured", locale: "it", message: "coverage.next.unmeasured" });
    // A hidden language added later doesn't hold it back.
    expect(next({ segments, measured, targets: [fr, { locale: "it", published: false }] })).toBeNull();
  });

  it("doesn't count a language whose rows went with it (removed, or now the primary language) although the last measurement read it", () => {
    expect([...measuredLocales({ locales: ["fr", "it"] }, full("fr"), COVERAGE_TYPES)]).toEqual(["fr"]);
    // Nor one missing a type the headline counts (a type added to the scan since).
    const withoutMenus = full("fr").filter((s) => s.resourceType !== "MENU");
    expect(measuredLocales({ locales: ["fr"] }, withoutMenus, COVERAGE_TYPES).size).toBe(0);
    // Theme texts aren't in the figures: a theme type without a row doesn't matter.
    const withoutTheme = full("fr").filter((s) => s.resourceType !== "ONLINE_STORE_THEME");
    expect([...measuredLocales({ locales: ["fr"] }, withoutTheme, COVERAGE_TYPES)]).toEqual(["fr"]);
    expect(measuredLocales(null, full("fr"), COVERAGE_TYPES).size).toBe(0);
  });

  it("during a first scan, measures no language and waits for the scan instead of all done", () => {
    // The scan has read the products (all translated) and is reading the collections.
    const segments = [
      { locale: "fr", resourceType: "PRODUCT", status: "SCANNED", ahead: false },
      { locale: "fr", resourceType: "COLLECTION", status: "SCANNING", ahead: false },
    ];
    const measured = measuredLocales(null, segments, COVERAGE_TYPES);
    expect(measured.size).toBe(0);
    expect(storeWide(complete("fr"), [...measured]).percent).toBeNull();
    expect(next({ segments, measured, scan: { scanning: true, locales: ["fr"] } })).toEqual({ kind: "unmeasured", locale: "fr", message: "coverage.next.unmeasuredScanning" });
    // A scan that doesn't read the language: scan again after it.
    expect(next({ segments, measured, scan: { scanning: true, locales: ["de"] } })).toMatchObject({ message: "coverage.next.unmeasuredAfterScan" });
  });

  it("names types without access and never says all done over them", () => {
    const segments = full("fr").map((s) => (["MENU", "LINK", "METAOBJECT", "ONLINE_STORE_THEME"].includes(s.resourceType) ? { ...s, status: "DENIED" } : s));
    const measured = measuredLocales({ locales: ["fr"] }, segments, COVERAGE_TYPES);
    expect([...measured]).toEqual(["fr"]);
    // Theme texts aren't in the figures; another language's rows don't count.
    expect(unreadableTypes(segments, { locales: ["fr"], types: COVERAGE_TYPES })).toEqual(["MENU", "LINK", "METAOBJECT"]);
    expect(unreadableTypes(segments, { locales: ["de"], types: COVERAGE_TYPES })).toEqual([]);
    expect(next({ segments, measured })).toEqual({ kind: "denied", types: ["MENU", "LINK", "METAOBJECT"] });
  });

  it("never says all done while a scan is under way, and says it once everything is read", () => {
    const segments = full("fr");
    const measured = measuredLocales({ locales: ["fr"] }, segments, COVERAGE_TYPES);
    expect(next({ segments, measured, scan: { scanning: true, locales: ["fr"] } })).toEqual({ kind: "scanning" });
    expect(next({ segments, measured })).toBeNull();
  });

  it("still asks for drafts, failed and missing fields first, then for content the last scan didn't finish", () => {
    const segments = full("fr");
    const measured = measuredLocales({ locales: ["fr"] }, segments, COVERAGE_TYPES);
    const drafts: CountInput[] = [...complete("fr"), { locale: "fr", resourceType: "PRODUCT", fieldGroup: "title", state: "draft", count: 2 }];
    expect(next({ segments, measured, counts: drafts, targets: [fr, it_] })).toEqual({ kind: "review", locale: "fr", count: 2 });
    const gaps: CountInput[] = [...complete("fr"), { locale: "fr", resourceType: "COLLECTION", fieldGroup: "title", state: "outdated", count: 3 }];
    expect(next({ segments, measured, counts: gaps })).toEqual({ kind: "missing", locale: "fr", type: "COLLECTION", count: 3 });
    // URLs are optional: a missing handle isn't the next step.
    const urls: CountInput[] = [...complete("fr"), { locale: "fr", resourceType: "PRODUCT", fieldGroup: "url", state: "missing", count: 10 }];
    expect(next({ segments, measured, counts: urls })).toBeNull();
    const failed = segments.map((s) => (s.resourceType === "PAGE" ? { ...s, status: "FAILED" } : s));
    expect(next({ segments: failed, measured, targets: [fr, it_] })).toMatchObject({ kind: "unread", segment: { resourceType: "PAGE" }, message: "coverage.next.unread" });
  });
});
