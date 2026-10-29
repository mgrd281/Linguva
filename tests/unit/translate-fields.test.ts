import { describe, expect, it } from "vitest";
import type { TranslationProvider } from "../../app/.server/providers/types";
import {
  estimateCharacters,
  translateFields,
} from "../../app/.server/translation/translate-fields";

/** Test double that applies a function to each segment, like a real provider would. */
function provider(fn: (segment: string) => string): TranslationProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id: "test",
    calls,
    async translate(request) {
      calls.push([...request.segments]);
      return {
        translations: request.segments.map(fn),
        billedCharacters: request.segments.join("").length,
        provider: "test",
      };
    },
  };
}

const fields = [
  { key: "title", value: "Red Shoe 42", type: "SINGLE_LINE_TEXT_FIELD" },
  { key: "body_html", value: "<p>Comfortable <b>leather</b> shoe.</p>", type: "HTML" },
  { key: "handle", value: "red-shoe", type: "URI" },
  { key: "meta_description", value: "", type: "MULTI_LINE_TEXT_FIELD" },
];

const german = (s: string) =>
  s.replace("Red Shoe", "Roter Schuh").replace("Comfortable", "Bequemer").replace("leather", "Leder").replace("shoe.", "Schuh.");

describe("translateFields", () => {
  it("translates all machine-translatable fields in one provider call", async () => {
    const p = provider(german);
    const { outcomes, billedCharacters } = await translateFields({
      provider: p,
      fields,
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(p.calls).toHaveLength(1);
    expect(outcomes).toMatchObject([
      { key: "title", status: "translated", value: "Roter Schuh 42", issues: [] },
      { key: "body_html", status: "translated", value: "<p>Bequemer <b>Leder</b> Schuh.</p>", issues: [] },
      { key: "handle", status: "skipped", reason: "MANUAL_ONLY" },
      { key: "meta_description", status: "skipped", reason: "EMPTY" },
    ]);
    expect(billedCharacters).toBeGreaterThan(0);
  });

  it("rejects fields whose inline structure was broken", async () => {
    const { outcomes } = await translateFields({
      provider: provider((s) => s.replace(/<\/?g[^>]*>/g, "")),
      fields: [fields[1]!],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(outcomes[0]).toMatchObject({ key: "body_html", status: "rejected", reason: "MISSING_CODE" });
  });

  it("rejects fields with changed numbers", async () => {
    const { outcomes } = await translateFields({
      provider: provider((s) => s.replace("42", "43")),
      fields: [fields[0]!],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(outcomes[0]).toMatchObject({ status: "rejected", reason: "VALIDATION_FAILED" });
  });

  it("warns when the result uses another form of address than the merchant chose", async () => {
    const informal = provider(() => "Bestelle deine Jacke heute.");
    const field = { key: "title", value: "Order your jacket today.", type: "SINGLE_LINE_TEXT_FIELD" };
    const formal = await translateFields({ provider: informal, fields: [field], sourceLocale: "en", targetLocale: "de", formality: "more" });
    expect(formal.outcomes[0]).toMatchObject({
      status: "translated",
      issues: [{ code: "FORMALITY_MISMATCH", severity: "warning", detail: "deine" }],
    });
    // Without a chosen form, or with the informal one, nothing is flagged.
    for (const formality of [undefined, "less"] as const) {
      const { outcomes } = await translateFields({ provider: informal, fields: [field], sourceLocale: "en", targetLocale: "de", ...(formality ? { formality } : {}) });
      expect(outcomes[0]).toMatchObject({ status: "translated", issues: [] });
    }
  });

  it("does not call the provider when nothing is translatable", async () => {
    const p = provider((s) => s);
    const { outcomes } = await translateFields({
      provider: p,
      fields: [fields[2]!, fields[3]!, { key: "title", value: "1234", type: "STRING" }],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(p.calls).toHaveLength(0);
    expect(outcomes.map((o) => o.status)).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("estimates characters from segment sources only", () => {
    expect(estimateCharacters(fields)).toBe(
      "Red Shoe 42".length + 'Comfortable <g id="1">leather</g> shoe.'.length,
    );
  });
});
