/**
 * The type the last coverage scan didn't finish reading (unreadSegment in
 * app/lib/coverage-view.ts), named by the Coverage page instead of "all done".
 */
import { describe, expect, it } from "vitest";
import { unreadSegment } from "../../app/lib/coverage-view";

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
});
