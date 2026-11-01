/**
 * SecretValue (app/.server/lib/secret.ts): the only form a merchant's engine
 * key takes on the server. However it is serialised, printed or copied, the
 * value never shows; only reveal() returns it.
 */
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { SecretValue } from "../../app/.server/lib/secret";

// Built at runtime: a fictional value, long enough that any leak would be found.
const VALUE = `mock-deepl-${"7".repeat(24)}:fx`;

describe("SecretValue", () => {
  const secret = new SecretValue(VALUE);
  const nested = { a: { b: { c: { d: secret } } }, list: [secret], label: "kept" };

  it("returns the value only from reveal()", () => {
    expect(secret.reveal()).toBe(VALUE);
  });

  it("never shows the value in JSON, strings, template literals or concatenation", () => {
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
    expect(String(secret)).toBe("[REDACTED]");
    expect(`${secret}`).toBe("[REDACTED]");
    expect("" + secret).toBe("[REDACTED]");
    const json = JSON.stringify(nested);
    expect(json).not.toContain(VALUE);
    expect(json).toContain("kept");
  });

  it("never shows the value through util.inspect at any depth", () => {
    expect(inspect(secret)).toBe("[REDACTED]");
    expect(inspect(nested, { depth: 10 })).not.toContain(VALUE);
    expect(inspect(nested, { depth: Infinity, showHidden: true })).not.toContain(VALUE);
    expect(inspect({ wrap: { secret } }, { depth: Infinity })).toContain("[REDACTED]");
  });

  it("carries no value through spread, Object.keys, Object.entries or structuredClone", () => {
    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify({ ...secret })).toBe("{}");
    expect(JSON.stringify(Object.entries(secret))).not.toContain(VALUE);
    const spreadNested = { ...nested, a: { ...nested.a } };
    expect(JSON.stringify(spreadNested)).not.toContain(VALUE);
    expect(inspect(structuredClone(nested), { depth: Infinity })).not.toContain(VALUE);
    expect(JSON.stringify(structuredClone(nested))).not.toContain(VALUE);
  });
});
