import { describe, expect, it } from "vitest";
import {
  MAX_ENABLED_LOCALES,
  isRtlLocale,
  summarizeLocales,
} from "../../app/.server/locales/shop-locales";

describe("summarizeLocales", () => {
  it("puts the primary locale first and counts published locales", () => {
    const summary = summarizeLocales([
      { locale: "fr", name: "French", primary: false, published: true },
      { locale: "ar", name: "Arabic", primary: false, published: false },
      { locale: "de", name: "German", primary: true, published: true },
    ]);
    expect(summary.locales.map((l) => l.locale)).toEqual(["de", "ar", "fr"]);
    expect(summary.primary?.locale).toBe("de");
    expect(summary.enabledCount).toBe(3);
    expect(summary.publishedCount).toBe(2);
    expect(summary.remainingEnabled).toBe(MAX_ENABLED_LOCALES - 3);
    expect(summary.locales.find((l) => l.locale === "ar")?.rtl).toBe(true);
  });

  it("never reports negative remaining capacity", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      locale: `x${i}`,
      name: `L${i}`,
      primary: i === 0,
      published: true,
    }));
    expect(summarizeLocales(many).remainingEnabled).toBe(0);
  });
});

describe("isRtlLocale", () => {
  it("detects RTL scripts including regional variants", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("he-IL")).toBe(true);
    expect(isRtlLocale("fa")).toBe(true);
    expect(isRtlLocale("de")).toBe(false);
    expect(isRtlLocale("uk")).toBe(false);
  });
});
