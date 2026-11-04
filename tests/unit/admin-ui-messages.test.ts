/**
 * The admin console's texts (app/admin/messages.ts): English and Arabic have
 * the same keys and the same placeholders, no text is empty, every key is
 * used somewhere in app/ (written out, so a search finds it), and the
 * Arabic catalog really is Arabic (with Western digits).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { adminT, ar, en, type AdminMessageKey } from "../../app/admin/messages";

const ROOT = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const SOURCES = files("app")
  .filter((path) => relative(ROOT, join(ROOT, path)) !== join("app", "admin", "messages.ts"))
  .map((path) => readFileSync(join(ROOT, path), "utf8"))
  .join("\n");

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const KEYS = Object.keys(en) as AdminMessageKey[];

describe("the admin console's catalogs", () => {
  it("have the same keys in English and Arabic", () => {
    expect(Object.keys(ar).sort()).toEqual([...KEYS].sort());
    expect(KEYS.length).toBeGreaterThan(150);
  });

  it("have no empty text and the same placeholders in both languages", () => {
    for (const key of KEYS) {
      expect(en[key].trim(), key).not.toBe("");
      expect(ar[key].trim(), key).not.toBe("");
      expect(placeholders(ar[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("use every key in app/ (written out in full)", () => {
    const unused = KEYS.filter((key) => !SOURCES.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("are Arabic in Arabic, with Western digits only", () => {
    // Product and plan names stay as they are (Linguva, Starter, Pro, Business, Shopify, DeepL…).
    const latinOnly = KEYS.filter((key) => !/[\u0600-\u06FF]/.test(ar[key]));
    expect(latinOnly.sort()).toEqual(["customer.usageLinguva", "plan.business", "plan.pro", "plan.starter"]);
    expect(KEYS.filter((key) => /[\u0660-\u0669\u06F0-\u06F9]/.test(ar[key]))).toEqual([]);
  });

  it("fill in placeholders and leave unknown ones visible", () => {
    expect(adminT("en", "customers.range", { from: 1, to: 50, total: 120 })).toBe("1–50 of 120");
    expect(adminT("ar", "customers.range", { from: 1, to: 50, total: 120 })).toBe("1–50 من 120");
    expect(adminT("en", "overview.endsOn")).toBe("Ends {date}");
  });

  it("say the messages the sign-in rules require", () => {
    expect(en["login.errorInvalid"]).toBe("E-mail, password or code is wrong.");
    expect(en["login.errorLocked"]).toBe("Too many attempts. Try again in 15 minutes.");
    expect(en["overview.billingOffTitle"]).toBe("Shopify billing isn't configured");
    // The reason's limits, as parsePriceForm checks them.
    expect(en["prices.error.REASON_REQUIRED"]).toContain("3 to 500 characters");
  });
});
