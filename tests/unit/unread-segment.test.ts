/**
 * The type the last coverage scan didn't finish reading (unreadSegment in
 * app/lib/coverage-view.ts), named by the Coverage page instead of "all done",
 * and what the page says about it (unreadMessage).
 */
import { describe, expect, it } from "vitest";
import { translator } from "../../app/i18n/i18n";
import { unreadMessage, unreadSegment } from "../../app/lib/coverage-view";

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
