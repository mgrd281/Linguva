import { describe, expect, it } from "vitest";
import { UNMAPPABLE_SEGMENT } from "../../app/.server/providers/html-transport";
import type { TranslationProvider, TranslationRequest, TranslationResult } from "../../app/.server/providers/types";
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
      engines: ["deepl"],
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
      engines: ["deepl"],
      provider: provider((s) => s.replace(/<\/?g[^>]*>/g, "")),
      fields: [fields[1]!],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(outcomes[0]).toMatchObject({ key: "body_html", status: "rejected", reason: "MISSING_CODE" });
  });

  it("rejects fields with changed numbers", async () => {
    const { outcomes } = await translateFields({
      engines: ["deepl"],
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
    const formal = await translateFields({ engines: ["deepl"], provider: informal, fields: [field], sourceLocale: "en", targetLocale: "de", formality: "more" });
    expect(formal.outcomes[0]).toMatchObject({
      status: "translated",
      issues: [{ code: "FORMALITY_MISMATCH", severity: "warning", detail: "deine" }],
    });
    // Without a chosen form, or with the informal one, nothing is flagged.
    for (const formality of [undefined, "less"] as const) {
      const { outcomes } = await translateFields({ engines: ["deepl"], provider: informal, fields: [field], sourceLocale: "en", targetLocale: "de", ...(formality ? { formality } : {}) });
      expect(outcomes[0]).toMatchObject({ status: "translated", issues: [] });
    }
  });

  it("does not call the provider when nothing is translatable", async () => {
    const p = provider((s) => s);
    const { outcomes } = await translateFields({
      engines: ["deepl"],
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

describe("results from engines on the HTML transport (Microsoft Azure, Google Cloud)", () => {
  /** An engine that reports what it couldn't apply, its notes, and records the request it got. */
  function engine(result: Partial<Pick<TranslationResult, "dropped" | "notes" | "lostByEngine">> & { provider?: string; fail?: (s: string) => boolean } = {}) {
    const requests: TranslationRequest[] = [];
    const p: TranslationProvider & { requests: TranslationRequest[] } = {
      id: "azure",
      capabilities: { formality: false, context: false },
      requests,
      async translate(request) {
        requests.push(request);
        return {
          translations: request.segments.map((s) => (result.fail?.(s) ? UNMAPPABLE_SEGMENT : german(s))),
          billedCharacters: 7,
          provider: result.provider ?? "azure",
          ...(result.dropped ? { dropped: result.dropped } : {}),
          ...(result.notes ? { notes: result.notes } : {}),
          ...(result.lostByEngine ? { lostByEngine: result.lostByEngine } : {}),
        };
      },
    };
    return p;
  }
  const two = [
    { key: "title", value: "Red Shoe 42", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>Comfortable <b>leather</b> shoe.</p>", type: "HTML" },
  ];

  it("warns FORMALITY_NOT_APPLIED on every field the engine translated when a form of address was chosen", async () => {
    const p = engine({ dropped: ["formality", "context"] });
    const { outcomes } = await translateFields({ engines: ["azure"], provider: p, fields: two, sourceLocale: "en", targetLocale: "de", formality: "more" });
    for (const o of outcomes.filter((x) => x.status === "translated")) {
      expect(o.issues, o.key).toContainEqual({ code: "FORMALITY_NOT_APPLIED", severity: "warning", detail: "azure" });
    }
  });

  it("doesn't warn without a chosen form of address, or when the engine applied it", async () => {
    const without = await translateFields({ engines: ["azure"], provider: engine({ dropped: ["context"] }), fields: two, sourceLocale: "en", targetLocale: "de", formality: "more" });
    expect(without.outcomes.flatMap((o) => (o.status === "translated" ? o.issues : []))).toEqual([]);
    const notChosen = await translateFields({ engines: ["azure"], provider: engine({ dropped: ["formality"] }), fields: two, sourceLocale: "en", targetLocale: "de" });
    expect(notChosen.outcomes.flatMap((o) => (o.status === "translated" ? o.issues : []))).toEqual([]);
  });

  it("doesn't warn a field whose segments all came from memory", async () => {
    const p = engine({ dropped: ["formality"] });
    const memory = { lookup: async (sources: readonly string[]) => new Map(sources.filter((s) => s === "Red Shoe 42").map((s) => [s, { target: "Roter Schuh 42", id: "m1" }])) };
    const { outcomes } = await translateFields({ engines: ["azure"], provider: p, fields: two, sourceLocale: "en", targetLocale: "de", formality: "less", memory });
    const title = outcomes.find((o) => o.key === "title")!;
    expect(title.status === "translated" && title.issues).toEqual([]);
    const body = outcomes.find((o) => o.key === "body_html")!;
    expect(body.status === "translated" && body.issues.map((i) => i.code)).toEqual(["FORMALITY_NOT_APPLIED"]);
  });

  it("refuses a field the engine couldn't map back (ENGINE_MARKUP) and warns about changed spacing", async () => {
    const p = engine({ fail: (s) => s.includes("leather"), notes: [{ index: 1, code: "ENGINE_MARKUP" }, { index: 0, code: "SPACING_CHANGED" }] });
    const { outcomes } = await translateFields({ engines: ["azure"], provider: p, fields: two, sourceLocale: "en", targetLocale: "de" });
    expect(outcomes.find((o) => o.key === "body_html")).toEqual({ key: "body_html", status: "rejected", reason: "ENGINE_MARKUP", issues: [] });
    const title = outcomes.find((o) => o.key === "title")!;
    expect(title.status).toBe("translated");
    expect(title.status === "translated" && title.issues).toContainEqual({ code: "SPACING_CHANGED", severity: "warning" });
  });

  it("still refuses an unmappable segment as broken markup when the engine sent no note", async () => {
    const p = engine({ fail: (s) => s.includes("leather") });
    const { outcomes } = await translateFields({ engines: ["azure"], provider: p, fields: two, sourceLocale: "en", targetLocale: "de" });
    expect(outcomes.find((o) => o.key === "body_html")).toMatchObject({ status: "rejected", reason: "UNBALANCED_TAGS" });
  });

  it("marks line breaks in HTML fields as soft for engines on the HTML transport, and passes lost partials on", async () => {
    const p = engine({ lostByEngine: { deepl: 3 } });
    const result = await translateFields({
      engines: ["azure"],
      provider: p,
      fields: [
        { key: "body_html", value: "<p>Line one\nline two</p>", type: "HTML" },
        { key: "meta_description", value: "First\nsecond", type: "MULTI_LINE_TEXT_FIELD" },
      ],
      sourceLocale: "en",
      targetLocale: "de",
    });
    expect(p.requests[0]!.segments).toEqual(["Line one\nline two", "First\nsecond"]);
    expect(p.requests[0]!.softBreaks).toEqual([true, false]);
    expect(result.lostByEngine).toEqual({ deepl: 3 });
    // A single engine: no engine list in the request (it was checked before the call).
    expect(p.requests[0]!.engines).toBeUndefined();
  });

  it("keeps a bare DeepL request exactly as before: no soft breaks, no engine list", async () => {
    const p = provider(german);
    const requests: TranslationRequest[] = [];
    const original = p.translate.bind(p);
    p.translate = async (request) => {
      requests.push(request);
      return original(request);
    };
    await translateFields({ engines: ["deepl"], provider: p, fields: [{ key: "body_html", value: "<p>a\nb</p>", type: "HTML" }], sourceLocale: "en", targetLocale: "de", formality: "less", context: "Store" });
    expect(Object.keys(requests[0]!).sort()).toEqual(["context", "formality", "segments", "sourceLocale", "targetLocale"]);
  });
});
