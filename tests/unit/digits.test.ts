/**
 * The numbers of a text (app/lib/digits.ts), moved unchanged from
 * validate.ts so Review can check an edited text in the browser exactly as
 * the server does.
 */
import { describe, expect, it } from "vitest";
import { validateTranslation } from "../../app/.server/translation/validate";
import { digitRuns, normalizeDigits } from "../../app/lib/digits";

describe("digitRuns", () => {
  it("reads digit runs, sorted as text", () => {
    expect(digitRuns("Pack of 12, 250 ml, 3 colours")).toEqual(["12", "250", "3"]);
    expect(digitRuns("No numbers")).toEqual([]);
  });

  it("accepts any decimal separator and ignores leading zeros", () => {
    expect(digitRuns("1.5 kg")).toEqual(digitRuns("1,5 kg"));
    expect(digitRuns("Nr. 007")).toEqual(["7"]);
    expect(digitRuns("0")).toEqual(["0"]);
  });

  it("reads Eastern Arabic and Persian digits as the same numbers", () => {
    expect(normalizeDigits("٤٢ و ۴۲")).toBe("42 و 42");
    expect(digitRuns("المقاس ٤٢، ٣ ألوان")).toEqual(digitRuns("Size 42, 3 colours"));
  });

  it("is what the server's number check compares", () => {
    expect(validateTranslation({ source: "From 10 to 20 cm", target: "20 bis 10 cm" })).toEqual([]);
    expect(validateTranslation({ source: "Pack of 12", target: "Lot de 10" })[0]).toMatchObject({
      code: "NUMBERS_CHANGED",
      detail: `source [${digitRuns("Pack of 12").join(", ")}] target [${digitRuns("Lot de 10").join(", ")}]`,
    });
  });
});
