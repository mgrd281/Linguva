/**
 * The import and export page's help on the file ("What's in the file?",
 * app/routes/app.translations.tsx): the status column's values as the file
 * writes them, the English codes in every language, also "complete", which
 * only an export of translated texts too has.
 */
import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, exportRows } from "../../app/.server/translation/csv-transfer";
import type { TranslatableResourceData } from "../../app/.server/shopify/translations-api";
import { APP_LOCALES, translate } from "../../app/i18n/i18n";

/** A product with a missing, an outdated and a translated text. */
const product: TranslatableResourceData = {
  resourceId: "gid://shopify/Product/1",
  content: [
    { key: "title", value: "Jacket", digest: "d1", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>Warm</p>", digest: "d2", locale: "en", type: "HTML" },
    { key: "handle", value: "jacket", digest: "d3", locale: "en", type: "URI" },
  ],
  translations: [
    { key: "body_html", value: "<p>Warm</p>", outdated: true, updatedAt: null },
    { key: "handle", value: "jacke", outdated: false, updatedAt: null },
  ],
};

describe("the export file's help", () => {
  it("names each status the file holds as the file writes it, in every language", () => {
    const status = EXPORT_COLUMNS.indexOf("status");
    const written = new Set(exportRows([product], "PRODUCT", "de", false).map((row) => row[status]!));
    expect(written).toEqual(new Set(["missing", "outdated", "complete"]));
    // Only gaps: no "complete" then.
    expect(new Set(exportRows([product], "PRODUCT", "de", true).map((row) => row[status]!))).toEqual(new Set(["missing", "outdated"]));
    for (const locale of APP_LOCALES) {
      const help = translate(locale, "transfer.file.status");
      for (const code of written) expect(help, `${locale}: ${code}`).toMatch(new RegExp(`\\b${code}\\b`));
    }
  });
});
