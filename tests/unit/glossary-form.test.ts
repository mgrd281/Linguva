/**
 * The glossary's form: the server's problems placed on the field they are about, in words for that field
 * (never "translation: is required for preferred terms"); the rules' tiles; the list's search.
 */
import { describe, expect, it } from "vitest";
import { issueMessages, termInputSchema } from "../../app/.server/glossary/glossary";
import { translate, type MessageRef } from "../../app/i18n/i18n";
import { formProblems, GLOSSARY_RULES, isGlossaryRule, matchesQuery, RULE_LOOK } from "../../app/lib/glossary-form";

/** The add form's problems as the server returns them. */
function serverProblems(input: Record<string, unknown>): MessageRef[] {
  const parsed = termInputSchema.safeParse(input);
  if (parsed.success) return [];
  return issueMessages(parsed.error.issues);
}

describe("formProblems", () => {
  it("puts a missing translation and language of “Always translate as” on their fields", () => {
    const { fields, rest } = formProblems(serverProblems({ rule: "PREFERRED", term: "hoodie", translation: null, targetLocale: "" }));
    expect(fields.translation).toEqual({ key: "glossary.form.translationRequired" });
    expect(fields.targetLocale).toEqual({ key: "glossary.form.languageRequired" });
    expect(rest).toEqual([]);
    expect(translate("de", fields.translation!.key)).toBe("Gib das Wort ein, das die KI immer verwenden soll.");
  });

  it("puts an empty term, a too long text and a wrong market on their fields", () => {
    expect(formProblems(serverProblems({ rule: "DO_NOT_TRANSLATE", term: "" })).fields.term).toEqual({ key: "glossary.form.termRequired" });
    expect(formProblems(serverProblems({ rule: "DO_NOT_TRANSLATE", term: "x".repeat(201) })).fields.term).toEqual({ key: "glossary.form.tooLong", vars: { max: 200 } });
    expect(formProblems(serverProblems({ rule: "DO_NOT_TRANSLATE", term: "Brand", market: "abc" })).fields.market).toEqual({ key: "glossary.form.marketInvalid" });
  });

  it("keeps what belongs to no field for the banner, and only the first problem of a field", () => {
    const limit: MessageRef = { key: "glossary.error.limit", vars: { max: 5000 } };
    const twice: MessageRef[] = [
      { key: "glossary.issue.tooShort", vars: { field: "term", min: 1 } },
      { key: "glossary.issue.tooLong", vars: { field: "term", max: 200 } },
    ];
    expect(formProblems([limit])).toEqual({ fields: {}, rest: [limit] });
    expect(formProblems(twice).fields.term).toEqual({ key: "glossary.form.termRequired" });
    // A wrong rule (only a crafted request sends one) isn't a field's problem.
    expect(formProblems(serverProblems({ rule: "UNKNOWN", term: "x" })).rest).toHaveLength(1);
  });
});

describe("the rules' tiles", () => {
  it("has a tile with its own icon and words for each rule the server knows", () => {
    expect([...GLOSSARY_RULES]).toEqual(["DO_NOT_TRANSLATE", "PREFERRED", "FORBIDDEN"]);
    for (const rule of GLOSSARY_RULES) expect(termInputSchema.safeParse({ rule, term: "Brand", translation: "Marke", targetLocale: "de" }).success, rule).toBe(true);
    expect(new Set(GLOSSARY_RULES.map((r) => RULE_LOOK[r].icon)).size).toBe(3);
    expect(RULE_LOOK.DO_NOT_TRANSLATE.icon).toBe("pin");
    expect(RULE_LOOK.PREFERRED.icon).toBe("replace");
    expect(RULE_LOOK.FORBIDDEN.icon).toBe("alert-octagon");
    expect(isGlossaryRule("PREFERRED")).toBe(true);
    expect(isGlossaryRule("preferred")).toBe(false);
  });
});

describe("matchesQuery", () => {
  const term = { term: "Merino", translation: "Mérinos" };
  it("finds a term by its words or its translation, ignoring case", () => {
    expect(matchesQuery(term, "")).toBe(true);
    expect(matchesQuery(term, " meri ")).toBe(true);
    expect(matchesQuery(term, "MÉRINOS")).toBe(true);
    expect(matchesQuery(term, "wool")).toBe(false);
    expect(matchesQuery({ term: "Alpine", translation: null }, "alp")).toBe(true);
  });
});
